import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders,
  handleCorsPreFlight,
  checkRateLimitDistributed,
  rateLimitResponse,
  getClientId,
  errorResponse,
  successResponse,
} from "../_shared/cors.ts";
import { createLogger, Logger } from "../_shared/logger.ts";
import { maskSensitiveData, safeLog } from "../_shared/masking.ts";
import { parseJsonResilient } from "../_shared/json-resilient.ts";
import { requireAuth, isProductionMode } from "../_shared/auth-check.ts";
import { callLLMWithMetrics } from "../_shared/retry.ts";

// =============================================================================
// CONFIGURATION - ANTHROPIC CLAUDE (Native PDF Support)
// =============================================================================

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

// Configuration BATCH par défaut
const DEFAULT_BATCH_SIZE = 4;  // Pages par appel
const MAX_BATCH_SIZE = 15;
const MIN_BATCH_SIZE = 1;

// Page detection - Cache pour éviter les appels répétés
const PAGE_COUNT_CACHE = new Map<string, number>();

// =============================================================================
// OBSERVABILITY METRICS
// =============================================================================

interface ObservabilityMetrics {
  run_id: string;
  function_name: string;
  start_time: number;
  pages_processed: number;
  inserted_rows: number;
  errors_count: number;
  llm_calls: number;
  llm_total_duration_ms: number;
}

function createMetrics(runId: string): ObservabilityMetrics {
  return {
    run_id: runId,
    function_name: "analyze-pdf",
    start_time: Date.now(),
    pages_processed: 0,
    inserted_rows: 0,
    errors_count: 0,
    llm_calls: 0,
    llm_total_duration_ms: 0,
  };
}

function logMetrics(metrics: ObservabilityMetrics, status: "processing" | "done" | "error"): void {
  const duration = Date.now() - metrics.start_time;
  console.log(JSON.stringify({
    type: "metrics",
    run_id: metrics.run_id,
    function: metrics.function_name,
    status,
    duration_ms: duration,
    pages_processed: metrics.pages_processed,
    inserted_rows: metrics.inserted_rows,
    errors_count: metrics.errors_count,
    llm_calls: metrics.llm_calls,
    llm_avg_duration_ms: metrics.llm_calls > 0 
      ? Math.round(metrics.llm_total_duration_ms / metrics.llm_calls) 
      : 0,
    timestamp: new Date().toISOString(),
  }));
}

// =============================================================================
// INTERFACES
// =============================================================================

interface RawTariffLine {
  prefix_col?: string | null;       // Chiffre d'alignement à IGNORER
  position_6?: string | null;       // Ex: "8903.11" ou "890311"
  col2?: string | null;             // 2 digits
  col3?: string | null;             // 2 digits
  national_code?: string | null;    // 10 digits (peut être reconstruit)
  hs_code_6?: string | null;        // 6 digits (peut être reconstruit)
  description?: string | null;
  duty_rate?: string | number | null;
  unit_norm?: string | null;        // Unité quantité normalisée
  unit_comp?: string | null;        // Unité complémentaire
  page_number?: number | null;      // Source page
}

interface ExtractedNote {
  note_type: "chapter_note" | "section_note" | "definition" | "footnote" | "exclusion" | "remark";
  anchor?: string;
  note_text: string;
  page_number?: number;
}

interface TariffLine {
  national_code: string;
  hs_code_6: string;
  description: string;
  duty_rate: number;
  duty_note: string | null;
  unit_norm: string | null;
  unit_comp: string | null;
  is_inherited: boolean;
  page_number?: number | null;
  // Source tracking
  source_pdf?: string | null;
  source_page?: number | null;
  source_extraction_id?: string | null;
  source_evidence?: string | null;
}

interface HSCodeEntry {
  code: string;
  code_clean: string;
  description: string;
  level: string;
}

interface CircularReference {
  source_type: string;
  source_ref: string;
  title?: string;
  issuer?: string;
  related_hs_codes: string[];
  note_text: string;
}

interface RawTableDebug {
  detectedSwaps: number;
  swappedSamples: Array<{
    national_code: string;
    before: { duty_rate: string | number | null | undefined; unit_norm: string | null | undefined };
    after: { duty_rate: number | null; unit_norm: string | null };
  }>;
  parsingWarnings: string[];
  skippedLines: number;
  notesCount: number;
  linesFromFallback: number;
  // Col2/Col3 swap detection
  swappedCol2Col3Count: number;
  swappedCol2Col3Samples: Array<{
    pos6: string;
    original: { col2: string; col3: string };
    resolved: { col2: string; col3: string };
    reason: string;
  }>;
}

interface BatchStats {
  tariff_lines_inserted: number;
  hs_codes_inserted: number;
  notes_inserted: number;
  pages_skipped: number;
  errors: string[];
}

interface BatchRequest {
  pdfId: string;
  filePath?: string;
  previewOnly?: boolean;
  // Paramètres BATCH
  start_page?: number;
  max_pages?: number;
  extraction_run_id?: string | null;
}

interface BatchResponse {
  extraction_run_id: string;
  done: boolean;
  next_page: number | null;
  processed_pages: number;
  total_pages: number;
  stats: BatchStats;
  status: "processing" | "done" | "error";
  pdfId: string;
  pdfTitle?: string;
  countryCode?: string;
  error?: string;
  // Preview data - retourné quand previewOnly=true ou pour accumulation côté frontend
  tariff_lines?: TariffLine[];
  hs_codes?: HSCodeEntry[];
  notes?: ExtractedNote[];
  // Résumé du document (généré au premier batch)
  summary?: string;
}

// =============================================================================
// HELPERS STRICTS (pas de padding)
// =============================================================================

function digitsOnly(str: string | null | undefined): string {
  if (!str) return "";
  return str.replace(/[^0-9]/g, "");
}

function normalize10Strict(str: string | null | undefined): string | null {
  if (!str) return null;
  const digits = digitsOnly(str);
  if (digits.length !== 10) return null;
  return digits;
}

function normalize6Strict(str: string | null | undefined): string | null {
  if (!str) return null;
  const cleaned = str.replace(/[\.\-\s]/g, "");
  const digits = digitsOnly(cleaned);
  if (digits.length !== 6) return null;
  return digits;
}

function normalize2Strict(str: string | null | undefined): string | null {
  if (!str) return null;
  const digits = digitsOnly(str);
  if (digits.length !== 2) return null;
  return digits;
}

function normalizeRate(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return isNaN(value) ? null : value;
  const str = String(value).trim();
  if (str === "" || str === "-" || str === "–" || str === "—") return null;
  let cleaned = str.replace(/%/g, "").trim();
  cleaned = cleaned.replace(",", ".");
  cleaned = cleaned.replace(/\([a-z]\)/gi, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function isUnit(val: string | number | null | undefined): boolean {
  if (val === null || val === undefined) return false;
  const str = String(val).trim().toUpperCase();
  if (str === "-" || str === "–" || str === "—" || str === "") return true;
  // Unités courantes marocaines
  const commonUnits = ["U", "KG", "KGN", "M", "M2", "M3", "L", "N", "P", "PR", "CT", "GR", "T", "1000U", "1000P", "K"];
  if (commonUnits.includes(str)) return true;
  // Pattern général: 1-5 lettres + optionnellement 0-2 chiffres
  return /^[A-Za-z]{1,5}\d{0,2}$/i.test(str);
}

function isNumberLike(val: string | number | null | undefined): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === "number") return !isNaN(val);
  const str = String(val).trim();
  if (str === "" || str === "-" || str === "–" || str === "—") return false;
  // Accepter virgule ou point comme séparateur décimal, et % optionnel
  return /^\d+([.,]\d+)?%?$/.test(str);
}

function fixRateUnitSwap(
  line: RawTariffLine,
  debug: RawTableDebug
): { duty_rate: number | null; unit_norm: string | null; swapped: boolean } {
  const originalDuty = line.duty_rate;
  const originalUnit = line.unit_norm;
  let dutyRate = originalDuty;
  let unitNorm = originalUnit;
  let swapped = false;
  
  // Cas 1: duty_rate ressemble à une unité ET unit_norm ressemble à un nombre
  if (isUnit(dutyRate) && isNumberLike(unitNorm)) {
    dutyRate = unitNorm;
    unitNorm = String(originalDuty);
    swapped = true;
    debug.detectedSwaps++;
    if (debug.swappedSamples.length < 10) {
      debug.swappedSamples.push({
        national_code: line.national_code || "unknown",
        before: { duty_rate: originalDuty, unit_norm: originalUnit as string | null },
        after: { duty_rate: normalizeRate(dutyRate), unit_norm: unitNorm }
      });
    }
    console.log(`[SWAP] ${line.national_code}: duty="${originalDuty}" ↔ unit="${originalUnit}"`);
  }
  
  // Cas 2: duty_rate est un tiret et unit_norm est numérique
  if ((dutyRate === "-" || dutyRate === "–" || dutyRate === "—") && isNumberLike(unitNorm)) {
    dutyRate = unitNorm;
    unitNorm = "-";
    swapped = true;
    debug.detectedSwaps++;
    console.log(`[SWAP-DASH] ${line.national_code}: duty="${originalDuty}" ↔ unit="${originalUnit}"`);
  }
  
  // Cas 3: duty_rate est null/vide mais unit_norm contient un nombre
  if ((dutyRate === null || dutyRate === undefined || String(dutyRate).trim() === "") && isNumberLike(unitNorm)) {
    dutyRate = unitNorm;
    unitNorm = null;
    swapped = true;
    debug.detectedSwaps++;
    console.log(`[SWAP-NULL] ${line.national_code}: duty=null ↔ unit="${originalUnit}"`);
  }
  
  return {
    duty_rate: normalizeRate(dutyRate),
    unit_norm: unitNorm ? String(unitNorm).trim() : null,
    swapped
  };
}

function extractDutyNote(dutyStr: string | number | null): string | null {
  if (dutyStr === null || dutyStr === undefined) return null;
  if (typeof dutyStr === "number") return null;
  const str = String(dutyStr).trim();
  const match = str.match(/\(([a-z])\)/i);
  return match ? match[1].toLowerCase() : null;
}

function isReservedCode(code: string): boolean {
  if (!code || code.trim() === "") return false;
  const raw = code.trim();
  return raw.startsWith("[") || raw.endsWith("]") || raw.includes("[") || raw.includes("]");
}

function isValidCleanCode(codeClean: string): boolean {
  if (!codeClean) return false;
  return /^\d{6}$/.test(codeClean);
}

// =============================================================================
// CONTEXTE POUR RÉSOLUTION COL2/COL3
// =============================================================================

interface Col2Col3Context {
  lastCol2: string | null;
  lastCol3: string | null;
  pos6Col2Counts: Map<string, Map<string, number>>; // pos6 -> (col2Value -> count)
}

interface Col2Col3Resolution {
  col2: string;
  col3: string;
  swapApplied: boolean;
  reason: string;
}

/**
 * Résout l'inversion col2/col3 de manière déterministe.
 * 
 * RÈGLE FONDAMENTALE du tarif marocain (CORRIGÉE):
 * - col2 = sous-position de la position SH (peut être 00 pour ligne parente, ou 10/20/90 pour sous-positions)
 * - col3 = détail national (peut être 00 si pas de détail, ou 10/20/90 pour détails)
 * 
 * IMPORTANT: col2=00 est VALIDE pour les lignes parentes (ex: 3502.11 00 = "Séchée")
 * Donc on ne doit PAS swapper quand le LLM retourne col2=00.
 * 
 * Le swap ne s'applique QUE si:
 * - col2 est un détail (10, 20, 90...) ET col3=00
 * - Car cela suggère que le vrai col2 devrait être 00 et le vrai col3 le détail
 */
function resolveCol2Col3(
  pos6: string,
  a: string | null, // Premier candidat (col2 brut extrait par Claude)
  b: string | null, // Deuxième candidat (col3 brut extrait par Claude)
  ctx: Col2Col3Context
): Col2Col3Resolution | null {
  // Validation stricte: a et b doivent être exactement 2 digits
  const col2A = normalize2Strict(a);
  const col2B = normalize2Strict(b);
  
  if (!col2A || !col2B) {
    return null; // Invalide, sera géré par l'héritage
  }
  
  // =========================================================================
  // RÈGLE 0: Si col2 (a) = "00", c'est une ligne parente → NE JAMAIS SWAPPER
  // col2=00 est parfaitement valide pour les positions parentes.
  // Ex: 3502.11 | 00 | (vide) = "Séchée" → col2=00 est correct
  //            |    | 10     = "impropre..." → col2=00 (hérité), col3=10
  // =========================================================================
  if (col2A === "00") {
    return {
      col2: col2A,
      col3: col2B,
      swapApplied: false,
      reason: `KEEP(col2=00-parent) col2=${col2A},col3=${col2B}`
    };
  }
  
  // =========================================================================
  // RÈGLE 1: Si aucun des deux n'est "00", garder l'ordre Claude
  // Sans "00", on ne peut pas savoir qui est col2 vs col3 → garder A.
  // =========================================================================
  if (col2A !== "00" && col2B !== "00") {
    return {
      col2: col2A,
      col3: col2B,
      swapApplied: false,
      reason: `KEEP(no-00) both=${col2A},${col2B}`
    };
  }
  
  // =========================================================================
  // RÈGLE 2: col2 est un détail (10/20/90) et col3=00
  // Ceci suggère une inversion: le vrai col2 devrait être 00, col3 le détail.
  // MAIS: ce cas est ambigu. Dans le tarif, on peut avoir:
  //   - 3502.11 | 10 | 00 = sous-position 10, pas de détail national
  // Donc on ne swappe PAS ici non plus. On fait confiance au LLM.
  // =========================================================================
  // col2B === "00" && col2A !== "00" → on garde l'ordre, col2=détail, col3=00
  return {
    col2: col2A,
    col3: col2B,
    swapApplied: false,
    reason: `KEEP(trust-llm) col2=${col2A},col3=${col2B}`
  };
}

/**
 * Met à jour les statistiques de col2 pour une position donnée.
 */
function updateCol2Stats(ctx: Col2Col3Context, pos6: string, col2: string): void {
  if (!ctx.pos6Col2Counts.has(pos6)) {
    ctx.pos6Col2Counts.set(pos6, new Map<string, number>());
  }
  const stats = ctx.pos6Col2Counts.get(pos6)!;
  stats.set(col2, (stats.get(col2) || 0) + 1);
}

// =============================================================================
// PROMPTS
// =============================================================================

const getPageTariffPrompt = (title: string, pageNumber: number, totalPages: number) => `Expert en tarifs douaniers marocains. Analyse cette PAGE ${pageNumber}/${totalPages} du PDF "${title}".

=== RÈGLE FONDAMENTALE: LECTURE HORIZONTALE STRICTE ===

⚠️ CRITIQUE: Lis CHAQUE LIGNE HORIZONTALEMENT, de gauche à droite.
Les valeurs sur une même ligne appartiennent TOUTES à cette ligne.
NE JAMAIS mélanger les valeurs de lignes différentes.

=== STRUCTURE EXACTE DU CODE NATIONAL MAROCAIN (10 CHIFFRES) ===

Le code national est composé de EXACTEMENT 10 chiffres, dans cet ordre STRICT:

  Position SH (6 chiffres) + Sous-position (2 chiffres) + Détail national (2 chiffres)
  
  ┌──────────────┬────────────┬──────────────────┐
  │ position_6   │    col2    │       col3       │
  │  6 chiffres  │ 2 chiffres │   2 chiffres     │
  │  (ex: 0301.99)│ (ex: 15)   │   (ex: 00)       │
  └──────────────┴────────────┴──────────────────┘

=== EXEMPLE RÉEL DÉTAILLÉ (CAS COMPLEXE) ===

Voici un exemple typique du tarif marocain avec hiérarchie:

  | Position | Col2 | Col3 | Désignation                                | Droit | Unité |
  |----------|------|------|--------------------------------------------|-------|-------|
  | 0301.99  |      |      | -- Autres                                  |       |       |
  |          |      |      | --- d'eau douce :                          |       |       |
  |          | 15   | 00   | ---- destinés au repeuplement              | 10    | kg    |
  |          | 19   |      | ---- autres :                              |       |       |
  |          |      | 10   | ----- saumons et corégones                 | 10    | kg    |
  |          |      | 20   | ----- autres salmonidés                    | 10    | kg    |

EXTRACTION CORRECTE ligne par ligne:
- Ligne "destinés au repeuplement": col2=15, col3=00 → national_code=0301991500
- Ligne "saumons et corégones": col2=19 (hérité), col3=10 → national_code=0301991910
- Ligne "autres salmonidés": col2=19 (hérité), col3=20 → national_code=0301991920

⚠️ ERREUR À ÉVITER:
- NE PAS lire col2=19 et col3=15 pour "destinés au repeuplement" 
  → C'est FAUX car 19 est sur une AUTRE ligne!

=== RÈGLE: DEUX COLONNES ADJACENTES ===

Sur une même ligne, s'il y a DEUX groupes de 2 chiffres côte à côte:
- Le PREMIER groupe = col2
- Le SECOND groupe = col3

Exemple: "15 00" sur la même ligne → col2=15, col3=00

⚠️ RÈGLE CRITIQUE: IGNORER LE CHIFFRE D'ALIGNEMENT ⚠️

Certaines lignes contiennent un chiffre JUSTE AVANT la Position SH (1, 3, 4, 5, 7, 8...).
Ce chiffre est un REPÈRE D'ALIGNEMENT et NE FAIT PAS PARTIE DU CODE SH.
IL FAUT L'IGNORER COMPLÈTEMENT.

=== RÈGLES D'HÉRITAGE (CARRY-FORWARD) ===

Les tableaux sont hiérarchiques. Tu DOIS maintenir l'héritage:
- Si position_6 est vide sur cette ligne → hériter de la ligne précédente
- Si col2 est vide sur cette ligne → hériter de la ligne précédente
- Si col3 est vide sur cette ligne → utiliser "00" par défaut OU hériter si la ligne parente existe

=== EXTRACTION DES NOTES (TRÈS IMPORTANT) ===

EXTRAIRE TOUTES les notes présentes sur la page:
1. Notes numérotées: "1. Le présent Chapitre ne comprend pas : a) les mammifères..."
2. Notes complémentaires: "Note complémentaire : Les autorités compétentes..."
3. Définitions: "Dans le présent Chapitre, l'expression «X» désigne..."
4. Exclusions: "Ce chapitre ne couvre pas..."
5. Notes de bas de page avec (a), (b), (1), (2)

Types de notes acceptés: "chapter_note", "section_note", "definition", "exclusion", "footnote", "remark"

=== FORMAT JSON STRICT ===

{
  "page_number": ${pageNumber},
  "has_tariff_table": true,
  "raw_lines": [
    {
      "prefix_col": "8",
      "position_6": "8903.11",
      "col2": "10",
      "col3": "00",
      "national_code": "8903111000",
      "hs_code_6": "890311",
      "description": "Description du produit",
      "duty_rate": "2,5",
      "unit_norm": "u",
      "unit_comp": "N"
    }
  ],
  "notes": [
    {
      "note_type": "chapter_note",
      "anchor": "1",
      "note_text": "1. Le présent Chapitre ne comprend pas : a) les mammifères du n° 01.06 ; b) les viandes...",
      "page_number": ${pageNumber}
    },
    {
      "note_type": "definition",
      "anchor": "agglomérés",
      "note_text": "Dans le présent Chapitre, l'expression «agglomérés sous forme de pellets» désigne les produits présentés sous forme de cylindres...",
      "page_number": ${pageNumber}
    }
  ]
}

Si la page ne contient PAS de tableau tarifaire (que du texte/notes):
{
  "page_number": ${pageNumber},
  "has_tariff_table": false,
  "raw_lines": [],
  "notes": [... toutes les notes de la page ...]
}

RAPPEL: col2 est la sous-position (variable), col3 est le détail national (souvent 00).
IMPORTANT: Extraire TOUTES les notes textuelles même si la page n'a pas de tableau.
RÉPONDS UNIQUEMENT AVEC LE JSON, RIEN D'AUTRE.`;

// =============================================================================
// PROCESS RAW LINES
// =============================================================================

function processRawLines(rawLines: RawTariffLine[]): { tariffLines: TariffLine[]; debug: RawTableDebug } {
  const results: TariffLine[] = [];
  const debug: RawTableDebug = {
    detectedSwaps: 0,
    swappedSamples: [],
    parsingWarnings: [],
    skippedLines: 0,
    notesCount: 0,
    linesFromFallback: 0,
    swappedCol2Col3Count: 0,
    swappedCol2Col3Samples: []
  };
  
  // Contexte pour la résolution col2/col3
  const col2Col3Ctx: Col2Col3Context = {
    lastCol2: null,
    lastCol3: null,
    pos6Col2Counts: new Map()
  };
  
  let lastPos6: string | null = null;
  
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    
    if (line.position_6 && isReservedCode(line.position_6)) {
      debug.parsingWarnings.push(`Line ${i}: Reserved code [${line.position_6}] ignored`);
      debug.skippedLines++;
      continue;
    }
    
    let pos6: string | null = null;
    
    if (line.position_6) {
      const cleaned = line.position_6.replace(/[\.\-\s]/g, "");
      const digits = digitsOnly(cleaned);
      if (digits.length === 6) {
        pos6 = digits;
      } else if (digits.length === 4) {
        pos6 = digits + "00";
      }
    }
    
    if (!pos6 && line.national_code) {
      const nc = normalize10Strict(line.national_code);
      if (nc) pos6 = nc.slice(0, 6);
    }
    
    if (!pos6 && lastPos6) pos6 = lastPos6;
    
    if (!pos6) {
      debug.parsingWarnings.push(`Line ${i}: No valid position_6, skipped`);
      debug.skippedLines++;
      continue;
    }
    
    if (line.position_6) lastPos6 = pos6;
    
    // =========================================================================
    // RÉSOLUTION COL2/COL3 AVEC SCORING DÉTERMINISTE
    // BUG FIX: Appliquer resolveCol2Col3 MÊME si national_code est fourni
    // =========================================================================
    
    let col2: string | null = null;
    let col3: string | null = null;
    let nationalCode: string | null = null;
    
    // Extraire depuis national_code si fourni
    const ncFromLine = normalize10Strict(line.national_code);
    const col2FromNc = ncFromLine ? ncFromLine.slice(6, 8) : null;
    const col3FromNc = ncFromLine ? ncFromLine.slice(8, 10) : null;
    
    // SÉCURITÉ: Vérifier cohérence pos6 vs national_code fourni
    if (ncFromLine && ncFromLine.slice(0, 6) !== pos6) {
      debug.parsingWarnings.push(`Line ${i}: national_code prefix "${ncFromLine.slice(0, 6)}" differs from pos6 "${pos6}", using pos6`);
    }
    
    // Choisir les candidats: priorité aux colonnes brutes, sinon depuis national_code
    const candA = normalize2Strict(line.col2) ?? col2FromNc;
    const candB = normalize2Strict(line.col3) ?? col3FromNc;
    
    // TOUJOURS passer par resolveCol2Col3 dès qu'on a 2 blocs de 2 digits
    if (candA && candB) {
      const resolution = resolveCol2Col3(pos6, candA, candB, col2Col3Ctx);
      
      if (resolution) {
        col2 = resolution.col2;
        col3 = resolution.col3;
        // IMPORTANT: Reconstruire nationalCode depuis pos6 + résolution
        nationalCode = pos6 + col2 + col3;
        
        if (resolution.swapApplied) {
          debug.swappedCol2Col3Count++;
          if (debug.swappedCol2Col3Samples.length < 15) {
            const source = ncFromLine ? "from_nc" : "from_cols";
            debug.swappedCol2Col3Samples.push({
              pos6,
              original: { col2: candA, col3: candB },
              resolved: { col2, col3 },
              reason: `${resolution.reason} [${source}]`
            });
          }
          const source = ncFromLine ? "[NC]" : "[COL]";
          console.log(`[COL-SWAP] ${source} pos6=${pos6} | "${candA},${candB}" -> "${col2},${col3}" | ${resolution.reason}`);
        }
      } else {
        // Résolution a retourné null (ex: digits invalides) -> utiliser tels quels
        col2 = candA;
        col3 = candB;
        nationalCode = pos6 + col2 + col3;
      }
    } else {
      // Fallback: héritage classique si pas assez de données
      col2 = candA ?? (col2Col3Ctx.lastCol2 || null);
      col3 = candB ?? (col2Col3Ctx.lastCol3 || null);
      
      if (col2 && col3) {
        nationalCode = pos6 + col2 + col3;
        debug.linesFromFallback++;
      }
    }
    
    // Validation finale du national_code
    if (!nationalCode || nationalCode.length !== 10 || !/^\d{10}$/.test(nationalCode)) {
      debug.parsingWarnings.push(`Line ${i}: Invalid national_code "${nationalCode}", skipped (NO PADDING)`);
      debug.skippedLines++;
      continue;
    }
    
    const { duty_rate, unit_norm, swapped } = fixRateUnitSwap(line, debug);
    
    if (duty_rate === null) {
      // Mettre à jour le contexte même si on skip cette ligne
      if (pos6) lastPos6 = pos6;
      if (col2) {
        col2Col3Ctx.lastCol2 = col2;
        updateCol2Stats(col2Col3Ctx, pos6, col2);
      }
      if (col3) col2Col3Ctx.lastCol3 = col3;
      continue;
    }
    
    const dutyNote = extractDutyNote(line.duty_rate ?? null);
    const hsCode6 = nationalCode.slice(0, 6);
    
    results.push({
      national_code: nationalCode,
      hs_code_6: hsCode6,
      description: (line.description || "").replace(/^[–\-\s]+/, "").trim(),
      duty_rate: duty_rate,
      duty_note: dutyNote,
      unit_norm: unit_norm,
      unit_comp: line.unit_comp || null,
      is_inherited: swapped || !line.national_code,
      page_number: line.page_number || null
    });
    
    // Mettre à jour le contexte après validation
    lastPos6 = pos6;
    col2Col3Ctx.lastCol2 = col2;
    col2Col3Ctx.lastCol3 = col3;
    if (col2) updateCol2Stats(col2Col3Ctx, pos6, col2);
  }
  
  // Log récapitulatif des swaps col2/col3
  if (debug.swappedCol2Col3Count > 0) {
    console.log(`[COL-SWAP-SUMMARY] Total: ${debug.swappedCol2Col3Count} swaps applied`);
  }
  
  return { tariffLines: results, debug };
}

// =============================================================================
// EXTRACTION DES HS CODES DEPUIS TARIFF LINES
// =============================================================================

function extractHSCodesFromTariffLines(tariffLines: TariffLine[]): HSCodeEntry[] {
  const seen = new Set<string>();
  const results: HSCodeEntry[] = [];
  const descriptionMap = new Map<string, string>();
  
  for (const line of tariffLines) {
    const code6 = line.hs_code_6;
    if (code6 && isValidCleanCode(code6)) {
      if (!descriptionMap.has(code6) && line.description) {
        descriptionMap.set(code6, line.description);
      }
      if (!seen.has(code6)) {
        seen.add(code6);
        results.push({
          code: `${code6.slice(0, 4)}.${code6.slice(4, 6)}`,
          code_clean: code6,
          description: descriptionMap.get(code6) || line.description,
          level: "subheading"
        });
      }
    }
  }
  
  return results;
}

// =============================================================================
// DÉTECTION PAGE TARIFAIRE (FILTRAGE INTELLIGENT)
// =============================================================================

const TARIFF_PAGE_MARKERS = [
  /TARIF\s+DES\s+DROITS/i,
  /Codification/i,
  /Position/i,
  /Désignation\s+des\s+produits/i,
  /\b\d{4}\.\d{2}\b/,  // Pattern XX.XX.XX
  /\b\d{4}\.\d{2}\s+\d{2}\s+\d{2}\b/,  // Pattern complet
  /Droit\s+d['']importation/i,
  /Unité/i
];

function pageContainsTariffTable(pageText: string): boolean {
  if (!pageText || pageText.length < 50) return false;
  
  let matchCount = 0;
  for (const marker of TARIFF_PAGE_MARKERS) {
    if (marker.test(pageText)) matchCount++;
  }
  
  // Au moins 2 marqueurs = probablement une page tarifaire
  return matchCount >= 2;
}

// =============================================================================
// GÉNÉRATION DE RÉSUMÉ DU DOCUMENT
// =============================================================================

const SUMMARY_CACHE = new Map<string, string>();

async function generateDocumentSummary(
  base64Pdf: string,
  title: string,
  apiKey: string,
  pdfId: string
): Promise<string> {
  // Vérifier le cache
  if (SUMMARY_CACHE.has(pdfId)) {
    return SUMMARY_CACHE.get(pdfId)!;
  }
  
  console.log("[Summary] Generating document summary...");
  
  const requestBody = {
    model: CLAUDE_MODEL,
    max_tokens: 1000,
    system: "Tu es un expert en tarifs douaniers. Génère des résumés concis et informatifs en français.",
    messages: [{
      role: "user",
      content: [
        { 
          type: "document", 
          source: { type: "base64", media_type: "application/pdf", data: base64Pdf },
        },
        { 
          type: "text", 
          text: `Analyse ce document tarifaire douanier "${title}" et génère un résumé structuré.

Inclure:
1. Le numéro et titre du chapitre (ex: "Chapitre 3 - Poissons et crustacés")
2. Une description générale du contenu (2-3 phrases)
3. Les principales catégories de produits couverts
4. Les notes importantes ou exceptions à retenir
5. La fourchette approximative des droits de douane

Format de réponse (texte brut, pas JSON):
**Chapitre X - [Titre]**
[Description générale]

**Produits couverts:** [liste]

**Notes importantes:** [résumé des notes clés]

**Droits de douane:** [fourchette en %]`
        }
      ]
    }],
  };
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s max
    
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn("[Summary] API error, skipping summary generation");
      return "";
    }
    
    const data = await response.json();
    const summary = data.content?.[0]?.text || "";
    
    if (summary.length > 50) {
      console.log(`[Summary] Generated summary (${summary.length} chars)`);
      SUMMARY_CACHE.set(pdfId, summary);
      return summary;
    }
    
    return "";
    
  } catch (err: any) {
    console.warn("[Summary] Error:", err.message);
    return "";
  }
}

// =============================================================================
// DÉTECTION DU NOMBRE DE PAGES VIA CLAUDE (appel léger)
// =============================================================================

async function detectPdfPageCount(
  base64Pdf: string,
  apiKey: string,
  pdfId: string
): Promise<number> {
  // Vérifier le cache
  if (PAGE_COUNT_CACHE.has(pdfId)) {
    return PAGE_COUNT_CACHE.get(pdfId)!;
  }
  
  console.log("[Page Detection] Calling Claude to detect page count...");
  
  const requestBody = {
    model: CLAUDE_MODEL,
    max_tokens: 100,
    system: "Réponds uniquement avec un nombre entier.",
    messages: [{
      role: "user",
      content: [
        { 
          type: "document", 
          source: { type: "base64", media_type: "application/pdf", data: base64Pdf },
        },
        { type: "text", text: "Combien de pages contient ce document PDF ? Réponds UNIQUEMENT avec le nombre (ex: 27)." }
      ]
    }],
  };
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s max
    
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn("[Page Detection] API error, using fallback estimation");
      return 0; // Retourne 0 pour signaler l'utilisation du fallback
    }
    
    const data = await response.json();
    const responseText = data.content?.[0]?.text || "";
    
    // Extraire le nombre
    const match = responseText.match(/\d+/);
    if (match) {
      const pageCount = parseInt(match[0], 10);
      if (pageCount > 0 && pageCount < 5000) {
        console.log(`[Page Detection] Detected ${pageCount} pages`);
        PAGE_COUNT_CACHE.set(pdfId, pageCount);
        return pageCount;
      }
    }
    
    console.warn("[Page Detection] Could not parse response, using fallback");
    return 0;
    
  } catch (err: any) {
    console.warn("[Page Detection] Error:", err.message);
    return 0;
  }
}

// =============================================================================
// PRÉ-ANALYSE LÉGÈRE: Scan rapide pour détecter pages tarifaires
// =============================================================================

async function scanPagesForTariffContent(
  base64Pdf: string,
  startPage: number,
  endPage: number,
  apiKey: string
): Promise<{ tariffPages: number[]; textPages: number[] }> {
  console.log(`[Page Scan] Quick scan pages ${startPage}-${endPage} for content type...`);
  
  const requestBody = {
    model: CLAUDE_MODEL,
    max_tokens: 500,
    system: "Tu analyses des PDF tarifaires. Réponds en JSON uniquement.",
    messages: [{
      role: "user",
      content: [
        { 
          type: "document", 
          source: { type: "base64", media_type: "application/pdf", data: base64Pdf },
        },
        { 
          type: "text", 
          text: `Analyse les pages ${startPage} à ${endPage} de ce PDF.
Pour chaque page, détermine si elle contient:
- Un TABLEAU TARIFAIRE (colonnes avec codes SH, descriptions, taux)
- Du TEXTE/NOTES (notes de chapitre, définitions, introductions)

Réponds UNIQUEMENT avec ce JSON:
{
  "tariff_pages": [${startPage}, ...],  
  "text_pages": [...]
}

Pages avec tableau tarifaire = ont des colonnes de codes (XXXX.XX XX XX), descriptions produits, taux en %.
Pages texte = notes de chapitre, définitions, introductions, index.
IMPORTANT: Inclure TOUTES les pages dans l'une des deux catégories.`
        }
      ]
    }],
  };
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);
    
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn("[Page Scan] API error, processing all pages as tariff");
      // Fallback: traiter toutes les pages
      const allPages: number[] = [];
      for (let i = startPage; i <= endPage; i++) allPages.push(i);
      return { tariffPages: allPages, textPages: [] };
    }
    
    const data = await response.json();
    let responseText = data.content?.[0]?.text || "{}";
    
    // Nettoyer le JSON
    if (responseText.includes("```json")) {
      const jsonStart = responseText.indexOf("```json") + 7;
      const jsonEnd = responseText.indexOf("```", jsonStart);
      if (jsonEnd > jsonStart) responseText = responseText.slice(jsonStart, jsonEnd).trim();
    }
    
    const parsed = parseJsonRobust(responseText);
    
    if (parsed && Array.isArray(parsed.tariff_pages)) {
      const tariffPages = parsed.tariff_pages.filter((p: any) => 
        typeof p === 'number' && p >= startPage && p <= endPage
      );
      const textPages = (parsed.text_pages || parsed.text_only_pages || []).filter((p: any) => 
        typeof p === 'number' && p >= startPage && p <= endPage
      );
      
      console.log(`[Page Scan] Found ${tariffPages.length} tariff pages, ${textPages.length} text pages`);
      
      return { 
        tariffPages, 
        textPages 
      };
    }
    
    // Fallback si parsing échoue
    const allPages: number[] = [];
    for (let i = startPage; i <= endPage; i++) allPages.push(i);
    return { tariffPages: allPages, textPages: [] };
    
  } catch (err: any) {
    console.warn("[Page Scan] Error:", err.message);
    const allPages: number[] = [];
    for (let i = startPage; i <= endPage; i++) allPages.push(i);
    return { tariffPages: allPages, textPages: [] };
  }
}

// =============================================================================
// PARSE JSON ROBUSTE
// =============================================================================

/**
 * Parse JSON using resilient parser with fallback
 */
function parseJsonRobust(text: string): any | null {
  const result = parseJsonResilient(text);
  if (result.success && result.data) {
    if (result.partial) {
      safeLog("warn", "analyze-pdf", "JSON parsed with fallback", { 
        recoveredFields: result.recoveredFields?.slice(0, 5) 
      });
    }
    return result.data;
  }
  return null;
}

// =============================================================================
// FALLBACK: Convertir ancien format col1..col5 vers RawTariffLine
// =============================================================================

function convertLegacyToRawTariffLine(legacy: any, pageNumber?: number): RawTariffLine | null {
  if (!legacy) return null;
  
  // Ancien format col1..col5
  if (legacy.col1 !== undefined) {
    const col1 = String(legacy.col1 || "").trim();
    const col2 = String(legacy.col2 || "").trim();
    const col3 = String(legacy.col3 || "").trim();
    const col4 = String(legacy.col4 || "").trim();
    const col5 = String(legacy.col5 || "").trim();
    
    // Détecter si col1 est un préfixe numérique (1 chiffre avant la position)
    let prefixCol: string | null = null;
    let position6: string | null = null;
    
    if (/^\d$/.test(col1) && /^\d{4}(\.\d{2})?$/.test(col2)) {
      // col1 = préfixe, col2 = position
      prefixCol = col1;
      position6 = col2;
    } else if (/^\d{4}(\.\d{2})?$/.test(col1) || /^\d{6}$/.test(col1)) {
      position6 = col1;
    }
    
    // Trouver description (champ texte le plus long)
    const textFields = [col3, col4, col5, legacy.description || ""];
    const description = textFields.reduce((a, b) => 
      (String(a).length > String(b).length) ? a : b, ""
    );
    
    // Trouver duty et unit
    let dutyRate: string | number | null = null;
    let unitNorm: string | null = null;
    let unitComp: string | null = null;
    
    for (const field of [col4, col5, legacy.duty_rate]) {
      if (isNumberLike(field) && dutyRate === null) dutyRate = field;
      else if (isUnit(field) && unitNorm === null) unitNorm = String(field);
    }
    
    if (legacy.unit_norm) unitNorm = String(legacy.unit_norm);
    if (legacy.unit_comp) unitComp = String(legacy.unit_comp);
    
    return {
      prefix_col: prefixCol,
      position_6: position6,
      col2: normalize2Strict(legacy.col6 || null),
      col3: normalize2Strict(legacy.col7 || null),
      national_code: normalize10Strict(digitsOnly(col1 + col2 + col3)),
      description,
      duty_rate: dutyRate,
      unit_norm: unitNorm,
      unit_comp: unitComp,
      page_number: pageNumber
    };
  }
  
  // Déjà au bon format
  return {
    ...legacy,
    page_number: legacy.page_number || pageNumber
  } as RawTariffLine;
}

// =============================================================================
// FALLBACK: Extraction agressive des lignes depuis texte brut
// =============================================================================

function extractRawLinesAggressively(text: string, pageNumber?: number): RawTariffLine[] {
  const results: RawTariffLine[] = [];
  
  // Pattern pour détecter les lignes tarifaires
  // Format: [préfixe?] XXXX.XX [XX] [XX] [description] [taux] [unité]
  const linePattern = /^(?:(\d)\s+)?(\d{4}[.\s]\d{2})\s+(\d{2})?\s*(\d{2})?\s+(.+?)(?:\s+(\d+(?:[,.]\d+)?%?)\s*([A-Za-z]{1,5}\d{0,2})?)?$/gm;
  
  let match;
  while ((match = linePattern.exec(text)) !== null) {
    const [, prefix, pos6, col2, col3, desc, rate, unit] = match;
    
    results.push({
      prefix_col: prefix || null,
      position_6: pos6?.replace(/\s/g, ""),
      col2: col2 || null,
      col3: col3 || null,
      description: desc?.trim() || null,
      duty_rate: rate || null,
      unit_norm: unit || null,
      page_number: pageNumber
    });
  }
  
  return results;
}

// =============================================================================
// NOTES: Extraction heuristique depuis texte
// =============================================================================

function extractNotesFromText(text: string, pageNumber?: number): ExtractedNote[] {
  const notes: ExtractedNote[] = [];
  const seen = new Set<string>();
  
  // Helper pour éviter les doublons
  const addNote = (note: ExtractedNote) => {
    const key = `${note.note_type}:${note.note_text.slice(0, 50)}`;
    if (!seen.has(key) && note.note_text.length > 15) {
      seen.add(key);
      notes.push(note);
    }
  };
  
  // 1. Notes numérotées au format "1. Le présent chapitre ne comprend pas..."
  const numberedNotePattern = /\b(\d+)\.\s+([A-Z](?:[^.]+\.){0,5}[^.]+\.)/g;
  let match;
  while ((match = numberedNotePattern.exec(text)) !== null) {
    const noteNum = match[1];
    const noteContent = match[2].trim();
    if (noteContent.length > 30 && noteContent.length < 2000) {
      addNote({
        note_type: "chapter_note",
        anchor: noteNum,
        note_text: `${noteNum}. ${noteContent}`,
        page_number: pageNumber
      });
    }
  }
  
  // 2. Définitions (BRT : ..., TVA : ...)
  const defPattern = /\b([A-Z]{2,8})\s*:\s*([^.\n]{10,200})/g;
  while ((match = defPattern.exec(text)) !== null) {
    addNote({
      note_type: "definition",
      anchor: match[1],
      note_text: `${match[1]} : ${match[2].trim()}`,
      page_number: pageNumber
    });
  }
  
  // 3. Notes de chapitre/section explicites
  const noteHeaderPattern = /(Notes?\s*(?:de\s+)?(?:chapitre|section|complémentaires?)?)\s*[:\-]?\s*((?:[^.\n]+\.?\s*)+)/gi;
  while ((match = noteHeaderPattern.exec(text)) !== null) {
    const header = match[1].trim();
    const content = match[2].trim();
    if (content.length > 20 && content.length < 1500) {
      const noteType = header.toLowerCase().includes("complémentaire") 
        ? "section_note" 
        : header.toLowerCase().includes("chapitre") 
          ? "chapter_note" 
          : "section_note";
      addNote({
        note_type: noteType,
        note_text: content,
        page_number: pageNumber
      });
    }
  }
  
  // 4. Footnotes (a), (b), (1), (2)
  const footnotePattern = /\(([a-z1-9])\)\s*([^()]{10,300})/g;
  while ((match = footnotePattern.exec(text)) !== null) {
    addNote({
      note_type: "footnote",
      anchor: `(${match[1]})`,
      note_text: match[2].trim(),
      page_number: pageNumber
    });
  }
  
  // 5. Exclusions explicites "ne comprend pas"
  const exclusionPattern = /((?:ne\s+comprend\s+pas|ne\s+couvre\s+pas)[^.]+\.)/gi;
  while ((match = exclusionPattern.exec(text)) !== null) {
    addNote({
      note_type: "exclusion",
      note_text: match[1].trim(),
      page_number: pageNumber
    });
  }
  
  // 6. Expressions désignent "l'expression ... désigne"
  const expressionPattern = /(l'expression\s*["«]([^"»]+)["»]\s*désigne[^.]+\.)/gi;
  while ((match = expressionPattern.exec(text)) !== null) {
    addNote({
      note_type: "definition",
      anchor: match[2]?.trim(),
      note_text: match[1].trim(),
      page_number: pageNumber
    });
  }
  
  return notes;
}

// =============================================================================
// DETECTION DES CIRCULAIRES DANS LES NOTES
// =============================================================================

function extractCircularReferences(notes: ExtractedNote[]): CircularReference[] {
  const refs: CircularReference[] = [];
  const seen = new Set<string>();
  
  // Pattern: "circulaire n° XXXX" ou "circulaire ADII n° XXXX"
  const circularPattern = /circulaire\s+(?:(ADII|ASMEX|DGDI)\s+)?n[°o]?\s*(\d{3,6}(?:\/\d{2,4})?)/gi;
  // Pattern pour détecter les codes HS associés
  const hsPattern = /\b(\d{4}(?:\.\d{2}){1,2})\b/g;
  
  for (const note of notes) {
    const text = note.note_text;
    let match;
    
    while ((match = circularPattern.exec(text)) !== null) {
      const issuer = match[1] || "ADII";
      const ref = match[2];
      const key = `circular:${ref}`;
      
      if (!seen.has(key)) {
        seen.add(key);
        
        // Chercher les codes HS mentionnés dans cette note
        const relatedHsCodes: string[] = [];
        let hsMatch;
        while ((hsMatch = hsPattern.exec(text)) !== null) {
          relatedHsCodes.push(hsMatch[1].replace(/\./g, ""));
        }
        
        refs.push({
          source_type: "circular",
          source_ref: ref,
          title: `Circulaire ${issuer} n° ${ref}`,
          issuer,
          related_hs_codes: relatedHsCodes,
          note_text: text
        });
      }
    }
  }
  
  return refs;
}

async function analyzePageWithClaude(
  base64Pdf: string,
  pageNumber: number,
  totalPages: number,
  title: string,
  apiKey: string,
  retryCount = 0
): Promise<{ raw_lines: RawTariffLine[]; notes: ExtractedNote[]; has_tariff_table: boolean; error?: string }> {
  const MAX_RETRIES = 3;
  const BASE_DELAY = 3000;
  
  const prompt = getPageTariffPrompt(title, pageNumber, totalPages);
  
  console.log(`[Page ${pageNumber}/${totalPages}] Analyzing...`);
  
  const requestBody = {
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system: "Tu es un expert en tarifs douaniers. Analyse cette page et retourne les données en JSON structuré.",
    messages: [{
      role: "user",
      content: [
        { 
          type: "document", 
          source: { type: "base64", media_type: "application/pdf", data: base64Pdf },
          // Claude native PDF: spécifier la page
          cache_control: { type: "ephemeral" }
        },
        { type: "text", text: `ANALYSE UNIQUEMENT LA PAGE ${pageNumber}.\n\n${prompt}` }
      ]
    }],
  };
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min par page
  
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.status === 429 || response.status === 529) {
      if (retryCount < MAX_RETRIES) {
        const retryAfter = response.headers.get("Retry-After");
        const delayMs = retryAfter ? parseInt(retryAfter) * 1000 : BASE_DELAY * Math.pow(2, retryCount);
        console.log(`[Page ${pageNumber}] Rate limited, retry ${retryCount + 1}/${MAX_RETRIES} after ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
        return analyzePageWithClaude(base64Pdf, pageNumber, totalPages, title, apiKey, retryCount + 1);
      }
      return { raw_lines: [], notes: [], has_tariff_table: false, error: "Rate limit exceeded" };
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Page ${pageNumber}] Claude error: ${response.status}`);
      return { raw_lines: [], notes: [], has_tariff_table: false, error: `HTTP ${response.status}` };
    }
    
    const data = await response.json();
    const responseText = data.content?.[0]?.text || "{}";
    
    let cleanedResponse = responseText.trim();
    if (cleanedResponse.includes("```json")) {
      const jsonStart = cleanedResponse.indexOf("```json") + 7;
      const jsonEnd = cleanedResponse.indexOf("```", jsonStart);
      if (jsonEnd > jsonStart) cleanedResponse = cleanedResponse.slice(jsonStart, jsonEnd).trim();
    }
    
    const parsed = parseJsonRobust(cleanedResponse);
    
    if (!parsed) {
      console.warn(`[Page ${pageNumber}] Failed to parse JSON, trying fallback extraction`);
      // Fallback: extraction agressive depuis le texte brut
      const fallbackLines = extractRawLinesAggressively(responseText, pageNumber);
      const fallbackNotes = extractNotesFromText(responseText, pageNumber);
      console.log(`[Page ${pageNumber}] Fallback: ${fallbackLines.length} lines, ${fallbackNotes.length} notes`);
      return { 
        raw_lines: fallbackLines, 
        notes: fallbackNotes, 
        has_tariff_table: fallbackLines.length > 0, 
        error: "JSON parse failed, used fallback" 
      };
    }
    
    // Convertir les lignes (support ancien format col1..col5)
    let rawLines: RawTariffLine[] = [];
    if (Array.isArray(parsed.raw_lines)) {
      rawLines = parsed.raw_lines.map((line: any) => {
        // Si ancien format col1..col5, convertir
        if (line.col1 !== undefined && line.position_6 === undefined) {
          return convertLegacyToRawTariffLine(line, pageNumber);
        }
        // Ajouter page_number
        return { ...line, page_number: line.page_number || pageNumber } as RawTariffLine;
      }).filter(Boolean) as RawTariffLine[];
    }
    
    // Notes depuis la réponse LLM
    let notes: ExtractedNote[] = (parsed.notes || []).map((n: any) => ({
      note_type: n.note_type || "remark",
      anchor: n.anchor || undefined,
      note_text: n.note_text || "",
      page_number: pageNumber
    }));
    
    // Fallback heuristique pour les notes si aucune trouvée
    if (notes.length === 0) {
      notes = extractNotesFromText(responseText, pageNumber);
    }
    
    const hasTariffTable = parsed.has_tariff_table !== false && rawLines.length > 0;
    
    console.log(`[Page ${pageNumber}] Found ${rawLines.length} lines, ${notes.length} notes, tariff=${hasTariffTable}`);
    
    return { raw_lines: rawLines, notes, has_tariff_table: hasTariffTable };
    
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.error(`[Page ${pageNumber}] Error:`, err.message);
    
    if (err.name === 'AbortError') {
      return { raw_lines: [], notes: [], has_tariff_table: false, error: "Timeout" };
    }
    
    if (retryCount < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, BASE_DELAY));
      return analyzePageWithClaude(base64Pdf, pageNumber, totalPages, title, apiKey, retryCount + 1);
    }
    
    return { raw_lines: [], notes: [], has_tariff_table: false, error: err.message };
  }
}

// =============================================================================
// HELPER: Delay
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }
  
  const logger = createLogger("analyze-pdf-batch", req);
  const corsHeaders = getCorsHeaders(req);
  
  // ==========================================================================
  // AUTHENTICATION CHECK (Production)
  // ==========================================================================
  if (isProductionMode()) {
    const authResult = await requireAuth(req, corsHeaders);
    if (authResult.error) {
      safeLog("warn", "analyze-pdf", "Unauthorized request blocked", {
        clientId: getClientId(req),
      });
      return authResult.error;
    }
    safeLog("info", "analyze-pdf", "Authenticated request", {
      userId: authResult.auth?.userId,
    });
  }
  
  // Initialize observability metrics
  let metrics: ObservabilityMetrics | null = null;
  
  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return errorResponse(req, "ANTHROPIC_API_KEY manquante", 500);
    }
    
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return errorResponse(req, "Configuration Supabase manquante", 500);
    }
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    
    // Rate limiting
    const clientId = getClientId(req);
    const rateLimitResult = await checkRateLimitDistributed(clientId, {
      maxRequests: 30,
      windowMs: 60000,
      blockDurationMs: 120000,
    });
    
    if (!rateLimitResult.allowed) {
      return rateLimitResponse(req, rateLimitResult.resetAt);
    }
    
    // Parse body
    const body = await req.json() as BatchRequest;
    const { 
      pdfId, 
      filePath,
      previewOnly = false,
      start_page = 1,
      max_pages = DEFAULT_BATCH_SIZE,
      extraction_run_id = null
    } = body;
    
    if (!pdfId) {
      return errorResponse(req, "pdfId est requis", 400);
    }
    
    // Initialize metrics with run_id
    metrics = createMetrics(extraction_run_id || pdfId);
    
    const batchSize = Math.min(Math.max(max_pages, MIN_BATCH_SIZE), MAX_BATCH_SIZE);
    
    // Use masked logging for sensitive data
    safeLog("info", "analyze-pdf", "Batch request started", {
      pdfId: maskSensitiveData(pdfId),
      start_page,
      batch_size: batchSize,
      run_id: extraction_run_id,
    });
    
    // Récupérer le PDF
    let pdfPath = filePath;
    if (!pdfPath) {
      const { data: pdfDoc } = await supabase
        .from("pdf_documents")
        .select("file_path")
        .eq("id", pdfId)
        .single();
      pdfPath = pdfDoc?.file_path;
    }
    
    if (!pdfPath) {
      return errorResponse(req, "Fichier PDF non trouvé", 404);
    }
    
    // Télécharger le PDF
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("pdf-documents")
      .download(pdfPath);
    
    if (downloadError || !fileData) {
      return errorResponse(req, `Erreur téléchargement PDF: ${downloadError?.message}`, 500);
    }
    
    // Convertir en base64 (chunked pour gros fichiers)
    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let base64Pdf = "";
    const CHUNK_SIZE = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const chunk = bytes.slice(i, i + CHUNK_SIZE);
      base64Pdf += String.fromCharCode(...chunk);
    }
    base64Pdf = btoa(base64Pdf);
    
    // Métadonnées PDF
    const { data: pdfDoc } = await supabase
      .from("pdf_documents")
      .select("title, category, country_code")
      .eq("id", pdfId)
      .single();
    
    const title = pdfDoc?.title || "Tarif douanier";
    const category = pdfDoc?.category || "tarif";
    const countryCode = pdfDoc?.country_code || "MA";
    
    // Détecter le nombre réel de pages via Claude (appel léger)
    const fileSizeBytes = bytes.length;
    let totalPagesDetected = 0;
    
    // Premier appel : détecter le nombre de pages
    if (!extraction_run_id) {
      totalPagesDetected = await detectPdfPageCount(base64Pdf, ANTHROPIC_API_KEY, pdfId);
      if (totalPagesDetected === 0) {
        // Fallback: estimation basée sur la taille (~50KB par page pour PDF tarifaire)
        totalPagesDetected = Math.max(1, Math.ceil(fileSizeBytes / 50000));
        console.log(`[Fallback] Estimated ${totalPagesDetected} pages from file size ${fileSizeBytes} bytes`);
      }
    }
    
    // Générer un résumé du document au premier batch
    let documentSummary = "";
    if (!extraction_run_id && start_page === 1) {
      documentSummary = await generateDocumentSummary(base64Pdf, title, ANTHROPIC_API_KEY, pdfId);
    }
    
    console.log(`PDF size: ${fileSizeBytes} bytes, detected pages: ${totalPagesDetected || "from existing run"}, summary: ${documentSummary ? "yes" : "no"}`);
    
    // Gérer le run d'extraction
    let runId = extraction_run_id;
    let runData: any = null;
    
    if (runId) {
      // Reprendre un run existant
      const { data: existingRun } = await supabase
        .from("pdf_extraction_runs")
        .select("*")
        .eq("id", runId)
        .single();
      
      if (existingRun) {
        runData = existingRun;
        console.log(`Resuming run ${runId}: page ${runData.current_page}/${runData.total_pages || "?"}`);
      }
    }
    
    if (!runData) {
      // Créer un nouveau run avec le vrai nombre de pages
      const { data: newRun, error: createError } = await supabase
        .from("pdf_extraction_runs")
        .insert({
          pdf_id: pdfId,
          status: "processing",
          current_page: start_page,
          total_pages: totalPagesDetected,
          processed_pages: 0,
          file_name: title,
          country_code: countryCode,
          batch_size: batchSize,
          started_at: new Date().toISOString(),
          stats: {
            tariff_lines_inserted: 0,
            hs_codes_inserted: 0,
            notes_inserted: 0,
            pages_skipped: 0,
            errors: []
          }
        })
        .select()
        .single();
      
      if (createError) {
        console.error("Error creating run:", createError);
        return errorResponse(req, `Erreur création run: ${createError.message}`, 500);
      }
      
      runData = newRun;
      runId = newRun.id;
      console.log(`Created new run ${runId} with ${totalPagesDetected} pages`);
    }
    
    const stats: BatchStats = runData.stats || {
      tariff_lines_inserted: 0,
      hs_codes_inserted: 0,
      notes_inserted: 0,
      pages_skipped: 0,
      errors: []
    };
    
    const startPage = runData.current_page || start_page;
    const totalPages = runData.total_pages || totalPagesDetected;
    const endPage = Math.min(startPage + batchSize - 1, totalPages);
    
    console.log(`Processing pages ${startPage} to ${endPage} of ${totalPages}`);
    
    console.log(`Processing pages ${startPage} to ${endPage} of ${totalPages}`);
    
    // Accumulateurs pour ce batch
    let allRawLines: RawTariffLine[] = [];
    let allNotes: ExtractedNote[] = [];
    let pagesProcessed = 0;
    let pagesSkipped = 0;
    
    // Pré-scan intelligent pour identifier les pages avec tableaux tarifaires vs texte
    // NOUVELLE LOGIQUE: On analyse aussi les pages texte pour extraire les notes
    let tariffPages: number[] = [];
    let textPages: number[] = [];
    
    // Activer le pré-scan seulement si batch assez grand (>= 3 pages)
    const usePreScan = batchSize >= 3;
    
    if (usePreScan) {
      const scanResult = await scanPagesForTariffContent(
        base64Pdf,
        startPage,
        endPage,
        ANTHROPIC_API_KEY
      );
      tariffPages = scanResult.tariffPages;
      textPages = scanResult.textPages;
      
      console.log(`[Pre-scan] ${tariffPages.length} tariff pages, ${textPages.length} text pages to process`);
    } else {
      // Pas de pré-scan, traiter toutes les pages comme tarifaires
      for (let i = startPage; i <= endPage; i++) tariffPages.push(i);
    }
    
    // 1. Traitement des pages tarifaires
    for (const page of tariffPages) {
      console.log(`--- Processing TARIFF page ${page}/${totalPages} ---`);
      
      const pageResult = await analyzePageWithClaude(
        base64Pdf,
        page,
        totalPages,
        title,
        ANTHROPIC_API_KEY
      );
      
      if (pageResult.error) {
        stats.errors.push(`Page ${page}: ${pageResult.error}`);
        if (pageResult.error === "Rate limit exceeded") {
          console.warn(`Rate limit hit at page ${page}, stopping batch`);
          pagesProcessed = tariffPages.indexOf(page) + textPages.filter(p => p < page).length;
          break;
        }
      }
      
      if (pageResult.has_tariff_table && pageResult.raw_lines.length > 0) {
        allRawLines.push(...pageResult.raw_lines);
        console.log(`  -> Added ${pageResult.raw_lines.length} lines`);
      } else {
        pagesSkipped++;
        stats.pages_skipped++;
      }
      
      if (pageResult.notes.length > 0) {
        allNotes.push(...pageResult.notes);
      }
      
      pagesProcessed++;
      
      // Petite pause entre les pages pour éviter le rate limiting
      if (tariffPages.indexOf(page) < tariffPages.length - 1) {
        await delay(500);
      }
    }
    
    // 2. NOUVEAU: Traitement des pages de texte pur pour extraire les notes
    if (textPages.length > 0) {
      console.log(`--- Processing ${textPages.length} TEXT pages for notes extraction ---`);
      
      for (const page of textPages) {
        console.log(`--- Processing TEXT page ${page}/${totalPages} ---`);
        
        const pageResult = await analyzePageWithClaude(
          base64Pdf,
          page,
          totalPages,
          title,
          ANTHROPIC_API_KEY
        );
        
        if (pageResult.error) {
          stats.errors.push(`Text page ${page}: ${pageResult.error}`);
          if (pageResult.error === "Rate limit exceeded") {
            console.warn(`Rate limit hit at text page ${page}, stopping`);
            break;
          }
        }
        
        // On s'attend à ne trouver QUE des notes sur ces pages
        if (pageResult.notes.length > 0) {
          allNotes.push(...pageResult.notes);
          console.log(`  -> Extracted ${pageResult.notes.length} notes from text page`);
        }
        
        // Si des lignes tarifaires sont trouvées quand même, les inclure
        if (pageResult.raw_lines.length > 0) {
          allRawLines.push(...pageResult.raw_lines);
          console.log(`  -> Bonus: found ${pageResult.raw_lines.length} tariff lines on text page`);
        }
        
        pagesProcessed++;
        
        if (textPages.indexOf(page) < textPages.length - 1) {
          await delay(300);
        }
      }
    }
    
    console.log(`Batch complete: ${pagesProcessed} pages, ${allRawLines.length} raw lines, ${allNotes.length} notes`);
    
    // Traiter les lignes brutes
    const { tariffLines, debug } = processRawLines(allRawLines);
    const hsCodeEntries = extractHSCodesFromTariffLines(tariffLines);
    
    // Enrichir le debug
    debug.notesCount = allNotes.length;
    
    console.log(`Processed: ${tariffLines.length} valid tariff lines, ${hsCodeEntries.length} HS codes`);
    
    // Insérer les données en DB si pas en mode preview
    if (!previewOnly) {
      // Récupérer ou créer extraction_id
      let extractionId: string | null = null;
      const { data: existingExtraction } = await supabase
        .from("pdf_extractions")
        .select("id")
        .eq("pdf_id", pdfId)
        .maybeSingle();
      
      if (existingExtraction) {
        extractionId = existingExtraction.id;
      }
      
      // Insérer les lignes tarifaires avec source tracking
      if (tariffLines.length > 0) {
        const tariffRows = tariffLines.map(line => {
          // Construire source_evidence stable
          const evidence = [
            line.hs_code_6 || "",
            line.national_code?.slice(6, 8) || "",
            line.national_code?.slice(8, 10) || "",
            "|",
            line.duty_rate?.toString() || "",
            "|",
            line.unit_norm || "",
            line.unit_comp || ""
          ].filter(Boolean).join(" ").trim();
          
          return {
            country_code: countryCode,
            hs_code_6: line.hs_code_6,
            national_code: line.national_code,
            description_local: line.description,
            duty_rate: line.duty_rate,
            duty_note: line.duty_note,
            vat_rate: 20,
            unit_code: line.unit_norm || null,
            unit_complementary_code: line.unit_comp || null,
            unit_complementary_description: null,
            is_active: true,
            is_inherited: line.is_inherited,
            source: `PDF: ${title}`,
            // Source tracking fields
            source_pdf: title,
            source_page: line.page_number || null,
            source_extraction_id: extractionId ? parseInt(extractionId.split('-')[0], 16) : null,
            source_evidence: evidence,
          };
        });
        
        const { error: tariffError } = await supabase
          .from("country_tariffs")
          .upsert(tariffRows, { onConflict: "country_code,national_code" });
        
        if (tariffError) {
          console.error("Tariff insert error:", tariffError);
          stats.errors.push(`Tariff insert: ${tariffError.message}`);
        } else {
          stats.tariff_lines_inserted += tariffRows.length;
          console.log(`✅ Inserted ${tariffRows.length} tariff lines with source tracking`);
        }
      }
      
      // Insérer les codes HS depuis les lignes validées
      if (hsCodeEntries.length > 0) {
        const hsRows = hsCodeEntries.map(hsCode => ({
          code: hsCode.code,
          code_clean: hsCode.code_clean,
          description_fr: hsCode.description,
          chapter_number: parseInt(hsCode.code_clean.slice(0, 2), 10),
          is_active: true,
          level: hsCode.level,
        }));
        
        const { error: hsError } = await supabase
          .from("hs_codes")
          .upsert(hsRows, { onConflict: "code" });
        
        if (hsError) {
          console.error("HS codes insert error:", hsError);
          stats.errors.push(`HS insert: ${hsError.message}`);
        } else {
          stats.hs_codes_inserted += hsRows.length;
          console.log(`✅ Inserted/updated ${hsRows.length} HS codes from validated tariff lines`);
        }
      }
      
      // Insérer les notes dans tariff_notes avec source tracking
      if (allNotes.length > 0) {
        const chapterMatch = title.match(/chapitre\s*(\d+)/i) || title.match(/SH_CODE_(\d+)/i);
        const chapterNum = chapterMatch ? chapterMatch[1] : null;
        
        const noteRows = allNotes.map(note => ({
          country_code: countryCode,
          chapter_number: chapterNum,
          note_type: note.note_type,
          anchor: note.anchor || null,
          note_text: note.note_text,
          page_number: note.page_number || null,
          source_pdf: title,
          source_extraction_id: extractionId ? parseInt(extractionId.split('-')[0], 16) : null,
        }));
        
        const { error: noteError } = await supabase
          .from("tariff_notes")
          .insert(noteRows);
        
        if (noteError) {
          console.error("Notes insert error:", noteError);
          stats.errors.push(`Notes insert: ${noteError.message}`);
        } else {
          stats.notes_inserted += noteRows.length;
          console.log(`✅ Inserted ${noteRows.length} notes with source tracking`);
        }
      }
      
      // Détecter et insérer les circulaires mentionnées
      const circularRefs = extractCircularReferences(allNotes);
      if (circularRefs.length > 0) {
        console.log(`Found ${circularRefs.length} circular references in notes`);
        
        for (const circRef of circularRefs) {
          // Insérer dans legal_sources
          const { data: legalSource, error: legalError } = await supabase
            .from("legal_sources")
            .upsert({
              country_code: countryCode,
              source_type: circRef.source_type,
              source_ref: circRef.source_ref,
              title: circRef.title,
              issuer: circRef.issuer,
              excerpt: circRef.note_text.slice(0, 500),
            }, { onConflict: "country_code,source_type,source_ref" })
            .select("id")
            .single();
          
          if (legalError) {
            console.error("Legal source insert error:", legalError);
          } else if (legalSource && circRef.related_hs_codes.length > 0) {
            // Insérer les liens hs_evidence
            const evidenceRows = circRef.related_hs_codes.map(hsCode => ({
              country_code: countryCode,
              national_code: hsCode.padEnd(10, "0"),
              hs_code_6: hsCode.slice(0, 6),
              source_id: legalSource.id,
              evidence_text: circRef.note_text.slice(0, 300),
              confidence: "high",
            }));
            
            const { error: evidenceError } = await supabase
              .from("hs_evidence")
              .insert(evidenceRows);
            
            if (evidenceError) {
              console.error("HS evidence insert error:", evidenceError);
            } else {
              console.log(`✅ Linked ${evidenceRows.length} HS codes to legal source ${circRef.source_ref}`);
            }
          }
        }
      }
    }
    
    // Calculer la progression
    const nextPage = startPage + pagesProcessed;
    const isDone = nextPage > totalPages;
    const newProcessedPages = (runData.processed_pages || 0) + pagesProcessed;
    
    // Mettre à jour le run
    const { error: updateError } = await supabase
      .from("pdf_extraction_runs")
      .update({
        status: isDone ? "done" : "processing",
        current_page: isDone ? totalPages : nextPage,
        processed_pages: newProcessedPages,
        stats: stats,
        completed_at: isDone ? new Date().toISOString() : null,
      })
      .eq("id", runId);
    
    if (updateError) {
      console.error("Run update error:", updateError);
    }
    
    // Mettre à jour pdf_extractions si terminé
    if (isDone && !previewOnly) {
      // Vérifier si une extraction existe déjà
      const { data: existingExtraction } = await supabase
        .from("pdf_extractions")
        .select("id")
        .eq("pdf_id", pdfId)
        .maybeSingle();
      
      // Construire notes_text pour RAG
      const notesText = allNotes.map(n => n.note_text).join("\n\n");
      
      // Enrichir les tariff_lines avec source info
      const enrichedTariffLines = tariffLines.map(line => ({
        ...line,
        source_pdf: title,
        source_page: line.page_number,
        source_extraction_id: runId,
        source_evidence: [
          line.hs_code_6 || "",
          line.national_code?.slice(6, 8) || "",
          line.national_code?.slice(8, 10) || "",
          "|",
          line.duty_rate?.toString() || "",
          "|",
          line.unit_norm || "",
          line.unit_comp || ""
        ].filter(Boolean).join(" ").trim()
      }));
      
      // Enrichir les notes avec source info
      const enrichedNotes = allNotes.map(note => ({
        ...note,
        source_pdf: title,
        source_extraction_id: runId
      }));
      
      const extractionData = {
        pdf_id: pdfId,
        summary: `Extraction batch terminée: ${stats.tariff_lines_inserted} lignes tarifaires, ${stats.hs_codes_inserted} codes HS, ${stats.notes_inserted} notes`,
        key_points: [
          `Total pages: ${totalPages}`,
          `Pages traitées: ${newProcessedPages}`,
          `Pages ignorées: ${stats.pages_skipped}`,
          `Erreurs: ${stats.errors.length}`
        ],
        mentioned_hs_codes: hsCodeEntries.map(h => h.code_clean),
        detected_tariff_changes: enrichedTariffLines,
        extracted_data: {
          batch_run_id: runId,
          stats: stats,
          raw_table_debug: debug,
          notes: enrichedNotes,
          notes_text: notesText,
          tariff_lines: enrichedTariffLines,
        },
        extraction_model: CLAUDE_MODEL,
        extraction_confidence: 0.92,
        extracted_at: new Date().toISOString(),
      };
      
      if (existingExtraction) {
        await supabase
          .from("pdf_extractions")
          .update(extractionData)
          .eq("id", existingExtraction.id);
      } else {
        await supabase.from("pdf_extractions").insert(extractionData);
      }
      
      // Mettre à jour pdf_documents
      await supabase
        .from("pdf_documents")
        .update({
          is_verified: true,
          verified_at: new Date().toISOString(),
          related_hs_codes: hsCodeEntries.map(h => h.code_clean),
        })
        .eq("id", pdfId);
    }
    
    // Réponse batch - toujours inclure les données extraites pour accumulation côté frontend
    const response: BatchResponse = {
      extraction_run_id: runId!,
      done: isDone,
      next_page: isDone ? null : nextPage,
      processed_pages: newProcessedPages,
      total_pages: totalPages,
      stats: stats,
      status: isDone ? "done" : "processing",
      pdfId,
      pdfTitle: title,
      countryCode,
      // Inclure les données extraites de ce batch pour accumulation côté frontend
      tariff_lines: tariffLines,
      hs_codes: hsCodeEntries,
      notes: allNotes,
      // Résumé du document (seulement au premier batch)
      summary: documentSummary || undefined,
    };
    
    // Update metrics
    if (metrics) {
      metrics.pages_processed = newProcessedPages;
      metrics.inserted_rows = stats.tariff_lines_inserted + stats.hs_codes_inserted + stats.notes_inserted;
      metrics.errors_count = stats.errors.length;
      logMetrics(metrics, isDone ? "done" : "processing");
    }
    
    safeLog("info", "analyze-pdf", "Batch completed", {
      done: isDone,
      next_page: response.next_page,
      processed: newProcessedPages,
      total: totalPages,
    });
    
    return new Response(
      JSON.stringify(response),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
    
  } catch (error) {
    // Log error with metrics
    if (metrics) {
      metrics.errors_count++;
      logMetrics(metrics, "error");
    }
    
    const errorMessage = error instanceof Error ? error.message : "Erreur d'analyse batch";
    safeLog("error", "analyze-pdf", "Batch failed", {
      error: maskSensitiveData(errorMessage),
    });
    
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
