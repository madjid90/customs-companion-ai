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
import { createLogger } from "../_shared/logger.ts";

// =============================================================================
// CONFIGURATION - ANTHROPIC CLAUDE (Native PDF Support)
// =============================================================================

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

// Configuration BATCH par défaut
const DEFAULT_BATCH_SIZE = 4;  // Pages par appel
const MAX_BATCH_SIZE = 10;
const MIN_BATCH_SIZE = 1;

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
}

interface HSCodeEntry {
  code: string;
  code_clean: string;
  description: string;
  level: string;
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
  const str = String(val).trim();
  if (str === "-" || str === "–" || str === "—") return true;
  return /^[A-Za-z]{1,5}\d{0,2}$/i.test(str);
}

function isNumberLike(val: string | number | null | undefined): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === "number") return !isNaN(val);
  const str = String(val).trim();
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
  
  if (isUnit(dutyRate) && isNumberLike(unitNorm)) {
    dutyRate = unitNorm;
    unitNorm = String(originalDuty);
    swapped = true;
    debug.detectedSwaps++;
    if (debug.swappedSamples.length < 5) {
      debug.swappedSamples.push({
        national_code: line.national_code || "unknown",
        before: { duty_rate: originalDuty, unit_norm: originalUnit as string | null },
        after: { duty_rate: normalizeRate(dutyRate), unit_norm: unitNorm }
      });
    }
  }
  
  if ((dutyRate === "-" || dutyRate === "–" || dutyRate === "—") && isNumberLike(unitNorm)) {
    dutyRate = unitNorm;
    unitNorm = "-";
    swapped = true;
    debug.detectedSwaps++;
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
// PROMPTS
// =============================================================================

const getPageTariffPrompt = (title: string, pageNumber: number, totalPages: number) => `Expert en tarifs douaniers marocains. Analyse cette PAGE ${pageNumber}/${totalPages} du PDF "${title}".

=== STRUCTURE DU TARIF MAROCAIN ===

Les codes nationaux ont TOUJOURS 10 chiffres.

⚠️ RÈGLE CRITIQUE: IGNORER LE CHIFFRE D'ALIGNEMENT ⚠️

Certaines lignes contiennent un chiffre JUSTE AVANT la Position SH (1, 3, 4, 5, 7, 8...).
Ce chiffre est un REPÈRE D'ALIGNEMENT et NE FAIT PAS PARTIE DU CODE SH.
IL FAUT L'IGNORER COMPLÈTEMENT.

Exemple:
"8 8903.11 00 00 ... 2,5 u" 
→ Le "8" au début est un repère à IGNORER
→ Position = 8903.11, Col2 = 00, Col3 = 00
→ national_code = 8903110000

=== RÈGLES D'HÉRITAGE (CARRY-FORWARD) ===

Les tableaux sont hiérarchiques. Tu DOIS maintenir l'héritage:
- Si position_6 est vide → hériter du parent
- Si col2 est vide → hériter du parent
- Si col3 est vide → hériter du parent

=== FORMAT JSON STRICT ===

{
  "page_number": ${pageNumber},
  "has_tariff_table": true,
  "raw_lines": [
    {
      "prefix_col": "8",
      "position_6": "8903.11",
      "col2": "00",
      "col3": "00",
      "national_code": "8903110000",
      "hs_code_6": "890311",
      "description": "Description du produit",
      "duty_rate": "2,5",
      "unit_norm": "u",
      "unit_comp": "N"
    }
  ],
  "notes": [
    {
      "note_type": "definition",
      "anchor": "BRT",
      "note_text": "BRT : Bruto Registered Ton",
      "page_number": ${pageNumber}
    }
  ]
}

Si la page ne contient PAS de tableau tarifaire (que du texte/notes):
{
  "page_number": ${pageNumber},
  "has_tariff_table": false,
  "raw_lines": [],
  "notes": [...]
}

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
    linesFromFallback: 0
  };
  
  let lastPos6: string | null = null;
  let lastCol2: string | null = null;
  let lastCol3: string | null = null;
  
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
    
    let col2 = normalize2Strict(line.col2);
    if (!col2) {
      if (line.national_code) {
        const nc = normalize10Strict(line.national_code);
        if (nc) col2 = nc.slice(6, 8);
      }
      if (!col2 && lastCol2) col2 = lastCol2;
    }
    
    if (line.col2 && normalize2Strict(line.col2)) lastCol2 = normalize2Strict(line.col2);
    
    let col3 = normalize2Strict(line.col3);
    if (!col3) {
      if (line.national_code) {
        const nc = normalize10Strict(line.national_code);
        if (nc) col3 = nc.slice(8, 10);
      }
      if (!col3 && lastCol3) col3 = lastCol3;
    }
    
    if (line.col3 && normalize2Strict(line.col3)) lastCol3 = normalize2Strict(line.col3);
    
    let nationalCode: string | null = null;
    
    if (line.national_code) nationalCode = normalize10Strict(line.national_code);
    
    if (!nationalCode && col2 && col3) nationalCode = pos6 + col2 + col3;
    
    if (!nationalCode || nationalCode.length !== 10 || !/^\d{10}$/.test(nationalCode)) {
      debug.parsingWarnings.push(`Line ${i}: Invalid national_code "${nationalCode}", skipped (NO PADDING)`);
      debug.skippedLines++;
      continue;
    }
    
    const { duty_rate, unit_norm, swapped } = fixRateUnitSwap(line, debug);
    
    if (duty_rate === null) {
      if (pos6) lastPos6 = pos6;
      if (col2) lastCol2 = col2;
      if (col3) lastCol3 = col3;
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
    
    lastPos6 = pos6;
    lastCol2 = col2;
    lastCol3 = col3;
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
// PARSE JSON ROBUSTE
// =============================================================================

function repairTruncatedJson(text: string): string {
  let repaired = text.trim();
  repaired = repaired.replace(/,\s*([}\]])/g, '$1');
  
  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  
  for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += "]";
  for (let i = 0; i < openBraces - closeBraces; i++) repaired += "}";
  
  return repaired;
}

function parseJsonRobust(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {}
  
  const repaired = repairTruncatedJson(text);
  try {
    return JSON.parse(repaired);
  } catch {}
  
  // Extraction du plus grand objet JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {}
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
  
  // Définitions (BRT : ...)
  const defPattern = /([A-Z]{2,5})\s*:\s*([^.\n]{10,80})/g;
  let match;
  while ((match = defPattern.exec(text)) !== null) {
    const key = match[1] + ":" + match[2].slice(0, 20);
    if (!seen.has(key)) {
      seen.add(key);
      notes.push({
        note_type: "definition",
        anchor: match[1],
        note_text: `${match[1]} : ${match[2].trim()}`,
        page_number: pageNumber
      });
    }
  }
  
  // Notes de chapitre/section
  const notePattern = /(NOTE[S]?\s*(?:DE\s+)?(?:CHAPITRE|SECTION)?)\s*[:\-]?\s*([^\n]{10,200})/gi;
  while ((match = notePattern.exec(text)) !== null) {
    const key = match[2].slice(0, 30);
    if (!seen.has(key)) {
      seen.add(key);
      notes.push({
        note_type: match[1].toLowerCase().includes("chapitre") ? "chapter_note" : "section_note",
        note_text: match[2].trim(),
        page_number: pageNumber
      });
    }
  }
  
  // Footnotes (1), (2), etc.
  const footnotePattern = /\((\d)\)\s*([^()\n]{10,150})/g;
  while ((match = footnotePattern.exec(text)) !== null) {
    const key = "fn" + match[1] + ":" + match[2].slice(0, 20);
    if (!seen.has(key)) {
      seen.add(key);
      notes.push({
        note_type: "footnote",
        anchor: `(${match[1]})`,
        note_text: match[2].trim(),
        page_number: pageNumber
      });
    }
  }
  
  return notes;
}

// =============================================================================
// ANALYSE D'UNE PAGE VIA CLAUDE
// =============================================================================

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
    
    const batchSize = Math.min(Math.max(max_pages, MIN_BATCH_SIZE), MAX_BATCH_SIZE);
    
    logger.info(`Batch request: pdfId=${pdfId}, start_page=${start_page}, batch_size=${batchSize}, run_id=${extraction_run_id}`);
    
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
    
    // Estimer le nombre total de pages (approximation basée sur la taille)
    // Note: Claude native PDF ne donne pas le nombre de pages directement
    // On estime ~50KB par page en moyenne pour un PDF texte/tableau
    const fileSizeBytes = bytes.length;
    const estimatedTotalPages = Math.max(1, Math.ceil(fileSizeBytes / 50000));
    
    console.log(`PDF size: ${fileSizeBytes} bytes, estimated pages: ${estimatedTotalPages}`);
    
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
      // Créer un nouveau run
      const { data: newRun, error: createError } = await supabase
        .from("pdf_extraction_runs")
        .insert({
          pdf_id: pdfId,
          status: "processing",
          current_page: start_page,
          total_pages: estimatedTotalPages,
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
      console.log(`Created new run ${runId}`);
    }
    
    const stats: BatchStats = runData.stats || {
      tariff_lines_inserted: 0,
      hs_codes_inserted: 0,
      notes_inserted: 0,
      pages_skipped: 0,
      errors: []
    };
    
    const startPage = runData.current_page || start_page;
    const totalPages = runData.total_pages || estimatedTotalPages;
    const endPage = Math.min(startPage + batchSize - 1, totalPages);
    
    console.log(`Processing pages ${startPage} to ${endPage} of ${totalPages}`);
    
    // Accumulateurs pour ce batch
    let allRawLines: RawTariffLine[] = [];
    let allNotes: ExtractedNote[] = [];
    let pagesProcessed = 0;
    let pagesSkipped = 0;
    
    // Traitement page par page
    for (let page = startPage; page <= endPage; page++) {
      console.log(`--- Processing page ${page}/${totalPages} ---`);
      
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
          // Arrêter le batch, on reprendra plus tard
          console.warn(`Rate limit hit at page ${page}, stopping batch`);
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
      if (page < endPage) {
        await delay(500);
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
      // Insérer les lignes tarifaires
      if (tariffLines.length > 0) {
        const tariffRows = tariffLines.map(line => ({
          country_code: countryCode,
          hs_code_6: line.hs_code_6,
          national_code: line.national_code,
          description_local: line.description,
          duty_rate: line.duty_rate,
          duty_note: line.duty_note,
          vat_rate: 20,
          unit_code: line.unit_norm || null,
          unit_complementary_code: line.unit_comp || null,
          is_active: true,
          is_inherited: line.is_inherited,
          source: `PDF: ${title}`,
        }));
        
        const { error: tariffError } = await supabase
          .from("country_tariffs")
          .upsert(tariffRows, { onConflict: "country_code,national_code" });
        
        if (tariffError) {
          console.error("Tariff insert error:", tariffError);
          stats.errors.push(`Tariff insert: ${tariffError.message}`);
        } else {
          stats.tariff_lines_inserted += tariffRows.length;
          console.log(`✅ Inserted ${tariffRows.length} tariff lines`);
        }
      }
      
      // Insérer les codes HS
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
          console.log(`✅ Inserted ${hsRows.length} HS codes`);
        }
      }
      
      // Insérer les notes
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
        }));
        
        const { error: noteError } = await supabase
          .from("tariff_notes")
          .insert(noteRows);
        
        if (noteError) {
          console.error("Notes insert error:", noteError);
          stats.errors.push(`Notes insert: ${noteError.message}`);
        } else {
          stats.notes_inserted += noteRows.length;
          console.log(`✅ Inserted ${noteRows.length} notes`);
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
        detected_tariff_changes: tariffLines,
        extracted_data: {
          batch_run_id: runId,
          stats: stats,
          raw_table_debug: debug,
          notes: allNotes,
          notes_text: notesText,
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
    
    // Réponse batch
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
    };
    
    console.log(`Response: done=${isDone}, next_page=${response.next_page}, processed=${newProcessedPages}/${totalPages}`);
    
    return new Response(
      JSON.stringify(response),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
    
  } catch (error) {
    logger.error("Analyze PDF batch error", error as Error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur d'analyse batch" }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
