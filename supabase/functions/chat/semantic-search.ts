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
  
  // Documents: seuils pour PDF, knowledge
  documentsHigh: 0.72,    // Très pertinents
  documentsMedium: 0.62,  // Pertinence moyenne
  documentsLow: 0.50,     // Inclure contexte additionnel
  
  // Cache de réponses: strict pour éviter les faux positifs
  cacheMatch: 0.94,       // Très strict pour le cache
  
  // Fallback
  minResultsForFallback: 3, // Si moins de 3 résultats, élargir la recherche
};

// ============================================================================
// SCORE DISTRIBUTION MONITORING
// ============================================================================

/**
 * Log la distribution des scores pour analyse et monitoring des seuils
 */
export function logScoreDistribution(
  searchType: string,
  results: Array<{ similarity?: number; combined_score?: number }>,
  threshold: number
): void {
  if (results.length === 0) return;

  const scores = results
    .map(r => r.similarity ?? r.combined_score ?? 0)
    .filter(s => s > 0)
    .sort((a, b) => b - a);

  if (scores.length === 0) return;

  const stats = {
    type: 'score_distribution',
    search_type: searchType,
    threshold,
    count: scores.length,
    above_threshold: scores.filter(s => s >= threshold).length,
    below_threshold: scores.filter(s => s < threshold).length,
    max: Math.round(scores[0] * 1000) / 1000,
    min: Math.round(scores[scores.length - 1] * 1000) / 1000,
    avg: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000,
    median: Math.round(scores[Math.floor(scores.length / 2)] * 1000) / 1000,
    p75: Math.round(scores[Math.floor(scores.length * 0.25)] * 1000) / 1000,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(stats));
}

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
        cited_circulars: data[0].cited_circulars || [],
        has_db_evidence: data[0].has_db_evidence ?? true,
        validation_message: data[0].validation_message,
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
  confidenceLevel: string,
  citedCirculars?: any[],
  hasDbEvidence?: boolean,
  validationMessage?: string
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
        cited_circulars: citedCirculars || [],
        has_db_evidence: hasDbEvidence ?? true,
        validation_message: validationMessage || null,
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

    let finalResults = data || [];

    if ((!data || data.length < SEMANTIC_THRESHOLDS.minResultsForFallback) && threshold > SEMANTIC_THRESHOLDS.hsCodesLow) {
      console.log(`Semantic HS: only ${data?.length || 0} results at threshold ${threshold}, retrying at ${SEMANTIC_THRESHOLDS.hsCodesLow}`);
      const { data: fallbackData } = await supabase.rpc("search_hs_codes_semantic", {
        query_embedding: `[${queryEmbedding.join(",")}]`,
        match_threshold: SEMANTIC_THRESHOLDS.hsCodesLow,
        match_count: limit + 5,
      });
      finalResults = fallbackData || data || [];
    }

    logScoreDistribution('hs_codes_semantic', finalResults, threshold);
    return finalResults;
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

    let results = data || [];

    // Fallback if not enough results
    if (results.length < 2 && threshold > SEMANTIC_THRESHOLDS.documentsLow) {
      const { data: fallbackData } = await supabase.rpc("search_knowledge_documents_semantic", {
        query_embedding: `[${queryEmbedding.join(",")}]`,
        match_threshold: SEMANTIC_THRESHOLDS.documentsLow,
        match_count: limit + 3,
      });
      results = fallbackData || results;
    }

    if (results.length === 0) return [];

    // Enrich with additional metadata (source_url, source_name)
    const docIds = results.map((d: any) => d.id);
    const { data: fullDocs } = await supabase
      .from("knowledge_documents")
      .select("id, source_url, source_name, reference, tags")
      .in("id", docIds);

    const docMap = new Map((fullDocs || []).map((d: any) => [d.id, d]));

    return results.map((doc: any) => {
      const fullDoc = docMap.get(doc.id) as any;
      return {
        ...doc,
        source_url: fullDoc?.source_url || null,
        source_name: fullDoc?.source_name || null,
        reference: fullDoc?.reference || null,
        tags: fullDoc?.tags || [],
        source: "semantic",
      };
    });
  } catch (error) {
    console.error("Semantic knowledge search failed:", error);
    return [];
  }
}

/**
 * Recherche par mots-clés (FTS) des documents de connaissance - fallback
 */
export async function searchKnowledgeKeyword(
  supabase: any,
  searchQuery: string,
  limit: number = 5
): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from("knowledge_documents")
      .select("id, title, content, summary, category, country_code, source_url, source_name, reference, tags")
      .eq("is_active", true)
      .or(`title.ilike.%${searchQuery}%,content.ilike.%${searchQuery}%,summary.ilike.%${searchQuery}%`)
      .limit(limit);

    if (error) {
      console.error("Keyword knowledge search error:", error);
      return [];
    }

    return (data || []).map((doc: any) => ({
      ...doc,
      similarity: 0.6,
      source: "keyword",
    }));
  } catch (error) {
    console.error("Keyword knowledge search failed:", error);
    return [];
  }
}

/**
 * Recherche hybride knowledge: sémantique + fallback keyword
 */
export async function searchKnowledgeHybrid(
  supabase: any,
  queryEmbedding: number[] | null,
  searchText: string,
  threshold: number = SEMANTIC_THRESHOLDS.documentsMedium,
  limit: number = 5
): Promise<any[]> {
  let results: any[] = [];

  // 1. Try semantic search first if embedding available
  if (queryEmbedding) {
    results = await searchKnowledgeSemantic(supabase, queryEmbedding, threshold, limit);
  }

  // 2. Fallback to keyword search if not enough results
  if (results.length < SEMANTIC_THRESHOLDS.minResultsForFallback && searchText) {
    console.log(`Knowledge search: only ${results.length} semantic results, adding keyword fallback`);
    const keywordResults = await searchKnowledgeKeyword(supabase, searchText, limit);
    
    // Merge and deduplicate by id
    const seenIds = new Set(results.map((r) => r.id));
    for (const kr of keywordResults) {
      if (!seenIds.has(kr.id)) {
        results.push(kr);
        seenIds.add(kr.id);
      }
    }
  }

  return results.slice(0, limit);
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
  limit: number = 5,
  supabaseUrl?: string
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

    if (!data || data.length === 0) return [];

    // Enrich with pdf_documents metadata
    const pdfIds = data.map((d: any) => d.pdf_id);
    const { data: pdfDocs } = await supabase
      .from("pdf_documents")
      .select("id, title, category, file_path")
      .in("id", pdfIds);

    const pdfMap = new Map((pdfDocs || []).map((p: any) => [p.id, p]));
    const baseUrl = supabaseUrl || Deno.env.get("SUPABASE_URL") || "";

    return data.map((doc: any) => {
      const pdfMeta = pdfMap.get(doc.pdf_id) as any;
      return {
        ...doc,
        title: pdfMeta?.title || doc.summary?.slice(0, 50) || "Document PDF",
        category: pdfMeta?.category || null,
        download_url: pdfMeta?.file_path 
          ? `${baseUrl}/storage/v1/object/public/pdf-documents/${pdfMeta.file_path}`
          : null,
        full_text: doc.extracted_text,
        similarity: Math.min(doc.relevance_score / 10, 1),
        source: "keyword",
      };
    });
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
  limit: number = 5,
  supabaseUrl?: string
): Promise<any[]> {
  let results: any[] = [];

  // 1. Try semantic search first if embedding available
  if (queryEmbedding) {
    results = await searchPDFsSemantic(supabase, queryEmbedding, threshold, limit, supabaseUrl);
  }

  // 2. Fallback to keyword search if not enough results
  if (results.length < SEMANTIC_THRESHOLDS.minResultsForFallback && searchText) {
    console.log(`PDF search: only ${results.length} semantic results, adding keyword fallback`);
    const keywordResults = await searchPDFsKeyword(supabase, searchText, limit, supabaseUrl);
    
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

// ============================================================================
// TARIFF NOTES SEARCH (NEW)
// ============================================================================

// ============================================================================
// TARIFF NOTES SEARCH (NEW)
// ============================================================================

/**
 * Recherche sémantique des notes tarifaires (définitions, notes de chapitre)
 */
export async function searchTariffNotesSemantic(
  supabase: any,
  queryEmbedding: number[],
  threshold: number = 0.65,
  limit: number = 8
): Promise<any[]> {
  try {
    const { data, error } = await supabase.rpc("search_tariff_notes_semantic", {
      query_embedding: `[${queryEmbedding.join(",")}]`,
      match_threshold: threshold,
      match_count: limit,
    });

    if (error) {
      console.error("Semantic tariff notes search error:", error);
      return [];
    }

    return (data || []).map((note: any) => ({
      ...note,
      source: "semantic",
    }));
  } catch (error) {
    console.error("Semantic tariff notes search failed:", error);
    return [];
  }
}

/**
 * Recherche FTS des notes tarifaires - fallback
 */
export async function searchTariffNotesFTS(
  supabase: any,
  searchQuery: string,
  chapterNumber?: string,
  limit: number = 8
): Promise<any[]> {
  try {
    const { data, error } = await supabase.rpc("search_tariff_notes_fts", {
      search_query: searchQuery,
      chapter_filter: chapterNumber || null,
      match_count: limit,
    });

    if (error) {
      console.error("FTS tariff notes search error:", error);
      return [];
    }

    return (data || []).map((note: any) => ({
      ...note,
      similarity: Math.min(note.relevance_score / 5, 1),
      source: "fts",
    }));
  } catch (error) {
    console.error("FTS tariff notes search failed:", error);
    return [];
  }
}

/**
 * Recherche hybride des notes tarifaires: sémantique + FTS fallback
 */
export async function searchTariffNotesHybrid(
  supabase: any,
  queryEmbedding: number[] | null,
  searchText: string,
  chapterNumbers?: string[],
  limit: number = 8
): Promise<any[]> {
  let results: any[] = [];

  // 1. Try semantic search first if embedding available
  if (queryEmbedding) {
    results = await searchTariffNotesSemantic(supabase, queryEmbedding, 0.65, limit);
  }

  // 2. Fallback to FTS if not enough results
  if (results.length < 3 && searchText) {
    console.log(`Tariff notes: only ${results.length} semantic results, adding FTS fallback`);
    
    // Try FTS for each chapter if specified, otherwise general search
    const chapters = chapterNumbers && chapterNumbers.length > 0 ? chapterNumbers : [undefined];
    
    for (const chapter of chapters) {
      const ftsResults = await searchTariffNotesFTS(supabase, searchText, chapter, limit);
      
      // Merge and deduplicate by id
      const seenIds = new Set(results.map((r) => r.id));
      for (const fr of ftsResults) {
        if (!seenIds.has(fr.id)) {
          results.push(fr);
          seenIds.add(fr.id);
        }
      }
    }
  }

  // Sort by similarity/relevance
  return results
    .sort((a: any, b: any) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, limit);
}

/**
 * Recherche directe des notes par numéro de chapitre (lookup rapide)
 */
export async function searchTariffNotesByChapter(
  supabase: any,
  chapterNumbers: string[],
  limit: number = 20
): Promise<any[]> {
  if (!chapterNumbers || chapterNumbers.length === 0) return [];

  try {
    const { data, error } = await supabase
      .from("tariff_notes")
      .select("id, note_type, note_text, chapter_number, anchor, page_number, country_code")
      .in("chapter_number", chapterNumbers)
      .order("note_type")
      .limit(limit);

    if (error) {
      console.error("Chapter notes lookup error:", error);
      return [];
    }

    return (data || []).map((note: any) => ({
      ...note,
      similarity: 1.0,
      source: "direct_lookup",
    }));
  } catch (error) {
    console.error("Chapter notes lookup failed:", error);
    return [];
  }
}


// ============================================
// NOUVELLES FONCTIONS - RECHERCHE HYBRIDE RRF
// ============================================

/**
 * Cache d'embeddings en mémoire pour éviter les appels répétés
 */
const embeddingCache = new Map<string, { embedding: number[]; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Génère un embedding avec cache en mémoire
 */
export async function generateQueryEmbeddingCached(
  text: string,
  apiKey: string
): Promise<number[] | null> {
  const cacheKey = text.toLowerCase().trim().substring(0, 500);
  
  const cached = embeddingCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('Embedding cache hit');
    return cached.embedding;
  }

  const embedding = await generateQueryEmbedding(text, apiKey);
  
  if (embedding) {
    embeddingCache.set(cacheKey, { embedding, timestamp: Date.now() });
    
    if (embeddingCache.size > 100) {
      const now = Date.now();
      for (const [key, value] of embeddingCache) {
        if (now - value.timestamp > CACHE_TTL_MS) {
          embeddingCache.delete(key);
        }
      }
    }
  }

  return embedding;
}

/**
 * Recherche hybride HS Codes combinant sémantique + FTS avec RRF
 */
export async function searchHSCodesHybrid(
  supabase: any,
  queryEmbedding: number[],
  queryText: string,
  semanticWeight: number = 0.6,
  limit: number = 20
): Promise<any[]> {
  try {
    const { data, error } = await supabase.rpc('search_hs_codes_hybrid', {
      query_text: queryText,
      query_embedding: `[${queryEmbedding.join(',')}]`,
      semantic_weight: semanticWeight,
      match_count: limit,
    });

    if (error) {
      console.warn('Hybrid HS search RPC failed, falling back to semantic:', error.message);
      return searchHSCodesSemantic(supabase, queryEmbedding, SEMANTIC_THRESHOLDS.hsCodesMedium, limit);
    }

    const results = data || [];
    logScoreDistribution('hs_codes_hybrid', results, 0.6);
    return results;
  } catch (error) {
    console.error('Hybrid HS search failed:', error);
    return [];
  }
}

/**
 * Recherche hybride pour les notes tarifaires avec RRF
 */
export async function searchTariffNotesHybridRRF(
  supabase: any,
  queryEmbedding: number[],
  queryText: string,
  chapterFilters: string[] | null = null,
  semanticWeight: number = 0.5,
  limit: number = 15
): Promise<any[]> {
  try {
    const { data, error } = await supabase.rpc('search_tariff_notes_hybrid', {
      query_text: queryText,
      query_embedding: `[${queryEmbedding.join(',')}]`,
      chapter_filters: chapterFilters,
      semantic_weight: semanticWeight,
      match_count: limit,
    });

    if (error) {
      console.warn('Hybrid tariff notes search failed:', error.message);
      if (chapterFilters && chapterFilters.length > 0) {
        return searchTariffNotesByChapter(supabase, chapterFilters, limit);
      }
      return [];
    }

    const results = data || [];
    logScoreDistribution('tariff_notes_hybrid', results, 0.5);
    return results;
  } catch (error) {
    console.error('Hybrid tariff notes search failed:', error);
    return [];
  }
}

/**
 * Recherche hybride pour les chunks légaux
 */
export async function searchLegalChunksHybrid(
  supabase: any,
  queryEmbedding: number[],
  queryText: string,
  semanticWeight: number = 0.5,
  limit: number = 10,
  supabaseUrl?: string
): Promise<any[]> {
  try {
    const { data, error } = await supabase.rpc('search_legal_chunks_hybrid', {
      query_text: queryText,
      query_embedding: `[${queryEmbedding.join(',')}]`,
      semantic_weight: semanticWeight,
      match_count: limit,
    });

    if (error) {
      console.warn('Hybrid legal chunks search failed:', error.message);
      return [];
    }

    if (!data || data.length === 0) return [];

    logScoreDistribution('legal_chunks_hybrid', data, 0.5);

    // Enrich with source metadata (title, PDF path)
    const sourceIds = [...new Set(data.map((d: any) => d.source_id).filter(Boolean))];
    
    if (sourceIds.length > 0) {
      const { data: sources } = await supabase
        .from('legal_sources')
        .select('id, source_ref, title, source_url')
        .in('id', sourceIds);
      
      const sourceMap = new Map((sources || []).map((s: any) => [s.id, s]));
      
      // Try to find PDF documents for these sources
      const sourceRefs = (sources || []).map((s: any) => s.source_ref).filter(Boolean);
      let pdfMap = new Map();
      
      if (sourceRefs.length > 0) {
        const { data: pdfs } = await supabase
          .from('pdf_documents')
          .select('id, document_reference, file_path, title')
          .in('document_reference', sourceRefs);
        
        pdfMap = new Map((pdfs || []).map((p: any) => [p.document_reference, p]));
      }
      
      const baseUrl = supabaseUrl || Deno.env.get('SUPABASE_URL') || '';
      
      return data.map((chunk: any) => {
        const source = sourceMap.get(chunk.source_id) as any;
        const pdf = source ? pdfMap.get(source.source_ref) as any : null;
        
        return {
          ...chunk,
          source_ref: source?.source_ref || null,
          source_title: source?.title || null,
          source_url: source?.source_url || null,
          source_pdf_path: pdf?.file_path || null,
          download_url: pdf?.file_path 
            ? `${baseUrl}/storage/v1/object/public/pdf-documents/${pdf.file_path}`
            : source?.source_url || null,
        };
      });
    }

    return data;
  } catch (error) {
    console.error('Hybrid legal chunks search failed:', error);
    return [];
  }
}

// ============================================================================
// MULTILINGUAL SEARCH (ARABIC/FRENCH)
// ============================================================================

/**
 * Détecte la langue principale d'un texte (arabe ou français)
 */
export function detectLanguage(text: string): 'ar' | 'fr' {
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
  const arabicChars = (text.match(arabicPattern) || []).length;
  const totalChars = text.replace(/\s/g, '').length;
  
  // If more than 30% Arabic characters, consider it Arabic
  return arabicChars / totalChars > 0.3 ? 'ar' : 'fr';
}

/**
 * Recherche multilingue des chunks légaux (supporte arabe et français)
 */
export async function searchLegalChunksMultilingual(
  supabase: any,
  queryEmbedding: number[],
  queryText: string,
  language?: 'ar' | 'fr',
  limit: number = 10
): Promise<any[]> {
  const detectedLang = language || detectLanguage(queryText);
  
  try {
    // Use the multilingual RPC function
    const { data, error } = await supabase.rpc('search_legal_chunks_multilingual', {
      query_text: queryText,
      query_embedding: `[${queryEmbedding.join(',')}]`,
      query_language: detectedLang,
      match_count: limit,
    });

    if (error) {
      console.warn('Multilingual legal search failed, falling back to hybrid:', error.message);
      return searchLegalChunksHybrid(supabase, queryEmbedding, queryText, 0.5, limit);
    }

    return (data || []).map((chunk: any) => ({
      ...chunk,
      detected_language: detectedLang,
    }));
  } catch (error) {
    console.error('Multilingual legal search failed:', error);
    return [];
  }
}

/**
 * Recherche complète multilingue - combine HS codes, tariff notes, et legal chunks
 */
export async function performMultilingualSearch(
  supabase: any,
  queryEmbedding: number[] | null,
  queryText: string,
  options: {
    language?: 'ar' | 'fr';
    hsLimit?: number;
    notesLimit?: number;
    legalLimit?: number;
    chapterFilters?: string[];
  } = {}
): Promise<{
  hsCodes: any[];
  tariffNotes: any[];
  legalChunks: any[];
  detectedLanguage: 'ar' | 'fr';
}> {
  const {
    language,
    hsLimit = 15,
    notesLimit = 10,
    legalLimit = 10,
    chapterFilters,
  } = options;
  
  const detectedLanguage = language || detectLanguage(queryText);
  
  const results = {
    hsCodes: [] as any[],
    tariffNotes: [] as any[],
    legalChunks: [] as any[],
    detectedLanguage,
  };

  if (!queryEmbedding) {
    console.warn('No embedding available, search limited');
    return results;
  }

  // Parallel searches
  const [hsResults, notesResults, legalResults] = await Promise.all([
    searchHSCodesHybrid(supabase, queryEmbedding, queryText, 0.6, hsLimit),
    searchTariffNotesHybridRRF(supabase, queryEmbedding, queryText, chapterFilters || null, 0.5, notesLimit),
    searchLegalChunksMultilingual(supabase, queryEmbedding, queryText, detectedLanguage, legalLimit),
  ]);

  results.hsCodes = hsResults;
  results.tariffNotes = notesResults;
  results.legalChunks = legalResults;

  console.log(`[Multilingual Search] Lang: ${detectedLanguage}, HS: ${hsResults.length}, Notes: ${notesResults.length}, Legal: ${legalResults.length}`);

  return results;
}

