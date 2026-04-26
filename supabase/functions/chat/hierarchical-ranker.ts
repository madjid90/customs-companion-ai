// ============================================================================
// HIERARCHICAL RANKER
// Combine un score sémantique brut (0..1) avec un bonus de cohérence
// hiérarchique (chapitre / position / sous-position / code 10-digit).
//
// Utilisé pour deux cas:
//  1) Re-ranking des candidats HS (search_hs_codes_hybrid) lorsqu'on
//     classe par description ou code SH.
//  2) Re-ranking des chunks NENC/NESH par rapport aux codes/positions
//     déjà identifiés dans la requête.
//
// Le score final reste borné dans [0, 1.5] pour rester comparable aux
// scores existants tout en autorisant un léger dépassement quand la
// hiérarchie matche parfaitement.
// ============================================================================

import { cleanHSCode } from "./hs-utils.ts";

export interface HierarchyAnchor {
  chapter?: string | null;   // "84"
  heading?: string | null;   // "84.71" or "8471"
  subheading?: string | null;// "847130" (6-digit)
  hsCode?: string | null;    // up to 10-digit
}

export interface RankableHsItem {
  code?: string;
  code_clean?: string;
  chapter_number?: string | number | null;
  heading_code?: string | null;
  position_code?: string | null;
  similarity?: number;
  combined_score?: number;
  rrf_score?: number;
  semantic_score?: number;
  [k: string]: any;
}

export interface RankableChunk {
  metadata?: any;
  similarity?: number;
  combined_score?: number;
  rrf_score?: number;
  [k: string]: any;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function pad2(n: string | number | null | undefined): string | null {
  if (n === null || n === undefined) return null;
  const s = String(n).replace(/\D/g, "");
  if (s.length === 0) return null;
  return s.padStart(2, "0").slice(0, 2);
}

function normalizeHeading(h: string | null | undefined): string | null {
  if (!h) return null;
  const digits = h.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.slice(0, 4); // "8471"
}

function normalizeSubheading(h: string | null | undefined): string | null {
  if (!h) return null;
  const digits = h.replace(/\D/g, "");
  if (digits.length < 6) return null;
  return digits.slice(0, 6); // "847130"
}

function getBaseScore(item: { similarity?: number; combined_score?: number; rrf_score?: number; semantic_score?: number }): number {
  return (
    item.semantic_score ??
    item.combined_score ??
    item.similarity ??
    item.rrf_score ??
    0
  );
}

// ----------------------------------------------------------------------------
// Build a hierarchy anchor from analysis + already-known HS context
// ----------------------------------------------------------------------------

/**
 * Construit un "anchor" hiérarchique à partir des codes détectés dans la
 * question et des codes HS déjà retrouvés (top candidat). On préfère le
 * code le plus précis disponible (10 > 6 > 4 > 2 chiffres).
 */
export function buildHierarchyAnchor(
  detectedCodes: string[] = [],
  knownHsCodes: Array<{ code?: string; code_clean?: string; chapter_number?: any }> = [],
  analysisHints: { nencChapter?: string | null; nencHeading?: string | null; nencHsCode?: string | null } = {},
): HierarchyAnchor {
  // 1) Codes explicitement détectés dans la question
  const candidates: string[] = [];
  for (const c of detectedCodes) {
    const cleaned = cleanHSCode(c);
    if (cleaned && cleaned.length >= 2) candidates.push(cleaned);
  }
  // 2) Codes connus (les premiers = plus pertinents)
  for (const k of knownHsCodes.slice(0, 3)) {
    const cleaned = cleanHSCode(k.code || k.code_clean || "");
    if (cleaned && cleaned.length >= 2) candidates.push(cleaned);
  }
  // 3) Hints d'analyse NENC
  if (analysisHints.nencHsCode) candidates.push(analysisHints.nencHsCode.replace(/\D/g, ""));
  if (analysisHints.nencHeading) candidates.push(analysisHints.nencHeading.replace(/\D/g, ""));
  if (analysisHints.nencChapter) candidates.push(analysisHints.nencChapter.replace(/\D/g, ""));

  // Choisir le candidat le plus long (le plus précis)
  const longest = candidates
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || "";

  if (!longest) return {};

  return {
    chapter: longest.length >= 2 ? longest.slice(0, 2) : null,
    heading: longest.length >= 4 ? longest.slice(0, 4) : null,
    subheading: longest.length >= 6 ? longest.slice(0, 6) : null,
    hsCode: longest.length >= 6 ? longest : null,
  };
}

// ----------------------------------------------------------------------------
// Bonus de cohérence hiérarchique
// ----------------------------------------------------------------------------

/**
 * Calcule un bonus additif (0 .. 0.30) en fonction de la profondeur de
 * correspondance entre l'item et l'anchor.
 * - même chapitre   : +0.08
 * - même position   : +0.18 (cumulatif avec le chapitre)
 * - même sous-position (6 chiffres) : +0.26
 * - même code complet : +0.30
 */
function hierarchyBonus(itemCode: string, anchor: HierarchyAnchor): number {
  if (!itemCode) return 0;
  const codeDigits = itemCode.replace(/\D/g, "");
  if (codeDigits.length < 2) return 0;

  let bonus = 0;
  if (anchor.chapter && codeDigits.startsWith(anchor.chapter)) bonus = 0.08;
  if (anchor.heading) {
    const h = normalizeHeading(anchor.heading);
    if (h && codeDigits.startsWith(h)) bonus = 0.18;
  }
  if (anchor.subheading) {
    const sh = normalizeSubheading(anchor.subheading);
    if (sh && codeDigits.startsWith(sh)) bonus = 0.26;
  }
  if (anchor.hsCode) {
    const full = anchor.hsCode.replace(/\D/g, "");
    if (full.length >= 6 && codeDigits.startsWith(full)) bonus = 0.30;
  }
  return bonus;
}

/**
 * Bonus pour un chunk via ses metadata (NENC/NESH ou legal_chunks
 * portant chapter/heading/subheading dans `metadata`).
 */
function metadataHierarchyBonus(metadata: any, anchor: HierarchyAnchor): number {
  if (!metadata) return 0;
  let bonus = 0;
  const metaChapter = pad2(metadata.chapter ?? metadata.chapter_number);
  const metaHeading = normalizeHeading(metadata.heading ?? metadata.heading_code);
  const metaSubheading = normalizeSubheading(metadata.subheading ?? metadata.hs_code);
  const metaHs = (metadata.hs_code || "").toString().replace(/\D/g, "");

  if (anchor.chapter && metaChapter && metaChapter === anchor.chapter) bonus = 0.08;
  if (anchor.heading) {
    const h = normalizeHeading(anchor.heading);
    if (h && metaHeading === h) bonus = 0.18;
  }
  if (anchor.subheading) {
    const sh = normalizeSubheading(anchor.subheading);
    if (sh && metaSubheading === sh) bonus = 0.26;
  }
  if (anchor.hsCode) {
    const full = anchor.hsCode.replace(/\D/g, "");
    if (full && metaHs && metaHs.startsWith(full)) bonus = 0.30;
  }
  return bonus;
}

// ----------------------------------------------------------------------------
// Re-rankers publics
// ----------------------------------------------------------------------------

export interface RerankOptions {
  /** Poids du score sémantique (le bonus hiérarchique est ajouté). Défaut 1.0 */
  semanticWeight?: number;
  /** Multiplicateur du bonus hiérarchique. Défaut 1.0 */
  hierarchyWeight?: number;
  /** Limite finale */
  limit?: number;
  /** Si true, log la distribution des scores avant/après. */
  debug?: boolean;
}

/**
 * Re-rank une liste de candidats HS en combinant score sémantique +
 * bonus hiérarchique. Préserve les champs d'origine et ajoute:
 *   - hierarchical_bonus
 *   - final_score
 */
export function rerankHsCandidates<T extends RankableHsItem>(
  items: T[],
  anchor: HierarchyAnchor,
  opts: RerankOptions = {},
): T[] {
  if (!items || items.length === 0) return items;
  const semanticWeight = opts.semanticWeight ?? 1.0;
  const hierarchyWeight = opts.hierarchyWeight ?? 1.0;

  // Si l'anchor est vide, on ne fait rien (pas de signal hiérarchique fiable)
  if (!anchor.chapter && !anchor.heading && !anchor.subheading && !anchor.hsCode) {
    return items;
  }

  const ranked = items.map((item) => {
    const base = getBaseScore(item);
    const code = (item.code || item.code_clean || "").toString();
    const bonus = hierarchyBonus(code, anchor) * hierarchyWeight;
    const final_score = base * semanticWeight + bonus;
    return { ...item, hierarchical_bonus: bonus, final_score };
  });

  ranked.sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0));

  if (opts.debug) {
    console.log(JSON.stringify({
      type: "hierarchical_rerank_hs",
      anchor,
      count: ranked.length,
      top: ranked.slice(0, 5).map((r) => ({
        code: r.code || r.code_clean,
        base: Math.round((getBaseScore(r)) * 1000) / 1000,
        bonus: Math.round((r.hierarchical_bonus ?? 0) * 1000) / 1000,
        final: Math.round((r.final_score ?? 0) * 1000) / 1000,
      })),
    }));
  }

  return opts.limit ? ranked.slice(0, opts.limit) : ranked;
}

/**
 * Re-rank des chunks (NENC/NESH/legal_chunks) selon la hiérarchie portée
 * par leurs `metadata`.
 */
export function rerankChunksByHierarchy<T extends RankableChunk>(
  items: T[],
  anchor: HierarchyAnchor,
  opts: RerankOptions = {},
): T[] {
  if (!items || items.length === 0) return items;
  const semanticWeight = opts.semanticWeight ?? 1.0;
  const hierarchyWeight = opts.hierarchyWeight ?? 1.0;

  if (!anchor.chapter && !anchor.heading && !anchor.subheading && !anchor.hsCode) {
    return items;
  }

  const ranked = items.map((item) => {
    const base = getBaseScore(item);
    const bonus = metadataHierarchyBonus(item.metadata, anchor) * hierarchyWeight;
    const final_score = base * semanticWeight + bonus;
    return { ...item, hierarchical_bonus: bonus, final_score };
  });

  ranked.sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0));

  if (opts.debug) {
    console.log(JSON.stringify({
      type: "hierarchical_rerank_chunks",
      anchor,
      count: ranked.length,
      top: ranked.slice(0, 5).map((r) => ({
        meta: {
          chapter: r.metadata?.chapter,
          heading: r.metadata?.heading,
          hs_code: r.metadata?.hs_code,
        },
        base: Math.round(getBaseScore(r) * 1000) / 1000,
        bonus: Math.round((r.hierarchical_bonus ?? 0) * 1000) / 1000,
        final: Math.round((r.final_score ?? 0) * 1000) / 1000,
      })),
    }));
  }

  return opts.limit ? ranked.slice(0, opts.limit) : ranked;
}
