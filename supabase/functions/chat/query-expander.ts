// ============================================================================
// QUERY EXPANSION - Enrichissement sémantique avant embedding
// Synonymes, traduction arabe ↔ français, hints HS
// ============================================================================

const LOVABLE_AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";

/**
 * Expand a user query with synonyms, Arabic translation, and HS code hints.
 * Uses Gemini Flash for fast, low-cost expansion (~50 tokens output).
 */
export async function expandQuery(
  question: string,
  apiKey: string,
  options: {
    synonyms?: boolean;
    translation?: boolean;
    hsCodeHints?: boolean;
  } = { synonyms: true, translation: true, hsCodeHints: true }
): Promise<string> {
  try {
    const response = await fetch(LOVABLE_AI_GATEWAY, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        max_tokens: 150,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: `Tu es un expert en classification douanière. Enrichis la requête utilisateur avec:
${options.synonyms ? "- Synonymes du produit (ex: smartphone → téléphone portable, mobile)" : ""}
${options.translation ? "- Traduction arabe si la requête est en français, ou française si en arabe" : ""}
${options.hsCodeHints ? "- Indication du chapitre SH probable (ex: tomates → chapitre 07)" : ""}

Réponds UNIQUEMENT avec la requête enrichie, PAS de JSON, PAS d'explication. Garde la requête originale et ajoute les enrichissements.`
          },
          {
            role: "user",
            content: question
          }
        ],
      }),
    });

    if (!response.ok) {
      console.warn(`[query-expander] API error ${response.status}, using original query`);
      return question;
    }

    const data = await response.json();
    const expanded = data.choices?.[0]?.message?.content?.trim();
    
    if (!expanded || expanded.length < question.length) {
      return question;
    }

    // Cap the expanded query to avoid bloating the embedding
    const result = expanded.substring(0, 1000);
    console.log(`[query-expander] Original: "${question.substring(0, 80)}..." → Expanded: "${result.substring(0, 120)}..."`);
    return result;
  } catch (error) {
    console.warn("[query-expander] Expansion failed, using original:", error);
    return question;
  }
}

/**
 * Search synonym table for matching HS codes
 * Fast DB-level expansion without LLM cost
 */
export async function expandWithSynonyms(
  supabase: any,
  keywords: string[]
): Promise<{ codes: string[]; terms: string[] }> {
  const result = { codes: [] as string[], terms: [] as string[] };
  
  if (!keywords || keywords.length === 0) return result;

  try {
    for (const keyword of keywords.slice(0, 5)) {
      const { data, error } = await supabase.rpc('search_synonyms', {
        search_text: keyword,
        result_limit: 5,
      });

      if (error) {
        console.warn(`[query-expander] Synonym search error for "${keyword}":`, error.message);
        continue;
      }

      if (data && data.length > 0) {
        for (const syn of data) {
          result.codes.push(syn.hs_code);
          if (syn.synonym_fr) result.terms.push(syn.synonym_fr);
          if (syn.synonym_ar) result.terms.push(syn.synonym_ar);
          if (syn.synonym_en) result.terms.push(syn.synonym_en);
        }
      }
    }

    // Deduplicate
    result.codes = [...new Set(result.codes)];
    result.terms = [...new Set(result.terms)];

    if (result.codes.length > 0) {
      console.log(`[query-expander] Synonyms found: ${result.codes.length} codes, ${result.terms.length} terms`);
    }
  } catch (error) {
    console.warn("[query-expander] Synonym expansion failed:", error);
  }

  return result;
}
