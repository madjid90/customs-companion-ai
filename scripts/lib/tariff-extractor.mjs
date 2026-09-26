import { createHash } from "node:crypto";

export const TARIFF_EXTRACTOR_VERSION = "tariff-extractor-v2";

const CODE_TOKEN = /(?<!\d)(\d{2}(?:[.\s-]?\d{2}){1,4})(?!\d)/gu;
const DATE_CONTEXT = /\b(?:19|20)\d{2}\b|\b\d{1,2}[./-]\d{1,2}[./-](?:\d{2}|\d{4})\b/gu;
const LEGAL_CONTEXT = /\b(?:circulaire|article|art\.?|loi|décret|decret|arrêté|arrete|n[°ºo])\b/iu;
const TARIFF_CONTEXT = /\b(?:tarif|désignation|designation|marchandise|unité|unite|quotité|quotite|droit|tva|tic|taxe)\b/iu;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const compact = (value = "") => value.normalize("NFC").replaceAll("\u0000", "").replace(/\s+/gu, " ").trim();

export function normalizeHsCode(value = "") {
  return value.replace(/[^0-9]/gu, "");
}

export function validateHsCode(value, context = "") {
  const code = normalizeHsCode(value);
  const reasons = [];
  const lengthValid = [4, 6, 8, 10].includes(code.length);
  if (!lengthValid) reasons.push("invalid_length");

  const chapter = code.slice(0, 2);
  const chapterNumber = Number(chapter);
  if (!/^\d{2}$/u.test(chapter) || chapterNumber < 1 || chapterNumber > 97) reasons.push("invalid_chapter");
  if (chapter === "77") reasons.push("reserved_chapter_77");

  const compactContext = compact(context);
  const dates = compactContext.match(DATE_CONTEXT) || [];
  if (dates.some((date) => normalizeHsCode(date) === code)) reasons.push("date_like_number");
  if (LEGAL_CONTEXT.test(compactContext) && !TARIFF_CONTEXT.test(compactContext)) reasons.push("legal_reference_context");

  return {
    code,
    chapter,
    level: code.length === 4 ? "heading" : code.length === 6 ? "subheading" : code.length >= 8 ? "national_line" : null,
    valid: reasons.length === 0,
    reasons,
  };
}

export function extractHsCandidatesFromLine(rawLine, options = {}) {
  const text = compact(rawLine);
  if (!text) return [];
  const candidates = [];
  for (const match of text.matchAll(CODE_TOKEN)) {
    const validation = validateHsCode(match[1], text);
    const before = text.slice(0, match.index).trim();
    const after = text.slice((match.index || 0) + match[0].length).trim();
    let confidence = 92;
    if (!TARIFF_CONTEXT.test(text) && !options.tableContext) confidence -= 18;
    confidence -= validation.reasons.length * 30;
    if (validation.code.length < 10) confidence -= 8;
    candidates.push({
      ...validation,
      rawCode: match[1],
      rawLine: text,
      descriptionCandidate: after || before || null,
      confidence: Math.max(0, Math.min(100, confidence)),
      evidenceSha256: sha256(text),
      startOffset: match.index,
      endOffset: (match.index || 0) + match[0].length,
    });
  }
  return candidates;
}

export function classifyNumericToken(value, context = "", options = {}) {
  const validation = validateHsCode(value, context);
  if (validation.valid && (TARIFF_CONTEXT.test(context) || options.tableContext)) return { kind: "hs_code", ...validation };
  if (validation.reasons.includes("date_like_number")) return { kind: "date", ...validation };
  if (validation.reasons.includes("legal_reference_context")) return { kind: "legal_reference", ...validation };
  return { kind: "unknown_number", ...validation };
}

