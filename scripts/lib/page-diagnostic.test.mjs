import { describe, expect, it } from "vitest";
import { classifyPage } from "./page-diagnostic.mjs";

describe("page diagnostic v2", () => {
  it("does not OCR a genuinely blank page", () => expect(classifyPage({ textCharacters: 0, inkRatio: 0.001, imageObjects: 0 }).pageClass).toBe("blank"));
  it("routes a visible image without text to OCR", () => expect(classifyPage({ textCharacters: 0, inkRatio: 0.12, imageObjects: 1 }).strategy).toBe("ocr"));
  it("keeps a usable text layer native", () => expect(classifyPage({ textCharacters: 1200, inkRatio: 0.14, imageObjects: 0 }).strategy).toBe("native_pdf"));
  it("routes vector content without text to layout", () => expect(classifyPage({ textCharacters: 3, inkRatio: 0.1, imageObjects: 0, pathObjects: 80 }).pageClass).toBe("vector_complex"));
  it("prioritizes table reconstruction over plain OCR", () => expect(classifyPage({ textCharacters: 500, inkRatio: 0.15, imageObjects: 0, hasTableSignals: true }).strategy).toBe("layout"));
});

