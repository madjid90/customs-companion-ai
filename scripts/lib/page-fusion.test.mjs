import { describe, expect, it } from "vitest";
import { assessCandidate, decidePageFusion, normalizeExtractedText, tokenSimilarity } from "./page-fusion.mjs";

describe("audited page fusion", () => {
  it("normalizes unsafe PDF text deterministically", () => {
    expect(normalizeExtractedText("  Tarif\u0000   douanier\n\n\n Maroc  ")).toBe("Tarif douanier\n\nMaroc");
  });

  it("penalizes corrupt extraction instead of preferring raw length", () => {
    const clean = assessCandidate({ source: "pdfium", text: "Article premier. Les marchandises sont classées selon la nomenclature applicable au Maroc.", confidence: 85 });
    const corrupt = assessCandidate({ source: "native_pdf", text: `${"�\u0001".repeat(200)} texte`, confidence: 99 });
    expect(clean.score).toBeGreaterThan(corrupt.score);
  });

  it("selects the strongest candidate and keeps its evidence identity", () => {
    const decision = decidePageFusion([
      { source: "native_pdf", text: "illisible", confidence: 30 },
      { source: "pdfium", engineOutputId: "pdfium-id", text: "Circulaire relative au classement tarifaire des marchandises importées au Maroc et aux pièces justificatives requises.", confidence: 82 },
      { source: "ocr", engineOutputId: "ocr-id", text: "Circulaire relative au classement tarifaire des marchandises importées au Maroc.", confidence: 65 },
    ]);
    expect(decision.selected?.source).toBe("pdfium");
    expect(decision.selected?.engineOutputId).toBe("pdfium-id");
    expect(decision.inputSignature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires review when close candidates disagree", () => {
    const decision = decidePageFusion([
      { source: "pdfium", text: "Autorisation obligatoire pour les produits chimiques relevant du chapitre vingt-huit.", confidence: 80 },
      { source: "ocr", text: "Exonération totale pour les véhicules relevant du chapitre quatre-vingt-sept.", confidence: 80 },
    ], { minimumMargin: 20 });
    expect(tokenSimilarity(decision.candidates[0].text, decision.candidates[1].text)).toBeLessThan(0.72);
    expect(decision.status).toBe("review_required");
    expect(decision.reasonCodes).toContain("close_scores_with_text_disagreement");
  });

  it("rejects a page when every engine is empty", () => {
    expect(decidePageFusion([
      { source: "native_pdf", text: "", confidence: 0 },
      { source: "ocr", text: "", confidence: 0 },
    ]).status).toBe("rejected");
  });
});

