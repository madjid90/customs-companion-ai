// ============================================================================
// POST-PROCESSOR MODULE
// Logique de post-traitement partagée entre mode streaming et classique
// ============================================================================

import {
  validateAllSources,
  extractCodesFromResponse,
  extractProductKeywords,
  filterCitedCirculars,
  type DBEvidence,
  type ValidatedSource,
} from "./source-validator.ts";
import { determineConfidence } from "./prompt-builder.ts";
import { cleanHSCode } from "./hs-utils.ts";
import type { RAGContext, TariffWithInheritance } from "./context-builder.ts";

// =============================================================================
// TYPES
// =============================================================================

export interface PostProcessInput {
  responseText: string;
  question: string;
  enrichedQuestion: string;
  context: RAGContext;
  analysis: {
    intent: string;
    country: string;
    detectedCodes: string[];
    keywords: string[];
  };
  queryEmbedding: number[] | null;
  useSemanticSearch: boolean;
  sessionId: string;
  images?: any[];
  startTime: number;
  supabase: any;
  SUPABASE_URL: string;
}

export interface PostProcessResult {
  confidence: string;
  responseWithValidation: string;
  citedCirculars: CitedCircular[];
  sourceValidation: {
    sources_validated: ValidatedSource[];
    sources_rejected: any[];
    has_evidence: boolean;
    message: string;
  };
  contextUsed: Record<string, any>;
  conversationId?: string;
  responseTime: number;
  codesForValidation: string[];
}

export interface CitedCircular {
  id: string;
  reference_type: string;
  reference_number: string;
  title: string;
  reference_date: string | null;
  download_url: string | null;
  pdf_title: string | null;
  validated: boolean;
  page_number?: number;
}

// =============================================================================
// POST-PROCESS RESPONSE
// =============================================================================

/**
 * Post-processing unifié : validation des sources, construction des citations,
 * sauvegarde de la conversation et du cache.
 */
export async function postProcessResponse(input: PostProcessInput): Promise<PostProcessResult> {
  const {
    responseText, question, enrichedQuestion, context, analysis,
    queryEmbedding, useSemanticSearch, sessionId, images,
    startTime, supabase, SUPABASE_URL,
  } = input;

  const responseTime = Date.now() - startTime;
  const confidence = determineConfidence(responseText, context);

  // Extract codes from AI response for validation
  const responseCodes = extractCodesFromResponse(responseText);
  const questionKeywords = extractProductKeywords(question || enrichedQuestion);

  // STRICT: Use ONLY codes from the AI response
  const codesForValidation = responseCodes.length > 0
    ? responseCodes
    : analysis.detectedCodes.slice(0, 5);

  // Get chapters from response codes (for filtering sources)
  const responseChapters = new Set<string>();
  for (const code of codesForValidation) {
    const clean = String(code).replace(/\D/g, '');
    if (clean.length >= 2) {
      responseChapters.add(clean.substring(0, 2).padStart(2, "0"));
    }
  }

  // Build filtered tariffs
  let filteredTariffs = [
    ...context.tariffs,
    ...context.tariffs_with_inheritance.map((t: TariffWithInheritance) => ({
      country_code: analysis.country,
      national_code: t.code_clean,
      description_local: t.description,
      duty_rate: t.duty_rate,
      source_pdf: null,
      source_evidence: t.legal_notes.join("; "),
    })),
  ].filter(t => {
    const code = String(t.national_code || t.hs_code_6 || '').replace(/\D/g, '');
    if (code.length < 2) return false;
    const chapter = code.substring(0, 2).padStart(2, "0");
    return responseChapters.has(chapter);
  });

  // FALLBACK: If AI response has codes but context had no tariffs, fetch from DB
  if (filteredTariffs.length === 0 && responseChapters.size > 0) {
    const chapterCodes = Array.from(responseChapters);
    console.log("[post-processor] No tariffs in context, fetching for chapters:", chapterCodes);
    
    // Try fetching by exact codes first
    const exactCodes = codesForValidation
      .map(c => String(c).replace(/\D/g, ''))
      .filter(c => c.length >= 6);
    
    if (exactCodes.length > 0) {
      const { data: dbTariffs } = await supabase
        .from('country_tariffs')
        .select('national_code, hs_code_6, description_local, duty_rate, vat_rate, source_pdf, source_page, source_evidence')
        .eq('country_code', analysis.country)
        .eq('is_active', true)
        .or(exactCodes.map(c => `national_code.eq.${c}`).join(','))
        .limit(20);
      if (dbTariffs && dbTariffs.length > 0) {
        filteredTariffs = dbTariffs;
        console.log(`[post-processor] Fetched ${dbTariffs.length} tariffs by exact codes`);
      }
    }
    
    // Fallback: fetch by chapter prefix
    if (filteredTariffs.length === 0) {
      for (const chapter of chapterCodes.slice(0, 3)) {
        const { data: chapterTariffs } = await supabase
          .from('country_tariffs')
          .select('national_code, hs_code_6, description_local, duty_rate, vat_rate, source_pdf, source_page, source_evidence')
          .eq('country_code', analysis.country)
          .eq('is_active', true)
          .like('national_code', `${chapter}%`)
          .limit(10);
        if (chapterTariffs && chapterTariffs.length > 0) {
          filteredTariffs.push(...chapterTariffs);
          console.log(`[post-processor] Fetched ${chapterTariffs.length} tariffs for chapter ${chapter}`);
        }
      }
    }
  }

  // FALLBACK: search by keywords if no codes matched
  if (filteredTariffs.length === 0 && codesForValidation.length === 0 && questionKeywords.length > 0) {
    const keywordSearchTerms = questionKeywords.slice(0, 3).filter(k => k.length >= 4);
    if (keywordSearchTerms.length > 0) {
      const { data: keywordTariffs } = await supabase
        .from('country_tariffs')
        .select('national_code, hs_code_6, description_local, duty_rate, vat_rate, source_pdf, source_evidence')
        .eq('country_code', analysis.country)
        .eq('is_active', true)
        .or(keywordSearchTerms.map(kw => `description_local.ilike.%${kw}%`).join(','))
        .limit(10);
      if (keywordTariffs && keywordTariffs.length > 0) {
        filteredTariffs = keywordTariffs;
        for (const t of keywordTariffs) {
          const code = String(t.national_code || t.hs_code_6 || '').replace(/\D/g, '');
          if (code.length >= 2) {
            responseChapters.add(code.substring(0, 2).padStart(2, "0"));
          }
        }
      }
    }
  }

  // Filter PDFs by chapter
  let filteredPdfs = context.pdf_summaries.filter((p: any) => {
    const chapter = String(p.chapter_number || '').padStart(2, "0");
    return responseChapters.has(chapter);
  });

  // FALLBACK: If no PDFs in context, search pdf_documents for chapter SH_CODE files
  if (filteredPdfs.length === 0 && responseChapters.size > 0) {
    const chapterCodes = Array.from(responseChapters);
    const patterns = chapterCodes.map(ch => `%SH_CODE_${ch}%`);
    const { data: dbPdfs } = await supabase
      .from('pdf_documents')
      .select('id, title, file_name, file_path, category, country_code')
      .eq('is_active', true)
      .or(patterns.map(p => `file_name.ilike.${p}`).join(','))
      .limit(5);
    if (dbPdfs && dbPdfs.length > 0) {
      filteredPdfs = dbPdfs.map((p: any) => ({
        ...p,
        chapter_number: chapterCodes[0],
        download_url: p.file_path
          ? `${SUPABASE_URL}/storage/v1/object/public/pdf-documents/${p.file_path}`
          : null,
      }));
      console.log(`[post-processor] Fetched ${dbPdfs.length} PDFs for chapters:`, chapterCodes);
    }
  }

  // Build DB evidence
  const dbEvidence: DBEvidence = {
    tariffs: filteredTariffs,
    notes: [],
    evidence: [],
    pdfSummaries: filteredPdfs,
    legalRefs: context.legal_references.filter((ref: any) => {
      const refContext = (ref.context || "").toLowerCase();
      const refTitle = (ref.title || "").toLowerCase();
      if (codesForValidation.some(code => {
        const clean = String(code).replace(/\D/g, '');
        return refContext.includes(clean) || refContext.includes(clean.substring(0, 4));
      })) return true;
      if (codesForValidation.length === 0) {
        return questionKeywords.some(kw =>
          kw.length >= 4 && (refContext.includes(kw.toLowerCase()) || refTitle.includes(kw.toLowerCase()))
        );
      }
      return false;
    }),
    legalChunks: ((context as any)._legalChunks || []).filter((chunk: any) => {
      const chunkText = (chunk.chunk_text || "").toLowerCase();
      const hasKeywordMatch = questionKeywords.some(kw =>
        kw.length >= 4 && chunkText.includes(kw.toLowerCase())
      );
      const hasHighSimilarity = chunk.similarity && chunk.similarity >= 0.6;
      const hasArticleNumber = !!chunk.article_number;
      return hasKeywordMatch || hasHighSimilarity || hasArticleNumber;
    }),
  };

  // Validate sources
  const sourceValidation = await validateAllSources(
    supabase, responseText, question || "", dbEvidence, SUPABASE_URL
  );

  console.log("Source validation result:", {
    validated: sourceValidation.sources_validated.length,
    rejected: sourceValidation.sources_rejected.length,
    has_evidence: sourceValidation.has_evidence,
    filteredTariffs: filteredTariffs.length,
    filteredPdfs: filteredPdfs.length,
  });

  // Build cited circulars
  const citedCirculars: CitedCircular[] = [];
  for (const validSource of sourceValidation.sources_validated.slice(0, 8)) {
    let refType = "Preuve";
    if (validSource.type === "pdf") refType = "Tarif";
    else if (validSource.type === "legal") {
      refType = (validSource.title?.toLowerCase().includes("article") || validSource.reference?.includes("Art."))
        ? "Article" : "Circulaire";
    } else if (validSource.type === "tariff") refType = "Ligne tarifaire";

    citedCirculars.push({
      id: validSource.id,
      reference_type: refType,
      reference_number: validSource.reference || validSource.chapter || "",
      title: validSource.title,
      reference_date: null,
      download_url: validSource.download_url,
      pdf_title: validSource.title,
      validated: true,
      page_number: validSource.page_number,
    });
  }

  // Build context used
  const contextUsed = {
    tariffs_with_inheritance: context.tariffs_with_inheritance.length,
    hs_codes: context.hs_codes.length,
    tariffs: context.tariffs.length,
    controlled: context.controlled_products.length,
    documents: context.knowledge_documents.length,
    pdfs: context.pdf_summaries.length,
    semantic_search_used: useSemanticSearch,
    sources_validated: sourceValidation.sources_validated.length,
    sources_rejected: sourceValidation.sources_rejected.length,
  };

  // Save conversation
  const { data: conversation } = await supabase
    .from('conversations')
    .insert({
      session_id: sessionId,
      question: question,
      response: responseText,
      detected_intent: analysis.intent,
      detected_hs_codes: codesForValidation,
      context_used: contextUsed,
      pdfs_used: context.pdf_summaries.map((p: any) => p.title),
      confidence_level: confidence,
      response_time_ms: responseTime,
    })
    .select('id')
    .single();

  // Add validation warning if needed
  let responseWithValidation = responseText;
  if (!sourceValidation.has_evidence && codesForValidation.length > 0) {
    responseWithValidation += "\n\n---\n⚠️ **Note**: Aucune source interne ne confirme ce code SH. Cette classification est indicative et nécessite vérification auprès des autorités douanières.";
  }

  return {
    confidence,
    responseWithValidation,
    citedCirculars,
    sourceValidation,
    contextUsed,
    conversationId: conversation?.id,
    responseTime,
    codesForValidation,
  };
}

/**
 * Sauvegarde dans le cache sémantique (fire-and-forget)
 */
export function saveToCache(
  supabase: any,
  saveToResponseCacheFn: Function,
  question: string,
  queryEmbedding: number[] | null,
  result: PostProcessResult,
  images?: any[]
): void {
  if (queryEmbedding && result.confidence !== "low" && (!images || images.length === 0) && question) {
    saveToResponseCacheFn(
      supabase,
      question,
      queryEmbedding,
      result.responseWithValidation,
      result.contextUsed,
      result.confidence,
      result.citedCirculars,
      result.sourceValidation.has_evidence,
      result.sourceValidation.message
    ).catch((err: any) => console.error("Cache save error:", err));
  }
}
