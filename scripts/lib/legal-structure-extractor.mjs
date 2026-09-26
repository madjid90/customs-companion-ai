import { createHash } from "node:crypto";

export const LEGAL_STRUCTURE_EXTRACTOR_VERSION = "legal-structure-extractor-v1";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const compact = (value = "") => String(value).normalize("NFC").replaceAll("\u0000", "").replace(/[ \t]+/gu, " ").trim();
const normalizeBody = (lines) => lines.map(compact).filter(Boolean).join("\n").trim();
const stripTrailingHeading = (value = "") => compact(value).replace(/^[\s:–—.-]+/u, "");

const ROMAN = "[IVXLCDM]+";
const NUMBER_WORDS = new Map([
  ["premier", "1"],
  ["première", "1"],
  ["prealable", "prealable"],
  ["préalable", "prealable"],
]);

const HEADING_PATTERNS = [
  { type: "book", level: 1, re: new RegExp(`^livre\\s+(${ROMAN}|[0-9]+|premier|première)\\b(.*)$`, "iu") },
  { type: "title", level: 2, re: new RegExp(`^titre\\s+(${ROMAN}|[0-9]+|premier|première)\\b(.*)$`, "iu") },
  { type: "chapter", level: 3, re: new RegExp(`^chapitre\\s+(${ROMAN}|[0-9]+|premier|première)\\b(.*)$`, "iu") },
  { type: "section", level: 4, re: new RegExp(`^section\\s+(${ROMAN}|[0-9]+|premier|première)\\b(.*)$`, "iu") },
  { type: "annex", level: 1, re: /^annexe\s*([A-Z0-9IVXLCDM-]+)?\b(.*)$/iu },
  { type: "article", level: 5, re: /^(?:article|art\.)\s+([0-9]+(?:\s*(?:bis|ter|quater))?|premier|première)\b(.*)$/iu },
];

const PARAGRAPH_PATTERNS = [
  /^(I{1,3}|IV|V|VI{0,3}|IX|X)\s*[.)-]\s+(.+)$/u,
  /^([0-9]+)[°.)-]\s+(.+)$/u,
  /^\(([0-9]+|[a-z])\)\s+(.+)$/iu,
  /^([a-z])\)\s+(.+)$/iu,
];

const MONTHS = new Map([
  ["janvier", "01"], ["février", "02"], ["fevrier", "02"], ["mars", "03"],
  ["avril", "04"], ["mai", "05"], ["juin", "06"], ["juillet", "07"],
  ["août", "08"], ["aout", "08"], ["septembre", "09"], ["octobre", "10"],
  ["novembre", "11"], ["décembre", "12"], ["decembre", "12"],
]);

const CIRCULAR_REF = /\b(?:circulaire|note)\s*(?:n[°ºo]?\s*)?([0-9]{3,6}\s*\/\s*[0-9]{1,5}|[0-9]{4,6})\b/giu;
const LEGAL_REF = /\b(?:loi|décret|decret|arrêté|arrete|dahir)\s*(?:n[°ºo]?\s*)?([0-9]{1,4}[-/][0-9]{1,4}(?:[-/][0-9]{1,4})?)\b/giu;
const DATE_TEXT = /\b([0-9]{1,2})\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)\s+([12][0-9]{3})\b/giu;

function normalizeNumber(value = "") {
  const normalized = compact(value).toLowerCase().replace(/\s+/gu, "");
  return NUMBER_WORDS.get(normalized) || normalized;
}

function pathSegment(type, number) {
  return `${type}:${normalizeNumber(number || "unnumbered")}`;
}

function parseHeading(line) {
  const normalized = compact(line);
  for (const pattern of HEADING_PATTERNS) {
    const match = normalized.match(pattern.re);
    if (!match) continue;
    const number = normalizeNumber(match[1] || "unnumbered");
    const heading = stripTrailingHeading(match[2] || normalized);
    return { type: pattern.type, level: pattern.level, number, heading: heading || normalized };
  }
  return null;
}

function parseParagraphStart(line) {
  const normalized = compact(line);
  for (const pattern of PARAGRAPH_PATTERNS) {
    const match = normalized.match(pattern);
    if (!match) continue;
    return { number: normalizeNumber(match[1]), bodyStart: stripTrailingHeading(match[2]) };
  }
  return null;
}

function parseDateText(value = "") {
  const match = compact(value).match(/^([0-9]{1,2})\s+(.+)\s+([12][0-9]{3})$/iu);
  if (!match) return null;
  const month = MONTHS.get(match[2].toLowerCase());
  if (!month) return null;
  return `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
}

function relationshipFromText(text) {
  if (/\b(abroge|abrogée|abrogee|annule|supprime)\b/u.test(text)) return "repeals";
  if (/\b(remplace|substitue)\b/u.test(text)) return "replaces";
  if (/\b(modifie|modifiée|modifiee|rectifie|corrige)\b/u.test(text)) return "amends";
  if (/\b(complète|complete|complétée|completee)\b/u.test(text)) return "complements";
  if (/\b(application|applique|pris pour l'application)\b/u.test(text)) return "implements";
  if (/\b(suspend|suspendu|proroge|prolonge)\b/u.test(text)) return "suspends";
  return null;
}

function classifyRelationshipAround(text, start, end) {
  const before = text.slice(Math.max(0, start - 90), start).toLowerCase();
  const after = text.slice(end, Math.min(text.length, end + 90)).toLowerCase();
  const sameClauseBefore = before.split(/[.;:\n]/u).at(-1) || before;
  const sameClauseAfter = after.split(/[.;:\n]/u)[0] || after;
  return relationshipFromText(sameClauseBefore) || relationshipFromText(sameClauseAfter) || "mentions";
}

function confidenceForProvision(provision) {
  let score = 70;
  if (provision.number && provision.number !== "unnumbered") score += 8;
  if (provision.body_text.length >= 40) score += 10;
  if (provision.provision_type === "article") score += 8;
  if (provision.parent_hierarchy_path || ["book", "annex"].includes(provision.provision_type)) score += 4;
  return Math.max(0, Math.min(100, score));
}

export function extractLegalReferences(text) {
  const normalized = String(text || "").normalize("NFC");
  const refs = [];
  const collect = (regex, referenceType) => {
    for (const match of normalized.matchAll(regex)) {
      const start = match.index || 0;
      const end = start + match[0].length;
      const context = normalized.slice(Math.max(0, start - 160), Math.min(normalized.length, end + 160));
      const dateMatch = [...context.matchAll(DATE_TEXT)][0];
      const relationshipType = classifyRelationshipAround(normalized, start, end);
      refs.push({
        reference_type: referenceType,
        reference_raw: compact(match[0]),
        reference_normalized: compact(match[1]).replace(/\s*\/\s*/gu, "/"),
        relationship_type: relationshipType,
        evidence_text: compact(context),
        effective_date_text: dateMatch ? compact(dateMatch[0]) : null,
        effective_from: dateMatch ? parseDateText(dateMatch[0]) : null,
        confidence: relationshipType === "mentions" ? 62 : 78,
        evidence_sha256: sha256(compact(context)),
      });
    }
  };
  collect(CIRCULAR_REF, "circular");
  collect(LEGAL_REF, "legal_instrument");
  return refs;
}

export function extractLegalStructureFromPages(pages, options = {}) {
  const normalizedPages = pages.map((page, index) => ({
    page_number: Number(page.page_number ?? page.page ?? index + 1),
    source_page_id: page.source_page_id ?? page.id ?? null,
    text: String(page.text_content ?? page.text ?? ""),
  })).filter((page) => page.text.trim());
  const inputSignature = sha256(normalizedPages.map((page) => `${page.page_number}:${sha256(page.text)}`).join("|"));
  const provisions = [];
  const stack = [];
  let currentArticle = null;
  let currentParagraph = null;
  let sequence = 0;

  const closeParagraph = () => {
    if (!currentParagraph) return;
    currentParagraph.body_text = normalizeBody(currentParagraph._bodyLines);
    currentParagraph.extraction_confidence = confidenceForProvision(currentParagraph);
    currentParagraph.evidence_sha256 = sha256(currentParagraph.body_text);
    delete currentParagraph._bodyLines;
    provisions.push(currentParagraph);
    currentParagraph = null;
  };

  const closeArticle = () => {
    closeParagraph();
    if (!currentArticle) return;
    currentArticle.body_text = normalizeBody(currentArticle._bodyLines);
    currentArticle.extraction_confidence = confidenceForProvision(currentArticle);
    currentArticle.evidence_sha256 = sha256(currentArticle.body_text);
    delete currentArticle._bodyLines;
    provisions.push(currentArticle);
    currentArticle = null;
  };

  const currentParentPath = (level) => stack.filter((entry) => entry.level < level).map((entry) => entry.segment).join("/") || null;
  const currentPath = (level, segment) => [...stack.filter((entry) => entry.level < level).map((entry) => entry.segment), segment].join("/");

  const pushStructuralHeading = (heading, pageNumber, sourcePageId) => {
    closeArticle();
    const segment = pathSegment(heading.type, heading.number);
    while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
    const parent = currentParentPath(heading.level);
    const path = currentPath(heading.level, segment);
    stack.push({ level: heading.level, segment, path, type: heading.type, number: heading.number });
    const body = heading.heading || `${heading.type} ${heading.number}`;
    provisions.push({
      provision_type: heading.type,
      number: heading.number,
      heading: heading.heading || null,
      body_text: body,
      hierarchy_path: path,
      parent_hierarchy_path: parent,
      sequence_number: sequence++,
      page_start: pageNumber,
      page_end: pageNumber,
      source_page_id: sourcePageId,
      extraction_confidence: 82,
      validation_status: "proposed",
      publication_status: "candidate",
      evidence_sha256: sha256(body),
    });
  };

  const startArticle = (heading, firstLine, pageNumber, sourcePageId) => {
    closeArticle();
    const segment = pathSegment("article", heading.number);
    const parent = currentParentPath(5);
    const path = currentPath(5, segment);
    currentArticle = {
      provision_type: "article",
      number: heading.number,
      heading: heading.heading || `Article ${heading.number}`,
      hierarchy_path: path,
      parent_hierarchy_path: parent,
      sequence_number: sequence++,
      page_start: pageNumber,
      page_end: pageNumber,
      source_page_id: sourcePageId,
      validation_status: "proposed",
      publication_status: "candidate",
      _bodyLines: [firstLine],
    };
  };

  const startParagraph = (paragraph, pageNumber, sourcePageId) => {
    if (!currentArticle) return false;
    closeParagraph();
    const segment = pathSegment("paragraph", paragraph.number);
    currentParagraph = {
      provision_type: "paragraph",
      number: paragraph.number,
      heading: null,
      hierarchy_path: `${currentArticle.hierarchy_path}/${segment}`,
      parent_hierarchy_path: currentArticle.hierarchy_path,
      sequence_number: sequence++,
      page_start: pageNumber,
      page_end: pageNumber,
      source_page_id: sourcePageId,
      validation_status: "proposed",
      publication_status: "candidate",
      _bodyLines: [paragraph.bodyStart],
    };
    currentArticle._bodyLines.push(`${paragraph.number}. ${paragraph.bodyStart}`);
    return true;
  };

  for (const page of normalizedPages) {
    const lines = page.text.split(/\r?\n/u).map(compact).filter(Boolean);
    for (const line of lines) {
      const heading = parseHeading(line);
      if (heading?.type && heading.type !== "article") {
        pushStructuralHeading(heading, page.page_number, page.source_page_id);
        continue;
      }
      if (heading?.type === "article") {
        startArticle(heading, line, page.page_number, page.source_page_id);
        continue;
      }
      const paragraph = parseParagraphStart(line);
      if (paragraph && startParagraph(paragraph, page.page_number, page.source_page_id)) continue;
      if (currentArticle) {
        currentArticle.page_end = page.page_number;
        currentArticle._bodyLines.push(line);
      }
      if (currentParagraph) {
        currentParagraph.page_end = page.page_number;
        currentParagraph._bodyLines.push(line);
      }
    }
  }
  closeArticle();

  provisions.sort((a, b) => a.sequence_number - b.sequence_number);

  const allText = normalizedPages.map((page) => page.text).join("\n");
  const relationships = extractLegalReferences(allText).map((relationship, index) => ({
    ...relationship,
    relationship_index: index,
    validation_status: "proposed",
    publication_status: "candidate",
  }));
  const articleCount = provisions.filter((provision) => provision.provision_type === "article").length;
  const avgConfidence = provisions.length ? provisions.reduce((sum, provision) => sum + provision.extraction_confidence, 0) / provisions.length : 0;
  const qualityScore = provisions.length ? Math.round((avgConfidence * (articleCount ? 1 : 0.65)) * 100) / 100 : 0;

  return {
    pipeline_version: LEGAL_STRUCTURE_EXTRACTOR_VERSION,
    input_signature_sha256: inputSignature,
    status: provisions.length ? (articleCount ? "completed" : "review_required") : "rejected",
    provision_count: provisions.length,
    article_count: articleCount,
    relationship_count: relationships.length,
    quality_score: qualityScore,
    metrics: {
      page_count: normalizedPages.length,
      articles: articleCount,
      structural_headings: provisions.filter((p) => !["article", "paragraph"].includes(p.provision_type)).length,
      paragraphs: provisions.filter((p) => p.provision_type === "paragraph").length,
      relationships: relationships.length,
      extraction_mode: "deterministic_text_hierarchy",
    },
    provisions,
    relationships,
  };
}
