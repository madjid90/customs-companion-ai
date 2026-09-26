import { describe, expect, it } from "vitest";
import { extractLegalReferences, extractLegalStructureFromPages } from "./legal-structure-extractor.mjs";

describe("legal structure extractor v1", () => {
  it("builds a hierarchy from book, title, chapter, section and article markers", () => {
    const result = extractLegalStructureFromPages([{ page_number: 1, text: [
      "LIVRE PREMIER : Régime général",
      "TITRE I - Principes",
      "CHAPITRE II : Déclarations",
      "Section 3 - Contrôle",
      "Article 12 - Déclaration en détail",
      "La déclaration doit contenir les éléments nécessaires au contrôle.",
    ].join("\n") }]);

    expect(result.status).toBe("completed");
    expect(result.article_count).toBe(1);
    const article = result.provisions.find((p) => p.provision_type === "article");
    expect(article).toMatchObject({
      number: "12",
      hierarchy_path: "book:1/title:i/chapter:ii/section:3/article:12",
      parent_hierarchy_path: "book:1/title:i/chapter:ii/section:3",
      page_start: 1,
      page_end: 1,
    });
    expect(article.body_text).toContain("Déclaration en détail");
    expect(article.evidence_sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("creates paragraph candidates under the active article", () => {
    const result = extractLegalStructureFromPages([{ page_number: 2, text: [
      "Article 4",
      "I. - Les marchandises sont présentées au bureau de douane.",
      "II. - Les documents justificatifs sont conservés.",
    ].join("\n") }]);

    const paragraphs = result.provisions.filter((p) => p.provision_type === "paragraph");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toMatchObject({
      number: "i",
      hierarchy_path: "article:4/paragraph:i",
      parent_hierarchy_path: "article:4",
    });
    const article = result.provisions.find((p) => p.provision_type === "article");
    expect(article.body_text).toContain("Les documents justificatifs");
  });

  it("extracts dated legal relationship candidates without publishing them", () => {
    const refs = extractLegalReferences("La présente circulaire modifie la circulaire n° 48416/311 du 12 septembre 2024 et abroge le décret n° 2-77-862.");
    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ reference_type: "circular", reference_normalized: "48416/311", relationship_type: "amends", effective_from: "2024-09-12" }),
      expect.objectContaining({ reference_type: "legal_instrument", reference_normalized: "2-77-862", relationship_type: "repeals" }),
    ]));
    expect(refs.every((ref) => ref.evidence_sha256.match(/^[a-f0-9]{64}$/u))).toBe(true);
  });

  it("rejects pages without identifiable legal provisions", () => {
    const result = extractLegalStructureFromPages([{ page_number: 1, text: "Texte libre sans article ni structure." }]);
    expect(result).toMatchObject({ status: "rejected", provision_count: 0, article_count: 0 });
  });
});
