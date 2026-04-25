// ============================================================================
// NENC / NESH METADATA EXTRACTOR
// ============================================================================
// Specialized extractor for the WCO Notes Explicatives de la Nomenclature
// Combinée (NENC) and Notes Explicatives du Système Harmonisé (NESH).
//
// These documents follow a strict structure:
//   - Section I-XXI (roman)
//   - Chapitre 01 → 97 (2-digit)
//   - Position XX.YY (4-digit heading)
//   - Sous-position XXYY.ZZ (6-digit subheading)
//
// We extract this hierarchy + cross-references (e.g. "voir Chapitre 84")
// into a JSONB `metadata` blob that powers structured search and filtering.
// ============================================================================

export type NencDocType = "nenc" | "nesh" | "circular" | "law" | "decree" | "note" | "decision" | "other";

export interface NencChunkMetadata {
  doc_type: NencDocType;
  // Hierarchy
  section_roman?: string | null;        // e.g. "VI"
  chapter?: string | null;              // 2-digit "84"
  heading?: string | null;              // 4-digit "84.71"
  subheading?: string | null;           // 6-digit "847130"
  // HS codes
  hs_code_normalized?: string | null;   // Best (most specific) HS code
  hs_codes_mentioned?: string[];        // All HS codes found
  // Cross-refs
  cross_references?: string[];          // ["Chapitre 85", "84.73", "Note 1"]
  // Free flags
  is_general_note?: boolean;            // "Considérations générales"
  is_exclusion?: boolean;               // "Sont exclus..."
}

// Patterns ----------------------------------------------------------------

const SECTION_RX = /\bSection\s+([IVXLC]+)\b/i;
const CHAPTER_RX = /\bChapitre\s+(\d{1,2})\b/i;
// 4-digit headings: 84.71 / 8471 / 84 71
const HEADING_RX = /\b(\d{2})[\.\s]?(\d{2})(?!\d)/g;
// 6-digit subheadings: 8471.30 / 847130
const SUBHEADING_RX = /\b(\d{2})[\.\s]?(\d{2})[\.\s]?(\d{2})(?!\d)/g;

const GENERAL_NOTE_RX = /(consid[ée]rations\s+g[ée]n[ée]rales|notes?\s+g[ée]n[ée]rales)/i;
const EXCLUSION_RX = /(sont\s+exclus|ne\s+rel[èe]vent\s+pas|exclus\s+de\s+la\s+pr[ée]sente)/i;

const CROSS_REF_RX = /(?:voir|cf\.?|conform[ée]ment\s+[àa])\s+(?:la\s+|le\s+|les\s+)?(Chapitre\s+\d{1,2}|Section\s+[IVXLC]+|Note\s+\d+|position\s+\d{2}\.\d{2}|sous-position\s+\d{4}\.\d{2})/gi;

// ----------------------------------------------------------------------------

/**
 * Detect the document type from `source_type` + textual hints.
 */
export function detectDocType(sourceType: string | undefined, sampleText: string): NencDocType {
  const st = (sourceType || "").toLowerCase();
  if (st === "nenc" || st === "nesh") return st;

  const lower = sampleText.slice(0, 5000).toLowerCase();
  if (/notes?\s+explicatives.+nomenclature\s+combin[ée]e/i.test(lower)) return "nenc";
  if (/notes?\s+explicatives.+syst[èe]me\s+harmonis[ée]/i.test(lower)) return "nesh";

  if (st === "circular") return "circular";
  if (st === "law") return "law";
  if (st === "decree") return "decree";
  if (st === "note") return "note";
  if (st === "decision") return "decision";
  return "other";
}

/**
 * Recommended page batch size for the ingestion pipeline.
 * NENC/NESH are dense → still small per request, but slightly larger
 * than circulars (which use 1 page/batch).
 */
export function recommendedBatchSize(docType: NencDocType): number {
  if (docType === "nenc" || docType === "nesh") return 5;
  return 1;
}

/**
 * Extract structured metadata from a chunk's text.
 * Returns a plain object suitable for direct JSONB insertion.
 */
export function extractNencMetadata(
  chunkText: string,
  docType: NencDocType,
  inheritedContext?: { chapter?: string | null; section_roman?: string | null }
): NencChunkMetadata {
  const text = chunkText || "";
  const meta: NencChunkMetadata = { doc_type: docType };

  // Section / chapter (with inheritance from previous chunks)
  const sectionMatch = text.match(SECTION_RX);
  meta.section_roman = sectionMatch?.[1] ?? inheritedContext?.section_roman ?? null;

  const chapterMatch = text.match(CHAPTER_RX);
  if (chapterMatch) {
    meta.chapter = chapterMatch[1].padStart(2, "0");
  } else {
    meta.chapter = inheritedContext?.chapter ?? null;
  }

  // Headings (4-digit) and subheadings (6-digit)
  const headings = new Set<string>();
  const subheadings = new Set<string>();

  let m: RegExpExecArray | null;

  // Reset lastIndex (global regex)
  HEADING_RX.lastIndex = 0;
  while ((m = HEADING_RX.exec(text)) !== null) {
    const ch = m[1];
    const sub = m[2];
    // Validate plausible chapter (01-97)
    const chNum = parseInt(ch, 10);
    if (chNum >= 1 && chNum <= 97) {
      headings.add(`${ch}.${sub}`);
    }
  }

  SUBHEADING_RX.lastIndex = 0;
  while ((m = SUBHEADING_RX.exec(text)) !== null) {
    const ch = m[1];
    const sub = m[2];
    const ssub = m[3];
    const chNum = parseInt(ch, 10);
    if (chNum >= 1 && chNum <= 97) {
      subheadings.add(`${ch}${sub}${ssub}`);
    }
  }

  meta.heading = headings.size > 0 ? Array.from(headings)[0] : null;
  meta.subheading = subheadings.size > 0 ? Array.from(subheadings)[0] : null;

  // Build hs_codes_mentioned (normalized digits only)
  const allCodes = new Set<string>();
  headings.forEach((h) => allCodes.add(h.replace(".", "")));
  subheadings.forEach((s) => allCodes.add(s));
  meta.hs_codes_mentioned = Array.from(allCodes);

  // Best (most specific) hs_code for indexing
  if (subheadings.size > 0) {
    meta.hs_code_normalized = Array.from(subheadings)[0];
  } else if (headings.size > 0) {
    meta.hs_code_normalized = Array.from(headings)[0].replace(".", "");
  } else if (meta.chapter) {
    meta.hs_code_normalized = meta.chapter;
  } else {
    meta.hs_code_normalized = null;
  }

  // Cross-references
  const crossRefs = new Set<string>();
  CROSS_REF_RX.lastIndex = 0;
  while ((m = CROSS_REF_RX.exec(text)) !== null) {
    crossRefs.add(m[1].replace(/\s+/g, " ").trim());
  }
  meta.cross_references = Array.from(crossRefs);

  // Flags
  meta.is_general_note = GENERAL_NOTE_RX.test(text);
  meta.is_exclusion = EXCLUSION_RX.test(text);

  return meta;
}

/**
 * Helper to maintain chapter / section context across chunks
 * (since headings often appear once and apply to dozens of pages).
 */
export class NencContextTracker {
  private chapter: string | null = null;
  private section: string | null = null;

  update(meta: NencChunkMetadata): void {
    if (meta.chapter) this.chapter = meta.chapter;
    if (meta.section_roman) this.section = meta.section_roman;
  }

  current(): { chapter: string | null; section_roman: string | null } {
    return { chapter: this.chapter, section_roman: this.section };
  }
}
