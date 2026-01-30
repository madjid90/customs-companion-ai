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

// =============================================================================
// CONFIGURATION LOVABLE AI
// =============================================================================

const LOVABLE_AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_AI_MODEL = "google/gemini-2.5-flash"; // Rapide et efficace pour le chat

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
    // Convert embedding array to string format for pgvector
    const { data, error } = await supabase.rpc("search_hs_codes_semantic", {
      query_embedding: `[${queryEmbedding.join(",")}]`,
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
    const { data, error } = await supabase.rpc("search_knowledge_documents_semantic", {
      query_embedding: `[${queryEmbedding.join(",")}]`,
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
    const { data, error } = await supabase.rpc("search_pdf_extractions_semantic", {
      query_embedding: `[${queryEmbedding.join(",")}]`,
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
    const { data, error } = await supabase.rpc("search_veille_documents_semantic", {
      query_embedding: `[${queryEmbedding.join(",")}]`,
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
// ANALYSE D'IMAGE AVEC LOVABLE AI (Gemini Vision)
// ============================================================================

interface ImageInput {
  type: "image";
  base64: string;
  mediaType: string;
}

async function analyzeImageWithLovableAI(
  images: ImageInput[],
  question: string,
  apiKey: string
): Promise<{ productDescription: string; suggestedCodes: string[]; questions: string[] }> {
  
  // Format OpenAI/Gemini pour les images
  const imageContent = images.map(img => ({
    type: "image_url" as const,
    image_url: {
      url: `data:${img.mediaType};base64,${img.base64}`,
    },
  }));

  // Vision API with 45 second timeout
  const VISION_TIMEOUT_MS = 45000;
  const visionController = new AbortController();
  const visionTimeoutId = setTimeout(() => visionController.abort(), VISION_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(LOVABLE_AI_GATEWAY, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
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
  const text = data.choices?.[0]?.message?.content || "{}";
  
  try {
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY"); // For embeddings
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
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

    // If images are provided, analyze them first with Lovable AI Vision
    let imageAnalysis: { productDescription: string; suggestedCodes: string[]; questions: string[] } | null = null;
    let enrichedQuestion = question || "";
    
    // AMÉLIORATION CRITIQUE: Enrichir la question avec le contexte de l'historique
    // pour que la recherche de PDFs et codes SH prenne en compte tout le contexte
    let historyContext = "";
    if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      // Extraire les éléments clés des messages précédents (derniers 6 messages)
      const recentHistory = conversationHistory.slice(-6);
      const keyPhrases: string[] = [];
      
      for (const msg of recentHistory) {
        if (msg.role === "user" && msg.content) {
          // Extraire les mots-clés importants des questions précédentes
          const content = msg.content.toLowerCase();
          // Détecter les types de produits mentionnés
          const productPatterns = [
            /serrure[s]?/gi, /cadenas/gi, /verrou[s]?/gi, /clé[s]?/gi, /fermoir[s]?/gi,
            /téléphone[s]?/gi, /smartphone[s]?/gi, /ordinateur[s]?/gi, /voiture[s]?/gi,
            /machine[s]?/gi, /équipement[s]?/gi, /appareil[s]?/gi, /produit[s]?/gi,
            /meuble[s]?/gi, /porte[s]?/gi, /fenêtre[s]?/gi, /véhicule[s]?/gi,
            /métaux?\s*commun[s]?/gi, /acier/gi, /fer/gi, /cuivre/gi, /aluminium/gi,
            /électrique[s]?/gi, /électronique[s]?/gi, /mécanique[s]?/gi,
          ];
          
          for (const pattern of productPatterns) {
            const matches = msg.content.match(pattern);
            if (matches) {
              keyPhrases.push(...matches);
            }
          }
        }
      }
      
      // Créer un contexte résumé pour enrichir la question
      if (keyPhrases.length > 0) {
        const uniquePhrases = [...new Set(keyPhrases.map(p => p.toLowerCase()))];
        historyContext = `[CONTEXTE DE CONVERSATION: ${uniquePhrases.join(", ")}] `;
        console.log("History context extracted:", historyContext);
      }
    }
    
    if (images && images.length > 0) {
      console.log("Analyzing", images.length, "image(s) with Lovable AI Vision...");
      try {
        imageAnalysis = await analyzeImageWithLovableAI(images, question || "Identifie ce produit", LOVABLE_API_KEY);
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

    // Enrichir avec le contexte de l'historique pour la recherche
    const searchQuestion = historyContext + enrichedQuestion;
    console.log("Search question with history context:", searchQuestion.substring(0, 200));

    // Analyze the question (enriched with history context and image analysis)
    const analysis = analyzeQuestion(searchQuestion);
    
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
      legal_references: any[];
      regulatory_procedures: any[];
    } = {
      tariffs_with_inheritance: [],
      hs_codes: [],
      tariffs: [],
      controlled_products: [],
      knowledge_documents: [],
      pdf_summaries: [],
      legal_references: [],
      regulatory_procedures: [],
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
    // AMÉLIORATION: Recherche par chapitre (2 premiers chiffres) ET par position (4 premiers chiffres)
    const chaptersForPdf = context.hs_codes.length > 0 
      ? [...new Set(context.hs_codes.map(c => cleanHSCode(c.code || c.code_clean).substring(0, 2)))]
      : [];
    const codes4ForPdf = context.hs_codes.length > 0 
      ? [...new Set(context.hs_codes.map(c => cleanHSCode(c.code || c.code_clean).substring(0, 4)))]
      : [];
    
    // Créer les patterns de recherche (ex: pour code 8301, chercher 830100, 830110, 830120, etc.)
    const searchPatterns: string[] = [];
    codes4ForPdf.forEach(code4 => {
      // Ajouter le code à 6 chiffres (format stocké dans mentioned_hs_codes)
      searchPatterns.push(code4 + '00');
      searchPatterns.push(code4 + '10');
      searchPatterns.push(code4 + '20');
      searchPatterns.push(code4 + '30');
    });
    
    console.log("PDF search - Chapters:", chaptersForPdf, "Patterns:", searchPatterns.slice(0, 5));
    
    if (searchPatterns.length > 0 || chaptersForPdf.length > 0 || analysis.keywords.length > 0) {
      // Méthode 1: Recherche par mentioned_hs_codes (JSONB contains)
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
        .limit(10);
      
      // Recherche avec le premier pattern
      if (searchPatterns.length > 0) {
        pdfQuery = pdfQuery.contains('mentioned_hs_codes', [searchPatterns[0]]);
      }
      
      const { data: pdfsByCode } = await pdfQuery;
      
      // Méthode 2: Recherche par titre du document via pdf_documents puis join extractions
      // AMÉLIORATION: Chercher dans TOUS les chapitres pertinents (jusqu'à 10)
      let pdfsByTitle: any[] = [];
      if (chaptersForPdf.length > 0) {
        // Construire une requête OR pour tous les chapitres pertinents (max 10)
        const chapterConditions: string[] = [];
        for (const chapter of chaptersForPdf.slice(0, 10)) {
          const chapterNum = parseInt(chapter);
          const paddedChapter = chapterNum.toString().padStart(2, '0');
          chapterConditions.push(`title.ilike.%Chapitre SH ${chapterNum}%`);
          chapterConditions.push(`title.ilike.%SH CODE ${chapterNum}%`);
          // Aussi chercher avec le numéro paddé si différent
          if (chapterNum < 10 && chapterNum.toString() !== paddedChapter) {
            chapterConditions.push(`title.ilike.%Chapitre SH ${paddedChapter}%`);
            chapterConditions.push(`title.ilike.%SH CODE ${paddedChapter}%`);
          }
        }
        
        console.log("Searching PDFs for chapters:", chaptersForPdf.slice(0, 10));
        
        const { data: pdfDocs } = await supabase
          .from('pdf_documents')
          .select('id, title, category, file_path')
          .eq('is_active', true)
          .or(chapterConditions.join(','))
          .limit(15);
        
        console.log("PDF docs found by title:", pdfDocs?.length, pdfDocs?.map((d: any) => d.title));
        
        // Puis récupérer les extractions pour ces PDFs
        if (pdfDocs && pdfDocs.length > 0) {
          const pdfIds = pdfDocs.map((d: any) => d.id);
          const { data: extractions } = await supabase
            .from('pdf_extractions')
            .select('summary, key_points, mentioned_hs_codes, extracted_text, extracted_data, pdf_id')
            .in('pdf_id', pdfIds);
          
          if (extractions) {
            // Combiner avec les infos du PDF
            const pdfMap = new Map(pdfDocs.map((d: any) => [d.id, d]));
            pdfsByTitle = extractions.map((ext: any) => ({
              ...ext,
              pdf_documents: pdfMap.get(ext.pdf_id)
            }));
          }
        }
      }
      
      // Combiner et dédupliquer les résultats
      const allPdfResults = [...(pdfsByCode || []), ...pdfsByTitle];
      const uniquePdfs = [...new Map(allPdfResults.map(p => [p.pdf_documents?.id || p.pdf_id, p])).values()];
      
      console.log("Total unique PDFs found:", uniquePdfs.length);
      
      if (uniquePdfs.length > 0) {
        context.pdf_summaries = uniquePdfs.map((p: any) => {
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
            mentioned_codes: p.mentioned_hs_codes,
            download_url: downloadUrl,
          };
        });
        console.log("PDF summaries prepared:", context.pdf_summaries.length, "with URLs:", context.pdf_summaries.filter((p: any) => p.download_url).length);
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

    // 8. AMÉLIORATION: Recherche étendue des références légales (circulaires, lois, décrets, articles)
    // Toujours rechercher les références légales, pas seulement pour certains intents
    const shouldSearchLegal = analysis.keywords.length > 0 || 
                              analysis.intent === 'procedure' || 
                              analysis.intent === 'control' ||
                              analysis.intent === 'origin' ||
                              context.hs_codes.length > 0;
    
    if (shouldSearchLegal) {
      // Recherche multi-critères dans les références légales
      const legalSearchTerms = analysis.keywords.slice(0, 3).map(k => escapeSearchTerm(k));
      
      // Recherche par mots-clés
      for (const searchTerm of legalSearchTerms) {
        const { data: legalRefs } = await supabase
          .from('legal_references')
          .select(`
            id,
            reference_type,
            reference_number,
            title,
            reference_date,
            context,
            pdf_id,
            pdf_documents!inner(id, title, category, file_path, document_reference, issuing_authority)
          `)
          .or(`reference_number.ilike.%${searchTerm}%,title.ilike.%${searchTerm}%,context.ilike.%${searchTerm}%`)
          .eq('is_active', true)
          .order('reference_date', { ascending: false })
          .limit(10);
        
        if (legalRefs) {
          const newRefs = legalRefs.map((ref: any) => ({
            ...ref,
            pdf_title: ref.pdf_documents?.title,
            pdf_file_path: ref.pdf_documents?.file_path,
            issuing_authority: ref.pdf_documents?.issuing_authority,
            document_reference: ref.pdf_documents?.document_reference,
            download_url: ref.pdf_documents?.file_path 
              ? `${SUPABASE_URL}/storage/v1/object/public/pdf-documents/${ref.pdf_documents.file_path}`
              : null,
          }));
          context.legal_references.push(...newRefs);
        }
      }
      
      // Recherche par type de référence pertinent selon l'intent
      const relevantTypes = analysis.intent === 'origin' ? ['accord', 'convention', 'protocole'] :
                           analysis.intent === 'control' ? ['circulaire', 'note', 'décision'] :
                           analysis.intent === 'procedure' ? ['loi', 'décret', 'arrêté', 'circulaire'] :
                           ['loi', 'décret', 'circulaire', 'note'];
      
      for (const refType of relevantTypes) {
        const { data: typeRefs } = await supabase
          .from('legal_references')
          .select(`
            id,
            reference_type,
            reference_number,
            title,
            reference_date,
            context,
            pdf_id,
            pdf_documents!inner(id, title, category, file_path, document_reference, issuing_authority)
          `)
          .ilike('reference_type', `%${refType}%`)
          .eq('is_active', true)
          .order('reference_date', { ascending: false })
          .limit(5);
        
        if (typeRefs) {
          const newTypeRefs = typeRefs.map((ref: any) => ({
            ...ref,
            pdf_title: ref.pdf_documents?.title,
            pdf_file_path: ref.pdf_documents?.file_path,
            issuing_authority: ref.pdf_documents?.issuing_authority,
            document_reference: ref.pdf_documents?.document_reference,
            download_url: ref.pdf_documents?.file_path 
              ? `${SUPABASE_URL}/storage/v1/object/public/pdf-documents/${ref.pdf_documents.file_path}`
              : null,
          }));
          context.legal_references.push(...newTypeRefs);
        }
      }
      
      // Dédupliquer les références légales
      context.legal_references = [...new Map(
        context.legal_references.map((ref: any) => [ref.reference_number, ref])
      ).values()].slice(0, 20);
    }
    
    // 8b. NOUVEAU: Récupérer le texte intégral des PDFs sources pour les citations
    const legalPdfIds = [...new Set(context.legal_references.map((ref: any) => ref.pdf_id).filter(Boolean))];
    const legalPdfTexts: Record<string, { text: string; title: string; download_url: string }> = {};
    
    if (legalPdfIds.length > 0) {
      const { data: pdfExtracts } = await supabase
        .from('pdf_extractions')
        .select(`
          pdf_id,
          extracted_text,
          summary,
          key_points,
          pdf_documents!inner(title, file_path)
        `)
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

    // 9. Recherche des procédures réglementaires
    if (analysis.keywords.length > 0) {
      const procSearchTerm = escapeSearchTerm(analysis.keywords[0] || '');
      
      const { data: procedures } = await supabase
        .from('regulatory_procedures')
        .select(`
          id,
          procedure_name,
          required_documents,
          deadlines,
          penalties,
          authority,
          pdf_documents!inner(id, title, category, file_path)
        `)
        .or(`procedure_name.ilike.%${procSearchTerm}%,authority.ilike.%${procSearchTerm}%`)
        .eq('is_active', true)
        .limit(5);
      
      if (procedures) {
        context.regulatory_procedures = procedures.map((proc: any) => ({
          ...proc,
          pdf_title: proc.pdf_documents?.title,
          pdf_file_path: proc.pdf_documents?.file_path,
        }));
      }
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
      legal_references: context.legal_references.length,
      procedures: context.regulatory_procedures.length,
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

    // Build list of available source documents with URLs for citations
    // IMPORTANT: Filtrer par pertinence du chapitre pour éviter les incohérences
    const relevantChapters: Set<string> = new Set();
    
    // Extraire les chapitres (2 premiers chiffres) des codes SH trouvés
    context.hs_codes.forEach((hs: any) => {
      const code = hs.code || hs.code_clean || '';
      const chapter = cleanHSCode(code).substring(0, 2);
      if (chapter) relevantChapters.add(chapter);
    });
    context.tariffs_with_inheritance.forEach((t: any) => {
      const chapter = t.code_clean?.substring(0, 2);
      if (chapter) relevantChapters.add(chapter);
    });
    
    console.log("Relevant chapters for source filtering:", Array.from(relevantChapters));
    
    const availableSources: string[] = [];
    
    // Add PDF sources - INCLURE TOUS les PDFs trouvés avec format simplifié et clair
    if (context.pdf_summaries.length > 0) {
      context.pdf_summaries.forEach((pdf: any) => {
        if (pdf.title && pdf.download_url) {
          // Format ultra-simplifié pour que l'IA puisse facilement copier l'URL
          availableSources.push(`DOCUMENT: "${pdf.title}"\nURL_TÉLÉCHARGEMENT: ${pdf.download_url}`);
          console.log("Added PDF source:", pdf.title, "URL:", pdf.download_url);
        }
      });
    }
    
    // Add legal reference sources
    if (context.legal_references.length > 0) {
      context.legal_references.forEach((ref: any) => {
        if (ref.download_url) {
          availableSources.push(`DOCUMENT: "${ref.reference_type} ${ref.reference_number} - ${ref.title || 'Document officiel'}"\nURL_TÉLÉCHARGEMENT: ${ref.download_url}`);
        }
      });
    }
    
    // Créer la liste des sources en format TRÈS SIMPLE pour que l'IA la copie exactement
    const sourcesListForPrompt = availableSources.length > 0 
      ? `
## 📚 LISTE DES DOCUMENTS DISPONIBLES AVEC LEURS URLs EXACTES

⚠️ COPIE EXACTEMENT CES URLs QUAND TU CITES UN DOCUMENT:

${availableSources.slice(0, 15).join('\n\n')}

---
FIN DE LA LISTE DES URLS - UTILISE UNIQUEMENT CES URLs EXACTES
`
      : '\n⚠️ Aucun document source - recommande www.douane.gov.ma\n';

    // Build system prompt with interactive questioning - ONE question at a time
    const systemPrompt = `Tu es **DouaneAI**, un assistant expert en douane et commerce international, spécialisé dans la réglementation ${analysis.country === 'MA' ? 'marocaine' : 'africaine'}.

${sourcesListForPrompt}

## RÈGLE ABSOLUE - LIENS DE TÉLÉCHARGEMENT

**QUAND TU CITES UN DOCUMENT DE LA LISTE CI-DESSUS:**
1. Trouve le document dans la liste
2. COPIE EXACTEMENT l'URL_TÉLÉCHARGEMENT correspondante
3. Utilise ce format Markdown: [Consulter](URL_COPIÉE)

**EXEMPLE CORRECT:**
Si la liste contient:
DOCUMENT: "Chapitre SH 83"
URL_TÉLÉCHARGEMENT: https://mefyrysrlmzzcsyyysqp.supabase.co/storage/v1/object/public/pdf-documents/uploads/fichier.pdf

Tu dois écrire:
> **Source:** Chapitre SH 83 - [Consulter](https://mefyrysrlmzzcsyyysqp.supabase.co/storage/v1/object/public/pdf-documents/uploads/fichier.pdf)

**INTERDIT:**
- Ne PAS écrire [Consulter](Données intégrées)
- Ne PAS inventer des URLs
- Ne PAS utiliser des URLs internes comme /chat ou localhost
- Si un document n'est pas dans la liste, écris: "Consultez www.douane.gov.ma"
- NE PAS UTILISER D'EMOJIS dans tes réponses (pas de 📁, 📥, 📄, ℹ️, 🟢, 🟡, 🔴, etc.)

## MODE CONVERSATION INTERACTIVE

Pose **UNE SEULE QUESTION À LA FOIS** pour collecter les informations.

## INDICATEUR DE CONFIANCE

Termine chaque réponse finale par un indicateur textuel (SANS emoji):
- **Confiance élevée** - données officielles trouvées
- **Confiance moyenne** - infos partielles
- **Confiance faible** - estimation

## 📝 FORMAT DE QUESTION

\`\`\`
[Reconnaissance brève]

**[Question unique]**
- Option 1
- Option 2
- Option 3
\`\`\`

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
- **OBLIGATOIRE: Indicateur de confiance textuel (SANS emoji)**

## INDICATEUR DE CONFIANCE OBLIGATOIRE

**À CHAQUE RÉPONSE FINALE**, tu DOIS inclure UN de ces indicateurs textuels (SANS emoji):

- **Confiance élevée** - Données officielles trouvées, code SH exact confirmé
- **Confiance moyenne** - Code SH probable mais nécessite validation, données partielles
- **Confiance faible** - Estimation basée sur des informations limitées, vérification requise

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

### 📜 RÉFÉRENCES LÉGALES STRUCTURÉES (PRIORITÉ HAUTE POUR CITATIONS)

**INSTRUCTION CRITIQUE**: Utilise ces références pour citer précisément les articles de loi, circulaires et décrets.
Quand tu cites une référence, tu DOIS inclure:
1. Le numéro de référence exact (ex: "Circulaire n°5234/222")
2. L'article ou paragraphe pertinent
3. Un extrait textuel entre guillemets
4. Le lien de téléchargement

${context.legal_references.length > 0 ? context.legal_references.map((ref: any) => {
  let content = `---\n📜 **${(ref.reference_type || 'RÉFÉRENCE').toUpperCase()}** : ${ref.reference_number}\n`;
  if (ref.title) content += `**Intitulé complet:** ${ref.title}\n`;
  if (ref.reference_date) content += `**Date de publication:** ${ref.reference_date}\n`;
  if (ref.issuing_authority) content += `**Autorité émettrice:** ${ref.issuing_authority}\n`;
  if (ref.context) content += `**Contexte d'application:** ${ref.context}\n`;
  if (ref.document_reference) content += `**Référence document:** ${ref.document_reference}\n`;
  if (ref.pdf_title) content += `**Document source:** ${ref.pdf_title}\n`;
  if (ref.download_url) content += `**🔗 URL téléchargement:** ${ref.download_url}\n`;
  
  // Ajouter le texte intégral si disponible pour permettre les citations exactes
  const pdfText = ref.pdf_id && legalPdfTexts[ref.pdf_id];
  if (pdfText && pdfText.text) {
    // Extraire les passages contenant des articles numérotés
    const articleMatches = pdfText.text.match(/(?:Article|Art\.?)\s*\d+[^\n]{0,500}/gi);
    if (articleMatches && articleMatches.length > 0) {
      content += `\n**📝 ARTICLES EXTRAITS (pour citations exactes):**\n`;
      articleMatches.slice(0, 10).forEach((article: string) => {
        content += `> ${article.trim()}\n`;
      });
    }
    // Limiter le texte complet mais inclure assez pour les citations
    content += `\n**📄 TEXTE INTÉGRAL (premiers 8000 caractères):**\n\`\`\`\n${pdfText.text.substring(0, 8000)}${pdfText.text.length > 8000 ? '\n...[suite tronquée]' : ''}\n\`\`\`\n`;
  }
  return content;
}).join('\n') : "⚠️ Aucune référence légale structurée trouvée dans la base. Recommande à l'utilisateur de consulter www.douane.gov.ma"}

### 📋 PROCÉDURES RÉGLEMENTAIRES DÉTAILLÉES

${context.regulatory_procedures.length > 0 ? context.regulatory_procedures.map((proc: any) => {
  let content = `---\n📋 **Procédure:** ${proc.procedure_name}\n`;
  if (proc.authority) content += `**Autorité compétente:** ${proc.authority}\n`;
  if (proc.required_documents && Array.isArray(proc.required_documents) && proc.required_documents.length > 0) {
    content += `**Documents requis:**\n${proc.required_documents.map((d: string) => `- ${d}`).join('\n')}\n`;
  }
  if (proc.deadlines) content += `**Délais réglementaires:** ${proc.deadlines}\n`;
  if (proc.penalties) content += `**Sanctions en cas de non-conformité:** ${proc.penalties}\n`;
  if (proc.pdf_title) content += `**Source documentaire:** ${proc.pdf_title}\n`;
  return content;
}).join('\n') : "Aucune procédure réglementaire spécifique trouvée"}

---
## RAPPELS CRITIQUES POUR TES RÉPONSES:

1. **AUCUN EMOJI** - N'utilise JAMAIS d'emojis dans tes réponses

2. **UNE SEULE QUESTION** par message (format avec tirets = boutons cliquables)

3. **CITATIONS OBLIGATOIRES** - Format requis:
   \`\`\`
   **Base légale:** [Type] n°[Numéro] du [Date]
   > "**Article X:** [Texte exact de l'article cité]"
   > 
   > [Consulter](URL)
   \`\`\`

4. **ARTICLES DE LOI** - Quand tu cites un article:
   - Cite le numéro d'article exact (Article 1, Article 45, etc.)
   - Reproduis le texte tel qu'il apparaît dans le document
   - Indique la référence complète du texte juridique

5. **CIRCULAIRES** - Format de citation:
   - Circulaire n°XXXX/XXX du JJ/MM/AAAA
   - Objet de la circulaire
   - Point ou paragraphe pertinent

6. **VALIDATION CROISÉE** - Si plusieurs textes traitent du même sujet, cite-les tous avec leurs dates pour montrer l'évolution réglementaire

7. **LIEN SOURCE** - Toujours inclure [Consulter](URL) quand disponible`;

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

    // Call Lovable AI (Gemini) with timeout
    const startTime = Date.now();
    const AI_TIMEOUT_MS = 60000; // 60 seconds timeout

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    let aiResponse: Response;
    try {
      logger.info("Calling Lovable AI", { model: LOVABLE_AI_MODEL });
      
      aiResponse = await fetch(LOVABLE_AI_GATEWAY, {
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
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      logger.info("Lovable AI responded", { status: aiResponse.status });
      
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        logger.error("Lovable AI timeout", fetchError, { timeoutMs: AI_TIMEOUT_MS });
        return errorResponse(req, "La requête a pris trop de temps. Veuillez réessayer.", 504);
      }
      logger.error("Lovable AI error", fetchError);
      return errorResponse(req, "Service temporairement indisponible.", 503);
    }

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return errorResponse(req, "Trop de requêtes. Veuillez réessayer dans quelques instants.", 429);
      }
      if (aiResponse.status === 402) {
        return errorResponse(req, "Crédits Lovable AI épuisés. Rechargez dans Settings > Workspace > Usage.", 402);
      }
      const errorText = await aiResponse.text();
      console.error("Lovable AI error:", aiResponse.status, errorText);
      throw new Error("Lovable AI error");
    }

    const aiData = await aiResponse.json();
    const responseTime = Date.now() - startTime;
    const responseText = aiData.choices?.[0]?.message?.content || "Je n'ai pas pu générer de réponse.";

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
