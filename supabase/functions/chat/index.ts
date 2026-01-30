// ============================================================================
// CHAT EDGE FUNCTION - POINT D'ENTRÉE PRINCIPAL
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders,
  handleCorsPreFlight,
  checkRateLimitDistributed,
  rateLimitResponse,
  getClientId,
  errorResponse,
  successResponse,
} from "../_shared/cors.ts";
import { validateChatRequest } from "../_shared/validation.ts";
import { createLogger } from "../_shared/logger.ts";
import { fetchWithRetry, type RetryConfig } from "../_shared/retry.ts";

// Modules refactorisés
import { cleanHSCode, escapeSearchTerm } from "./hs-utils.ts";
import {
  SEMANTIC_THRESHOLDS,
  getAdaptiveThresholds,
  generateQueryEmbedding,
  checkResponseCache,
  saveToResponseCache,
  searchHSCodesSemantic,
  searchKnowledgeHybrid,
  searchPDFsHybrid,
  searchVeilleHybrid,
} from "./semantic-search.ts";
import {
  analyzeQuestion,
  extractHistoryContext,
  analyzePdfWithClaude,
  analyzeImageWithLovableAI,
  type ImageInput,
  type PdfInput,
  type ImageAnalysisResult,
  type PdfAnalysisResult,
} from "./analysis.ts";
import {
  searchHSCodeWithInheritance,
  formatTariffForRAG,
  createEmptyContext,
  buildAvailableSources,
  type RAGContext,
  type TariffWithInheritance,
} from "./context-builder.ts";
import { buildSystemPrompt, determineConfidence } from "./prompt-builder.ts";

// =============================================================================
// CONFIGURATION
// =============================================================================

const LOVABLE_AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_AI_MODEL = "google/gemini-2.5-flash";

// =============================================================================
// HANDLER PRINCIPAL
// =============================================================================

serve(async (req) => {
  const logger = createLogger("chat", req);
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }

  logger.info("Request received", { method: req.method });

  // Rate limiting
  const clientId = getClientId(req);
  const rateLimit = await checkRateLimitDistributed(clientId, {
    maxRequests: 30,
    windowMs: 60000,
    blockDurationMs: 300000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse(req, rateLimit.resetAt);
  }

  try {
    // Parse et valider le body
    let body: unknown;
    try {
      body = await req.json();
    } catch (e) {
      logger.error("Invalid JSON body", e as Error);
      return errorResponse(req, "Body JSON invalide", 400);
    }

    const validation = validateChatRequest(body);
    if (!validation.valid) {
      logger.warn("Validation failed", { error: validation.error });
      return errorResponse(req, validation.error!, 400);
    }

    const { question, sessionId, images, pdfDocuments, conversationHistory } = validation.data!;
    logger.info("Request validated", { sessionId, hasImages: !!images?.length, hasPdfs: !!pdfDocuments?.length });

    if (!question && (!images || images.length === 0) && (!pdfDocuments || pdfDocuments.length === 0)) {
      return errorResponse(req, "Question, images or PDF documents required", 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // =========================================================================
    // SEMANTIC CACHE CHECK
    // =========================================================================
    let queryEmbedding: number[] | null = null;
    let useSemanticSearch = false;

    if (OPENAI_API_KEY && question) {
      queryEmbedding = await generateQueryEmbedding(question, OPENAI_API_KEY);
      useSemanticSearch = queryEmbedding !== null;

      if (queryEmbedding && (!images || images.length === 0)) {
        const cachedResponse = await checkResponseCache(supabase, queryEmbedding, 0.92);
        if (cachedResponse.found && cachedResponse.response) {
          console.log("Cache hit! Similarity:", cachedResponse.response.similarity);
          return new Response(
            JSON.stringify({
              response: cachedResponse.response.text,
              confidence: cachedResponse.response.confidence,
              cached: true,
              metadata: { cached: true, similarity: cachedResponse.response.similarity }
            }),
            { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
          );
        }
      }
    }

    // =========================================================================
    // ANALYSE DES MÉDIAS (IMAGES/PDFs)
    // =========================================================================
    let imageAnalysis: ImageAnalysisResult | null = null;
    let pdfAnalysis: PdfAnalysisResult | null = null;
    let enrichedQuestion = question || "";
    
    const historyContext = extractHistoryContext(conversationHistory);
    
    // Analyse des images
    if (images && images.length > 0) {
      console.log("Analyzing", images.length, "image(s) with Lovable AI Vision...");
      try {
        imageAnalysis = await analyzeImageWithLovableAI(images as ImageInput[], question || "Identifie ce produit", LOVABLE_API_KEY);
        console.log("Image analysis result:", JSON.stringify(imageAnalysis));
        
        enrichedQuestion = `${question || "Identifie ce produit et donne-moi le code SH"}

[ANALYSE D'IMAGE]
Description du produit identifié: ${imageAnalysis.productDescription}
Codes SH suggérés par l'analyse visuelle: ${imageAnalysis.suggestedCodes.join(", ") || "Aucun"}
${imageAnalysis.questions.length > 0 ? `Questions de clarification: ${imageAnalysis.questions.join("; ")}` : ""}`;
      } catch (visionError) {
        console.error("Vision analysis failed:", visionError);
      }
    }

    // Analyse des PDFs
    if (pdfDocuments && pdfDocuments.length > 0) {
      console.log("Analyzing", pdfDocuments.length, "PDF(s) with Claude...");
      const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
      
      if (ANTHROPIC_API_KEY) {
        try {
          pdfAnalysis = await analyzePdfWithClaude(pdfDocuments as PdfInput[], question || "Analyse ce document", ANTHROPIC_API_KEY);
          console.log("PDF analysis complete. Content length:", pdfAnalysis.fullContent?.length || 0);
          
          enrichedQuestion = `${question || "Analyse ce document"}

[EXTRACTION COMPLÈTE DU DOCUMENT PDF]
=== RÉSUMÉ ===
${pdfAnalysis.summary}

=== CONTENU INTÉGRAL EXTRAIT ===
${pdfAnalysis.fullContent || "Non disponible"}

=== INFORMATIONS STRUCTURÉES ===
${pdfAnalysis.extractedInfo}

${pdfAnalysis.suggestedCodes.length > 0 ? `=== CODES SH IDENTIFIÉS ===\n${pdfAnalysis.suggestedCodes.join(", ")}` : ""}`;
        } catch (pdfError) {
          console.error("PDF analysis failed:", pdfError);
          const fileNames = pdfDocuments.map(p => p.fileName).join(", ");
          enrichedQuestion = `${question || ""}\n\n[Documents uploadés: ${fileNames} - Erreur lors de l'analyse]`;
        }
      }
    }

    // =========================================================================
    // ANALYSE DE LA QUESTION
    // =========================================================================
    const searchQuestion = historyContext + enrichedQuestion;
    const analysis = analyzeQuestion(searchQuestion);
    
    if (imageAnalysis?.suggestedCodes.length) {
      const cleanedSuggested = imageAnalysis.suggestedCodes.map(c => cleanHSCode(c));
      analysis.detectedCodes = [...new Set([...analysis.detectedCodes, ...cleanedSuggested])];
    }
    console.log("Question analysis:", JSON.stringify(analysis));

    // =========================================================================
    // COLLECTE DU CONTEXTE
    // =========================================================================
    const context: RAGContext = createEmptyContext();

    // 1. Recherche avec héritage pour les codes détectés
    if (analysis.detectedCodes.length > 0) {
      console.log("Searching with inheritance for codes:", analysis.detectedCodes);
      for (const code of analysis.detectedCodes.slice(0, 15)) {
        const tariffWithInheritance = await searchHSCodeWithInheritance(supabase, code, analysis.country);
        if (tariffWithInheritance.found) {
          context.tariffs_with_inheritance.push(tariffWithInheritance);
        }
        if (tariffWithInheritance.description) {
          context.hs_codes.push({
            code: tariffWithInheritance.code,
            code_clean: tariffWithInheritance.code_clean,
            description_fr: tariffWithInheritance.description,
            chapter_number: tariffWithInheritance.chapter,
            level: tariffWithInheritance.level,
          });
        }
      }
    }
    
    // 2. Search HS codes by keywords
    if (analysis.keywords.length > 0 && context.hs_codes.length < 10) {
      for (const keyword of analysis.keywords.slice(0, 3)) {
        const escapedKeyword = escapeSearchTerm(keyword);
        const { data } = await supabase
          .from('hs_codes')
          .select('code, code_clean, description_fr, description_en, chapter_number, level')
          .or(`description_fr.ilike.%${escapedKeyword}%,description_en.ilike.%${escapedKeyword}%`)
          .eq('is_active', true)
          .limit(5);
        if (data) context.hs_codes.push(...data);
      }
    }
    
    context.hs_codes = [...new Map(context.hs_codes.map(item => [item.code, item])).values()].slice(0, 30);

    // 3. Get tariffs for found codes
    const codes6 = [...new Set(context.hs_codes.map(c => cleanHSCode(c.code || c.code_clean).substring(0, 6)))];
    if (codes6.length > 0 && context.tariffs_with_inheritance.length === 0) {
      const { data } = await supabase
        .from('country_tariffs')
        .select('hs_code_6, national_code, description_local, duty_rate, vat_rate, other_taxes, is_prohibited, is_restricted')
        .eq('country_code', analysis.country)
        .in('hs_code_6', codes6)
        .eq('is_active', true)
        .limit(20);
      if (data) context.tariffs = data;
    }

    // 4. Check for controlled products
    if (context.tariffs_with_inheritance.length === 0) {
      const codes4 = [...new Set(context.hs_codes.map(c => cleanHSCode(c.code || c.code_clean).substring(0, 4)))];
      if (codes4.length > 0) {
        for (const code4 of codes4.slice(0, 5)) {
          const { data } = await supabase
            .from('controlled_products')
            .select('hs_code, control_type, control_authority, standard_required, required_documents, notes')
            .eq('country_code', analysis.country)
            .ilike('hs_code', `${code4}%`)
            .eq('is_active', true);
          if (data?.length) context.controlled_products.push(...data);
        }
      }
    }

    // 5. Search knowledge documents
    if (analysis.keywords.length > 0) {
      const searchTerms = analysis.keywords.slice(0, 5);
      for (const term of searchTerms) {
        const escapedTerm = escapeSearchTerm(term);
        const { data } = await supabase
          .from('knowledge_documents')
          .select('title, content, category, source_url')
          .or(`title.ilike.%${escapedTerm}%,content.ilike.%${escapedTerm}%`)
          .eq('is_active', true)
          .limit(5);
        if (data) context.knowledge_documents.push(...data);
      }
      context.knowledge_documents = [...new Map(context.knowledge_documents.map(d => [d.title, d])).values()].slice(0, 10);
    }

    // 6. Get relevant PDF summaries
    const chaptersForPdf = context.hs_codes.length > 0 
      ? [...new Set(context.hs_codes.map(c => cleanHSCode(c.code || c.code_clean).substring(0, 2)))]
      : [];
    
    if (chaptersForPdf.length > 0) {
      const chapterConditions: string[] = [];
      for (const chapter of chaptersForPdf.slice(0, 10)) {
        const chapterNum = parseInt(chapter);
        const paddedChapter = chapterNum.toString().padStart(2, '0');
        
        if (chapterNum < 10) {
          chapterConditions.push(`title.ilike.%Chapitre SH ${paddedChapter}`);
          chapterConditions.push(`title.ilike.%SH_CODE_${paddedChapter}.%`);
        } else {
          chapterConditions.push(`title.ilike.%Chapitre SH ${chapterNum}%`);
          chapterConditions.push(`title.ilike.%SH_CODE_${chapterNum}.%`);
        }
      }
      
      const { data: pdfDocs } = await supabase
        .from('pdf_documents')
        .select('id, title, category, file_path')
        .eq('is_active', true)
        .or(chapterConditions.join(','))
        .limit(15);
      
      if (pdfDocs && pdfDocs.length > 0) {
        const pdfIds = pdfDocs.map((d: any) => d.id);
        const { data: extractions } = await supabase
          .from('pdf_extractions')
          .select('summary, key_points, mentioned_hs_codes, extracted_text, extracted_data, pdf_id')
          .in('pdf_id', pdfIds);
        
        if (extractions) {
          const pdfMap = new Map(pdfDocs.map((d: any) => [d.id, d]));
          context.pdf_summaries = extractions.map((ext: any) => {
            const pdfDoc = pdfMap.get(ext.pdf_id) as any;
            const filePath = pdfDoc?.file_path;
            return {
              title: pdfDoc?.title,
              category: pdfDoc?.category,
              summary: ext.summary,
              key_points: ext.key_points,
              full_text: ext.extracted_text,
              mentioned_codes: ext.mentioned_hs_codes,
              download_url: filePath ? `${SUPABASE_URL}/storage/v1/object/public/pdf-documents/${filePath}` : null,
            };
          });
        }
      }
    }

    // 7. Get veille documents
    let veilleDocuments: any[] = [];
    if (analysis.keywords.length > 0) {
      const veilleSearchTerm = escapeSearchTerm(analysis.keywords.slice(0, 2).join(' '));
      const { data: veille } = await supabase
        .from('veille_documents')
        .select('id, title, summary, content, source_name, source_url, category, importance, publication_date, mentioned_hs_codes')
        .eq('is_verified', true)
        .or(`title.ilike.%${veilleSearchTerm}%,summary.ilike.%${veilleSearchTerm}%,content.ilike.%${veilleSearchTerm}%`)
        .order('publication_date', { ascending: false })
        .limit(5);
      
      if (veille) veilleDocuments = veille;
    }

    // 8. Get legal references
    if (analysis.keywords.length > 0) {
      const legalSearchTerm = escapeSearchTerm(analysis.keywords[0] || '');
      const { data: refs } = await supabase
        .from('legal_references')
        .select(`
          id, reference_type, reference_number, title, reference_date, context, pdf_id,
          pdf_documents!inner(id, title, category, file_path, issuing_authority, document_reference)
        `)
        .or(`reference_number.ilike.%${legalSearchTerm}%,title.ilike.%${legalSearchTerm}%`)
        .eq('is_active', true)
        .limit(10);
      
      if (refs) {
        context.legal_references = refs.map((ref: any) => ({
          ...ref,
          pdf_title: ref.pdf_documents?.title,
          download_url: ref.pdf_documents?.file_path 
            ? `${SUPABASE_URL}/storage/v1/object/public/pdf-documents/${ref.pdf_documents.file_path}`
            : null,
        }));
      }
    }

    // Get legal PDF texts for citations
    const legalPdfIds = [...new Set(context.legal_references.map((ref: any) => ref.pdf_id).filter(Boolean))];
    const legalPdfTexts: Record<string, { text: string; title: string; download_url: string }> = {};
    
    if (legalPdfIds.length > 0) {
      const { data: pdfExtracts } = await supabase
        .from('pdf_extractions')
        .select(`pdf_id, extracted_text, summary, key_points, pdf_documents!inner(title, file_path)`)
        .in('pdf_id', legalPdfIds.slice(0, 10));
      
      if (pdfExtracts) {
        for (const extract of pdfExtracts as any[]) {
          const pdfDoc = extract.pdf_documents as any;
          legalPdfTexts[extract.pdf_id] = {
            text: extract.extracted_text || extract.summary || '',
            title: pdfDoc?.title || 'Document',
            download_url: pdfDoc?.file_path 
              ? `${SUPABASE_URL}/storage/v1/object/public/pdf-documents/${pdfDoc.file_path}`
              : '',
          };
        }
      }
    }

    // 9. Get regulatory procedures
    if (analysis.keywords.length > 0) {
      const procSearchTerm = escapeSearchTerm(analysis.keywords[0] || '');
      const { data: procedures } = await supabase
        .from('regulatory_procedures')
        .select(`
          id, procedure_name, required_documents, deadlines, penalties, authority,
          pdf_documents!inner(id, title, category, file_path)
        `)
        .or(`procedure_name.ilike.%${procSearchTerm}%,authority.ilike.%${procSearchTerm}%`)
        .eq('is_active', true)
        .limit(5);
      
      if (procedures) {
        context.regulatory_procedures = procedures.map((proc: any) => ({
          ...proc,
          pdf_title: proc.pdf_documents?.title,
        }));
      }
    }

    // =========================================================================
    // SEMANTIC SEARCH ENHANCEMENT
    // =========================================================================
    if (useSemanticSearch && queryEmbedding) {
      console.log("Using semantic search enhancement...");
      const adaptiveThresholds = getAdaptiveThresholds(analysis.intent);

      const [semanticHS, semanticKnowledge, semanticPDFs, semanticVeille] = await Promise.all([
        context.hs_codes.length < 10
          ? searchHSCodesSemantic(supabase, queryEmbedding, adaptiveThresholds.hsThreshold, adaptiveThresholds.limits.hs)
          : Promise.resolve([]),
        context.knowledge_documents.length < 5
          ? searchKnowledgeHybrid(supabase, queryEmbedding, searchQuestion, adaptiveThresholds.docThreshold, adaptiveThresholds.limits.docs)
          : Promise.resolve([]),
        context.pdf_summaries.length < 3
          ? searchPDFsHybrid(supabase, queryEmbedding, searchQuestion, adaptiveThresholds.docThreshold, adaptiveThresholds.limits.docs, SUPABASE_URL)
          : Promise.resolve([]),
        veilleDocuments.length < 3
          ? searchVeilleHybrid(supabase, queryEmbedding, searchQuestion, adaptiveThresholds.docThreshold, adaptiveThresholds.limits.docs)
          : Promise.resolve([]),
      ]);

      // Merge semantic results
      if (semanticHS.length > 0) {
        const existingCodes = new Set(context.hs_codes.map((c: any) => c.code || c.code_clean));
        const newHSCodes = semanticHS
          .filter((hs: any) => !existingCodes.has(hs.code))
          .map((hs: any) => ({ ...hs, semantic_match: true }));
        context.hs_codes = [...context.hs_codes, ...newHSCodes].slice(0, 30);
      }

      if (semanticKnowledge.length > 0) {
        const existingTitles = new Set(context.knowledge_documents.map((d: any) => d.title));
        const newKnowledge = semanticKnowledge
          .filter((d: any) => !existingTitles.has(d.title))
          .map((d: any) => ({ ...d, semantic_match: true }));
        context.knowledge_documents = [...context.knowledge_documents, ...newKnowledge].slice(0, 10);
      }

      if (semanticPDFs.length > 0) {
        const existingPdfIds = new Set(context.pdf_summaries.map((p: any) => p.pdf_id || p.id));
        const newPDFs = semanticPDFs
          .filter((p: any) => !existingPdfIds.has(p.pdf_id) && !existingPdfIds.has(p.id))
          .map((p: any) => ({ ...p, semantic_match: true }));
        context.pdf_summaries = [...context.pdf_summaries, ...newPDFs].slice(0, 10);
      }

      if (semanticVeille.length > 0) {
        const existingVeilleTitles = new Set(veilleDocuments.map((d: any) => d.title));
        const newVeille = semanticVeille
          .filter((d: any) => !existingVeilleTitles.has(d.title))
          .map((d: any) => ({ ...d, semantic_match: true }));
        veilleDocuments = [...veilleDocuments, ...newVeille].slice(0, 8);
      }

      console.log("Semantic search added:", {
        hs_codes: semanticHS.length,
        knowledge: semanticKnowledge.length,
        pdfs: semanticPDFs.length,
        veille: semanticVeille.length,
      });
    }

    console.log("Context collected:", {
      tariffs_with_inheritance: context.tariffs_with_inheritance.length,
      hs_codes: context.hs_codes.length,
      pdfs: context.pdf_summaries.length,
      veille: veilleDocuments.length,
    });

    // =========================================================================
    // BUILD SYSTEM PROMPT
    // =========================================================================
    const availableSources = buildAvailableSources(context, SUPABASE_URL!);
    const systemPrompt = buildSystemPrompt(
      context,
      veilleDocuments,
      legalPdfTexts,
      imageAnalysis,
      analysis.country,
      availableSources,
      SUPABASE_URL!
    );

    // Build messages array
    const claudeMessages: { role: "user" | "assistant"; content: string }[] = [];
    
    if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      const recentHistory = conversationHistory.slice(-10);
      for (const msg of recentHistory) {
        if (msg.role === "user" || msg.role === "assistant") {
          claudeMessages.push({ role: msg.role, content: msg.content });
        }
      }
    }
    
    claudeMessages.push({
      role: "user",
      content: enrichedQuestion || question || "Identifie ce produit",
    });

    // =========================================================================
    // CALL LOVABLE AI
    // =========================================================================
    const startTime = Date.now();
    
    const lovableRetryConfig: RetryConfig = {
      maxRetries: 3,
      initialDelayMs: 2000,
      maxDelayMs: 15000,
      retryableStatuses: [429, 500, 502, 503, 504]
    };

    let aiResponse: Response;
    try {
      logger.info("Calling Lovable AI with retry", { model: LOVABLE_AI_MODEL });
      
      aiResponse = await fetchWithRetry(
        LOVABLE_AI_GATEWAY,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: LOVABLE_AI_MODEL,
            max_tokens: 4096,
            messages: [
              { role: "system", content: systemPrompt },
              ...claudeMessages,
            ],
          }),
        },
        lovableRetryConfig
      );
      
    } catch (fetchError: any) {
      logger.error("Lovable AI fetch error after retries", fetchError);
      return errorResponse(req, "Service temporairement indisponible. Veuillez réessayer.", 503);
    }

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      logger.error("Lovable AI non-OK response", new Error(errorText), { status: aiResponse.status });
      
      if (aiResponse.status === 429) {
        return errorResponse(req, "Trop de requêtes. Veuillez réessayer.", 429);
      }
      if (aiResponse.status === 402) {
        return errorResponse(req, "Crédits Lovable AI épuisés.", 402);
      }
      return errorResponse(req, "Service temporairement indisponible.", 503);
    }

    const aiData = await aiResponse.json();
    const responseTime = Date.now() - startTime;
    const responseText = aiData.choices?.[0]?.message?.content || "Je n'ai pas pu générer de réponse.";

    // Determine confidence
    const confidence = determineConfidence(responseText, context);
    console.info(`Final confidence: ${confidence}`);

    // Save conversation
    const contextUsed = {
      tariffs_with_inheritance: context.tariffs_with_inheritance.length,
      hs_codes: context.hs_codes.length,
      tariffs: context.tariffs.length,
      controlled: context.controlled_products.length,
      documents: context.knowledge_documents.length,
      pdfs: context.pdf_summaries.length,
      veille: veilleDocuments.length,
      semantic_search_used: useSemanticSearch,
    };

    const { data: conversation } = await supabase
      .from('conversations')
      .insert({
        session_id: sessionId,
        question: question,
        response: responseText,
        detected_intent: analysis.intent,
        detected_hs_codes: context.hs_codes.map(c => c.code || c.code_clean),
        context_used: contextUsed,
        pdfs_used: context.pdf_summaries.map(p => p.title),
        confidence_level: confidence,
        response_time_ms: responseTime,
      })
      .select('id')
      .single();

    // Save to cache
    if (queryEmbedding && confidence !== "low" && (!images || images.length === 0) && question) {
      saveToResponseCache(
        supabase,
        question,
        queryEmbedding,
        responseText,
        contextUsed,
        confidence
      ).catch((err) => console.error("Cache save error:", err));
    }

    return new Response(
      JSON.stringify({
        response: responseText,
        confidence: confidence,
        conversationId: conversation?.id,
        context: {
          tariffs_with_inheritance: context.tariffs_with_inheritance.length,
          hs_codes_found: context.hs_codes.length,
          tariffs_found: context.tariffs.length,
          controlled_found: context.controlled_products.length,
          documents_found: context.knowledge_documents.length,
          pdfs_used: context.pdf_summaries.length,
          veille_docs: veilleDocuments.length,
        },
        metadata: {
          intent: analysis.intent,
          country: analysis.country,
          response_time_ms: responseTime,
          inheritance_used: context.tariffs_with_inheritance.length > 0,
          semantic_search_used: useSemanticSearch,
          cached: false,
        }
      }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  } catch (error) {
    logger.error("Unexpected chat error", error as Error);
    return errorResponse(req, "Une erreur est survenue. Veuillez réessayer.", 500, logger.getRequestId());
  }
});
