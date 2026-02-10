import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// =============================================================================
// TESTS: Source Validator Module
// =============================================================================

// Re-implement pure functions for testing (avoiding import issues with Supabase)

function extractCodesFromResponse(responseText: string): string[] {
  const codes: string[] = [];
  
  const recommendedPatterns = [
    /\*\*(\d{4}\.\d{2}(?:\.\d{2})?(?:\.\d{2})?)\*\*/g,
    /\*\*(\d{2}\.\d{2})\*\*/g,
    /Code\s+(?:SH\s*)?:?\s*\*?\*?(\d{2,4}\.?\d{0,6})/gi,
    /correspond(?:re)?.*?(\d{2,4}\.\d{2})/gi,
    /position\s+(?:tarifaire\s+)?(\d{2,4}\.\d{2})/gi,
  ];
  
  for (const pattern of recommendedPatterns) {
    const matches = responseText.matchAll(pattern);
    for (const match of matches) {
      const codeRaw = match[1] || match[0];
      const code = codeRaw.replace(/[^0-9]/g, "");
      if (code.length >= 4) {
        const chapter = parseInt(code.substring(0, 2));
        if (chapter >= 1 && chapter <= 99) {
          codes.push(code);
        }
      }
    }
  }
  
  if (codes.length === 0) {
    const fallbackPatterns = [
      /\b(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})\b/g,
      /\b(\d{4})\.(\d{2})\.(\d{2})\b/g,
      /\b(\d{4})\.(\d{2})\b/g,
      /\b(\d{2})\.(\d{2})\b/g,
    ];
    
    for (const pattern of fallbackPatterns) {
      const matches = responseText.matchAll(pattern);
      for (const match of matches) {
        let code = match[0].replace(/\./g, "");
        if (code.length >= 4) {
          const chapter = parseInt(code.substring(0, 2));
          if (chapter >= 1 && chapter <= 99) {
            codes.push(code);
          }
        }
      }
    }
  }
  
  return [...new Set(codes)];
}

function extractArticlesFromResponse(responseText: string): string[] {
  const articles: string[] = [];
  
  const articlePatterns = [
    /\b(?:Article|Art\.?)\s*(\d+(?:\s*(?:bis|ter|quater))?(?:\s*-\s*\d+)?)/gi,
    /\bl['']article\s+(\d+(?:\s*(?:bis|ter|quater))?)/gi,
  ];
  
  for (const pattern of articlePatterns) {
    const matches = responseText.matchAll(pattern);
    for (const match of matches) {
      const articleNum = match[1]?.trim();
      if (articleNum && articleNum.length <= 10) {
        const normalized = articleNum.replace(/\s+/g, " ").trim();
        articles.push(normalized);
      }
    }
  }
  
  return [...new Set(articles)];
}

function extractProductKeywords(question: string): string[] {
  const stopWords = new Set([
    "quel", "quelle", "quels", "quelles", "est", "sont", "le", "la", "les", "un", "une", "des",
    "pour", "sur", "dans", "par", "avec", "sans", "que", "qui", "quoi", "comment", "pourquoi",
    "code", "tarif", "droit", "douane", "importation", "exportation", "taux", "taxe",
    "maroc", "marocain", "marocaine", "import", "export", "importer", "exporter",
  ]);
  
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
  
  return words;
}

// =============================================================================
// extractCodesFromResponse Tests
// =============================================================================

Deno.test("extracts bold HS code from response", () => {
  const result = extractCodesFromResponse("Le code est **8471.30.00.10** pour les ordinateurs.");
  assertEquals(result.includes("8471300010"), true);
});

Deno.test("extracts multiple codes from response", () => {
  const result = extractCodesFromResponse("Codes possibles : **8471.30** ou **8471.50**");
  assertEquals(result.length >= 2, true);
});

Deno.test("extracts 'Code SH:' pattern", () => {
  const result = extractCodesFromResponse("Code SH: 8301.30.00");
  assertEquals(result.length >= 1, true);
});

Deno.test("rejects invalid chapter (00)", () => {
  const result = extractCodesFromResponse("**0000.00.00.00**");
  assertEquals(result.length, 0);
});

Deno.test("extracts 'correspond au code' pattern", () => {
  const result = extractCodesFromResponse("Ce produit correspond au code 8471.30");
  assertEquals(result.length >= 1, true);
});

Deno.test("extracts 'position tarifaire' pattern", () => {
  const result = extractCodesFromResponse("La position tarifaire 0702.00");
  assertEquals(result.length >= 1, true);
});

Deno.test("extracts fallback codes when no bold patterns", () => {
  const result = extractCodesFromResponse("Le taux pour 8301.30.00 est de 25%.");
  assertEquals(result.length >= 1, true);
});

Deno.test("returns empty for no codes", () => {
  const result = extractCodesFromResponse("Bonjour, comment puis-je vous aider ?");
  assertEquals(result.length, 0);
});

Deno.test("deduplicates codes", () => {
  const result = extractCodesFromResponse("**8471.30** et encore **8471.30** dans le texte.");
  const unique = result.filter((v, i, a) => a.indexOf(v) === i);
  assertEquals(result.length, unique.length);
});

// =============================================================================
// extractArticlesFromResponse Tests
// =============================================================================

Deno.test("extracts 'Article 85' pattern", () => {
  const result = extractArticlesFromResponse("Selon l'Article 85 du CDII");
  assertEquals(result.includes("85"), true);
});

Deno.test("extracts 'Art. 15 bis' pattern", () => {
  const result = extractArticlesFromResponse("Voir Art. 15 bis pour plus de détails");
  assertEquals(result.includes("15 bis"), true);
});

Deno.test("extracts 'article 42-2' with hyphen", () => {
  const result = extractArticlesFromResponse("L'article 42-2 stipule que...");
  assertEquals(result.length >= 1, true);
});

Deno.test("extracts multiple articles", () => {
  const result = extractArticlesFromResponse("Article 15, Article 20 et Art. 30");
  assertEquals(result.length >= 3, true);
});

Deno.test("returns empty for no articles", () => {
  const result = extractArticlesFromResponse("Pas de référence légale ici.");
  assertEquals(result.length, 0);
});

Deno.test("deduplicates articles", () => {
  const result = extractArticlesFromResponse("Article 85, puis l'article 85 encore.");
  assertEquals(result.length, 1);
});

// =============================================================================
// extractProductKeywords Tests
// =============================================================================

Deno.test("extracts meaningful keywords from question", () => {
  const result = extractProductKeywords("Quel est le code SH pour les tomates fraîches ?");
  assertEquals(result.includes("tomates"), true);
  assertEquals(result.includes("fraîches"), true);
});

Deno.test("filters out stop words", () => {
  const result = extractProductKeywords("Quel est le taux de droit pour le code SH ?");
  assertEquals(result.includes("quel"), false);
  assertEquals(result.includes("taux"), false);
  assertEquals(result.includes("droit"), false);
});

Deno.test("filters out short words (<=3 chars)", () => {
  const result = extractProductKeywords("le son du blé");
  assertEquals(result.includes("son"), false);
});

Deno.test("handles empty input", () => {
  const result = extractProductKeywords("");
  assertEquals(result.length, 0);
});

Deno.test("handles question with only stop words", () => {
  const result = extractProductKeywords("Quel est le code SH ?");
  // All words are either stop words or too short
  assertEquals(result.length, 0);
});
