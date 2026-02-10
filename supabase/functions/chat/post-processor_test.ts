import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// =============================================================================
// TESTS: Post-Processor Module - determineConfidence logic
// =============================================================================

// Re-implement determineConfidence for testing (from prompt-builder.ts)

interface RAGContext {
  tariffs_with_inheritance: Array<{ rate_source: string }>;
  hs_codes: any[];
  tariffs: any[];
  controlled_products: any[];
  knowledge_documents: any[];
  pdf_summaries: any[];
  legal_references: any[];
  regulatory_procedures: any[];
  tariff_notes: any[];
}

function determineConfidence(
  responseText: string,
  context: RAGContext
): "high" | "medium" | "low" {
  let score = 0;

  // SOURCES JURIDIQUES (40 points max)
  if (/article\s+\d+\s+(du\s+)?(CDII|Code des Douanes)/i.test(responseText)) {
    score += 15;
  }
  if (/circulaire\s+(n°\s*)?\d+/i.test(responseText)) {
    score += 10;
  }
  if (context.legal_references?.length > 0) {
    score += Math.min(context.legal_references.length * 3, 15);
  }

  // PRÉCISION DES DONNÉES (30 points max)
  if (/\d{4}\.\d{2}\.\d{2}\.\d{2}/.test(responseText)) {
    score += 10;
  }
  if (/\d+(\.\d+)?\s*%/.test(responseText)) {
    score += 8;
  }
  if (/\d+[\s,.]?\d*\s*(DH|MAD|dirhams)/i.test(responseText)) {
    score += 7;
  }
  if (context.tariffs_with_inheritance?.length > 0 &&
      context.tariffs_with_inheritance.some(t => t.rate_source === 'direct')) {
    score += 5;
  }

  // QUALITÉ DE LA RÉPONSE (20 points max)
  if (responseText.length > 300 && responseText.length < 2500) {
    score += 5;
  }
  if (/je (te\s+)?(vous\s+)?(recommande|conseille)|tu (dois|peux)|vous (devez|pouvez)/i.test(responseText)) {
    score += 5;
  }
  if (/toutefois|cependant|attention|à noter|important/i.test(responseText)) {
    score += 5;
  }
  if (!/je ne suis pas (sûr|certain)|je pense que peut-être/i.test(responseText)) {
    score += 5;
  }

  // BONUS DUM (10 points)
  if (/\|\s*Taxe\s*\|/.test(responseText) || /TOTAL.*DH/i.test(responseText)) {
    score += 5;
  }
  if (/anomalie|écart|incohérence/i.test(responseText)) {
    score += 5;
  }

  // PÉNALITÉS
  if (!context.legal_references?.length &&
      !context.tariffs_with_inheritance?.length &&
      !context.knowledge_documents?.length) {
    score -= 20;
  }
  if (responseText.length < 150) {
    score -= 10;
  }
  if (/généralement|en principe|normalement|il semble que/i.test(responseText)) {
    score -= 5;
  }
  if (/\[.*\]\(http/.test(responseText) || /https?:\/\/(?!www\.(douane|adii)\.gov\.ma)/.test(responseText)) {
    score -= 15;
  }

  if (score >= 55) return "high";
  if (score >= 30) return "medium";
  return "low";
}

function createEmptyContext(): RAGContext {
  return {
    tariffs_with_inheritance: [],
    hs_codes: [],
    tariffs: [],
    controlled_products: [],
    knowledge_documents: [],
    pdf_summaries: [],
    legal_references: [],
    regulatory_procedures: [],
    tariff_notes: [],
  };
}

// =============================================================================
// determineConfidence Tests
// =============================================================================

Deno.test("high confidence: article + circulaire + code + rate", () => {
  const response = "Selon l'article 85 du CDII, et la circulaire n°6243, le code **8471.30.00.10** a un taux de 25%. Je vous recommande de vérifier. Toutefois, attention à la saisonnalité. " + "x".repeat(200);
  const context = createEmptyContext();
  context.legal_references = [{ id: "1" }, { id: "2" }] as any;
  context.tariffs_with_inheritance = [{ rate_source: "direct" }] as any;
  
  assertEquals(determineConfidence(response, context), "high");
});

Deno.test("medium confidence: some data but no legal refs", () => {
  const response = "Le code **8471.30** a un taux de 25%. Je vous recommande de vérifier auprès de l'ADII. Toutefois il faut noter que ce taux peut varier selon l'origine." + "x".repeat(200);
  const context = createEmptyContext();
  context.tariffs_with_inheritance = [{ rate_source: "direct" }] as any;
  
  assertEquals(determineConfidence(response, context), "medium");
});

Deno.test("low confidence: no sources, short response", () => {
  const response = "Je ne sais pas exactement.";
  const context = createEmptyContext();
  
  assertEquals(determineConfidence(response, context), "low");
});

Deno.test("penalizes invented URLs", () => {
  const response = "Voir [ce lien](https://example.com/doc.pdf) pour plus d'infos. Le code **8471.30.00.10** a un taux de 25%." + "x".repeat(300);
  const context = createEmptyContext();
  context.legal_references = [{ id: "1" }] as any;
  
  const result = determineConfidence(response, context);
  // URL penalty should bring it down
  assertEquals(result !== "high", true);
});

Deno.test("does not penalize official government URLs", () => {
  const response = "Consultez https://www.douane.gov.ma pour les détails. Le code **8471.30.00.10** est à 25%. Selon l'article 85 du CDII. Je vous recommande de vérifier. Toutefois, attention." + "x".repeat(200);
  const context = createEmptyContext();
  context.legal_references = [{ id: "1" }, { id: "2" }] as any;
  context.tariffs_with_inheritance = [{ rate_source: "direct" }] as any;
  
  const result = determineConfidence(response, context);
  assertEquals(result === "high" || result === "medium", true);
});

Deno.test("penalizes vague language", () => {
  const responseWithVague = "Généralement, le taux est de 25%." + "x".repeat(300);
  const responseWithout = "Le taux est de 25%." + "x".repeat(300);
  const context = createEmptyContext();
  context.tariffs_with_inheritance = [{ rate_source: "direct" }] as any;
  
  const scoreVague = determineConfidence(responseWithVague, context);
  const scoreClean = determineConfidence(responseWithout, context);
  
  // Vague should score equal or lower
  const order = { high: 2, medium: 1, low: 0 };
  assertEquals(order[scoreVague] <= order[scoreClean], true);
});

Deno.test("penalizes short responses", () => {
  const shortResponse = "Code: 8471.30";
  const context = createEmptyContext();
  
  assertEquals(determineConfidence(shortResponse, context), "low");
});

Deno.test("bonus for DUM analysis with table", () => {
  const response = "| Taxe | Taux | Montant |\n| DI | 25% | 5000 DH |\nTOTAL: 7500 DH. Toutefois, attention à l'anomalie détectée sur le fret. Je vous recommande de vérifier." + "x".repeat(200);
  const context = createEmptyContext();
  context.legal_references = [{ id: "1" }] as any;
  context.tariffs_with_inheritance = [{ rate_source: "direct" }] as any;
  
  const result = determineConfidence(response, context);
  assertEquals(result === "high" || result === "medium", true);
});
