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
import { requireAuth } from "../_shared/auth-check.ts";
import { validateChatRequest } from "../_shared/validation.ts";
import { createLogger } from "../_shared/logger.ts";
import { fetchWithRetry, RETRY_CONFIGS, type RetryConfig } from "../_shared/retry.ts";
import { withCircuitBreaker } from "../_shared/circuit-breaker.ts";

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
  searchTariffNotesHybrid,
  searchTariffNotesByChapter,
  // Nouvelles fonctions hybrides RRF
  searchHSCodesHybrid,
  searchTariffNotesHybridRRF,
  searchLegalChunksHybrid,
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
  formatTariffNotesForRAG,
  createEmptyContext,
  buildAvailableSources,
  type RAGContext,
  type TariffWithInheritance,
} from "./context-builder.ts";
import { buildSystemPrompt, determineConfidence } from "./prompt-builder.ts";
import {
  validateAllSources,
  extractCodesFromResponse,
  extractProductKeywords,
  filterCitedCirculars,
  type DBEvidence,
  type ValidatedSource,
} from "./source-validator.ts";
// Nouveaux modules RAG V2
import { expandQuery, expandWithSynonyms } from "./query-expander.ts";
import { rerankWithLLM, rerankWithTFIDF, type RankedResult } from "./reranker.ts";
// Post-processing unifié
import { postProcessResponse, saveToCache, type PostProcessResult } from "./post-processor.ts";

// =============================================================================
// CONFIGURATION
// =============================================================================

const LOVABLE_AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_AI_MODEL = "google/gemini-2.5-flash";

// Configuration des timeouts
const TIMEOUTS = {
  embedding: 5000,    // 5s
  search: 8000,       // 8s
  llm: 60000,         // 60s
};

// =============================================================================
// FONCTIONS UTILITAIRES
// =============================================================================

/**
 * Exécute une promesse avec timeout
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
  name: string
): Promise<T> {
  const timeout = new Promise<T>((resolve) => {
    setTimeout(() => {
      console.warn(`${name} timeout after ${ms}ms, using fallback`);
      resolve(fallback);
    }, ms);
  });
  return Promise.race([promise, timeout]);
}

/**
 * Nettoie les URLs inventées par le LLM dans la réponse (défense en profondeur)
 * Appliqué côté serveur AVANT envoi au client
 */
function stripUrlsFromResponse(text: string): string {
  if (!text) return text;
  
  return text
    // 1. Liens markdown [texte](url)
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    
    // 2. URLs Supabase brutes (storage, API, etc.)
    .replace(/https?:\/\/[a-z0-9-]+\.supabase\.co\/[^\s"'<>\])}]+/gi, '[source validée ci-dessous]')
    
    // 3. URLs génériques brutes dans le texte (pas dans les balises de code)
    .replace(/(?<![`])https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_+.~#?&/=]*(?![`])/gi, (match) => {
      // Autoriser certains domaines officiels
      const allowedDomains = ['douane.gov.ma', 'adii.gov.ma', 'ompic.ma'];
      const isAllowed = allowedDomains.some(domain => match.includes(domain));
      return isAllowed ? match : '[voir sources ci-dessous]';
    })
    
    // 4. Section "Sources" générée par l'IA avec des liens
    .replace(/📎\s*\*?\*?Sources?\*?\*?:?\s*\n?(?:[-•*]\s*\[[^\]]+\]\([^)]+\)\s*\n?)+/gi, '')
    .replace(/\*?\*?Sources?\s*:?\*?\*?\s*\n?(?:[-•*]\s*\[[^\]]+\]\([^)]+\)\s*\n?)+/gi, '')
    
    // 5. Liens HTML (au cas où)
    .replace(/<a[^>]*href=["'][^"']*["'][^>]*>([^<]*)<\/a>/gi, '$1')
    
    // 6. Nettoyer les doubles espaces et lignes vides multiples
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
// =============================================================================
// STREAMING SSE UTILITIES
// =============================================================================

interface StreamChunk {
  type: 'content' | 'done' | 'error';
  content?: string;
  error?: string;
  metadata?: {
    confidence: string;
    cited_circulars: any[];
    has_db_evidence: boolean;
    validation_message?: string;
    context: any;
    conversationId?: string;
  };
}

function createSSEStream(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
) {
  return {
    sendChunk(chunk: StreamChunk) {
      const data = `data: ${JSON.stringify(chunk)}\n\n`;
      controller.enqueue(encoder.encode(data));
    },
    sendContent(content: string) {
      this.sendChunk({ type: 'content', content });
    },
    sendDone(metadata: StreamChunk['metadata']) {
      this.sendChunk({ type: 'done', metadata });
      controller.close();
    },
    sendError(error: string) {
      this.sendChunk({ type: 'error', error });
      controller.close();
    }
  };
}

/**
 * Appelle Lovable AI avec streaming activé et retourne la réponse complète
 */
async function streamLovableAI(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  apiKey: string,
  onChunk: (text: string) => void
): Promise<string> {
  const response = await fetch(LOVABLE_AI_GATEWAY, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: LOVABLE_AI_MODEL,
      max_tokens: 4096,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Lovable AI error: ${response.status} - ${errorText}`);
  }

  if (!response.body) {
    throw new Error("No response body for streaming");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullResponse = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullResponse += content;
            onChunk(content);
          }
        } catch {
          // Ignore parse errors (incomplete JSON across chunks)
        }
      }
    }
  }

  return fullResponse;
}

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

  const corsHeaders = getCorsHeaders(req);

  // Authentication check - REQUIRED
  const { error: authError } = await requireAuth(req, corsHeaders);
  if (authError) return authError;

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
    const enableStreaming = req.headers.get('accept')?.includes('text/event-stream') || false;
    logger.info("Request validated", { sessionId, hasImages: !!images?.length, hasPdfs: !!pdfDocuments?.length, streaming: enableStreaming });

    if (!question && (!images || images.length === 0) && (!pdfDocuments || pdfDocuments.length === 0)) {
      return errorResponse(req, "Question, images or PDF documents required", 400);
    }

    // =========================================================================
    // VALIDATION DES CLÉS API
    // =========================================================================
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // Vérifier les clés OBLIGATOIRES
    const missingKeys: string[] = [];
    if (!LOVABLE_API_KEY) missingKeys.push("LOVABLE_API_KEY");
    if (!SUPABASE_URL) missingKeys.push("SUPABASE_URL");
    if (!SUPABASE_SERVICE_ROLE_KEY) missingKeys.push("SUPABASE_SERVICE_ROLE_KEY");
    
    if (missingKeys.length > 0) {
      logger.error("Missing required API keys", { missingKeys });
      return errorResponse(
        req, 
        `Erreur de configuration serveur. Contactez l'administrateur.`, 
        500
      );
    }

    // Avertir si les clés optionnelles sont manquantes
    if (!OPENAI_API_KEY) {
      logger.warn("OPENAI_API_KEY not configured - semantic search disabled");
    }
    if (!ANTHROPIC_API_KEY) {
      logger.warn("ANTHROPIC_API_KEY not configured - PDF analysis disabled");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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
          // Nettoyer la réponse en cache (peut contenir d'anciennes URLs)
          const cleanedCachedText = stripUrlsFromResponse(cachedResponse.response.text);
          return new Response(
            JSON.stringify({
              response: cleanedCachedText,
              confidence: cachedResponse.response.confidence,
              cached: true,
              metadata: { cached: true, similarity: cachedResponse.response.similarity },
              cited_circulars: cachedResponse.response.cited_circulars || [],
              has_db_evidence: cachedResponse.response.has_db_evidence ?? true,
              validation_message: cachedResponse.response.validation_message,
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
    const historyContextString = historyContext.contextString;
    
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

    // Analyse des PDFs (avec détection automatique DUM)
    if (pdfDocuments && pdfDocuments.length > 0) {
      console.log("Analyzing", pdfDocuments.length, "PDF(s) with Claude...");
      const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
      
      if (ANTHROPIC_API_KEY) {
        try {
          // Pass supabase client for DUM verification
          pdfAnalysis = await analyzePdfWithClaude(
            pdfDocuments as PdfInput[], 
            question || "Analyse ce document", 
            ANTHROPIC_API_KEY,
            supabase
          );
          console.log("PDF analysis complete. isDUM:", pdfAnalysis.isDUM, "Content length:", pdfAnalysis.fullContent?.length || 0);
          
          // Si c'est une DUM, utiliser le formatage spécialisé
          if (pdfAnalysis.isDUM && pdfAnalysis.dumAnalysis) {
            enrichedQuestion = `${question || "Analyse cette DUM"}

[ANALYSE COMPLÈTE DE LA DUM]
${pdfAnalysis.fullContent}

INSTRUCTIONS: L'utilisateur a uploadé une Déclaration Unique de Marchandises (DUM). 
L'analyse ci-dessus contient:
- Extraction des données: code SH, valeurs, poids, origines
- Calcul des droits et taxes applicables
- Vérification de conformité (contrôles requis, restrictions)

Réponds en te basant sur cette analyse. Si des anomalies sont détectées, explique-les clairement.`;
          } else {
            enrichedQuestion = `${question || "Analyse ce document"}

[EXTRACTION COMPLÈTE DU DOCUMENT PDF]
=== RÉSUMÉ ===
${pdfAnalysis.summary}

=== CONTENU INTÉGRAL EXTRAIT ===
${pdfAnalysis.fullContent || "Non disponible"}

=== INFORMATIONS STRUCTURÉES ===
${pdfAnalysis.extractedInfo}

${pdfAnalysis.suggestedCodes.length > 0 ? `=== CODES SH IDENTIFIÉS ===\n${pdfAnalysis.suggestedCodes.join(", ")}` : ""}`;
          }
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
    // IMPORTANT: Analyser SEULEMENT la question enrichie, PAS le contexte d'historique
    // Le contexte d'historique contient des caractères spéciaux qui cassent les requêtes SQL
    const analysis = analyzeQuestion(enrichedQuestion);
    
    // Add codes detected from conversation history SEPARATELY (already cleaned)
    if (historyContext.detectedCodes.length > 0) {
      const cleanedHistoryCodes = historyContext.detectedCodes.map(c => cleanHSCode(c));
      analysis.detectedCodes = [...new Set([...analysis.detectedCodes, ...cleanedHistoryCodes])];
      console.log("Added codes from history:", cleanedHistoryCodes);
    }
    
    // Add keywords from history SEPARATELY (already cleaned)
    if (historyContext.keywords.length > 0) {
      // Filter out any keywords with special characters
      const cleanHistoryKeywords = historyContext.keywords
        .filter(k => /^[a-zA-ZàâäéèêëïîôùûüçÀÂÄÉÈÊËÏÎÔÙÛÜÇ]+$/i.test(k));
      analysis.keywords = [...new Set([...analysis.keywords, ...cleanHistoryKeywords])];
      console.log("Added keywords from history:", cleanHistoryKeywords);
    }
    
    if (imageAnalysis?.suggestedCodes.length) {
      const cleanedSuggested = imageAnalysis.suggestedCodes.map(c => cleanHSCode(c));
      analysis.detectedCodes = [...new Set([...analysis.detectedCodes, ...cleanedSuggested])];
    }
    console.log("Question analysis:", JSON.stringify(analysis));

    // Create a clean search query for semantic/hybrid search (no special characters)
    let cleanSearchQuery = analysis.keywords.slice(0, 5).join(' ') || enrichedQuestion;

    // =========================================================================
    // QUERY EXPANSION - Enrichissement sémantique (synonymes + traduction)
    // =========================================================================
    if (question && !pdfAnalysis?.isDUM) {
      const [expandedText, synonymResults] = await Promise.all([
        withTimeout(
          expandQuery(question, LOVABLE_API_KEY!, { synonyms: true, translation: true, hsCodeHints: true }),
          3000, question, "Query expansion"
        ),
        withTimeout(
          expandWithSynonyms(supabase, analysis.keywords),
          2000, { codes: [], terms: [] }, "Synonym lookup"
        ),
      ]);

      // Update search query with expanded text
      if (expandedText && expandedText !== question) {
        cleanSearchQuery = expandedText;
        console.log(`[query-expander] Search query enriched: "${cleanSearchQuery.substring(0, 120)}..."`);
      }

      // Add synonym-discovered codes to analysis
      if (synonymResults.codes.length > 0) {
        const existingCodes = new Set(analysis.detectedCodes);
        const newCodes = synonymResults.codes.filter(c => !existingCodes.has(c));
        analysis.detectedCodes = [...analysis.detectedCodes, ...newCodes].slice(0, 20);
        console.log(`[query-expander] Added ${newCodes.length} codes from synonyms: ${newCodes.join(', ')}`);
      }

      // Add synonym terms to keywords
      if (synonymResults.terms.length > 0) {
        const existingKeywords = new Set(analysis.keywords.map(k => k.toLowerCase()));
        const newTerms = synonymResults.terms.filter(t => !existingKeywords.has(t.toLowerCase()));
        analysis.keywords = [...analysis.keywords, ...newTerms].slice(0, 15);
      }

      // Re-generate embedding with expanded query for better semantic search
      if (OPENAI_API_KEY && expandedText && expandedText !== question) {
        const expandedEmbedding = await withTimeout(
          generateQueryEmbedding(expandedText, OPENAI_API_KEY),
          TIMEOUTS.embedding, null, "Expanded embedding"
        );
        if (expandedEmbedding) {
          queryEmbedding = expandedEmbedding;
          useSemanticSearch = true;
          console.log("[query-expander] Re-generated embedding with expanded query");
        }
      }
    }

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

    // 2b. FALLBACK: Si hs_codes est vide, chercher DIRECTEMENT dans country_tariffs par description
    // C'est ici que des produits comme "tomate" seront trouvés car la table country_tariffs
    // contient des descriptions en français comme "tomates", "Jus de tomate", etc.
    if (context.hs_codes.length === 0 && context.tariffs_with_inheritance.length === 0 && analysis.keywords.length > 0) {
      console.log("hs_codes empty, searching country_tariffs by keywords:", analysis.keywords);
      
      // Build OR conditions for keyword search with fuzzy matching
      const keywordsToSearch = analysis.keywords.slice(0, 5).filter(k => k.length >= 3);
      
      if (keywordsToSearch.length > 0) {
        // Search with each keyword independently to cast wider net
        for (const keyword of keywordsToSearch) {
          const escapedKeyword = escapeSearchTerm(keyword);
          const { data: tariffsByKeyword, error: tariffError } = await supabase
            .from('country_tariffs')
            .select('hs_code_6, national_code, description_local, duty_rate, vat_rate, other_taxes, is_prohibited, is_restricted, source_pdf')
            .eq('country_code', analysis.country)
            .ilike('description_local', `%${escapedKeyword}%`)
            .eq('is_active', true)
            .limit(10);
          
          if (tariffError) {
            console.error("Error searching tariffs by keyword:", tariffError);
          } else if (tariffsByKeyword && tariffsByKeyword.length > 0) {
            console.log(`Found ${tariffsByKeyword.length} tariffs for keyword "${keyword}":`, 
              tariffsByKeyword.map(t => `${t.national_code}: ${t.description_local}`).slice(0, 3));
            
            // Convert tariffs to hs_codes format for use by the rest of the pipeline
            for (const tariff of tariffsByKeyword) {
              const code = tariff.national_code || tariff.hs_code_6;
              const cleanCode = cleanHSCode(code);
              
              // Add to hs_codes
              context.hs_codes.push({
                code: code,
                code_clean: cleanCode,
                description_fr: tariff.description_local || '',
                chapter_number: parseInt(cleanCode.substring(0, 2)) || 0,
                level: cleanCode.length >= 10 ? 'subheading' : 
                       cleanCode.length >= 6 ? 'heading' : 
                       cleanCode.length >= 4 ? 'position' : 'chapter',
              });
              
              // Also build TariffWithInheritance for precise display
              const tariffWithInheritance: TariffWithInheritance = {
                found: true,
                code: code,
                code_clean: cleanCode,
                description: tariff.description_local || '',
                chapter: parseInt(cleanCode.substring(0, 2)) || 0,
                level: cleanCode.length >= 10 ? 'subheading' : 
                       cleanCode.length >= 6 ? 'heading' : 
                       cleanCode.length >= 4 ? 'position' : 'chapter',
                duty_rate: tariff.duty_rate,
                vat_rate: tariff.vat_rate || 20,
                rate_source: "direct",
                children_count: 0,
                is_prohibited: tariff.is_prohibited || false,
                is_restricted: tariff.is_restricted || false,
                has_children_prohibited: false,
                has_children_restricted: false,
                legal_notes: [],
                controls: [],
              };
              context.tariffs_with_inheritance.push(tariffWithInheritance);
            }
            
            // Also add to tariffs for backwards compatibility
            context.tariffs.push(...tariffsByKeyword);
          }
        }
        
        // Deduplicate
        context.hs_codes = [...new Map(context.hs_codes.map(item => [item.code, item])).values()].slice(0, 30);
        context.tariffs_with_inheritance = [...new Map(context.tariffs_with_inheritance.map(item => [item.code, item])).values()].slice(0, 20);
        context.tariffs = [...new Map(context.tariffs.map(item => [item.national_code, item])).values()].slice(0, 20);
        
        console.log(`After keyword fallback: hs_codes=${context.hs_codes.length}, tariffs_with_inheritance=${context.tariffs_with_inheritance.length}`);
      }
    }

    // 3. Get tariffs for found codes (if not already populated by fallback)
    const codes6 = [...new Set(context.hs_codes.map(c => cleanHSCode(c.code || c.code_clean).substring(0, 6)))];
    if (codes6.length > 0 && context.tariffs_with_inheritance.length === 0 && context.tariffs.length === 0) {
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

    // 6. Get relevant PDF summaries - OPTIMIZED WITH RPC
    // Extract unique chapter prefixes (2 digits) from detected HS codes AND analysis codes
    const allCodes = [
      ...context.hs_codes.map(c => cleanHSCode(c.code || c.code_clean)),
      ...analysis.detectedCodes.map(c => cleanHSCode(c))
    ];
    const hsCodePrefixes = allCodes.length > 0 
      ? [...new Set(allCodes.map(code => {
          return code.substring(0, 2); // Get first 2 digits as string
        }).filter(prefix => prefix.length === 2 && /^\d{2}$/.test(prefix)))]
      : [];
    
    if (hsCodePrefixes.length > 0) {
      console.log(`PDF lookup: searching for HS prefixes via RPC: ${hsCodePrefixes.join(', ')}`);
      
      // Use optimized RPC that filters at DB level (much faster than JS filtering)
      const { data: matchingPdfs, error: rpcError } = await supabase
        .rpc('search_pdf_by_chapter_prefixes', { prefixes: hsCodePrefixes });
      
      if (rpcError) {
        console.error("PDF RPC search error:", rpcError.message);
      } else if (matchingPdfs && matchingPdfs.length > 0) {
        console.log(`PDF lookup: found ${matchingPdfs.length} PDFs matching prefixes ${hsCodePrefixes.join(', ')}`);
        
        context.pdf_summaries = matchingPdfs.slice(0, 10).map((pdf: any) => ({
          title: pdf.pdf_title,
          category: pdf.pdf_category,
          chapter_number: pdf.chapter_number,
          summary: pdf.summary,
          key_points: pdf.key_points,
          full_text: pdf.extracted_text,
          mentioned_codes: pdf.mentioned_hs_codes || [],
          download_url: pdf.pdf_file_path 
            ? `${SUPABASE_URL}/storage/v1/object/public/pdf-documents/${pdf.pdf_file_path}` 
            : null,
        }));
        
        console.log(`PDF lookup: returning ${context.pdf_summaries.length} PDFs with chapters: ${context.pdf_summaries.map((p: any) => p.chapter_number).join(', ')}`);
      } else {
        console.log(`PDF lookup: no PDFs found for prefixes`);
      }
    }

    // 7. (REMOVED) Veille documents - fonctionnalité supprimée

    // 8. Get legal references - ALWAYS search for relevant circulars
    // Search by keywords AND by detected HS codes to ensure comprehensive coverage
    const searchLegalReferences = async () => {
      const allRefs: any[] = [];
      const seenIds = new Set<string>();
      
      // 8a. Search by keywords using FTS
      if (analysis.keywords.length > 0) {
        const legalSearchTerm = analysis.keywords.slice(0, 3).join(' ');
        try {
          const { data: ftsRefs } = await supabase
            .rpc('search_legal_references_fts', { 
              search_query: legalSearchTerm,
              limit_count: 10 
            });
          
          if (ftsRefs && ftsRefs.length > 0) {
            // Get file paths for FTS results
            const pdfIds = ftsRefs.map((r: any) => r.pdf_id).filter(Boolean);
            const pdfPathsMap: Record<string, string> = {};
            
            if (pdfIds.length > 0) {
              const { data: pdfDocs } = await supabase
                .from('pdf_documents')
                .select('id, file_path')
                .in('id', pdfIds);
              
              if (pdfDocs) {
                for (const doc of pdfDocs) {
                  pdfPathsMap[doc.id] = doc.file_path;
                }
              }
            }
            
            for (const ref of ftsRefs) {
              if (!seenIds.has(ref.id)) {
                seenIds.add(ref.id);
                const filePath = pdfPathsMap[ref.pdf_id];
                allRefs.push({
                  ...ref,
                  download_url: filePath 
                    ? `${SUPABASE_URL}/storage/v1/object/public/pdf-documents/${filePath}`
                    : null,
                  search_method: 'fts_keyword'
                });
              }
            }
          }
        } catch (ftsError) {
          console.log("FTS legal search fallback to ILIKE:", ftsError);
          // Fallback to ILIKE search with join
          const escapedTerm = escapeSearchTerm(analysis.keywords[0] || '');
          const { data: refs } = await supabase
            .from('legal_references')
            .select(`id, reference_type, reference_number, title, reference_date, context, pdf_id, pdf_documents!inner(file_path, title)`)
            .or(`reference_number.ilike.%${escapedTerm}%,title.ilike.%${escapedTerm}%`)
            .eq('is_active', true)
            .limit(10);
          
          if (refs) {
            for (const ref of refs as any[]) {
              if (!seenIds.has(ref.id)) {
                seenIds.add(ref.id);
                const filePath = ref.pdf_documents?.file_path;
                allRefs.push({ 
                  ...ref, 
                  pdf_title: ref.pdf_documents?.title,
                  download_url: filePath 
                    ? `${SUPABASE_URL}/storage/v1/object/public/pdf-documents/${filePath}`
                    : null,
                  search_method: 'ilike_fallback' 
                });
              }
            }
          }
        }
      }
      
      // 8b. ALWAYS search by detected HS codes - check if any circular mentions these codes
      if (analysis.detectedCodes.length > 0 || context.hs_codes.length > 0) {
        const codesToSearch = [
          ...analysis.detectedCodes.map(c => cleanHSCode(c)),
          ...context.hs_codes.map(c => cleanHSCode(c.code || c.code_clean))
        ].slice(0, 10);
        
        const codePatterns = codesToSearch.map(c => `%${c.substring(0, 4)}%`);
        
        for (const pattern of [...new Set(codePatterns)].slice(0, 5)) {
          const { data: codeRefs } = await supabase
            .from('legal_references')
            .select(`
              id, reference_type, reference_number, title, reference_date, context, pdf_id,
              pdf_documents!inner(id, title, category, file_path)
            `)
            .ilike('context', pattern)
            .eq('is_active', true)
            .limit(5);
          
          if (codeRefs) {
            for (const ref of codeRefs) {
              if (!seenIds.has(ref.id)) {
                seenIds.add(ref.id);
                allRefs.push({
                  ...ref,
                  pdf_title: (ref.pdf_documents as any)?.title,
                  download_url: (ref.pdf_documents as any)?.file_path 
                    ? `${SUPABASE_URL}/storage/v1/object/public/pdf-documents/${(ref.pdf_documents as any).file_path}`
                    : null,
                  search_method: 'hs_code_context'
                });
              }
            }
          }
        }
      }
      
      // 8c. Also check pdf_extractions for mentions of circulars
      if (allRefs.length < 5 && analysis.keywords.length > 0) {
        const searchTerm = escapeSearchTerm(analysis.keywords[0]);
        const { data: pdfMentions } = await supabase
          .from('pdf_extractions')
          .select(`
            pdf_id, summary, key_points,
            pdf_documents!inner(id, title, category, file_path, document_reference)
          `)
          .or(`summary.ilike.%circulaire%,summary.ilike.%${searchTerm}%`)
          .limit(5);
        
        if (pdfMentions) {
          for (const mention of pdfMentions as any[]) {
            const pdfDoc = mention.pdf_documents as any;
            if (pdfDoc && !seenIds.has(mention.pdf_id)) {
              seenIds.add(mention.pdf_id);
              allRefs.push({
                id: mention.pdf_id,
                reference_type: 'Document',
                reference_number: pdfDoc.document_reference || '',
                title: pdfDoc.title,
                pdf_id: mention.pdf_id,
                pdf_title: pdfDoc.title,
                context: mention.summary?.substring(0, 200),
                download_url: pdfDoc.file_path 
                  ? `${SUPABASE_URL}/storage/v1/object/public/pdf-documents/${pdfDoc.file_path}`
                  : null,
                search_method: 'pdf_extraction_mention'
              });
            }
          }
        }
      }
      
      return allRefs.slice(0, 15);
    };
    
    context.legal_references = await searchLegalReferences();
    console.log(`Legal references found: ${context.legal_references.length} (methods: ${[...new Set(context.legal_references.map((r: any) => r.search_method))].join(', ')})`);

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
    // TARIFF NOTES SEARCH (10. Search chapter notes for detected codes)
    // =========================================================================
    const chapterNumbers = [...new Set([
      ...context.hs_codes.map((c: any) => {
        const code = cleanHSCode(c.code || c.code_clean);
        return code.substring(0, 2);
      }),
      ...analysis.detectedCodes.map(c => cleanHSCode(c).substring(0, 2))
    ])].filter(ch => /^\d{2}$/.test(ch));

    if (chapterNumbers.length > 0) {
      console.log(`Searching tariff notes for chapters: ${chapterNumbers.join(', ')}`);
      
      // First, direct lookup by chapter numbers (fast, always works)
      const directNotes = await searchTariffNotesByChapter(supabase, chapterNumbers, 15);
      context.tariff_notes = directNotes;
      
      // If we have semantic search and want more relevant notes
      if (useSemanticSearch && queryEmbedding && directNotes.length < 5) {
        const semanticNotes = await searchTariffNotesHybrid(
          supabase, 
          queryEmbedding, 
          cleanSearchQuery, 
          chapterNumbers, 
          10
        );
        
        // Merge and deduplicate
        const existingIds = new Set(context.tariff_notes.map((n: any) => n.id));
        const newNotes = semanticNotes.filter((n: any) => !existingIds.has(n.id));
        context.tariff_notes = [...context.tariff_notes, ...newNotes].slice(0, 20);
      }
      
      console.log(`Found ${context.tariff_notes.length} tariff notes`);
    }

    // =========================================================================
    // SEMANTIC SEARCH ENHANCEMENT - VERSION OPTIMISÉE
    // =========================================================================
    if (useSemanticSearch && queryEmbedding) {
      console.log("Using semantic search enhancement (parallel with hybrid)...");
      const adaptiveThresholds = getAdaptiveThresholds(analysis.intent);

      // Toutes les recherches en parallèle avec timeout
      const [semanticHS, semanticKnowledge, semanticPDFs, legalChunks] = await Promise.all([
        // HS Codes - utiliser recherche hybride RRF
        context.hs_codes.length < 10
          ? withTimeout(
              searchHSCodesHybrid(supabase, queryEmbedding, cleanSearchQuery, 0.6, adaptiveThresholds.limits.hs),
              TIMEOUTS.search,
              [],
              "HS hybrid search"
            )
          : Promise.resolve([]),
        // Knowledge documents
        context.knowledge_documents.length < 5
          ? withTimeout(
              searchKnowledgeHybrid(supabase, queryEmbedding, cleanSearchQuery, adaptiveThresholds.docThreshold, adaptiveThresholds.limits.docs),
              TIMEOUTS.search,
              [],
              "Knowledge search"
            )
          : Promise.resolve([]),
        // PDFs
        context.pdf_summaries.length < 3
          ? withTimeout(
              searchPDFsHybrid(supabase, queryEmbedding, cleanSearchQuery, adaptiveThresholds.docThreshold, adaptiveThresholds.limits.docs, SUPABASE_URL),
              TIMEOUTS.search,
              [],
              "PDF search"
            )
          : Promise.resolve([]),
        // Legal chunks (Code des Douanes)
        withTimeout(
        searchLegalChunksHybrid(supabase, queryEmbedding, cleanSearchQuery, 0.5, 8, SUPABASE_URL),
          TIMEOUTS.search,
          [],
          "Legal chunks search"
        ),
      ]);

    // Store raw legal chunks for source validation later
    (context as any)._legalChunks = legalChunks;

      // Merge HS codes
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

      // Ajouter les chunks légaux au contexte knowledge_documents
      if (legalChunks.length > 0) {
        const legalDocs = legalChunks.map((chunk: any) => ({
          title: chunk.article_number ? `Article ${chunk.article_number} - Code des Douanes` : chunk.section_title || 'Code des Douanes',
          content: chunk.chunk_text,
          category: 'legal',
          chunk_type: chunk.chunk_type,
          source: 'legal_chunks',
        }));
        context.knowledge_documents = [...context.knowledge_documents, ...legalDocs].slice(0, 15);
      }

      console.log("Semantic search added:", {
        hs_codes: semanticHS.length,
        knowledge: semanticKnowledge.length,
        pdfs: semanticPDFs.length,
        legal_chunks: legalChunks.length,
      });
    }
    
    // =========================================================================
    // FALLBACK: ILIKE search for legal_chunks when semantic search returns empty
    // =========================================================================
    if ((!(context as any)._legalChunks || (context as any)._legalChunks.length === 0) && analysis.keywords.length > 0) {
      console.log("Legal chunks empty from semantic search, trying ILIKE fallback...");
      
      try {
        // Build OR conditions for keyword search
        const keywordsToSearch = analysis.keywords.slice(0, 3).filter(k => k.length >= 4);
        
        if (keywordsToSearch.length > 0) {
          const orConditions = keywordsToSearch.map(kw => `chunk_text.ilike.%${escapeSearchTerm(kw)}%`).join(',');
          
          const { data: fallbackChunks, error: fallbackError } = await supabase
            .from('legal_chunks')
            .select(`
              id, chunk_index, chunk_text, chunk_type, article_number, section_title, 
              page_number, source_id,
              legal_sources!inner(id, source_ref, title, source_url)
            `)
            .or(orConditions)
            .eq('is_active', true)
            .order('id', { ascending: true })
            .limit(10);
          
          if (!fallbackError && fallbackChunks && fallbackChunks.length > 0) {
            console.log(`ILIKE fallback found ${fallbackChunks.length} legal chunks`);
            
            // Enrich with download URLs (try to find Code des Douanes PDF)
            const { data: cdiiPdf } = await supabase
              .from('pdf_documents')
              .select('id, file_path, title')
              .or(`title.ilike.%Code des Douanes%,file_name.ilike.%CodeDesDouanes%`)
              .eq('is_active', true)
              .limit(1)
              .single();
            
            const baseDownloadUrl = cdiiPdf?.file_path 
              ? `${SUPABASE_URL}/storage/v1/object/public/pdf-documents/${cdiiPdf.file_path}`
              : null;
            
            const enrichedChunks = fallbackChunks.map((chunk: any) => ({
              ...chunk,
              source_ref: chunk.legal_sources?.source_ref || null,
              source_title: chunk.legal_sources?.title || 'Code des Douanes',
              source_url: chunk.legal_sources?.source_url || null,
              download_url: baseDownloadUrl,
              similarity: 0.65, // Assign a reasonable score for keyword matches
            }));
            
            (context as any)._legalChunks = enrichedChunks;
            
            // Also add to knowledge_documents for context
            const legalDocs = enrichedChunks.map((chunk: any) => ({
              title: chunk.article_number ? `Article ${chunk.article_number} - Code des Douanes` : chunk.section_title || 'Code des Douanes',
              content: chunk.chunk_text,
              category: 'legal',
              chunk_type: chunk.chunk_type,
              source: 'legal_chunks_fallback',
            }));
            context.knowledge_documents = [...context.knowledge_documents, ...legalDocs].slice(0, 15);
          }
        }
      } catch (fallbackErr) {
        console.warn("Legal chunks ILIKE fallback failed:", fallbackErr);
      }
    }

    // =========================================================================
    // LLM RE-RANKING - Post-retrieval relevance filtering
    // =========================================================================
    const totalRetrievedPassages = context.knowledge_documents.length + 
      context.tariff_notes.length + 
      ((context as any)._legalChunks?.length || 0);

    if (totalRetrievedPassages > 5 && LOVABLE_API_KEY) {
      // Build unified passage list for re-ranking
      const passagesForReranking: Array<{ text: string; type: string; metadata?: any }> = [];
      const passageSourceMap: Array<{ type: string; index: number }> = [];

      context.knowledge_documents.forEach((doc: any, i: number) => {
        passagesForReranking.push({
          text: (doc.content || doc.title || '').substring(0, 400),
          type: 'knowledge_doc',
        });
        passageSourceMap.push({ type: 'knowledge_doc', index: i });
      });

      context.tariff_notes.forEach((note: any, i: number) => {
        passagesForReranking.push({
          text: (note.note_text || '').substring(0, 400),
          type: 'tariff_note',
        });
        passageSourceMap.push({ type: 'tariff_note', index: i });
      });

      const legalChks = (context as any)._legalChunks || [];
      legalChks.forEach((chunk: any, i: number) => {
        passagesForReranking.push({
          text: (chunk.chunk_text || '').substring(0, 400),
          type: 'legal_chunk',
        });
        passageSourceMap.push({ type: 'legal_chunk', index: i });
      });

      if (passagesForReranking.length > 3) {
        const reranked = await withTimeout(
          rerankWithLLM(enrichedQuestion || question || '', passagesForReranking, LOVABLE_API_KEY!, 15),
          5000,
          rerankWithTFIDF(enrichedQuestion || question || '', passagesForReranking),
          "LLM re-ranking"
        );

        // Build keep-sets per type (only passages with score >= 3)
        const keepByType: Record<string, Set<number>> = {
          knowledge_doc: new Set(),
          tariff_note: new Set(),
          legal_chunk: new Set(),
        };

        for (const r of reranked) {
          if (r.score >= 3) {
            const source = passageSourceMap[r.index];
            if (source) keepByType[source.type]?.add(source.index);
          }
        }

        // Filter knowledge_documents (only if we're keeping at least some)
        const kKeep = keepByType.knowledge_doc;
        if (kKeep.size > 0 && kKeep.size < context.knowledge_documents.length) {
          const before = context.knowledge_documents.length;
          context.knowledge_documents = context.knowledge_documents.filter((_: any, i: number) => kKeep.has(i));
          console.log(`[reranker] knowledge_documents: ${before} → ${context.knowledge_documents.length}`);
        }

        // Filter tariff_notes
        const nKeep = keepByType.tariff_note;
        if (nKeep.size > 0 && nKeep.size < context.tariff_notes.length) {
          const before = context.tariff_notes.length;
          context.tariff_notes = context.tariff_notes.filter((_: any, i: number) => nKeep.has(i));
          console.log(`[reranker] tariff_notes: ${before} → ${context.tariff_notes.length}`);
        }

        // Filter legal chunks
        const cKeep = keepByType.legal_chunk;
        if (cKeep.size > 0 && cKeep.size < legalChks.length) {
          const before = legalChks.length;
          (context as any)._legalChunks = legalChks.filter((_: any, i: number) => cKeep.has(i));
          console.log(`[reranker] legal_chunks: ${before} → ${(context as any)._legalChunks.length}`);
        }
      }
    }

    console.log("Context collected (post re-ranking):", {
      tariffs_with_inheritance: context.tariffs_with_inheritance.length,
      hs_codes: context.hs_codes.length,
      pdfs: context.pdf_summaries.length,
      tariff_notes: context.tariff_notes.length,
      knowledge_documents: context.knowledge_documents.length,
    });

    // =========================================================================
    // BUILD SYSTEM PROMPT
    // =========================================================================
    const availableSources = buildAvailableSources(context, SUPABASE_URL!);
    const systemPrompt = buildSystemPrompt(
      context,
      legalPdfTexts,
      imageAnalysis,
      analysis.country,
      availableSources,
      SUPABASE_URL!,
      analysis.detectedCodes,
      analysis.keywords
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
    // CALL LOVABLE AI (avec support streaming)
    // =========================================================================
    const startTime = Date.now();

    if (enableStreaming) {
      // =====================================================================
      // MODE STREAMING (SSE) - Réponse progressive token par token
      // =====================================================================
      const encoder = new TextEncoder();
      
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const sse = createSSEStream(controller, encoder);
          
          try {
            const fullResponseText = await streamLovableAI(
              systemPrompt,
              claudeMessages,
              LOVABLE_API_KEY!,
              (chunk) => sse.sendContent(chunk)
            );
            
            const responseText = stripUrlsFromResponse(fullResponseText);
            
            // Unified post-processing
            const result = await postProcessResponse({
              responseText, question: question || "", enrichedQuestion,
              context, analysis, queryEmbedding, useSemanticSearch,
              sessionId, images, startTime, supabase, SUPABASE_URL: SUPABASE_URL!,
            });
            
            // Save to cache
            saveToCache(supabase, saveToResponseCache, question || "", queryEmbedding, result, images);
            
            // Send final metadata via SSE
            sse.sendDone({
              confidence: result.confidence,
              cited_circulars: result.citedCirculars,
              has_db_evidence: result.sourceValidation.has_evidence,
              validation_message: result.sourceValidation.message,
              context: {
                tariffs_with_inheritance: context.tariffs_with_inheritance.length,
                hs_codes_found: context.hs_codes.length,
                tariffs_found: context.tariffs.length,
                controlled_found: context.controlled_products.length,
                documents_found: context.knowledge_documents.length,
                pdfs_used: context.pdf_summaries.length,
                legal_references_found: context.legal_references.length,
              },
              conversationId: result.conversationId,
            });
          } catch (error) {
            logger.error("Stream error", error as Error);
            sse.sendError("Erreur de génération. Veuillez réessayer.");
          }
        }
      });
      
      return new Response(stream, {
        headers: {
          ...getCorsHeaders(req),
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // =========================================================================
    // MODE CLASSIQUE (sans streaming) - Rétrocompatibilité
    // =========================================================================
    
    let aiResponse: Response;
    try {
      logger.info("Calling Lovable AI with retry + circuit breaker", { model: LOVABLE_AI_MODEL });
      
      aiResponse = await withCircuitBreaker(
        'lovable-ai',
        async () => fetchWithRetry(
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
          {
            ...RETRY_CONFIGS.lovableAI,
            onRetry: (attempt, error, delay) => {
              logger.warn(`LLM retry ${attempt}`, { error: error.message, delay });
            },
          }
        ),
        { failureThreshold: 5, resetTimeoutMs: 60000 }
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
    const rawResponseText = aiData.choices?.[0]?.message?.content || "Je n'ai pas pu générer de réponse.";
    const responseText = stripUrlsFromResponse(rawResponseText);

    // Unified post-processing
    const result = await postProcessResponse({
      responseText, question: question || "", enrichedQuestion,
      context, analysis, queryEmbedding, useSemanticSearch,
      sessionId, images, startTime, supabase, SUPABASE_URL: SUPABASE_URL!,
    });

    // Save to cache
    saveToCache(supabase, saveToResponseCache, question || "", queryEmbedding, result, images);

    return new Response(
      JSON.stringify({
        response: result.responseWithValidation,
        confidence: result.confidence,
        conversationId: result.conversationId,
        context: {
          tariffs_with_inheritance: context.tariffs_with_inheritance.length,
          hs_codes_found: context.hs_codes.length,
          tariffs_found: context.tariffs.length,
          controlled_found: context.controlled_products.length,
          documents_found: context.knowledge_documents.length,
          pdfs_used: context.pdf_summaries.length,
          legal_references_found: context.legal_references.length,
        },
        cited_circulars: result.citedCirculars,
        sources_validated: result.sourceValidation.sources_validated,
        sources_rejected_count: result.sourceValidation.sources_rejected.length,
        has_db_evidence: result.sourceValidation.has_evidence,
        validation_message: result.sourceValidation.message,
        metadata: {
          intent: analysis.intent,
          country: analysis.country,
          response_time_ms: result.responseTime,
          inheritance_used: context.tariffs_with_inheritance.length > 0,
          semantic_search_used: useSemanticSearch,
          cached: false,
          detected_codes: result.codesForValidation.slice(0, 10),
        }
      }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  } catch (error) {
    logger.error("Unexpected chat error", error as Error);
    return errorResponse(req, "Une erreur est survenue. Veuillez réessayer.", 500, logger.getRequestId());
  }
});