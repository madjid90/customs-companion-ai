// ============================================================================
// LLM RE-RANKER - Post-retrieval scoring with Gemini Flash
// Scores each passage 0-10 for relevance to the exact question
// ============================================================================

const LOVABLE_AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface RankedResult {
  index: number;
  score: number;
  text: string;
  type: string;
  metadata?: any;
}

/**
 * Re-rank retrieved passages using LLM scoring.
 * Uses Gemini Flash Lite for speed (~200 tokens, <1s).
 */
export async function rerankWithLLM(
  question: string,
  passages: Array<{ text: string; type: string; metadata?: any }>,
  apiKey: string,
  maxPassages: number = 15
): Promise<RankedResult[]> {
  if (!passages || passages.length === 0) return [];
  
  // Don't re-rank if too few passages
  if (passages.length <= 3) {
    return passages.map((p, i) => ({ index: i, score: 10 - i, text: p.text, type: p.type, metadata: p.metadata }));
  }

  // Limit input to avoid context overflow
  const toRank = passages.slice(0, maxPassages);
  
  // Build passage list for scoring (truncate each to 300 chars)
  const passageList = toRank.map((p, i) => 
    `[${i}] (${p.type}) ${p.text.substring(0, 300)}${p.text.length > 300 ? '...' : ''}`
  ).join('\n\n');

  try {
    const response = await fetch(LOVABLE_AI_GATEWAY, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        max_tokens: 200,
        temperature: 0,
        tools: [
          {
            type: "function",
            function: {
              name: "rank_passages",
              description: "Score each passage for relevance to the question (0-10)",
              parameters: {
                type: "object",
                properties: {
                  scores: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        index: { type: "number", description: "Passage index [0..N]" },
                        score: { type: "number", description: "Relevance score 0-10" },
                      },
                      required: ["index", "score"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["scores"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "rank_passages" } },
        messages: [
          {
            role: "system",
            content: "Score chaque passage de 0 à 10 selon sa pertinence pour répondre à la question. 10 = parfaitement pertinent, 0 = hors sujet.",
          },
          {
            role: "user",
            content: `Question: ${question}\n\nPassages:\n${passageList}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn(`[reranker] API error ${response.status}, using original order`);
      return toRank.map((p, i) => ({ index: i, score: 10 - i * 0.5, text: p.text, type: p.type, metadata: p.metadata }));
    }

    const data = await response.json();
    
    // Extract tool call results
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.warn("[reranker] No tool call in response, using original order");
      return toRank.map((p, i) => ({ index: i, score: 10 - i * 0.5, text: p.text, type: p.type, metadata: p.metadata }));
    }

    const args = JSON.parse(toolCall.function.arguments);
    const scores: Array<{ index: number; score: number }> = args.scores || [];

    // Map scores back to passages
    const scoreMap = new Map(scores.map(s => [s.index, s.score]));
    
    const ranked: RankedResult[] = toRank.map((p, i) => ({
      index: i,
      score: scoreMap.get(i) ?? 5, // Default score if not returned
      text: p.text,
      type: p.type,
      metadata: p.metadata,
    }));

    // Sort by score descending
    ranked.sort((a, b) => b.score - a.score);

    console.log(`[reranker] Re-ranked ${ranked.length} passages. Top score: ${ranked[0]?.score}, Bottom: ${ranked[ranked.length - 1]?.score}`);
    
    return ranked;
  } catch (error) {
    console.warn("[reranker] Re-ranking failed, using original order:", error);
    return toRank.map((p, i) => ({ index: i, score: 10 - i * 0.5, text: p.text, type: p.type, metadata: p.metadata }));
  }
}

/**
 * TF-IDF-inspired scoring without LLM cost.
 * Scores passages based on term frequency of question keywords.
 * Used as fallback or for budget-conscious deployments.
 */
export function rerankWithTFIDF(
  question: string,
  passages: Array<{ text: string; type: string; metadata?: any }>
): RankedResult[] {
  if (!passages || passages.length === 0) return [];

  // Extract question terms
  const questionTerms = question
    .toLowerCase()
    .replace(/[^\w\sàâäéèêëïîôùûüçأ-ي]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);

  if (questionTerms.length === 0) {
    return passages.map((p, i) => ({ index: i, score: 5, text: p.text, type: p.type, metadata: p.metadata }));
  }

  // Score each passage
  const ranked: RankedResult[] = passages.map((p, i) => {
    const passageLower = p.text.toLowerCase();
    let score = 0;

    for (const term of questionTerms) {
      // Count occurrences
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = passageLower.match(regex);
      if (matches) {
        // TF component: log(1 + count) to dampen high frequencies
        score += Math.log(1 + matches.length);
      }
    }

    // Normalize by passage length (IDF-like)
    const lengthFactor = Math.max(0.5, Math.min(1.5, 500 / Math.max(100, p.text.length)));
    score *= lengthFactor;

    // Bonus for type
    if (p.type === 'legal_chunk' || p.type === 'tariff_note') score *= 1.2;
    if (p.type === 'hs_code') score *= 1.1;

    // Normalize to 0-10 scale
    score = Math.min(10, Math.round(score * 2 * 10) / 10);

    return { index: i, score, text: p.text, type: p.type, metadata: p.metadata };
  });

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}
