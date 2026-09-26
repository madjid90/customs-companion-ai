import { describe, expect, it } from "vitest";
import { classifyNumericToken, extractHsCandidatesFromLine, normalizeHsCode, validateHsCode } from "./tariff-extractor.mjs";

describe("tariff extractor v2", () => {
  it("normalizes Moroccan national codes without losing leading zeroes", () => {
    expect(normalizeHsCode("01.01 21 00 00")).toBe("0101210000");
    expect(validateHsCode("01.01 21 00 00")).toMatchObject({ valid: true, level: "national_line", chapter: "01" });
  });

  it("rejects dates that have ten digits once separators are removed", () => {
    const result = validateHsCode("26-09-2026", "Circulaire du 26-09-2026");
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("date_like_number");
  });

  it("does not classify a circular number as an HS code", () => {
    expect(classifyNumericToken("48.416", "Circulaire n° 48.416").kind).toBe("legal_reference");
  });

  it("extracts code, description and auditable offsets from a tariff row", () => {
    const [candidate] = extractHsCandidatesFromLine("8471.30 00 00 Machines automatiques portatives — Droit 2,5 %", { tableContext: true });
    expect(candidate).toMatchObject({ code: "8471300000", valid: true, descriptionCandidate: "Machines automatiques portatives — Droit 2,5 %" });
    expect(candidate.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(candidate.endOffset).toBeGreaterThan(candidate.startOffset);
  });

  it("flags the reserved chapter instead of publishing it", () => {
    const [candidate] = extractHsCandidatesFromLine("77.01 00 00 00 Produit inconnu", { tableContext: true });
    expect(candidate.valid).toBe(false);
    expect(candidate.reasons).toContain("reserved_chapter_77");
  });
});

