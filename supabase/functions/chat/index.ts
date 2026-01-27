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
import { callAnthropicWithRetry } from "../_shared/retry.ts";
import { createLogger } from "../_shared/logger.ts";

// ============================================================================
// UTILITAIRES CODES SH (héritage hiérarchique)
// ============================================================================

const cleanHSCode = (code: string): string => {
  return code.replace(/[\.\s\-]/g, "").trim();
};

const formatHSCode = (code: string): string => {
  const clean = cleanHSCode(code);
  if (clean.length <= 2) return clean;
  if (clean.length <= 4) return clean.slice(0, 2) + "." + clean.slice(2);
  if (clean.length <= 6) return clean.slice(0, 4) + "." + clean.slice(4);
  if (clean.length <= 8) return clean.slice(0, 4) + "." + clean.slice(4, 6) + "." + clean.slice(6);
  return clean.slice(0, 4) + "." + clean.slice(4, 6) + "." + clean.slice(6, 8) + "." + clean.slice(8);
};

const getParentCodes = (code: string): string[] => {
  const clean = cleanHSCode(code);
  const parents: string[] = [];
  if (clean.length > 2) parents.push(clean.slice(0, 2));
  if (clean.length > 4) parents.push(clean.slice(0, 4));
  if (clean.length > 6) parents.push(clean.slice(0, 6));
  if (clean.length > 8) parents.push(clean.slice(0, 8));
  return parents;
};

const getHSLevel = (code: string): string => {
  const len = cleanHSCode(code).length;
  if (len <= 2) return "chapitre";
  if (len <= 4) return "position";
  if (len <= 6) return "sous-position";
  return "ligne_tarifaire";
};

// Escape special characters for SQL LIKE/ILIKE queries
const escapeSearchTerm = (term: string): string => {
  return term
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/'/g, "''");
};

// ============================================================================
// SEMANTIC SEARCH & EMBEDDING FUNCTIONS (Phase 3)
// ============================================================================

// Generate embedding using OpenAI API
async function generateQueryEmbedding(text: string, apiKey: string): Promise<number[] | null> {
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.substring(0, 8000),
        dimensions: 1536,
      }),
    });

    if (!response.ok) {
      console.error("OpenAI embedding error:", response.status);
      return null;
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    console.error("Embedding generation failed:", error);
    return null;
  }
}

// Check response cache for semantically similar questions
async function checkResponseCache(
  supabase: any,
  queryEmbedding: number[],
  similarityThreshold: number = 0.92
): Promise<{ found: boolean; response?: any }> {
  try {
    const { data, error } = await supabase.rpc("find_cached_response", {
      query_embedding: queryEmbedding,
      similarity_threshold: similarityThreshold,
    });

    if (error || !data || data.length === 0) {
      return { found: false };
    }

    // Update hit count
    await supabase.rpc("update_cache_hit", { cache_id: data[0].id });

    return {
      found: true,
      response: {
        text: data[0].response_text,
        confidence: data[0].confidence_level,
        context: data[0].context_used,
        similarity: data[0].similarity,
        cached: true,
      },
    };
  } catch (error) {
    console.error("Cache lookup failed:", error);
    return { found: false };
  }
}

// Save response to cache
async function saveToResponseCache(
  supabase: any,
  question: string,
  questionEmbedding: number[],
  response: string,
  contextUsed: any,
  confidenceLevel: string
): Promise<void> {
  try {
    // Create hash for deduplication
    const encoder = new TextEncoder();
    const data = encoder.encode(question.toLowerCase().trim());
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const questionHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    await supabase.from("response_cache").upsert(
      {
        question_hash: questionHash,
        question_text: question,
        question_embedding: questionEmbedding,
        response_text: response,
        context_used: contextUsed,
        confidence_level: confidenceLevel,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      },
      { onConflict: "question_hash" }
    );
  } catch (error) {
    console.error("Failed to save to cache:", error);
  }
}

// Semantic search for HS codes
async function searchHSCodesSemantic(
  supabase: any,
  queryEmbedding: number[],
  threshold: number = 0.65,
  limit: number = 10
): Promise<any[]> {
  try {
    const { data, error } = await supabase.rpc("search_hs_codes_semantic", {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit,
    });

    if (error) {
      console.error("Semantic HS search error:", error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error("Semantic HS search failed:", error);
    return [];
  }
}

// Semantic search for knowledge documents
async function searchKnowledgeSemantic(
  supabase: any,
  queryEmbedding: number[],
  threshold: number = 0.6,
  limit: number = 5
): Promise<any[]> {
  try {
    const { data, error } = await supabase.rpc("search_knowledge_semantic", {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit,
    });

    if (error) {
      console.error("Semantic knowledge search error:", error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error("Semantic knowledge search failed:", error);
    return [];
  }
}

// Semantic search for PDF extractions
async function searchPDFsSemantic(
  supabase: any,
  queryEmbedding: number[],
  threshold: number = 0.6,
  limit: number = 5
): Promise<any[]> {
  try {
    const { data, error } = await supabase.rpc("search_pdfs_semantic", {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit,
    });

    if (error) {
      console.error("Semantic PDF search error:", error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error("Semantic PDF search failed:", error);
    return [];
  }
}

// Semantic search for veille documents
async function searchVeilleSemantic(
  supabase: any,
  queryEmbedding: number[],
  threshold: number = 0.6,
  limit: number = 5
): Promise<any[]> {
  try {
    const { data, error } = await supabase.rpc("search_veille_semantic", {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit,
    });

    if (error) {
      console.error("Semantic veille search error:", error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error("Semantic veille search failed:", error);
    return [];
  }
}

// ============================================================================
// RECHERCHE AVEC HÉRITAGE HIÉRARCHIQUE
// ============================================================================

interface TariffWithInheritance {
  found: boolean;
  code: string;
  code_clean: string;
  description: string;
  chapter: number;
  level: string;
  duty_rate: number | null;
  duty_rate_min?: number;
  duty_rate_max?: number;
  vat_rate: number;
  rate_source: "direct" | "inherited" | "range" | "not_found";
  children_count: number;
  is_prohibited: boolean;
  is_restricted: boolean;
  has_children_prohibited: boolean;
  has_children_restricted: boolean;
  legal_notes: string[];
  controls: Array<{
    type: string;
    authority: string;
    inherited: boolean;
  }>;
}

async function searchHSCodeWithInheritance(
  supabase: any,
  code: string,
  countryCode: string = "MA"
): Promise<TariffWithInheritance> {
  const cleanCode = cleanHSCode(code);
  
  const result: TariffWithInheritance = {
    found: false,
    code: formatHSCode(cleanCode),
    code_clean: cleanCode,
    description: "",
    chapter: parseInt(cleanCode.slice(0, 2)) || 0,
    level: getHSLevel(cleanCode),
    duty_rate: null,
    vat_rate: 20,
    rate_source: "not_found",
    children_count: 0,
    is_prohibited: false,
    is_restricted: false,
    has_children_prohibited: false,
    has_children_restricted: false,
    legal_notes: [],
    controls: [],
  };

  try {
    // 1. Chercher le code exact dans hs_codes
    const { data: hsCode } = await supabase
      .from("hs_codes")
      .select("*")
      .or(`code.eq.${formatHSCode(cleanCode)},code_clean.eq.${cleanCode}`)
      .eq("is_active", true)
      .maybeSingle();

    if (hsCode) {
      result.description = hsCode.description_fr || "";
      result.legal_notes = hsCode.legal_notes ? [hsCode.legal_notes] : [];
    }

    // 2. Chercher le tarif exact
    const { data: exactTariff } = await supabase
      .from("country_tariffs")
      .select("*")
      .eq("country_code", countryCode)
      .eq("is_active", true)
      .or(`national_code.eq.${cleanCode},hs_code_6.eq.${cleanCode.slice(0, 6)}`)
      .maybeSingle();

    if (exactTariff) {
      result.found = true;
      result.duty_rate = exactTariff.duty_rate;
      result.vat_rate = exactTariff.vat_rate || 20;
      result.is_prohibited = exactTariff.is_prohibited || false;
      result.is_restricted = exactTariff.is_restricted || false;
      result.rate_source = "direct";
      result.description = exactTariff.description_local || result.description;
      
      // Chercher les contrôles même pour tarif direct
      const { data: controls } = await supabase
        .from("controlled_products")
        .select("*")
        .eq("country_code", countryCode)
        .eq("is_active", true)
        .or(`hs_code.eq.${cleanCode},hs_code.like.${cleanCode.slice(0, 4)}%`);

      if (controls) {
        result.controls = controls.map((c: any) => ({
          type: c.control_type,
          authority: c.control_authority || "N/A",
          inherited: cleanHSCode(c.hs_code) !== cleanCode,
        }));
      }
      
      return result;
    }

    // 3. Chercher les enfants (codes plus spécifiques) - HÉRITAGE
    const { data: children } = await supabase
      .from("country_tariffs")
      .select("*")
      .eq("country_code", countryCode)
      .eq("is_active", true)
      .like("national_code", `${cleanCode}%`)
      .neq("national_code", cleanCode);

    if (children && children.length > 0) {
      result.found = true;
      result.children_count = children.length;

      // Analyser les taux des enfants
      const rates = children
        .map((c: any) => c.duty_rate)
        .filter((r: any): r is number => r !== null && r !== undefined);

      if (rates.length > 0) {
        const minRate = Math.min(...rates);
        const maxRate = Math.max(...rates);

        result.duty_rate_min = minRate;
        result.duty_rate_max = maxRate;

        if (minRate === maxRate) {
          result.duty_rate = minRate;
          result.rate_source = "inherited";
        } else {
          result.duty_rate = null;
          result.rate_source = "range";
        }
      }

      // Vérifier les statuts des enfants
      result.has_children_prohibited = children.some((c: any) => c.is_prohibited);
      result.has_children_restricted = children.some((c: any) => c.is_restricted);

      // Prendre la description du premier enfant si pas déjà définie
      if (!result.description && children[0]?.description_local) {
        result.description = children[0].description_local;
      }
    }

    // 4. Chercher les notes légales des parents
    const parentCodes = getParentCodes(cleanCode);
    if (parentCodes.length > 0) {
      const { data: parentNotes } = await supabase
        .from("hs_codes")
        .select("code, legal_notes")
        .in("code_clean", parentCodes)
        .eq("is_active", true)
        .not("legal_notes", "is", null);

      if (parentNotes) {
        const notes = parentNotes
          .filter((p: any) => p.legal_notes)
          .map((p: any) => `[${p.code}] ${p.legal_notes}`);
        result.legal_notes = [...notes, ...result.legal_notes];
      }
    }

    // 5. Chercher les contrôles hérités
    const { data: controls } = await supabase
      .from("controlled_products")
      .select("*")
      .eq("country_code", countryCode)
      .eq("is_active", true)
      .or(`hs_code.eq.${cleanCode},hs_code.like.${cleanCode.slice(0, 4)}%`);

    if (controls) {
      result.controls = controls.map((c: any) => ({
        type: c.control_type,
        authority: c.control_authority || "N/A",
        inherited: cleanHSCode(c.hs_code) !== cleanCode,
      }));
    }

    return result;

  } catch (error) {
    console.error("Erreur searchHSCodeWithInheritance:", error);
    return result;
  }
}

// Formater le tarif avec héritage pour le contexte RAG
function formatTariffForRAG(tariff: TariffWithInheritance): string {
  let text = `## Code ${tariff.code}\n`;
  text += `**Description:** ${tariff.description}\n`;
  text += `**Niveau:** ${tariff.level} | **Chapitre:** ${tariff.chapter}\n\n`;

  if (tariff.rate_source === "range" && tariff.duty_rate_min !== undefined && tariff.duty_rate_max !== undefined) {
    text += `**DDI:** ${tariff.duty_rate_min}% à ${tariff.duty_rate_max}% (selon sous-position)\n`;
    text += `⚠️ Ce code a ${tariff.children_count} sous-positions avec des taux différents. Précisez le code complet.\n`;
  } else if (tariff.duty_rate !== null) {
    text += `**DDI:** ${tariff.duty_rate}%`;
    if (tariff.rate_source === "inherited") {
      text += ` (hérité de ${tariff.children_count} sous-position(s))`;
    }
    text += `\n`;
  } else {
    text += `**DDI:** Non trouvé\n`;
  }
  text += `**TVA:** ${tariff.vat_rate}%\n\n`;

  if (tariff.is_prohibited) text += `🚫 **INTERDIT à l'importation**\n`;
  if (tariff.is_restricted) text += `⚠️ **RESTREINT** - licence potentiellement requise\n`;
  if (tariff.has_children_prohibited) text += `🚫 Certaines sous-positions sont INTERDITES\n`;
  if (tariff.has_children_restricted) text += `⚠️ Certaines sous-positions sont RESTREINTES\n`;

  if (tariff.controls.length > 0) {
    text += `\n**Contrôles requis:**\n`;
    tariff.controls.forEach((c) => {
      text += `- ${c.type} par ${c.authority}${c.inherited ? " [hérité du parent]" : ""}\n`;
    });
  }

  if (tariff.legal_notes.length > 0) {
    text += `\n**Notes légales:**\n`;
    tariff.legal_notes.forEach((n) => text += `> ${n}\n`);
  }

  return text;
}

// Analyze question to extract intent, codes, and keywords
function analyzeQuestion(question: string) {
  const lowerQ = question.toLowerCase();
  
  // Detect HS codes (various formats)
  const hsPattern = /\b(\d{2}[\.\s]?\d{2}[\.\s]?\d{0,2}[\.\s]?\d{0,2})\b/g;
  const detectedCodes = [...question.matchAll(hsPattern)]
    .map(m => m[1].replace(/[\.\s]/g, ''))
    .filter(c => c.length >= 4);
  
  // Detect intent
  let intent = 'info';
  if (/class|code|position|nomenclature|sh\s/i.test(lowerQ)) intent = 'classify';
  else if (/droit|ddi|tva|tax|payer|combien|calcul|coût|prix/i.test(lowerQ)) intent = 'calculate';
  else if (/origine|eur\.?1|préférentiel|accord|certificat/i.test(lowerQ)) intent = 'origin';
  else if (/contrôl|interdit|autoris|mcinet|onssa|anrt|permis|licence/i.test(lowerQ)) intent = 'control';
  else if (/document|formalité|procédure|étape/i.test(lowerQ)) intent = 'procedure';
  
  // Extract meaningful keywords (remove stop words)
  const stopWords = ['le','la','les','un','une','des','pour','sur','est','que','quel','quels','quelle',
    'quelles','comment','combien','dans','avec','sans','par','vers','chez','être','avoir','faire',
    'douane','maroc','marocain','produit','marchandise'];
  const keywords = lowerQ
    .replace(/[^\w\sàâäéèêëïîôùûüç]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.includes(w));
  
  // Detect country (default to Morocco)
  let country = 'MA';
  if (/sénégal|senegal/i.test(lowerQ)) country = 'SN';
  else if (/côte d'ivoire|cote d'ivoire|ivoirien/i.test(lowerQ)) country = 'CI';
  else if (/cameroun/i.test(lowerQ)) country = 'CM';
  
  return { detectedCodes, intent, keywords, country };
}

// ============================================================================
// ANALYSE D'IMAGE AVEC CLAUDE VISION
// ============================================================================

interface ImageInput {
  type: "image";
  base64: string;
  mediaType: string;
}

async function analyzeImageWithClaude(
  images: ImageInput[],
  question: string,
  apiKey: string
): Promise<{ productDescription: string; suggestedCodes: string[]; questions: string[] }> {
  
  const imageContent = images.map(img => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: img.mediaType,
      data: img.base64,
    },
  }));

  // Vision API with 45 second timeout
  const VISION_TIMEOUT_MS = 45000;
  const visionController = new AbortController();
  const visionTimeoutId = setTimeout(() => visionController.abort(), VISION_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              ...imageContent,
              {
                type: "text",
                text: `Tu es un expert en classification douanière. Analyse cette/ces image(s) pour identifier le produit.

Question de l'utilisateur: "${question}"

Réponds en JSON avec ce format:
{
  "productDescription": "Description détaillée du produit visible (matériaux, fonction, caractéristiques)",
  "suggestedCodes": ["8517.12", "8517.13"], // Codes SH probables (4-6 chiffres)
  "questions": ["Question pour clarifier si nécessaire"] // Max 2 questions
}

IMPORTANT:
- Si c'est une facture/fiche technique, extrais les informations produit
- Suggère des codes SH basés sur ce que tu vois
- Pose des questions uniquement si crucial pour la classification`,
              },
            ],
          },
        ],
      }),
      signal: visionController.signal,
    });
  } catch (fetchError: any) {
    clearTimeout(visionTimeoutId);
    if (fetchError.name === 'AbortError') {
      console.error("Vision API timeout after", VISION_TIMEOUT_MS, "ms");
      throw new Error("Vision API timeout");
    }
    throw fetchError;
  }
  clearTimeout(visionTimeoutId);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Vision API error:", response.status, errorText);
    throw new Error(`Vision API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "{}";
  
  try {
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Failed to parse vision response:", e);
  }

  return {
    productDescription: text,
    suggestedCodes: [],
    questions: [],
  };
}

serve(async (req) => {
  // Créer le logger
  const logger = createLogger("chat", req);
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }

  logger.info("Request received", { method: req.method });

  // ============================================================================
  // PHASE 4: RATE LIMITING DISTRIBUÉ
  // ============================================================================
  const clientId = getClientId(req);
  const rateLimit = await checkRateLimitDistributed(clientId, {
    maxRequests: 30,     // 30 requests
    windowMs: 60000,      // per minute
    blockDurationMs: 300000, // 5 min block
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse(req, rateLimit.resetAt);
  }

  try {
    // Parser et valider le body
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

    const { question, sessionId, images, conversationHistory } = validation.data!;
    logger.info("Request validated", { sessionId, hasImages: !!images?.length });

    if (!question && (!images || images.length === 0)) {
      return errorResponse(req, "Question or images required", 400);
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY"); // For embeddings
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // ============================================================================
    // PHASE 3: SEMANTIC CACHE CHECK
    // ============================================================================
    let queryEmbedding: number[] | null = null;
    let useSemanticSearch = false;

    // Generate embedding for the question if OpenAI key is available
    if (OPENAI_API_KEY && question) {
      queryEmbedding = await generateQueryEmbedding(question, OPENAI_API_KEY);
      useSemanticSearch = queryEmbedding !== null;

      // Check response cache first (only for text questions, not images)
      if (queryEmbedding && (!images || images.length === 0)) {
        const cachedResponse = await checkResponseCache(supabase, queryEmbedding, 0.92);
        if (cachedResponse.found && cachedResponse.response) {
          console.log("Cache hit! Similarity:", cachedResponse.response.similarity);
          return new Response(
            JSON.stringify({
              response: cachedResponse.response.text,
              confidence: cachedResponse.response.confidence || "medium",
              context: cachedResponse.response.context || {},
              metadata: {
                cached: true,
                similarity: cachedResponse.response.similarity,
              },
            }),
            { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
          );
        }
      }
    }

    // If images are provided, analyze them first with Claude Vision
    let imageAnalysis: { productDescription: string; suggestedCodes: string[]; questions: string[] } | null = null;
    let enrichedQuestion = question || "";
    
    if (images && images.length > 0) {
      console.log("Analyzing", images.length, "image(s) with Claude Vision...");
      try {
        imageAnalysis = await analyzeImageWithClaude(images, question || "Identifie ce produit", ANTHROPIC_API_KEY);
        console.log("Image analysis result:", JSON.stringify(imageAnalysis));
        
        // Enrich the question with image analysis
        enrichedQuestion = `${question || "Identifie ce produit et donne-moi le code SH"}

[ANALYSE D'IMAGE]
Description du produit identifié: ${imageAnalysis.productDescription}
Codes SH suggérés par l'analyse visuelle: ${imageAnalysis.suggestedCodes.join(", ") || "Aucun"}
${imageAnalysis.questions.length > 0 ? `Questions de clarification: ${imageAnalysis.questions.join("; ")}` : ""}`;
      } catch (visionError) {
        console.error("Vision analysis failed:", visionError);
        // Continue without image analysis
      }
    }

    // Analyze the question (enriched with image analysis if available)
    const analysis = analyzeQuestion(enrichedQuestion);
    
    // Add suggested codes from image analysis
    if (imageAnalysis?.suggestedCodes.length) {
      const cleanedSuggested = imageAnalysis.suggestedCodes.map(c => cleanHSCode(c));
      analysis.detectedCodes = [...new Set([...analysis.detectedCodes, ...cleanedSuggested])];
    }
    console.log("Question analysis:", JSON.stringify(analysis));

    // Collect context from database
    const context: {
      tariffs_with_inheritance: TariffWithInheritance[];
      hs_codes: any[];
      tariffs: any[];
      controlled_products: any[];
      knowledge_documents: any[];
      pdf_summaries: any[];
    } = {
      tariffs_with_inheritance: [],
      hs_codes: [],
      tariffs: [],
      controlled_products: [],
      knowledge_documents: [],
      pdf_summaries: [],
    };

    // 1. NOUVEAU: Recherche avec héritage pour les codes détectés
    // AMÉLIORATION: Augmenté de 5 à 15 codes pour meilleure couverture
    if (analysis.detectedCodes.length > 0) {
      console.log("Searching with inheritance for codes:", analysis.detectedCodes);
      for (const code of analysis.detectedCodes.slice(0, 15)) {
        const tariffWithInheritance = await searchHSCodeWithInheritance(supabase, code, analysis.country);
        if (tariffWithInheritance.found) {
          context.tariffs_with_inheritance.push(tariffWithInheritance);
        }
        // Aussi ajouter aux hs_codes pour compatibilité
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
    
    // 2. Search HS codes by keywords (fallback si pas de codes détectés)
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
    
    // Remove duplicates
    // AMÉLIORATION: Augmenté de 15 à 30 codes pour contexte plus riche
    context.hs_codes = [...new Map(context.hs_codes.map(item => [item.code, item])).values()].slice(0, 30);

    // 3. Get tariffs for found codes (backup pour codes trouvés par keyword)
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

    // 4. Check for controlled products (si pas déjà dans tariffs_with_inheritance)
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
    // AMÉLIORATION: Augmenté de 2 à 5 termes et de 3 à 5 résultats par terme
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
      // AMÉLIORATION: Augmenté de 5 à 10 documents de connaissance
      context.knowledge_documents = [...new Map(context.knowledge_documents.map(d => [d.title, d])).values()].slice(0, 10);
    }

    // 6. Get relevant PDF summaries AND full text for precise RAG + download links
    const codes4ForPdf = context.hs_codes.length > 0 
      ? [...new Set(context.hs_codes.map(c => cleanHSCode(c.code || c.code_clean).substring(0, 4)))]
      : [];
    if (codes4ForPdf.length > 0 || analysis.keywords.length > 0) {
      let pdfQuery = supabase
        .from('pdf_extractions')
        .select(`
          summary,
          key_points,
          mentioned_hs_codes,
          extracted_text,
          extracted_data,
          pdf_documents!inner(id, title, category, country_code, file_path)
        `)
        // AMÉLIORATION: Augmenté de 5 à 10 PDFs pour plus de sources
        .limit(10);
      
      if (codes4ForPdf.length > 0) {
        pdfQuery = pdfQuery.contains('mentioned_hs_codes', [codes4ForPdf[0]]);
      }
      
      const { data } = await pdfQuery;
      if (data) {
        context.pdf_summaries = data.map((p: any) => {
          // Generate public download URL for the PDF
          const filePath = p.pdf_documents?.file_path;
          const downloadUrl = filePath 
            ? `${SUPABASE_URL}/storage/v1/object/public/pdf-documents/${filePath}`
            : null;
          
          return {
            title: p.pdf_documents?.title,
            category: p.pdf_documents?.category,
            summary: p.summary,
            key_points: p.key_points,
            full_text: p.extracted_text,
            extracted_data: p.extracted_data,
            download_url: downloadUrl,
          };
        });
      }
    }
    
    // 6b. Recherche textuelle dans les extractions si pas trouvé par code
    if (context.pdf_summaries.length === 0 && analysis.keywords.length > 0) {
      // Chercher par mots-clés dans le texte extrait
      const searchTerms = escapeSearchTerm(analysis.keywords.slice(0, 3).join(' '));
      const { data: textSearchResults } = await supabase
        .from('pdf_extractions')
        .select(`
          summary,
          key_points,
          extracted_text,
          extracted_data,
          pdf_documents!inner(id, title, category, country_code, file_path)
        `)
        .or(`summary.ilike.%${searchTerms}%,extracted_text.ilike.%${searchTerms}%`)
        .limit(3);
      
      if (textSearchResults) {
        context.pdf_summaries = textSearchResults.map((p: any) => {
          const filePath = p.pdf_documents?.file_path;
          const downloadUrl = filePath 
            ? `${SUPABASE_URL}/storage/v1/object/public/pdf-documents/${filePath}`
            : null;
          
          return {
            title: p.pdf_documents?.title,
            category: p.pdf_documents?.category,
            summary: p.summary,
            key_points: p.key_points,
            full_text: p.extracted_text,
            extracted_data: p.extracted_data,
            download_url: downloadUrl,
          };
        });
      }
    }

    // 7. NOUVEAU: Recherche dans les documents de veille (circulaires, accords, etc.)
    let veilleDocuments: any[] = [];
    if (analysis.keywords.length > 0 || codes6.length > 0) {
      // Recherche par mots-clés (avec échappement)
      const firstKeyword = analysis.keywords[0] ? escapeSearchTerm(analysis.keywords[0]) : '';
      const { data: veilleByKeywords } = await supabase
        .from('veille_documents')
        .select('title, summary, content, source_url, category, importance, mentioned_hs_codes')
        .or(`title.ilike.%${firstKeyword}%,summary.ilike.%${firstKeyword}%`)
        .eq('status', 'approved')
        .order('publication_date', { ascending: false })
        .limit(5);

      if (veilleByKeywords) veilleDocuments.push(...veilleByKeywords);

      // Recherche par codes HS mentionnés
      if (codes6.length > 0) {
        const { data: veilleByHs } = await supabase
          .from('veille_documents')
          .select('title, summary, content, source_url, category, importance, mentioned_hs_codes')
          .contains('mentioned_hs_codes', [codes6[0]])
          .eq('status', 'approved')
          .limit(5);

        if (veilleByHs) veilleDocuments.push(...veilleByHs);
      }

      // Dédupliquer
      veilleDocuments = [...new Map(veilleDocuments.map(d => [d.title, d])).values()].slice(0, 8);
    }

    // ============================================================================
    // PHASE 3: SEMANTIC SEARCH ENHANCEMENT
    // ============================================================================
    let semanticResults = {
      hs_codes: [] as any[],
      knowledge: [] as any[],
      pdfs: [] as any[],
      veille: [] as any[],
    };

    if (useSemanticSearch && queryEmbedding) {
      console.log("Using semantic search enhancement...");

      // Parallel semantic searches
      const [semanticHS, semanticKnowledge, semanticPDFs, semanticVeille] = await Promise.all([
        // Only search HS if we don't have enough from keyword search
        context.hs_codes.length < 10
          ? searchHSCodesSemantic(supabase, queryEmbedding, 0.65, 10)
          : Promise.resolve([]),
        // Only search knowledge if we don't have enough
        context.knowledge_documents.length < 5
          ? searchKnowledgeSemantic(supabase, queryEmbedding, 0.6, 5)
          : Promise.resolve([]),
        // Only search PDFs if we don't have enough
        context.pdf_summaries.length < 3
          ? searchPDFsSemantic(supabase, queryEmbedding, 0.6, 5)
          : Promise.resolve([]),
        // Only search veille if we don't have enough
        veilleDocuments.length < 3
          ? searchVeilleSemantic(supabase, queryEmbedding, 0.6, 5)
          : Promise.resolve([]),
      ]);

      semanticResults = {
        hs_codes: semanticHS,
        knowledge: semanticKnowledge,
        pdfs: semanticPDFs,
        veille: semanticVeille,
      };

      // Merge semantic results with keyword results (prioritizing keyword results)
      if (semanticHS.length > 0) {
        const existingCodes = new Set(context.hs_codes.map((c: any) => c.code || c.code_clean));
        const newHSCodes = semanticHS
          .filter((hs: any) => !existingCodes.has(hs.code))
          .map((hs: any) => ({
            ...hs,
            semantic_match: true,
            similarity: hs.similarity,
          }));
        context.hs_codes = [...context.hs_codes, ...newHSCodes].slice(0, 30);
      }

      if (semanticKnowledge.length > 0) {
        const existingTitles = new Set(context.knowledge_documents.map((d: any) => d.title));
        const newKnowledge = semanticKnowledge
          .filter((d: any) => !existingTitles.has(d.title))
          .map((d: any) => ({
            ...d,
            semantic_match: true,
            similarity: d.similarity,
          }));
        context.knowledge_documents = [...context.knowledge_documents, ...newKnowledge].slice(0, 10);
      }

      if (semanticVeille.length > 0) {
        const existingVeilleTitles = new Set(veilleDocuments.map((d: any) => d.title));
        const newVeille = semanticVeille
          .filter((d: any) => !existingVeilleTitles.has(d.title))
          .map((d: any) => ({
            ...d,
            semantic_match: true,
            similarity: d.similarity,
          }));
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
      tariffs: context.tariffs.length,
      controlled: context.controlled_products.length,
      documents: context.knowledge_documents.length,
      pdfs: context.pdf_summaries.length,
      veille: veilleDocuments.length,
    });

    // Build context with inheritance for RAG
    let tariffsContext = "";
    if (context.tariffs_with_inheritance.length > 0) {
      tariffsContext = context.tariffs_with_inheritance.map(formatTariffForRAG).join("\n---\n");
    } else if (context.tariffs.length > 0) {
      tariffsContext = JSON.stringify(context.tariffs, null, 2);
    } else {
      tariffsContext = "Aucun tarif trouvé";
    }

    // Build image analysis context
    let imageAnalysisContext = "";
    if (imageAnalysis) {
      imageAnalysisContext = `
### Analyse d'image/document uploadé
**Description du produit identifié:** ${imageAnalysis.productDescription}
**Codes SH suggérés par l'analyse visuelle:** ${imageAnalysis.suggestedCodes.join(", ") || "Non déterminés"}
${imageAnalysis.questions.length > 0 ? `**Questions de clarification suggérées:** ${imageAnalysis.questions.join("; ")}` : ""}
`;
    }

    // Build system prompt with interactive questioning - ONE question at a time
    const systemPrompt = `Tu es **DouaneAI**, un assistant expert en douane et commerce international, spécialisé dans la réglementation ${analysis.country === 'MA' ? 'marocaine' : 'africaine'}.

## 🚨 RÈGLE ABSOLUE - ÉMOJI DE CONFIANCE OBLIGATOIRE

**CHAQUE MESSAGE** que tu écris DOIT se terminer par UN émoji de confiance. C'est NON NÉGOCIABLE.

Termine TOUJOURS ton message par une de ces lignes:
- 🟢 **Confiance élevée** - quand tu as des données précises
- 🟡 **Confiance moyenne** - quand tu as des infos partielles
- 🔴 **Confiance faible** - quand tu manques d'informations

## 📖 CITATIONS OBLIGATOIRES - JUSTIFICATION DOCUMENTÉE

**RÈGLE CRITIQUE**: Quand tu donnes une réponse finale, tu DOIS citer les sources avec des EXTRAITS EXACTS des documents. Le client peut demander une justification documentée !

### Format de citation obligatoire (avec lien de téléchargement):
\`\`\`
📄 **Source:** [Titre du document]
> "[Extrait exact du texte source, entre guillemets]"
>
> [📥 Télécharger le document officiel](URL_DU_DOCUMENT)
\`\`\`

### Exemple de réponse avec citations et liens:
> **Code SH:** 0901.21.00
> **DDI:** 25%
>
> 📄 **Source:** Circulaire n°4212 - Accord Maroco-Finnois
> > "Les produits originaires de la Finlande bénéficient d'une exonération totale des droits de douane conformément à l'article 3 de l'accord..."
> >
> > [📥 Télécharger le document officiel](https://...)
>
> 📄 **Source:** Tarif Douanier Marocain - Chapitre 09
> > "Position 0901.21 - Café, non torréfié, non décaféiné : DDI 25%, TVA 20%"
> >
> > [📥 Télécharger le document officiel](https://...)
>
> 🟢 **Confiance élevée** - Données confirmées par 2 sources officielles

## 🎯 MODE CONVERSATION INTERACTIVE

Tu dois mener une **conversation naturelle** avec l'utilisateur en posant **UNE SEULE QUESTION À LA FOIS** pour collecter les informations nécessaires. C'est un dialogue, pas un interrogatoire !

## 📋 RÈGLES CRITIQUES

### ❌ CE QUE TU NE DOIS JAMAIS FAIRE
- Ne pose JAMAIS plusieurs questions dans un seul message
- Ne donne JAMAIS une réponse finale incomplète juste pour répondre
- N'utilise PAS de liste numérotée de questions
- N'OUBLIE JAMAIS l'émoji de confiance à la fin
- **NE DONNE JAMAIS de réponse finale SANS citer au moins UNE source avec un extrait exact**

### ✅ CE QUE TU DOIS FAIRE
1. **ANALYSE** ce que tu sais déjà grâce à la conversation
2. **IDENTIFIE** la prochaine information manquante la plus importante
3. **POSE UNE SEULE QUESTION** claire et précise avec des options cliquables
4. **TERMINE** par l'émoji de confiance approprié (🟢, 🟡 ou 🔴)
5. **ATTENDS** la réponse avant de continuer
6. **CITE TES SOURCES** avec des extraits exacts quand tu donnes une réponse finale

## 🔄 PROCESSUS DE CONVERSATION

### Étape 1: Première question
Quand l'utilisateur pose une question vague (ex: "code SH pour téléphone"), pose UNE question:

> Je peux vous aider à classifier votre téléphone ! 
>
> **Quel type de téléphone s'agit-il ?**
> - Smartphone
> - Téléphone basique (appels/SMS)  
> - Téléphone satellite
> - Téléphone fixe

### Étape 2: Utiliser la réponse
Quand l'utilisateur répond (ex: "Smartphone"), **PRENDS EN COMPTE** cette info et pose LA question suivante:

> Parfait, un smartphone ! 
>
> **Quel est l'état du produit ?**
> - Neuf
> - Reconditionné
> - Occasion

### Étape 3: Continuer jusqu'à avoir assez d'infos
Continue à poser UNE question à la fois jusqu'à avoir:
- Type de produit précis
- Caractéristiques techniques (si nécessaires)
- Pays d'origine (si demande calcul ou accords)
- Valeur CIF (si demande calcul)

### Étape 4: Réponse finale avec CITATIONS
Quand tu as TOUTES les infos, donne ta réponse complète avec:
- Code SH complet (10 chiffres si possible)
- Droits applicables
- Contrôles si applicables
- **OBLIGATOIRE: Citations des sources avec extraits exacts**
- **OBLIGATOIRE: Indicateur de confiance avec émoji**

## 🚦 INDICATEUR DE CONFIANCE OBLIGATOIRE

**À CHAQUE RÉPONSE FINALE**, tu DOIS inclure UN de ces émojis de confiance dans ton message:

- 🟢 **Confiance élevée** - Données officielles trouvées, code SH exact confirmé
- 🟡 **Confiance moyenne** - Code SH probable mais nécessite validation, données partielles
- 🔴 **Confiance faible** - Estimation basée sur des informations limitées, vérification requise

**Format obligatoire** (à inclure dans ta réponse finale):
> 🟢 **Niveau de confiance: Élevé** - [Raison]

ou

> 🟡 **Niveau de confiance: Moyen** - [Raison]

ou

> 🔴 **Niveau de confiance: Faible** - [Raison]

## 📝 FORMAT DE QUESTION INTERACTIF

Chaque question doit suivre ce format pour permettre des boutons cliquables:

> [Brève reconnaissance de la réponse précédente]
>
> **[Question unique et claire]** - [Pourquoi c'est important optionnel]
> - Option 1
> - Option 2
> - Option 3
> - Autre (précisez)

## 🎯 ORDRE DES QUESTIONS (selon l'intent)

**Pour classification:**
1. Type/catégorie de produit
2. Caractéristiques spécifiques (matériaux, fonctions)
3. État (neuf/occasion) si pertinent
4. → Réponse finale AVEC CITATIONS

**Pour calcul de droits:**
1. Type de produit (si pas clair)
2. Pays d'origine
3. Valeur CIF en MAD
4. → Calcul détaillé AVEC CITATIONS

**Pour contrôles/autorisations:**
1. Type de produit (si pas clair)
2. Usage prévu (commercial/personnel)
3. → Info sur les autorisations AVEC CITATIONS

## 🔍 VALIDATION CROISÉE DES SOURCES (NOUVEAU)

**RÈGLE IMPORTANTE**: Avant de donner une réponse finale, tu DOIS valider les informations:

1. **Vérifier la cohérence** entre les différentes sources (tarifs, PDFs, documents de veille)
2. **Prioriser les sources** dans cet ordre:
   - 🥇 **Tarif officiel** (country_tariffs) = Source la plus fiable
   - 🥈 **PDF extrait** (pdf_extractions) = Source officielle analysée
   - 🥉 **Document de veille** (veille_documents) = Source secondaire

3. **Si les sources se contredisent**, signale-le clairement:
   > ⚠️ **Attention - Sources contradictoires:**
   > - Tarif officiel: [info A]
   > - Document PDF: [info B]
   > → Recommandation: Vérifier auprès de l'ADII (www.douane.gov.ma)

4. **Indique le nombre de sources** qui confirment ton information:
   > ✅ Information confirmée par X source(s)

## 📚 CONTEXTE À UTILISER POUR TA RÉPONSE FINALE

${imageAnalysisContext}
### Tarifs avec héritage hiérarchique
${tariffsContext}

### Codes SH additionnels
${context.hs_codes.length > 0 ? JSON.stringify(context.hs_codes, null, 2) : "Aucun code SH additionnel"}

### Produits contrôlés
${context.controlled_products.length > 0 ? JSON.stringify(context.controlled_products, null, 2) : "Voir contrôles dans les tarifs ci-dessus"}

### Documents de référence
${context.knowledge_documents.length > 0 ? context.knowledge_documents.map(d => `- **${d.title}**: ${d.content?.substring(0, 500)}...`).join('\n') : "Aucun document de référence"}

### Contenu PDF pertinents (texte intégral pour citations + liens de téléchargement)
${context.pdf_summaries.length > 0 ? context.pdf_summaries.map(p => {
  let content = `#### 📄 ${p.title} (${p.category})\n`;
  if (p.download_url) {
    content += `**🔗 Lien de téléchargement:** ${p.download_url}\n`;
  }
  content += `**Résumé:** ${p.summary || 'N/A'}\n`;
  if (p.key_points && p.key_points.length > 0) {
    content += `**Points clés:**\n${p.key_points.map((kp: string) => `- ${kp}`).join('\n')}\n`;
  }
  // AMÉLIORATION: Augmenté de 10000 à 25000 chars pour meilleures citations
  if (p.full_text) {
    content += `**📝 TEXTE COMPLET DU DOCUMENT (utilise-le pour citer des passages exacts):**\n\`\`\`\n${p.full_text.substring(0, 25000)}${p.full_text.length > 25000 ? '\n...[document tronqué à 25000 caractères]' : ''}\n\`\`\`\n`;
  }
  // Inclure les données structurées
  if (p.extracted_data?.trade_agreements?.length > 0) {
    content += `**Accords commerciaux:** ${p.extracted_data.trade_agreements.map((a: any) => a.name).join(', ')}\n`;
  }
  if (p.extracted_data?.authorities?.length > 0) {
    content += `**Autorités:** ${p.extracted_data.authorities.join(', ')}\n`;
  }
  return content;
}).join('\n---\n') : "Aucun PDF pertinent"}

### Documents de veille récents (circulaires, accords, actualités)
${veilleDocuments.length > 0 ? veilleDocuments.map(v => {
  let content = `#### 📰 ${v.title} (${v.category || 'document'})\n`;
  content += `**Importance:** ${v.importance || 'moyenne'}\n`;
  if (v.summary) content += `**Résumé:** ${v.summary}\n`;
  if (v.content) content += `**Extrait:** ${v.content.substring(0, 3000)}...\n`;
  if (v.source_url) content += `**Source:** ${v.source_url}\n`;
  if (v.mentioned_hs_codes?.length > 0) content += `**Codes HS mentionnés:** ${v.mentioned_hs_codes.join(', ')}\n`;
  return content;
}).join('\n---\n') : "Aucun document de veille pertinent"}

---
⚠️ RAPPELS CRITIQUES:
1. POSE **UNE SEULE QUESTION** par message
2. Utilise le format avec tirets pour les options (elles seront transformées en boutons cliquables)
3. **CITE TOUJOURS tes sources** avec des extraits EXACTS des documents fournis ci-dessus quand tu donnes une réponse finale
4. Le format de citation est: 📄 **Source:** [Titre] suivi de > "[extrait exact]"
5. **INCLUS LE LIEN DE TÉLÉCHARGEMENT** du document source quand tu cites. Format: [📥 Télécharger le document](URL)`;

    // Build messages array with conversation history
    const claudeMessages: { role: "user" | "assistant"; content: string }[] = [];
    
    // Add previous conversation history if available
    if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      // Limit history to last 10 messages to avoid token limits
      const recentHistory = conversationHistory.slice(-10);
      for (const msg of recentHistory) {
        if (msg.role === "user" || msg.role === "assistant") {
          claudeMessages.push({
            role: msg.role,
            content: msg.content,
          });
        }
      }
    }
    
    // Add current question
    claudeMessages.push({
      role: "user",
      content: enrichedQuestion || question || "Identifie ce produit",
    });

    // Call Claude AI (Anthropic API) with timeout
    const startTime = Date.now();
    const CLAUDE_TIMEOUT_MS = 60000; // 60 seconds timeout

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);

    let aiResponse: Response;
    try {
      logger.info("Calling Claude API", { model: "claude-sonnet-4-20250514" });
      
      aiResponse = await callAnthropicWithRetry(
        ANTHROPIC_API_KEY,
        {
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: systemPrompt,
          messages: claudeMessages,
        },
        CLAUDE_TIMEOUT_MS
      );
      clearTimeout(timeoutId);
      
      logger.info("Claude API responded", { status: aiResponse.status });
      
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        logger.error("Claude API timeout", fetchError, { timeoutMs: CLAUDE_TIMEOUT_MS });
        return errorResponse(req, "La requête a pris trop de temps. Veuillez réessayer.", 504);
      }
      logger.error("Claude API error after retries", fetchError);
      return errorResponse(req, "Service temporairement indisponible.", 503);
    }

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return errorResponse(req, "Trop de requêtes. Veuillez réessayer dans quelques instants.", 429);
      }
      if (aiResponse.status === 402 || aiResponse.status === 400) {
        const errorData = await aiResponse.json().catch(() => ({}));
        console.error("Claude API error:", aiResponse.status, errorData);
        return errorResponse(req, "Erreur API Claude. Vérifiez votre clé API.", 402);
      }
      const errorText = await aiResponse.text();
      console.error("Claude API error:", aiResponse.status, errorText);
      throw new Error("Claude API error");
    }

    const aiData = await aiResponse.json();
    const responseTime = Date.now() - startTime;
    const responseText = aiData.content?.[0]?.text || "Je n'ai pas pu générer de réponse.";

    // Determine confidence level from response and context
    let confidence: "high" | "medium" | "low" = "medium";
    const hasDirectRate = context.tariffs_with_inheritance.some(t => t.rate_source === "direct");
    const hasInheritedRate = context.tariffs_with_inheritance.some(t => t.rate_source === "inherited");
    const hasRangeRate = context.tariffs_with_inheritance.some(t => t.rate_source === "range");
    const responseTextLower = responseText.toLowerCase();
    
    // Priority 1: Check for emoji indicators (most reliable)
    if (responseText.includes("🟢")) {
      confidence = "high";
    } else if (responseText.includes("🔴")) {
      confidence = "low";
    } else if (responseText.includes("🟡")) {
      confidence = "medium";
    }
    // Priority 2: Check for explicit confidence text patterns (case-insensitive)
    else if (responseTextLower.includes("confiance haute") || responseTextLower.includes("confiance élevée") || responseTextLower.includes("confiance elevee") || responseTextLower.includes("niveau de confiance : élevé") || responseTextLower.includes("confiance : haute") || responseTextLower.includes("confiance : élevée")) {
      confidence = "high";
    } else if (responseTextLower.includes("confiance faible") || responseTextLower.includes("confiance basse") || responseTextLower.includes("niveau de confiance : faible") || responseTextLower.includes("confiance : faible")) {
      confidence = "low";
    } else if (responseTextLower.includes("confiance moyenne") || responseTextLower.includes("confiance modérée") || responseTextLower.includes("niveau de confiance : moyen") || responseTextLower.includes("confiance : moyenne")) {
      confidence = "medium";
    }
    // Priority 3: Check for percentage specifically linked to confidence (e.g., "confiance: 95%", "95% de confiance")
    else {
      const confidencePercentMatch = responseText.match(/(?:confiance|fiabilité|certitude)[:\s]*(\d{1,3})\s*%/i) || 
                                      responseText.match(/(\d{1,3})\s*%\s*(?:de\s+)?(?:confiance|fiabilité|certitude)/i);
      if (confidencePercentMatch) {
        const percentage = parseInt(confidencePercentMatch[1], 10);
        if (percentage >= 80) {
          confidence = "high";
        } else if (percentage >= 50) {
          confidence = "medium";
        } else {
          confidence = "low";
        }
      }
    }
    
    // Log for debugging
    console.info(`Confidence detection: initial="${confidence}", hasEmoji=${responseText.includes("🟢") || responseText.includes("🟡") || responseText.includes("🔴")}, textLower contains "confiance élevée"=${responseTextLower.includes("confiance élevée")}, contains "haute"=${responseTextLower.includes("haute")}`);
    
    // Priority 4: Fallback to context-based confidence ONLY if no explicit confidence was found in text
    const hasExplicitConfidence = responseText.includes("🟢") || responseText.includes("🟡") || responseText.includes("🔴") ||
                                   responseTextLower.includes("confiance") || responseTextLower.includes("fiabilité");
    
    if (!hasExplicitConfidence) {
      // Only use context-based logic if the AI didn't explicitly state confidence
      if (hasDirectRate || hasInheritedRate) {
        confidence = "high";
      } else if (hasRangeRate) {
        confidence = "medium";
      } else if (context.tariffs_with_inheritance.length === 0 && context.hs_codes.length === 0) {
        confidence = "low";
      }
    }
    
    console.info(`Final confidence: ${confidence}`);

    // Save conversation to database
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
        veille_docs_used: veilleDocuments.map(v => v.title),
        confidence_level: confidence,
        response_time_ms: responseTime,
      })
      .select('id')
      .single();

    // ============================================================================
    // PHASE 3: SAVE TO RESPONSE CACHE
    // ============================================================================
    // Only cache if confidence is medium or high and we have an embedding
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
    return errorResponse(
      req,
      "Une erreur est survenue. Veuillez réessayer.",
      500,
      logger.getRequestId()
    );
  }
});
