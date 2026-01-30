// ============================================================================
// SEMANTIC SEARCH & EMBEDDING FUNCTIONS
// ============================================================================

/**
 * Configuration des seuils de similarité optimisés par type de recherche
 */
export interface SemanticThresholds {
  hsCodesHigh: number;      // Classification précise
  hsCodesMedium: number;    // Recherche générale
  hsCodesLow: number;       // Recherche exploratoire
  documentsHigh: number;    // Documents très pertinents
  documentsMedium: number;  // Documents moyennement pertinents
  documentsLow: number;     // Inclure plus de contexte
  cacheMatch: number;       // Cache de réponses
  minResultsForFallback: number; // Seuil pour déclencher une recherche plus large
}

export const SEMANTIC_THRESHOLDS: SemanticThresholds = {
  // Codes SH: seuils affinés pour classification précise
  hsCodesHigh: 0.78,      // Très proche sémantiquement (classification directe)
  hsCodesMedium: 0.68,    // Bonne correspondance (recherche standard)
  hsCodesLow: 0.55,       // Recherche élargie (fallback si peu de résultats)
  
  // Documents: seuils pour PDF, knowledge, veille
  documentsHigh: 0.72,    // Très pertinents
  documentsMedium: 0.62,  // Pertinence moyenne
  documentsLow: 0.50,     // Inclure contexte additionnel
  
  // Cache de réponses: strict pour éviter les faux positifs
  cacheMatch: 0.94,       // Très strict pour le cache
  
  // Fallback
  minResultsForFallback: 3, // Si moins de 3 résultats, élargir la recherche
};

/**
 * Seuils adaptatifs selon l'intention détectée
 */
export interface AdaptiveThresholds {
  hsThreshold: number;
  docThreshold: number;
  limits: { hs: number; docs: number };
}

export function getAdaptiveThresholds(intent: string): AdaptiveThresholds {
  switch (intent) {
    case 'classify':
      return {
        hsThreshold: SEMANTIC_THRESHOLDS.hsCodesHigh,
        docThreshold: SEMANTIC_THRESHOLDS.documentsLow,
        limits: { hs: 15, docs: 8 }
      };
    case 'calculate':
      return {
        hsThreshold: SEMANTIC_THRESHOLDS.hsCodesMedium,
        docThreshold: SEMANTIC_THRESHOLDS.documentsMedium,
        limits: { hs: 10, docs: 5 }
      };
    case 'control':
    case 'procedure':
      return {
        hsThreshold: SEMANTIC_THRESHOLDS.hsCodesMedium,
        docThreshold: SEMANTIC_THRESHOLDS.documentsHigh,
        limits: { hs: 8, docs: 10 }
      };
    case 'origin':
      return {
        hsThreshold: SEMANTIC_THRESHOLDS.hsCodesMedium,
        docThreshold: SEMANTIC_THRESHOLDS.documentsHigh,
        limits: { hs: 10, docs: 8 }
      };
    default:
      return {
        hsThreshold: SEMANTIC_THRESHOLDS.hsCodesMedium,
        docThreshold: SEMANTIC_THRESHOLDS.documentsMedium,
        limits: { hs: 12, docs: 6 }
      };
  }
}

/**
 * Génère un embedding avec l'API OpenAI
 */
export async function generateQueryEmbedding(text: string, apiKey: string): Promise<number[] | null> {
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

/**
 * Vérifie le cache de réponses pour les questions similaires
 */
export async function checkResponseCache(
  supabase: any,
  queryEmbedding: number[],
  similarityThreshold: number = SEMANTIC_THRESHOLDS.cacheMatch
): Promise<{ found: boolean; response?: any }> {
  try {
    const embeddingString = `[${queryEmbedding.join(",")}]`;
    const { data, error } = await supabase.rpc("find_cached_response", {
      query_embedding: embeddingString,
      similarity_threshold: similarityThreshold,
    });

    if (error || !data || data.length === 0) {
      return { found: false };
    }

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

/**
 * Sauvegarde une réponse dans le cache
 */
export async function saveToResponseCache(
  supabase: any,
  question: string,
  questionEmbedding: number[],
  response: string,
  contextUsed: any,
  confidenceLevel: string
): Promise<void> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(question.toLowerCase().trim());
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const questionHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    const embeddingString = `[${questionEmbedding.join(",")}]`;
    
    await supabase.from("response_cache").upsert(
      {
        question_hash: questionHash,
        question_text: question,
        question_embedding: embeddingString,
        response_text: response,
        context_used: contextUsed,
        confidence_level: confidenceLevel,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: "question_hash" }
    );
  } catch (error) {
    console.error("Failed to save to cache:", error);
  }
}

/**
 * Recherche sémantique des codes SH avec fallback adaptatif
 */
export async function searchHSCodesSemantic(
  supabase: any,
  queryEmbedding: number[],
  threshold: number = SEMANTIC_THRESHOLDS.hsCodesMedium,
  limit: number = 10
): Promise<any[]> {
  try {
    const { data, error } = await supabase.rpc("search_hs_codes_semantic", {
      query_embedding: `[${queryEmbedding.join(",")}]`,
      match_threshold: threshold,
      match_count: limit,
    });

    if (error) {
      console.error("Semantic HS search error:", error);
      return [];
    }

    if ((!data || data.length < SEMANTIC_THRESHOLDS.minResultsForFallback) && threshold > SEMANTIC_THRESHOLDS.hsCodesLow) {
      console.log(`Semantic HS: only ${data?.length || 0} results at threshold ${threshold}, retrying at ${SEMANTIC_THRESHOLDS.hsCodesLow}`);
      const { data: fallbackData } = await supabase.rpc("search_hs_codes_semantic", {
        query_embedding: `[${queryEmbedding.join(",")}]`,
        match_threshold: SEMANTIC_THRESHOLDS.hsCodesLow,
        match_count: limit + 5,
      });
      return fallbackData || data || [];
    }

    return data || [];
  } catch (error) {
    console.error("Semantic HS search failed:", error);
    return [];
  }
}

/**
 * Recherche sémantique des documents de connaissance
 */
export async function searchKnowledgeSemantic(
  supabase: any,
  queryEmbedding: number[],
  threshold: number = SEMANTIC_THRESHOLDS.documentsMedium,
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

    if ((!data || data.length < 2) && threshold > SEMANTIC_THRESHOLDS.documentsLow) {
      const { data: fallbackData } = await supabase.rpc("search_knowledge_documents_semantic", {
        query_embedding: `[${queryEmbedding.join(",")}]`,
        match_threshold: SEMANTIC_THRESHOLDS.documentsLow,
        match_count: limit + 3,
      });
      return fallbackData || data || [];
    }

    return data || [];
  } catch (error) {
    console.error("Semantic knowledge search failed:", error);
    return [];
  }
}

/**
 * Calcule un score de qualité pour un document
 */
function calculateDocumentQuality(doc: any): number {
  let score = 1.0;
  if (doc.summary && doc.summary.length > 100) score += 0.2;
  if (doc.key_points && Array.isArray(doc.key_points) && doc.key_points.length > 0) score += 0.15;
  if (doc.extracted_text && doc.extracted_text.length > 500) score += 0.15;
  return Math.min(score, 1.5);
}

/**
 * Recherche sémantique des extractions PDF avec score de qualité
 */
export async function searchPDFsSemantic(
  supabase: any,
  queryEmbedding: number[],
  threshold: number = SEMANTIC_THRESHOLDS.documentsMedium,
  limit: number = 5,
  supabaseUrl?: string
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

    if (!data || data.length === 0) return [];

    // Enrich with pdf_documents metadata
    const pdfIds = data.map((d: any) => d.pdf_id);
    const { data: pdfDocs } = await supabase
      .from("pdf_documents")
      .select("id, title, category, file_path")
      .in("id", pdfIds);

    const pdfMap = new Map((pdfDocs || []).map((p: any) => [p.id, p]));
    const baseUrl = supabaseUrl || Deno.env.get("SUPABASE_URL") || "";

    const results = data.map((doc: any) => {
      const pdfMeta = pdfMap.get(doc.pdf_id) as any;
      return {
        ...doc,
        title: pdfMeta?.title || doc.summary?.slice(0, 50) || "Document PDF",
        category: pdfMeta?.category || null,
        download_url: pdfMeta?.file_path 
          ? `${baseUrl}/storage/v1/object/public/pdf-documents/${pdfMeta.file_path}`
          : null,
        full_text: doc.extracted_text,
        quality_score: calculateDocumentQuality(doc),
      };
    });

    return results.sort((a: any, b: any) => 
      (b.similarity * b.quality_score) - (a.similarity * a.quality_score)
    );
  } catch (error) {
    console.error("Semantic PDF search failed:", error);
    return [];
  }
}

/**
 * Recherche par mots-clés (FTS) des extractions PDF - fallback quand sémantique insuffisante
 */
export async function searchPDFsKeyword(
  supabase: any,
  searchQuery: string,
  limit: number = 5
): Promise<any[]> {
  try {
    const { data, error } = await supabase.rpc("search_pdf_extractions_keyword", {
      search_query: searchQuery,
      match_count: limit,
    });

    if (error) {
      console.error("Keyword PDF search error:", error);
      return [];
    }

    // Normalize relevance score to similarity-like format (0-1)
    return (data || []).map((doc: any) => ({
      ...doc,
      similarity: Math.min(doc.relevance_score / 10, 1), // Normalize FTS score
      source: "keyword",
    }));
  } catch (error) {
    console.error("Keyword PDF search failed:", error);
    return [];
  }
}

/**
 * Recherche hybride PDF: sémantique + fallback keyword si peu de résultats
 */
export async function searchPDFsHybrid(
  supabase: any,
  queryEmbedding: number[] | null,
  searchText: string,
  threshold: number = SEMANTIC_THRESHOLDS.documentsMedium,
  limit: number = 5
): Promise<any[]> {
  let results: any[] = [];

  // 1. Try semantic search first if embedding available
  if (queryEmbedding) {
    results = await searchPDFsSemantic(supabase, queryEmbedding, threshold, limit);
  }

  // 2. Fallback to keyword search if not enough results
  if (results.length < SEMANTIC_THRESHOLDS.minResultsForFallback && searchText) {
    console.log(`PDF search: only ${results.length} semantic results, adding keyword fallback`);
    const keywordResults = await searchPDFsKeyword(supabase, searchText, limit);
    
    // Merge and deduplicate by pdf_id
    const seenIds = new Set(results.map((r) => r.pdf_id));
    for (const kr of keywordResults) {
      if (!seenIds.has(kr.pdf_id)) {
        results.push(kr);
        seenIds.add(kr.pdf_id);
      }
    }
  }

  return results.slice(0, limit);
}

/**
 * Recherche sémantique des documents de veille
 */
export async function searchVeilleSemantic(
  supabase: any,
  queryEmbedding: number[],
  threshold: number = SEMANTIC_THRESHOLDS.documentsMedium,
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

    const results = (data || []).map((doc: any) => ({
      ...doc,
      effective_similarity: doc.similarity * (doc.importance === 'haute' ? 1.15 : doc.importance === 'moyenne' ? 1.05 : 1.0)
    }));

    return results.sort((a: any, b: any) => b.effective_similarity - a.effective_similarity);
  } catch (error) {
    console.error("Semantic veille search failed:", error);
    return [];
  }
}
