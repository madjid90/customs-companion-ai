import { createHash } from "node:crypto";

export const TARIFF_EXTRACTOR_VERSION = "tariff-extractor-v2";

const CODE_TOKEN = /(?<!\d)(\d{2}(?:[.\s-]?\d{2}){1,4})(?!\d)/gu;
const DATE_CONTEXT = /\b(?:19|20)\d{2}\b|\b\d{1,2}[./-]\d{1,2}[./-](?:\d{2}|\d{4})\b/gu;
const LEGAL_CONTEXT = /\b(?:circulaire|article|art\.?|loi|décret|decret|arrêté|arrete|n[°ºo])\b/iu;
const TARIFF_CONTEXT = /\b(?:tarif|désignation|designation|marchandise|unité|unite|quotité|quotite|droit|tva|tic|taxe)\b/iu;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const compact = (value = "") => value.normalize("NFC").replaceAll("\u0000", "").replace(/\s+/gu, " ").trim();
const parseRate = (value) => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(",", ".");
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*%/u);
  return match ? Number(match[1]) : null;
};
const rateSnippet = (line, labels) => {
  const pattern = new RegExp(`\\b(?:${labels.join("|")})\\b[^%]{0,35}(\\d+(?:[,.]\\d+)?)\\s*%`, "iu");
  const match = line.match(pattern);
  return match ? match[0] : null;
};
const unitSnippet = (line) => {
  const match = line.match(/\b(?:kg|100\s*kg|u|unité|unite|m2|m3|l|litre|hl|tonne|paire|pce)\b/iu);
  return match ? match[0] : null;
};

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

export function extractTariffPage(text, options = {}) {
  const normalizedText = String(text || "").replaceAll("\u0000", "").normalize("NFC");
  const inputTextSha256 = sha256(normalizedText);
  const rows = [];
  const cellsByRowIndex = new Map();
  const lines = normalizedText.split(/\r?\n/u).map(compact);
  for (const [lineIndex, line] of lines.entries()) {
    if (!line) continue;
    const candidates = extractHsCandidatesFromLine(line, { tableContext: true });
    if (!candidates.length) continue;
    const candidate = candidates.sort((a, b) => b.confidence - a.confidence)[0];
    if (candidate.reasons.some((reason) => ["invalid_length", "date_like_number", "legal_reference_context"].includes(reason))) continue;
    const dutyRaw = rateSnippet(line, ["droit", "quotité", "quotite", "di", "dd"]);
    const vatRaw = rateSnippet(line, ["tva", "taxe"]);
    const unitRaw = unitSnippet(line);
    const designation = compact(candidate.descriptionCandidate || line.replace(candidate.rawCode, ""));
    const validationCodes = [...candidate.reasons];
    if (!designation) validationCodes.push("missing_designation");
    const validationStatus = candidate.valid && designation ? "valid" : candidate.valid ? "ambiguous" : "invalid";
    const confidence = Math.max(0, Math.min(100, candidate.confidence - (designation ? 0 : 20)));
    rows.push({
      row_index: rows.length,
      raw_text: line,
      raw_text_sha256: candidate.evidenceSha256,
      hs_code_raw: candidate.rawCode,
      hs_code_normalized: candidate.valid ? candidate.code : null,
      hs_level: candidate.valid ? candidate.level : null,
      designation,
      unit_code: unitRaw,
      duty_rate_raw: dutyRaw,
      duty_rate: parseRate(dutyRaw),
      vat_rate_raw: vatRaw,
      vat_rate: parseRate(vatRaw),
      regime: null,
      notes: null,
      confidence,
      validation_status: validationStatus,
      validation_codes: validationCodes,
      source_line_index: lineIndex,
    });
    const rowCells = [
      { column_name: "hs_code", column_index: 0, raw_value: candidate.rawCode, normalized_value: candidate.valid ? candidate.code : null, confidence: candidate.confidence, evidence_sha256: sha256(candidate.rawCode) },
      { column_name: "designation", column_index: 1, raw_value: designation || line, normalized_value: designation || null, confidence: designation ? confidence : Math.max(0, confidence - 20), evidence_sha256: sha256(designation || line) },
    ];
    if (unitRaw) rowCells.push({ column_name: "unit", column_index: 2, raw_value: unitRaw, normalized_value: compact(unitRaw).toLowerCase(), confidence: 70, evidence_sha256: sha256(unitRaw) });
    if (dutyRaw) rowCells.push({ column_name: "duty_rate", column_index: 3, raw_value: dutyRaw, normalized_value: String(parseRate(dutyRaw)), confidence: 72, evidence_sha256: sha256(dutyRaw) });
    if (vatRaw) rowCells.push({ column_name: "vat_rate", column_index: 4, raw_value: vatRaw, normalized_value: String(parseRate(vatRaw)), confidence: 72, evidence_sha256: sha256(vatRaw) });
    cellsByRowIndex.set(rows.length - 1, rowCells);
  }
  const validRowCount = rows.filter((row) => row.validation_status === "valid").length;
  const averageConfidence = rows.length ? rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length : 0;
  const table = rows.length ? {
    table_index: 0,
    header_map: {
      extraction_mode: "line_based_text",
      source: options.source || "canonical_page_text",
      geometry_available: false,
    },
    confidence: Math.round(averageConfidence * 100) / 100,
    status: validRowCount === rows.length ? "proposed" : "ambiguous",
    reason_codes: validRowCount === rows.length ? [] : ["row_validation_required"],
    rows: rows.map((row) => ({ ...row, cells: cellsByRowIndex.get(row.row_index) || [] })),
  } : null;
  return {
    pipeline_version: TARIFF_EXTRACTOR_VERSION,
    input_text_sha256: inputTextSha256,
    status: rows.length ? (validRowCount === rows.length ? "completed" : "review_required") : "rejected",
    table_count: table ? 1 : 0,
    row_count: rows.length,
    valid_row_count: validRowCount,
    quality_score: rows.length ? Math.round((validRowCount / rows.length) * averageConfidence * 100) / 100 : 0,
    metrics: {
      extraction_mode: "line_based_text",
      line_count: lines.filter(Boolean).length,
      rows_with_codes: rows.length,
      valid_rows: validRowCount,
      geometry_available: false,
    },
    tables: table ? [table] : [],
  };
}
