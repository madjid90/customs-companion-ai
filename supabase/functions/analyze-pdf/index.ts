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
import { validateAnalyzePdfRequest } from "../_shared/validation.ts";
import { createLogger } from "../_shared/logger.ts";

// =============================================================================
// CONFIGURATION - ANTHROPIC CLAUDE (Native PDF Support)
// =============================================================================

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

// =============================================================================
// INTERFACES - ÉTAPE 1: Schéma RawTariffLine standardisé
// =============================================================================

/**
 * Structure standardisée pour les lignes tarifaires brutes
 * Utilisée par le prompt LLM et tous les fallbacks
 */
interface RawTariffLine {
  prefix_col?: string | null;       // Chiffre d'alignement (1-8) à IGNORER
  position_6?: string | null;       // Position 6 chiffres ex: "8903.11" ou "890311"
  col2?: string | null;             // 2 digits (positions 7-8)
  col3?: string | null;             // 2 digits (positions 9-10)
  national_code?: string | null;    // 10 digits (optionnel, peut être reconstruit)
  hs_code_6?: string | null;        // 6 digits (optionnel, reconstruit)
  description?: string | null;
  duty_rate?: string | number | null;
  unit_norm?: string | null;        // Unité principale (KG, L, U, etc.)
  unit_comp?: string | null;        // Unité complémentaire
}

/**
 * Note extraite du document (notes de chapitre, définitions, etc.)
 */
interface ExtractedNote {
  note_type: "chapter_note" | "section_note" | "definition" | "footnote" | "exclusion" | "remark";
  anchor?: string;                  // Ex: "BRT", "(a)", "Chapitre 84"
  note_text: string;
  page_number?: number;
}

/**
 * Ligne tarifaire validée et normalisée
 */
interface TariffLine {
  national_code: string;   // 10 chiffres
  hs_code_6: string;       // 6 premiers chiffres
  description: string;
  duty_rate: number;
  duty_note: string | null;
  unit_norm: string | null;
  unit_comp: string | null;
  is_inherited: boolean;
}

/**
 * Code SH à 6 chiffres
 */
interface HSCodeEntry {
  code: string;           // Format "XXXX.XX"
  code_clean: string;     // 6 chiffres sans points
  description: string;
  level: string;
}

interface PreferentialRate {
  agreement_code: string;
  agreement_name: string;
  hs_code: string;
  preferential_rate: number;
  conditions?: string;
  origin_countries?: string[];
}

interface TradeAgreementMention {
  code: string;
  name: string;
  type: string;
  countries: string[];
  mentioned_benefits?: string[];
}

interface LegalReference {
  type: string;
  reference: string;
  title?: string;
  date?: string;
  context?: string;
}

interface ImportantDate {
  date: string;
  type: string;
  description: string;
}

interface IssuingAuthority {
  name: string;
  department?: string;
  signatory?: string;
}

interface Procedure {
  name: string;
  required_documents?: string[];
  deadlines?: string;
  penalties?: string;
}

/**
 * Mode DEBUG - informations de diagnostic
 */
interface RawTableDebug {
  detectedSwaps: number;
  swappedSamples: Array<{
    national_code: string;
    before: { duty_rate: string | number | null | undefined; unit_norm: string | null | undefined };
    after: { duty_rate: number | null; unit_norm: string | null };
  }>;
  parsingWarnings: string[];
  skippedLines: number;
}

interface AnalysisResult {
  summary: string;
  key_points: string[];
  hs_codes: HSCodeEntry[];
  tariff_lines: TariffLine[];
  chapter_info?: { number: number | null; title: string };
  notes?: {
    legal: string[];
    subposition: string[];
    complementary: string[];
  };
  footnotes?: Record<string, string>;
  authorities?: string[];
  trade_agreements?: TradeAgreementMention[];
  preferential_rates?: PreferentialRate[];
  raw_lines?: RawTariffLine[];
  extracted_notes?: ExtractedNote[];
  document_type?: string;
  document_reference?: string;
  publication_date?: string;
  effective_date?: string;
  expiry_date?: string;
  legal_references?: LegalReference[] | string[];
  important_dates?: ImportantDate[];
  issuing_authority?: IssuingAuthority;
  recipients?: string[];
  procedures?: Procedure[];
  abrogates?: string[];
  modifies?: string[];
  full_text?: string;
  raw_table_debug?: RawTableDebug;
}

// =============================================================================
// ÉTAPE 3: HELPERS STRICTS (pas de padding)
// =============================================================================

/**
 * Extrait uniquement les chiffres d'une chaîne
 */
function digitsOnly(str: string | null | undefined): string {
  if (!str) return "";
  return str.replace(/[^0-9]/g, "");
}

/**
 * Normalise un code à exactement 10 chiffres ou retourne null
 * NE JAMAIS PADDER - retourne null si invalide
 */
function normalize10Strict(str: string | null | undefined): string | null {
  if (!str) return null;
  const digits = digitsOnly(str);
  if (digits.length !== 10) return null;
  return digits;
}

/**
 * Normalise un code à exactement 6 chiffres ou retourne null
 * NE JAMAIS PADDER
 */
function normalize6Strict(str: string | null | undefined): string | null {
  if (!str) return null;
  // Nettoyer les points, tirets, espaces
  const cleaned = str.replace(/[\.\-\s]/g, "");
  const digits = digitsOnly(cleaned);
  if (digits.length !== 6) return null;
  return digits;
}

/**
 * Normalise un code à exactement 2 chiffres ou retourne null
 * Accepte aussi "00" comme valide
 */
function normalize2Strict(str: string | null | undefined): string | null {
  if (!str) return null;
  const digits = digitsOnly(str);
  if (digits.length !== 2) return null;
  return digits;
}

/**
 * Normalise un taux (duty_rate) en nombre
 * Gère les formats: "2,5", "2.5", "40%", 17.5, etc.
 */
function normalizeRate(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  
  if (typeof value === "number") {
    return isNaN(value) ? null : value;
  }
  
  const str = String(value).trim();
  if (str === "" || str === "-" || str === "–" || str === "—") return null;
  
  // Supprimer le symbole %
  let cleaned = str.replace(/%/g, "").trim();
  // Remplacer la virgule par un point
  cleaned = cleaned.replace(",", ".");
  // Supprimer les parenthèses et notes (ex: "2,5(a)" -> "2.5")
  cleaned = cleaned.replace(/\([a-z]\)/gi, "").trim();
  
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Vérifie si une valeur est une unité (KG, L, U, M2, BRT, etc.)
 */
function isUnit(val: string | number | null | undefined): boolean {
  if (val === null || val === undefined) return false;
  const str = String(val).trim();
  if (str === "-" || str === "–" || str === "—") return true;
  // Unités courantes: lettres majuscules 1-5 caractères, éventuellement suivies de chiffres
  return /^[A-Za-z]{1,5}\d{0,2}$/i.test(str);
}

/**
 * Vérifie si une valeur ressemble à un nombre (taux)
 */
function isNumberLike(val: string | number | null | undefined): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === "number") return !isNaN(val);
  const str = String(val).trim();
  // Formats: "2,5", "2.5", "40", "17.5%"
  return /^\d+([.,]\d+)?%?$/.test(str);
}

/**
 * Corrige l'inversion duty_rate / unit_norm (colonnes 4 et 5 inversées)
 */
function fixRateUnitSwap(
  line: RawTariffLine,
  debug: RawTableDebug
): { duty_rate: number | null; unit_norm: string | null; swapped: boolean } {
  const originalDuty = line.duty_rate;
  const originalUnit = line.unit_norm;
  
  let dutyRate = originalDuty;
  let unitNorm = originalUnit;
  let swapped = false;
  
  // Détection d'inversion: duty_rate contient une unité ET unit_norm contient un nombre
  if (isUnit(dutyRate) && isNumberLike(unitNorm)) {
    // SWAP!
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
  
  // Autre cas: duty_rate est "-" et unit_norm est un nombre
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

/**
 * Extrait la note entre parenthèses du taux (ex: "2,5(a)" -> "a")
 */
function extractDutyNote(dutyStr: string | number | null): string | null {
  if (dutyStr === null || dutyStr === undefined) return null;
  if (typeof dutyStr === "number") return null;
  const str = String(dutyStr).trim();
  const match = str.match(/\(([a-z])\)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Vérifie si un code est entre crochets (position réservée)
 */
function isReservedCode(code: string): boolean {
  if (!code || code.trim() === "") return false;
  const raw = code.trim();
  return raw.startsWith("[") || raw.endsWith("]") || raw.includes("[") || raw.includes("]");
}

/**
 * Vérifie si un code clean est valide (6 chiffres)
 */
function isValidCleanCode(codeClean: string): boolean {
  if (!codeClean) return false;
  return /^\d{6}$/.test(codeClean);
}

// =============================================================================
// ÉTAPE 2: PROMPT TARIFAIRE AVEC JSON STRICT + NOTES + EXEMPLES
// =============================================================================

const getTariffPrompt = (title: string, category: string) => `Expert en tarifs douaniers marocains. Analyse ce PDF et extrais TOUTES les lignes tarifaires ET les notes importantes.

Doc: ${title}
Catégorie: ${category}

=== STRUCTURE DU TARIF MAROCAIN ===

Les codes nationaux ont TOUJOURS 10 chiffres.

⚠️ RÈGLE CRITIQUE: IGNORER LE CHIFFRE D'ALIGNEMENT ⚠️

Certaines lignes du PDF contiennent un chiffre dans une colonne JUSTE AVANT la Position SH (1, 3, 4, 5, 7, 8, etc.).
Ce chiffre est un REPÈRE D'ALIGNEMENT et NE FAIT PAS PARTIE DU CODE SH.
IL FAUT L'IGNORER COMPLÈTEMENT.

Exemple:
"8 8903.11 00 00 ... 2,5 u" 
→ Le "8" au début est un repère à IGNORER
→ Position = 8903.11, Col2 = 00, Col3 = 00
→ national_code = 8903110000

=== RÈGLE DE CONSTRUCTION DU CODE ===

CODE NATIONAL 10 CHIFFRES = Position_6 + Col2 + Col3

Position_6 = Les 6 premiers chiffres (ex: "8903.11" → "890311")
Col2 = Chiffres 7-8 (colonne après la position)
Col3 = Chiffres 9-10 (colonne après Col2)

=== RÈGLES D'HÉRITAGE (CARRY-FORWARD) ===

Les tableaux sont hiérarchiques. Certaines sous-lignes n'affichent pas tout le code.
Tu DOIS maintenir l'héritage:
- Si position_6 est vide → hériter du parent
- Si col2 est vide → hériter du parent
- Si col3 est vide → hériter du parent

Exemple PDF:
Position | Col2 | Col3 | Description          | Taux | Unité
---------|------|------|----------------------|------|------
8903.11  | 00   | 00   | Bateaux gonflables   | 2,5  | u
8903.12  |      |      | - Autres:            |      |
         | 00   | 00   | -- en bois           | 2,5  | u
         |      | 10   | --- petits           | 2,5  | u
         |      | 90   | --- autres           | 2,5  | u

Construction:
- Ligne "8903.11 | 00 | 00" → national_code = 8903110000 ✓
- Ligne "8903.12" → parent, pas de taux
- Ligne "| 00 | 00 | en bois" → position héritée 890312, code = 8903120000 ✓
- Ligne "| | 10 | petits" → position=890312 (héritée), col2=00 (héritée), col3=10 → code = 8903120010 ✓
- Ligne "| | 90 | autres" → position=890312 (héritée), col2=00 (héritée), col3=90 → code = 8903120090 ✓

=== FORMAT JSON STRICT ===

Tu DOIS retourner ce JSON EXACT (pas d'autre format):

{
  "doc_type": "tariff_table",
  "chapter_number": "XX",
  "summary": "Résumé du chapitre",
  "key_points": ["Point 1", "Point 2"],
  "chapter_info": {"number": XX, "title": "Titre du chapitre"},
  "raw_lines": [
    {
      "prefix_col": "8",
      "position_6": "8903.11",
      "col2": "00",
      "col3": "00",
      "national_code": "8903110000",
      "hs_code_6": "890311",
      "description": "Comportant un moteur hors-bord",
      "duty_rate": "2,5",
      "unit_norm": "u",
      "unit_comp": "N"
    }
  ],
  "notes": [
    {
      "note_type": "definition",
      "anchor": "BRT",
      "note_text": "BRT : Bruto Registered Ton (2,8316m3)",
      "page_number": 2
    },
    {
      "note_type": "chapter_note",
      "anchor": "Note 1",
      "note_text": "Le présent chapitre ne comprend pas...",
      "page_number": 1
    }
  ],
  "full_text": "TEXTE INTÉGRAL DU DOCUMENT..."
}

=== TYPES DE NOTES À EXTRAIRE ===

1. "chapter_note" - Notes de chapitre (ex: "Note 1. Le présent chapitre...")
2. "section_note" - Notes de section
3. "definition" - Définitions (ex: "BRT : Bruto Registered Ton")
4. "footnote" - Notes de bas de page (ex: "(a) Soumis à licence")
5. "exclusion" - Exclusions (ex: "Ne comprend pas...")
6. "remark" - Remarques générales

=== RÈGLES STRICTES ===

✓ CHAQUE raw_line DOIT avoir:
  - position_6: les 6 chiffres (format "XXXX.XX" ou "XXXXXX")
  - col2: 2 chiffres ou vide (à hériter)
  - col3: 2 chiffres ou vide (à hériter)
  - description: texte descriptif
  - duty_rate: nombre ou chaîne (ex: "2,5", 40, "17,5(a)")
  - unit_norm: unité principale (KG, L, U, M2, etc.) ou null
  - unit_comp: unité complémentaire ou null

✓ prefix_col: Si présent, c'est le chiffre d'alignement À IGNORER
✓ national_code: Optionnel, sera reconstruit si absent
✓ hs_code_6: Optionnel, sera déduit de national_code

✓ duty_rate DOIT être un nombre (ou string convertible): "2,5", 40, "17.5"
✓ unit_norm/unit_comp DOIVENT être des strings courtes: "KG", "L", "U", "M2", "N", "-"

⚠️ IGNORER les codes entre crochets [XX.XX] - positions réservées
⚠️ NE JAMAIS inventer de codes en paddant de zéros
⚠️ EXTRAIRE 100% DES LIGNES DE TOUTES LES PAGES

RÉPONDS UNIQUEMENT AVEC LE JSON, RIEN D'AUTRE.`;

// =============================================================================
// PROMPT RÉGLEMENTAIRE (inchangé)
// =============================================================================

const getRegulatoryPrompt = (title: string, category: string) => `Tu es un expert en réglementation douanière marocaine. Analyse ce document PDF (${category}) avec précision.

Document : ${title}
Type : ${category}

=== CONTEXTE ===
Ce document est un texte RÉGLEMENTAIRE/JURIDIQUE. Il NE CONTIENT PAS de tableau tarifaire.

=== INFORMATIONS À EXTRAIRE ===

1. RÉSUMÉ : Synthèse claire du contenu
2. POINTS CLÉS : Dispositions principales
3. RÉFÉRENCES LÉGALES : Circulaires, lois, décrets, arrêtés, articles
4. DATES IMPORTANTES : Publication, application, expiration
5. AUTORITÉS ET SIGNATAIRES
6. ACCORDS COMMERCIAUX (si applicable)
7. CODES SH MENTIONNÉS (références explicites)
8. PROCÉDURES ET OBLIGATIONS

=== FORMAT JSON ===

{
  "summary": "Résumé...",
  "key_points": ["Point 1", "Point 2"],
  "chapter_info": {"number": null, "title": "Titre"},
  "document_type": "${category}",
  "document_reference": "Numéro officiel",
  "publication_date": "YYYY-MM-DD",
  "effective_date": "YYYY-MM-DD",
  "expiry_date": "YYYY-MM-DD ou null",
  "legal_references": [
    {"type": "circulaire", "reference": "n° XXX", "title": "...", "date": "...", "context": "..."}
  ],
  "important_dates": [
    {"date": "YYYY-MM-DD", "type": "application", "description": "..."}
  ],
  "issuing_authority": {"name": "...", "department": "...", "signatory": "..."},
  "recipients": ["Service 1", "Service 2"],
  "raw_lines": [],
  "hs_codes": [
    {"code": "XXXX.XX", "code_clean": "XXXXXX", "description": "...", "level": "reference"}
  ],
  "trade_agreements": [],
  "preferential_rates": [],
  "procedures": [],
  "authorities": [],
  "full_text": "TEXTE INTÉGRAL..."
}

RÉPONDS UNIQUEMENT AVEC LE JSON, RIEN D'AUTRE.`;

// =============================================================================
// CLASSIFICATION DU DOCUMENT
// =============================================================================

const TARIFF_CATEGORIES = ["tarif", "chapitre", "chapter", "nomenclature", "sh_code", "hs_code"];
const REGULATORY_CATEGORIES = ["circulaire", "accord", "note", "instruction", "reglement", "règlement", "convention", "loi", "decret", "décret", "arrete", "arrêté"];

type DocumentType = "tariff" | "regulatory";

interface DocumentClassification {
  type: DocumentType;
  confidence: number;
  reason: string;
}

const CLASSIFICATION_PROMPT = `Tu es un expert en classification de documents douaniers.

Analyse les PREMIÈRES PAGES de ce PDF et détermine SON TYPE :

TYPE "tariff" si le document contient :
- Un TABLEAU de nomenclature douanière avec des colonnes (Position, Description, Taux, Unité)
- Des codes SH/HS à 6, 8 ou 10 chiffres organisés hiérarchiquement
- Des taux de droits de douane en pourcentage

TYPE "regulatory" si le document contient :
- Un texte juridique/réglementaire (circulaire, note, décret, accord)
- Des paragraphes de texte législatif avec articles numérotés
- Pas de tableau tarifaire structuré

RÉPONDS UNIQUEMENT avec ce JSON :
{
  "type": "tariff" ou "regulatory",
  "confidence": 0.0 à 1.0,
  "reason": "Explication courte"
}`;

async function classifyDocument(
  base64Pdf: string,
  title: string,
  category: string,
  apiKey: string
): Promise<DocumentClassification> {
  console.log(`[Classification] Starting for: "${title}"`);
  
  const heuristicResult = classifyByHeuristics(title, category);
  if (heuristicResult.confidence >= 0.9) {
    console.log(`[Classification] High-confidence heuristic: ${heuristicResult.type} (${heuristicResult.confidence})`);
    return heuristicResult;
  }
  
  console.log(`[Classification] Heuristic low (${heuristicResult.confidence}), using AI...`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Pdf } },
            { type: "text", text: CLASSIFICATION_PROMPT }
          ]
        }]
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn(`[Classification] AI failed ${response.status}, fallback to heuristics`);
      return heuristicResult;
    }
    
    const data = await response.json();
    const responseText = data.content?.[0]?.text || "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const classification = JSON.parse(jsonMatch[0]);
      console.log(`[Classification] AI: ${classification.type} (${classification.confidence})`);
      return {
        type: classification.type === "tariff" ? "tariff" : "regulatory",
        confidence: Math.min(1, Math.max(0, classification.confidence || 0.8)),
        reason: classification.reason || "AI classification"
      };
    }
    
    return heuristicResult;
  } catch (error) {
    console.warn(`[Classification] Error: ${error}, fallback to heuristics`);
    return heuristicResult;
  }
}

function classifyByHeuristics(title: string, category: string): DocumentClassification {
  const categoryLower = category.toLowerCase();
  const titleLower = title.toLowerCase();
  
  const strongTariffKeywords = [
    /sh\s*code/i, /hs\s*code/i, /chapitre\s*\d+/i, /chapter\s*\d+/i,
    /tarif\s*douanier/i, /nomenclature/i, /système\s*harmonisé/i
  ];
  
  for (const regex of strongTariffKeywords) {
    if (regex.test(titleLower) || regex.test(categoryLower)) {
      return { type: "tariff", confidence: 0.95, reason: `Mot-clé tarif: ${regex.source}` };
    }
  }
  
  const strongRegulatoryKeywords = [
    /circulaire\s*n[°o]?/i, /décret\s*n[°o]?/i, /arrêté/i,
    /accord\s*(commercial|de\s*libre)/i, /convention/i, /note\s*technique/i
  ];
  
  for (const regex of strongRegulatoryKeywords) {
    if (regex.test(titleLower) || regex.test(categoryLower)) {
      return { type: "regulatory", confidence: 0.95, reason: `Mot-clé réglementaire: ${regex.source}` };
    }
  }
  
  const isTariff = TARIFF_CATEGORIES.some(t => categoryLower.includes(t) || titleLower.includes(t));
  const isRegulatory = REGULATORY_CATEGORIES.some(r => categoryLower.includes(r) || titleLower.includes(r));
  
  if (isTariff && !isRegulatory) return { type: "tariff", confidence: 0.8, reason: "Catégorie tarifaire" };
  if (isRegulatory && !isTariff) return { type: "regulatory", confidence: 0.8, reason: "Catégorie réglementaire" };
  
  return { type: "tariff", confidence: 0.4, reason: "Classification par défaut" };
}

function getAnalysisPrompt(title: string, category: string, documentType: DocumentType = "tariff"): string {
  if (documentType === "regulatory") {
    console.log(`Using REGULATORY prompt for: "${title}"`);
    return getRegulatoryPrompt(title, category);
  }
  console.log(`Using TARIFF prompt for: "${title}"`);
  return getTariffPrompt(title, category);
}

function isRegulatoryDocument(category: string, title: string): boolean {
  const result = classifyByHeuristics(title, category);
  return result.type === "regulatory" && result.confidence >= 0.7;
}

// =============================================================================
// ÉTAPE 3: PROCESSRAWLINES - RECONSTRUCTION + HÉRITAGE + SWAP
// =============================================================================

/**
 * Traite les lignes brutes avec héritage robuste et correction d'inversion
 * SUPPRESSION DU PADDING - retourne null si invalide
 */
function processRawLines(rawLines: RawTariffLine[]): { tariffLines: TariffLine[]; debug: RawTableDebug } {
  const results: TariffLine[] = [];
  const debug: RawTableDebug = {
    detectedSwaps: 0,
    swappedSamples: [],
    parsingWarnings: [],
    skippedLines: 0
  };
  
  // Variables d'héritage (carry-forward)
  let lastPos6: string | null = null;
  let lastCol2: string | null = null;
  let lastCol3: string | null = null;
  
  console.log(`[processRawLines] Processing ${rawLines.length} raw lines...`);
  
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    
    // Ignorer les codes réservés [XX.XX]
    if (line.position_6 && isReservedCode(line.position_6)) {
      debug.parsingWarnings.push(`Line ${i}: Reserved code [${line.position_6}] ignored`);
      debug.skippedLines++;
      continue;
    }
    
    // ÉTAPE 1: Normaliser la position à 6 chiffres
    let pos6: string | null = null;
    
    // D'abord essayer position_6
    if (line.position_6) {
      const cleaned = line.position_6.replace(/[\.\-\s]/g, "");
      const digits = digitsOnly(cleaned);
      if (digits.length === 6) {
        pos6 = digits;
      } else if (digits.length === 4) {
        // Format "XX.XX" (heading) - compléter avec "00"
        pos6 = digits + "00";
      }
    }
    
    // Si pas de position valide, essayer depuis national_code
    if (!pos6 && line.national_code) {
      const nc = normalize10Strict(line.national_code);
      if (nc) {
        pos6 = nc.slice(0, 6);
      }
    }
    
    // Hériter si toujours pas de position
    if (!pos6 && lastPos6) {
      pos6 = lastPos6;
    }
    
    // Si toujours pas de position, ignorer la ligne
    if (!pos6) {
      debug.parsingWarnings.push(`Line ${i}: No valid position_6, skipped`);
      debug.skippedLines++;
      continue;
    }
    
    // Mettre à jour lastPos6 si on a une nouvelle position
    if (line.position_6) {
      lastPos6 = pos6;
    }
    
    // ÉTAPE 2: Normaliser col2 (positions 7-8)
    let col2 = normalize2Strict(line.col2);
    if (!col2) {
      // Essayer d'extraire depuis national_code
      if (line.national_code) {
        const nc = normalize10Strict(line.national_code);
        if (nc) col2 = nc.slice(6, 8);
      }
      // Sinon hériter
      if (!col2 && lastCol2) col2 = lastCol2;
    }
    
    // Mettre à jour l'héritage si on a une valeur explicite
    if (line.col2 && normalize2Strict(line.col2)) {
      lastCol2 = normalize2Strict(line.col2);
    }
    
    // ÉTAPE 3: Normaliser col3 (positions 9-10)
    let col3 = normalize2Strict(line.col3);
    if (!col3) {
      // Essayer d'extraire depuis national_code
      if (line.national_code) {
        const nc = normalize10Strict(line.national_code);
        if (nc) col3 = nc.slice(8, 10);
      }
      // Sinon hériter
      if (!col3 && lastCol3) col3 = lastCol3;
    }
    
    // Mettre à jour l'héritage si on a une valeur explicite
    if (line.col3 && normalize2Strict(line.col3)) {
      lastCol3 = normalize2Strict(line.col3);
    }
    
    // ÉTAPE 4: Reconstruire national_code
    let nationalCode: string | null = null;
    
    // D'abord essayer le national_code fourni
    if (line.national_code) {
      nationalCode = normalize10Strict(line.national_code);
    }
    
    // Sinon reconstruire
    if (!nationalCode && col2 && col3) {
      nationalCode = pos6 + col2 + col3;
    }
    
    // Validation stricte: exactement 10 chiffres
    if (!nationalCode || nationalCode.length !== 10 || !/^\d{10}$/.test(nationalCode)) {
      debug.parsingWarnings.push(`Line ${i}: Invalid national_code "${nationalCode}", skipped (NO PADDING)`);
      debug.skippedLines++;
      continue;
    }
    
    // ÉTAPE 5: Correction d'inversion duty_rate / unit_norm
    const { duty_rate, unit_norm, swapped } = fixRateUnitSwap(line, debug);
    
    // ÉTAPE 6: Validation du taux
    if (duty_rate === null) {
      // Ligne sans taux = en-tête parent, pas une ligne tarifaire
      // Mais on met à jour l'héritage quand même
      if (pos6) lastPos6 = pos6;
      if (col2) lastCol2 = col2;
      if (col3) lastCol3 = col3;
      continue;
    }
    
    // ÉTAPE 7: Extraire la note du taux
    const dutyNote = extractDutyNote(line.duty_rate ?? null);
    
    // ÉTAPE 8: Calculer hs_code_6
    const hsCode6 = nationalCode.slice(0, 6);
    
    // Ligne valide!
    results.push({
      national_code: nationalCode,
      hs_code_6: hsCode6,
      description: (line.description || "").replace(/^[–\-\s]+/, "").trim(),
      duty_rate: duty_rate,
      duty_note: dutyNote,
      unit_norm: unit_norm,
      unit_comp: line.unit_comp || null,
      is_inherited: swapped || !line.national_code // Marqué si reconstruit
    });
    
    // Mettre à jour l'héritage pour les lignes suivantes
    lastPos6 = pos6;
    lastCol2 = col2;
    lastCol3 = col3;
  }
  
  console.log(`[processRawLines] Processed ${results.length} valid lines, ${debug.skippedLines} skipped, ${debug.detectedSwaps} swaps`);
  
  return { tariffLines: results, debug };
}

// =============================================================================
// ÉTAPE 4: FALLBACK - EXTRACTION PARTIELLE ET AGRESSIVE
// =============================================================================

/**
 * Tente de réparer un JSON tronqué
 */
function repairTruncatedJson(text: string): string {
  let repaired = text.trim();
  
  // Supprimer les virgules pendantes
  repaired = repaired.replace(/,\s*([}\]])/g, '$1');
  
  // Fermer les chaînes ouvertes
  const lastPart = repaired.slice(-500);
  const lastQuote = lastPart.lastIndexOf('"');
  if (lastQuote !== -1) {
    const afterLastQuote = lastPart.slice(lastQuote + 1);
    if (!afterLastQuote.match(/^\s*[,:}\]]/)) {
      repaired = repaired + '"';
    }
  }
  
  // Équilibrer accolades et crochets
  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  
  for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += "]";
  for (let i = 0; i < openBraces - closeBraces; i++) repaired += "}";
  
  return repaired;
}

/**
 * Extrait les données partielles depuis un JSON malformé
 * ÉTAPE 4: Unifié au format RawTariffLine
 */
function extractPartialData(text: string, debug: RawTableDebug): any {
  const result: any = {};
  
  // Extraire summary
  const summaryMatch = text.match(/"summary"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
  if (summaryMatch) result.summary = summaryMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
  
  // Extraire full_text
  const fullTextMatch = text.match(/"full_text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (fullTextMatch) {
    result.full_text = fullTextMatch[1]
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\');
  }
  
  // Extraire key_points
  const keyPointsMatch = text.match(/"key_points"\s*:\s*\[((?:[^\[\]]|\[(?:[^\[\]]|\[[^\[\]]*\])*\])*)\]/);
  if (keyPointsMatch) {
    try {
      result.key_points = JSON.parse('[' + keyPointsMatch[1] + ']');
    } catch {
      const points = keyPointsMatch[1].match(/"([^"]+)"/g);
      result.key_points = points ? points.map(p => p.replace(/"/g, '')) : [];
    }
  }
  
  // Extraire chapter_info
  const chapterMatch = text.match(/"chapter_info"\s*:\s*\{([^}]+)\}/);
  if (chapterMatch) {
    try {
      result.chapter_info = JSON.parse('{' + chapterMatch[1] + '}');
    } catch {
      const numMatch = chapterMatch[1].match(/"number"\s*:\s*(\d+)/);
      const titleMatch = chapterMatch[1].match(/"title"\s*:\s*"([^"]+)"/);
      if (numMatch || titleMatch) {
        result.chapter_info = {
          number: numMatch ? parseInt(numMatch[1]) : 0,
          title: titleMatch ? titleMatch[1] : ""
        };
      }
    }
  }
  
  // IMPORTANT: Extraire raw_lines au format RawTariffLine
  const rawLinesMatch = text.match(/"raw_lines"\s*:\s*\[([\s\S]*?)(?:\](?:\s*,\s*"|\s*\})|$)/);
  if (rawLinesMatch) {
    const rawLinesContent = rawLinesMatch[1];
    const lines: RawTariffLine[] = [];
    
    const lineMatches = rawLinesContent.matchAll(/\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g);
    for (const match of lineMatches) {
      try {
        const content = match[1];
        const lineObj: RawTariffLine = {};
        
        // Extraire les champs du nouveau format
        const prefixMatch = content.match(/"prefix_col"\s*:\s*"([^"]*)"/);
        lineObj.prefix_col = prefixMatch ? prefixMatch[1] : null;
        
        const pos6Match = content.match(/"position_6"\s*:\s*"([^"]*)"/);
        lineObj.position_6 = pos6Match ? pos6Match[1] : null;
        
        const col2Match = content.match(/"col2"\s*:\s*"([^"]*)"/);
        lineObj.col2 = col2Match ? col2Match[1] : null;
        
        const col3Match = content.match(/"col3"\s*:\s*"([^"]*)"/);
        lineObj.col3 = col3Match ? col3Match[1] : null;
        
        const ncMatch = content.match(/"national_code"\s*:\s*"([^"]*)"/);
        lineObj.national_code = ncMatch ? ncMatch[1] : null;
        
        const hs6Match = content.match(/"hs_code_6"\s*:\s*"([^"]*)"/);
        lineObj.hs_code_6 = hs6Match ? hs6Match[1] : null;
        
        const descMatch = content.match(/"description"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
        lineObj.description = descMatch ? descMatch[1].replace(/\\"/g, '"') : null;
        
        const dutyMatch = content.match(/"duty_rate"\s*:\s*(?:"([^"]+)"|(\d+\.?\d*)|null)/);
        if (dutyMatch) {
          lineObj.duty_rate = dutyMatch[1] || (dutyMatch[2] ? parseFloat(dutyMatch[2]) : null);
        }
        
        const unitNormMatch = content.match(/"unit_norm"\s*:\s*(?:"([^"]+)"|null)/);
        lineObj.unit_norm = unitNormMatch ? unitNormMatch[1] || null : null;
        
        const unitCompMatch = content.match(/"unit_comp"\s*:\s*(?:"([^"]+)"|null)/);
        lineObj.unit_comp = unitCompMatch ? unitCompMatch[1] || null : null;
        
        // FALLBACK: Ancien format col1..col5
        if (!lineObj.position_6 && !lineObj.national_code) {
          const col1Match = content.match(/"col1"\s*:\s*"([^"]*)"/);
          const col2OldMatch = content.match(/"col2"\s*:\s*"([^"]*)"/);
          const col3OldMatch = content.match(/"col3"\s*:\s*"([^"]*)"/);
          
          if (col1Match) {
            // Tenter de construire depuis col1+col2+col3
            const combined = digitsOnly(col1Match[1] + (col2OldMatch?.[1] || "") + (col3OldMatch?.[1] || ""));
            if (combined.length >= 6) {
              lineObj.position_6 = combined.slice(0, 6);
              if (combined.length >= 8) lineObj.col2 = combined.slice(6, 8);
              if (combined.length >= 10) lineObj.col3 = combined.slice(8, 10);
            }
          }
          debug.parsingWarnings.push(`Fallback: Converted old format col1..col5 to RawTariffLine`);
        }
        
        // Appliquer correction swap
        if (lineObj.duty_rate || lineObj.unit_norm) {
          const { duty_rate, unit_norm } = fixRateUnitSwap(lineObj, debug);
          lineObj.duty_rate = duty_rate;
          lineObj.unit_norm = unit_norm;
        }
        
        // Garder si on a au moins une position ou description
        if (lineObj.position_6 || lineObj.national_code || lineObj.description) {
          lines.push(lineObj);
        }
      } catch (lineError) {
        debug.parsingWarnings.push(`Failed to parse line: ${match[0].substring(0, 100)}`);
      }
    }
    
    if (lines.length > 0) {
      result.raw_lines = lines;
      console.log(`[extractPartialData] Extracted ${lines.length} raw_lines`);
    }
  }
  
  // Extraire notes
  const notesMatch = text.match(/"notes"\s*:\s*\[([\s\S]*?)(?:\](?:\s*,\s*"|\s*\})|$)/);
  if (notesMatch) {
    const notes: ExtractedNote[] = [];
    const noteMatches = notesMatch[1].matchAll(/\{([^{}]*)\}/g);
    for (const match of noteMatches) {
      try {
        const content = match[1];
        const typeMatch = content.match(/"note_type"\s*:\s*"([^"]*)"/);
        const anchorMatch = content.match(/"anchor"\s*:\s*"([^"]*)"/);
        const textMatch = content.match(/"note_text"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
        const pageMatch = content.match(/"page_number"\s*:\s*(\d+)/);
        
        if (textMatch) {
          notes.push({
            note_type: (typeMatch?.[1] || "remark") as ExtractedNote["note_type"],
            anchor: anchorMatch?.[1] || undefined,
            note_text: textMatch[1].replace(/\\"/g, '"'),
            page_number: pageMatch ? parseInt(pageMatch[1]) : undefined
          });
        }
      } catch {}
    }
    if (notes.length > 0) result.extracted_notes = notes;
  }
  
  // Extraire hs_codes si raw_lines absent
  if (!result.raw_lines) {
    const hsCodesMatch = text.match(/"hs_codes"\s*:\s*\[([\s\S]*?)(?:\](?:\s*,\s*"|\s*\})|$)/);
    if (hsCodesMatch) {
      const codes: any[] = [];
      const codeMatches = hsCodesMatch[1].matchAll(/\{([^{}]*)\}/g);
      for (const match of codeMatches) {
        try {
          const codeObj = JSON.parse('{' + match[1] + '}');
          if (codeObj.code_clean && /^\d{6}$/.test(codeObj.code_clean)) {
            codes.push(codeObj);
          }
        } catch {}
      }
      if (codes.length > 0) result.hs_codes = codes;
    }
  }
  
  // Extraire trade_agreements
  const agreementsMatch = text.match(/"trade_agreements"\s*:\s*\[([\s\S]*?)(?:\](?:\s*,\s*"|\s*\})|$)/);
  if (agreementsMatch && agreementsMatch[1].trim().length > 2) {
    try { result.trade_agreements = JSON.parse('[' + agreementsMatch[1] + ']'); } catch {}
  }
  
  // Extraire preferential_rates
  const prefRatesMatch = text.match(/"preferential_rates"\s*:\s*\[([\s\S]*?)(?:\](?:\s*,\s*"|\s*\})|$)/);
  if (prefRatesMatch && prefRatesMatch[1].trim().length > 2) {
    try { result.preferential_rates = JSON.parse('[' + prefRatesMatch[1] + ']'); } catch {}
  }
  
  return result;
}

/**
 * Extraction agressive des lignes brutes via regex
 * ÉTAPE 4: Unifié au format RawTariffLine
 */
function extractRawLinesAggressively(text: string, debug: RawTableDebug): RawTariffLine[] {
  console.log("[extractRawLinesAggressively] Attempting aggressive extraction...");
  const lines: RawTariffLine[] = [];
  
  // Pattern pour objets dans raw_lines
  const rawLinesRegex = /["']raw_lines["']\s*:\s*\[\s*([\s\S]*?)\s*\]\s*(?:,\s*["']|$|\})/;
  const rawLinesMatch = text.match(rawLinesRegex);
  
  if (rawLinesMatch) {
    const content = rawLinesMatch[1];
    const objectRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
    let match;
    
    while ((match = objectRegex.exec(content)) !== null) {
      try {
        const lineObj = JSON.parse(match[0]) as RawTariffLine;
        
        // Convertir ancien format si nécessaire
        if ((lineObj as any).col1 !== undefined && !lineObj.position_6) {
          const col1 = (lineObj as any).col1 || "";
          const col2Old = (lineObj as any).col2 || "";
          const col3Old = (lineObj as any).col3 || "";
          const combined = digitsOnly(col1 + col2Old + col3Old);
          if (combined.length >= 6) {
            lineObj.position_6 = combined.slice(0, 6);
            if (combined.length >= 8) lineObj.col2 = combined.slice(6, 8);
            if (combined.length >= 10) lineObj.col3 = combined.slice(8, 10);
          }
          debug.parsingWarnings.push(`Aggressive: Converted old format`);
        }
        
        // Appliquer swap si nécessaire
        const { duty_rate, unit_norm } = fixRateUnitSwap(lineObj, debug);
        lineObj.duty_rate = duty_rate;
        lineObj.unit_norm = unit_norm;
        
        if (lineObj.position_6 || lineObj.national_code || lineObj.description) {
          lines.push(lineObj);
        }
      } catch {
        // Extraction manuelle
        const lineData: RawTariffLine = {};
        
        const pos6Match = match[0].match(/["']position_6["']\s*:\s*["']([^"']+)["']/);
        lineData.position_6 = pos6Match?.[1] || null;
        
        const col2Match = match[0].match(/["']col2["']\s*:\s*["']([^"']+)["']/);
        lineData.col2 = col2Match?.[1] || null;
        
        const col3Match = match[0].match(/["']col3["']\s*:\s*["']([^"']+)["']/);
        lineData.col3 = col3Match?.[1] || null;
        
        const ncMatch = match[0].match(/["']national_code["']\s*:\s*["']([^"']+)["']/);
        lineData.national_code = ncMatch?.[1] || null;
        
        const descMatch = match[0].match(/["']description["']\s*:\s*["']([^"']*(?:\\.[^"']*)*)["']/);
        lineData.description = descMatch?.[1]?.replace(/\\"/g, '"') || null;
        
        const dutyMatch = match[0].match(/["']duty_rate["']\s*:\s*(?:["']([^"']+)["']|(\d+\.?\d*)|null)/);
        lineData.duty_rate = dutyMatch?.[1] || (dutyMatch?.[2] ? parseFloat(dutyMatch[2]) : null);
        
        const unitMatch = match[0].match(/["']unit_norm["']\s*:\s*(?:["']([^"']*)["']|null)/);
        lineData.unit_norm = unitMatch?.[1] || null;
        
        if (lineData.position_6 || lineData.national_code || lineData.description) {
          lines.push(lineData);
        }
      }
    }
  }
  
  console.log(`[extractRawLinesAggressively] Found ${lines.length} lines`);
  return lines;
}

/**
 * Parse JSON avec tentatives multiples
 */
function parseJsonRobust(text: string, debug: RawTableDebug): { parsed: any | null; method: string } {
  // Tentative 1: Parse direct
  try {
    return { parsed: JSON.parse(text), method: "direct" };
  } catch {}
  
  // Tentative 2: Après réparation
  const repaired = repairTruncatedJson(text);
  try {
    return { parsed: JSON.parse(repaired), method: "repaired" };
  } catch {}
  
  // Tentative 3: Extraction partielle
  try {
    const partial = extractPartialData(text, debug);
    if (partial && (partial.raw_lines || partial.summary || partial.hs_codes)) {
      return { parsed: partial, method: "partial" };
    }
  } catch {}
  
  // Tentative 4: Plus grand objet JSON valide
  let bestMatch = null;
  let bestLength = 0;
  
  const jsonObjects = text.matchAll(/\{[\s\S]*?\}/g);
  for (const match of jsonObjects) {
    if (match[0].length > bestLength) {
      try {
        JSON.parse(match[0]);
        bestMatch = match[0];
        bestLength = match[0].length;
      } catch {}
    }
  }
  
  if (bestMatch) {
    try {
      return { parsed: JSON.parse(bestMatch), method: "largest_object" };
    } catch {}
  }
  
  return { parsed: null, method: "failed" };
}

// =============================================================================
// ÉTAPE 6: EXTRACTION DES HS CODES DEPUIS TARIFF LINES
// =============================================================================

/**
 * Extrait les codes HS uniques depuis les lignes tarifaires validées
 */
function extractHSCodesFromTariffLines(
  tariffLines: TariffLine[],
  rawLines: RawTariffLine[],
  claudeHSCodes?: any[]
): HSCodeEntry[] {
  const seen = new Set<string>();
  const results: HSCodeEntry[] = [];
  const descriptionMap = new Map<string, string>();
  
  // ÉTAPE 1: Collecter les descriptions depuis Claude hs_codes
  if (claudeHSCodes && Array.isArray(claudeHSCodes)) {
    for (const hs of claudeHSCodes) {
      const code = hs.code_clean || digitsOnly(hs.code || "");
      const desc = (hs.description || "").trim();
      if (code && code.length >= 6 && desc) {
        const code6 = code.slice(0, 6);
        if (!descriptionMap.has(code6)) {
          descriptionMap.set(code6, desc);
        }
      }
    }
  }
  
  // ÉTAPE 2: Ajouter les codes depuis tariffLines validées (SOURCE PRINCIPALE)
  for (const line of tariffLines) {
    const code6 = line.hs_code_6;
    if (code6 && isValidCleanCode(code6) && !seen.has(code6)) {
      seen.add(code6);
      const desc = descriptionMap.get(code6) || line.description;
      results.push({
        code: `${code6.slice(0, 4)}.${code6.slice(4, 6)}`,
        code_clean: code6,
        description: desc,
        level: "subheading"
      });
    }
  }
  
  // ÉTAPE 3: Compléter depuis rawLines
  for (const line of rawLines) {
    const hs6 = line.hs_code_6 ? digitsOnly(line.hs_code_6).slice(0, 6) :
                line.national_code ? digitsOnly(line.national_code).slice(0, 6) : null;
    
    if (hs6 && isValidCleanCode(hs6) && !seen.has(hs6)) {
      seen.add(hs6);
      const desc = descriptionMap.get(hs6) || (line.description || "").replace(/^[–\-\s]+/, "").trim();
      results.push({
        code: `${hs6.slice(0, 4)}.${hs6.slice(4, 6)}`,
        code_clean: hs6,
        description: desc,
        level: "subheading"
      });
    }
  }
  
  // ÉTAPE 4: Compléter depuis Claude hs_codes
  if (claudeHSCodes && Array.isArray(claudeHSCodes)) {
    for (const hs of claudeHSCodes) {
      const codeRaw = hs.code_clean || digitsOnly(hs.code || "");
      const code6 = codeRaw.length >= 6 ? codeRaw.slice(0, 6) : null;
      
      if (code6 && isValidCleanCode(code6) && !seen.has(code6)) {
        seen.add(code6);
        results.push({
          code: `${code6.slice(0, 4)}.${code6.slice(4, 6)}`,
          code_clean: code6,
          description: hs.description || "",
          level: hs.level || "subheading"
        });
      }
    }
  }
  
  console.log(`[extractHSCodesFromTariffLines] Total: ${results.length} HS codes`);
  return results;
}

// =============================================================================
// ÉTAPE 7: EXTRACTION DES NOTES
// =============================================================================

/**
 * Extrait les notes importantes depuis le texte du document (fallback serveur)
 */
function extractNotesFromText(fullText: string): ExtractedNote[] {
  if (!fullText) return [];
  
  const notes: ExtractedNote[] = [];
  const seen = new Set<string>();
  
  const lines = fullText.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Notes de chapitre
    if (/^(NOTE|NOTES|Note|Notes)\s*[:.]?\s*/i.test(line)) {
      const text = line.replace(/^(NOTE|NOTES|Note|Notes)\s*[:.]?\s*/i, "").trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        notes.push({ note_type: "chapter_note", note_text: text });
      }
    }
    
    // Définitions (BRT : ..., etc.)
    const defMatch = line.match(/^([A-Z]{2,5})\s*:\s*(.+)/);
    if (defMatch) {
      const anchor = defMatch[1];
      const text = defMatch[2].trim();
      if (!seen.has(anchor)) {
        seen.add(anchor);
        notes.push({ note_type: "definition", anchor, note_text: `${anchor} : ${text}` });
      }
    }
    
    // Footnotes (1), (2), (a), (b)
    const footMatch = line.match(/^\(([a-z0-9])\)\s*(.+)/i);
    if (footMatch) {
      const anchor = `(${footMatch[1]})`;
      const text = footMatch[2].trim();
      if (!seen.has(anchor)) {
        seen.add(anchor);
        notes.push({ note_type: "footnote", anchor, note_text: text });
      }
    }
    
    // Exclusions
    if (/^(Sont exclus|Ne comprend pas|Exclu)/i.test(line)) {
      if (!seen.has(line)) {
        seen.add(line);
        notes.push({ note_type: "exclusion", note_text: line });
      }
    }
  }
  
  return notes;
}

// =============================================================================
// HELPERS
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseFlexibleDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  
  const str = dateStr.trim();
  
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const [, day, month, year] = dmyMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  const frenchMonths: Record<string, string> = {
    'janvier': '01', 'février': '02', 'mars': '03', 'avril': '04',
    'mai': '05', 'juin': '06', 'juillet': '07', 'août': '08',
    'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12',
  };
  
  const frenchMatch = str.match(/(\d{1,2})(?:er)?\s+(\w+)\s+(\d{4})/i);
  if (frenchMatch) {
    const [, day, monthName, year] = frenchMatch;
    const month = frenchMonths[monthName.toLowerCase()];
    if (month) return `${year}-${month}-${day.padStart(2, '0')}`;
  }
  
  try {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  } catch {}
  
  return null;
}

// =============================================================================
// APPEL CLAUDE API
// =============================================================================

async function analyzeWithClaude(
  base64Pdf: string,
  title: string,
  category: string,
  apiKey: string,
  documentType: DocumentType = "tariff",
  retryCount = 0
): Promise<{ result: AnalysisResult | null; truncated: boolean; rateLimited: boolean; documentType: DocumentType }> {
  
  const MAX_RETRIES = 5;
  const BASE_DELAY = 5000;
  const prompt = getAnalysisPrompt(title, category, documentType);
  
  console.log(`PDF base64 size: ${base64Pdf.length} chars`);
  console.log(`Document type: ${documentType}`);
  console.log("Using model:", CLAUDE_MODEL);
  
  const requestBody = {
    model: CLAUDE_MODEL,
    max_tokens: 64000,
    system: "Tu es un expert en tarifs douaniers et nomenclature SH. Analyse les PDFs de manière exhaustive et retourne les données en JSON structuré.",
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Pdf } },
        { type: "text", text: prompt }
      ]
    }],
  };
  
  console.log("Sending request to Claude API...");
  
  const controller = new AbortController();
  const CLAUDE_TIMEOUT_MS = 290000;
  const timeoutId = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);
  
  let aiResponse: Response;
  try {
    aiResponse = await fetch(ANTHROPIC_API_URL, {
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
  } catch (fetchError: any) {
    clearTimeout(timeoutId);
    if (fetchError.name === 'AbortError') {
      console.error(`Request timed out after ${CLAUDE_TIMEOUT_MS / 1000} seconds`);
      throw new Error(`Timeout après ${CLAUDE_TIMEOUT_MS / 60000} min`);
    }
    throw fetchError;
  }
  
  clearTimeout(timeoutId);
  console.log("Claude response status:", aiResponse.status);
  
  // Rate limiting
  if (aiResponse.status === 429 || aiResponse.status === 529) {
    if (retryCount < MAX_RETRIES) {
      const retryAfter = aiResponse.headers.get("Retry-After");
      const delayMs = retryAfter ? parseInt(retryAfter) * 1000 : BASE_DELAY * Math.pow(2, retryCount);
      console.log(`Rate limited (${aiResponse.status}). Retry ${retryCount + 1}/${MAX_RETRIES} after ${delayMs}ms...`);
      await delay(delayMs);
      return analyzeWithClaude(base64Pdf, title, category, apiKey, documentType, retryCount + 1);
    } else {
      console.error("Max retries reached");
      return { result: null, truncated: false, rateLimited: true, documentType };
    }
  }
  
  if (!aiResponse.ok) {
    const errorText = await aiResponse.text();
    console.error("Claude error:", aiResponse.status, errorText);
    throw new Error(`Claude error: ${aiResponse.status} - ${errorText}`);
  }
  
  const aiData = await aiResponse.json();
  const stopReason = aiData.stop_reason;
  const truncated = stopReason === "max_tokens";
  
  console.log("Claude response - stop_reason:", stopReason, "truncated:", truncated);
  
  const responseText = aiData.content?.[0]?.text || "{}";
  let cleanedResponse = responseText.trim();
  
  // Nettoyer les blocs markdown
  if (cleanedResponse.includes("```json")) {
    const jsonStart = cleanedResponse.indexOf("```json") + 7;
    const jsonEnd = cleanedResponse.indexOf("```", jsonStart);
    if (jsonEnd > jsonStart) cleanedResponse = cleanedResponse.slice(jsonStart, jsonEnd).trim();
  } else if (cleanedResponse.includes("```")) {
    const jsonStart = cleanedResponse.indexOf("```") + 3;
    const jsonEnd = cleanedResponse.indexOf("```", jsonStart);
    if (jsonEnd > jsonStart) cleanedResponse = cleanedResponse.slice(jsonStart, jsonEnd).trim();
  }
  
  if (!cleanedResponse.startsWith("{")) {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) cleanedResponse = jsonMatch[0];
  }
  
  // Initialiser debug
  const debug: RawTableDebug = {
    detectedSwaps: 0,
    swappedSamples: [],
    parsingWarnings: [],
    skippedLines: 0
  };
  
  // Parse JSON
  const { parsed, method } = parseJsonRobust(cleanedResponse, debug);
  console.log(`JSON parsing method: ${method}`);
  
  if (!parsed) {
    console.error("All JSON parsing methods failed");
    return { 
      result: {
        summary: "Analyse échouée - Impossible de parser la réponse.",
        key_points: [],
        hs_codes: [],
        tariff_lines: [],
        raw_table_debug: debug
      }, 
      truncated, 
      rateLimited: false,
      documentType
    };
  }
  
  const isRegulatory = isRegulatoryDocument(category, title);
  
  // Extraction agressive si pas de raw_lines
  if (!isRegulatory && (!parsed.raw_lines || parsed.raw_lines.length === 0)) {
    console.log("No raw_lines found, attempting aggressive extraction...");
    const aggressiveLines = extractRawLinesAggressively(cleanedResponse, debug);
    if (aggressiveLines.length > 0) {
      parsed.raw_lines = aggressiveLines;
    }
  }
  
  // Traitement des données
  let tariffLines: TariffLine[] = [];
  let hsCodeEntries: HSCodeEntry[] = [];
  let extractedNotes: ExtractedNote[] = [];
  
  if (isRegulatory) {
    console.log(`Processing REGULATORY document`);
    if (parsed.hs_codes && Array.isArray(parsed.hs_codes)) {
      hsCodeEntries = parsed.hs_codes.filter((hs: any) => hs.code_clean && /^\d{6}$/.test(hs.code_clean));
    }
  } else if (parsed.raw_lines && Array.isArray(parsed.raw_lines) && parsed.raw_lines.length > 0) {
    console.log(`Processing ${parsed.raw_lines.length} raw lines...`);
    
    // ÉTAPE 3: Traitement avec héritage et swap
    const { tariffLines: processedLines, debug: processDebug } = processRawLines(parsed.raw_lines);
    tariffLines = processedLines;
    
    // Fusionner les debug info
    debug.detectedSwaps = processDebug.detectedSwaps;
    debug.swappedSamples = processDebug.swappedSamples;
    debug.parsingWarnings.push(...processDebug.parsingWarnings);
    debug.skippedLines = processDebug.skippedLines;
    
    // ÉTAPE 6: Extraire les codes HS depuis les lignes tarifaires validées
    hsCodeEntries = extractHSCodesFromTariffLines(tariffLines, parsed.raw_lines, parsed.hs_codes);
    
    console.log(`Reconstructed ${tariffLines.length} tariff lines and ${hsCodeEntries.length} HS codes`);
  }
  
  // ÉTAPE 7: Extraire les notes
  if (parsed.notes && Array.isArray(parsed.notes)) {
    extractedNotes = parsed.notes.map((n: any) => ({
      note_type: n.note_type || "remark",
      anchor: n.anchor || undefined,
      note_text: n.note_text || "",
      page_number: n.page_number || undefined
    }));
  }
  
  // Fallback: extraire notes du full_text
  if (extractedNotes.length === 0 && parsed.full_text) {
    extractedNotes = extractNotesFromText(parsed.full_text);
  }
  
  const fullText = parsed.full_text || "";
  
  const result: AnalysisResult = {
    summary: parsed.summary || "",
    key_points: parsed.key_points || [],
    chapter_info: parsed.chapter_info,
    notes: parsed.notes,
    footnotes: parsed.footnotes,
    hs_codes: hsCodeEntries,
    tariff_lines: tariffLines,
    trade_agreements: parsed.trade_agreements || [],
    preferential_rates: parsed.preferential_rates || [],
    raw_lines: parsed.raw_lines,
    extracted_notes: extractedNotes,
    document_type: isRegulatory ? "regulatory" : "tariff",
    authorities: parsed.authorities || [],
    effective_date: parsed.effective_date,
    legal_references: parsed.legal_references || [],
    full_text: fullText,
    raw_table_debug: debug  // ÉTAPE 8: Mode DEBUG
  };
  
  console.log("Final result:", 
    "document_type:", isRegulatory ? "regulatory" : "tariff",
    "tariff_lines:", result.tariff_lines.length,
    "hs_codes:", result.hs_codes.length,
    "notes:", extractedNotes.length,
    "swaps:", debug.detectedSwaps,
    "skipped:", debug.skippedLines
  );
  
  return { result, truncated, rateLimited: false, documentType };
}

// =============================================================================
// HANDLER PRINCIPAL
// =============================================================================

serve(async (req) => {
  const logger = createLogger("analyze-pdf", req);
  
  if (req.method === "OPTIONS") return handleCorsPreFlight(req);
  
  logger.info("Request received");
  
  const clientId = getClientId(req);
  const rateLimit = await checkRateLimitDistributed(clientId, {
    maxRequests: 5,
    windowMs: 60000,
    blockDurationMs: 300000,
  });
  
  if (!rateLimit.allowed) return rateLimitResponse(req, rateLimit.resetAt);
  
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch (e) {
      logger.error("Invalid JSON", e as Error);
      return errorResponse(req, "Body JSON invalide", 400);
    }
    
    const validation = validateAnalyzePdfRequest(body);
    if (!validation.valid) {
      logger.warn("Validation failed", { error: validation.error });
      return errorResponse(req, validation.error!, 400);
    }
    
    const { pdfId, filePath, previewOnly = true } = validation.data!;
    logger.info("Analyzing PDF", { pdfId, previewOnly });
    
    if (!filePath) return errorResponse(req, "filePath is required", 400);
    
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
    
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    // Vérifier taille fichier
    const { data: fileList } = await supabase.storage
      .from("pdf-documents")
      .list(filePath.split('/').slice(0, -1).join('/') || '', { search: filePath.split('/').pop() });
    
    const fileInfo = fileList?.find(f => filePath.endsWith(f.name));
    const fileSizeMB = fileInfo?.metadata?.size ? fileInfo.metadata.size / (1024 * 1024) : 0;
    
    if (fileSizeMB > 25) {
      return new Response(
        JSON.stringify({ error: `PDF trop volumineux (${fileSizeMB.toFixed(1)}MB). Limite: 25MB.` }),
        { status: 413, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }
    
    // Télécharger PDF
    const { data: pdfData, error: downloadError } = await supabase.storage
      .from("pdf-documents")
      .download(filePath);
    
    if (downloadError) throw new Error(`Failed to download PDF: ${downloadError.message}`);
    
    // Convertir en base64
    const arrayBuffer = await pdfData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    let binaryString = '';
    const CHUNK_SIZE = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const chunk = bytes.slice(i, Math.min(i + CHUNK_SIZE, bytes.length));
      binaryString += String.fromCharCode(...chunk);
    }
    const base64Pdf = btoa(binaryString);
    
    console.log("PDF converted to base64, size:", base64Pdf.length, "chars");
    
    // Métadonnées PDF
    const { data: pdfDoc } = await supabase
      .from("pdf_documents")
      .select("title, category, country_code")
      .eq("id", pdfId)
      .single();
    
    const title = pdfDoc?.title || "Tarif douanier";
    const category = pdfDoc?.category || "tarif";
    const countryCode = pdfDoc?.country_code || "MA";
    
    // Vérifier si extraction existe déjà
    const { data: existingExtraction } = await supabase
      .from("pdf_extractions")
      .select("id, summary")
      .eq("pdf_id", pdfId)
      .maybeSingle();
    
    if (existingExtraction && existingExtraction.summary && existingExtraction.summary !== "__PROCESSING__") {
      console.log("Extraction already exists for PDF:", pdfId);
      
      const { data: fullExtraction } = await supabase
        .from("pdf_extractions")
        .select("*")
        .eq("id", existingExtraction.id)
        .single();
      
      if (fullExtraction) {
        const extractedData = fullExtraction.extracted_data as Record<string, any> || {};
        const hsCodesFull = extractedData.hs_codes_full || [];
        
        return new Response(
          JSON.stringify({
            summary: fullExtraction.summary,
            key_points: fullExtraction.key_points || [],
            hs_codes: hsCodesFull,
            tariff_lines: fullExtraction.detected_tariff_changes || [],
            full_text: fullExtraction.extracted_text || "",
            chapter_info: extractedData.chapter_info || null,
            trade_agreements: extractedData.trade_agreements || [],
            preferential_rates: extractedData.preferential_rates || [],
            extracted_notes: extractedData.extracted_notes || [],
            raw_table_debug: extractedData.raw_table_debug || null,
            pdfId,
            pdfTitle: title,
            countryCode,
            cached: true,
          }),
          { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
        );
      }
    }
    
    // En cours de traitement?
    if (existingExtraction && existingExtraction.summary === "__PROCESSING__") {
      return new Response(
        JSON.stringify({ status: "processing", message: "Analyse en cours...", pdfId }),
        { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }
    
    // Créer marqueur PROCESSING
    const { data: processingMarker } = await supabase.from("pdf_extractions").insert({
      pdf_id: pdfId,
      summary: "__PROCESSING__",
      key_points: [],
      mentioned_hs_codes: [],
      detected_tariff_changes: [],
      extraction_model: CLAUDE_MODEL,
      extraction_confidence: 0,
    }).select("id").single();
    
    console.log("Created PROCESSING marker for PDF:", pdfId);
    
    // Traitement en arrière-plan
    const backgroundProcess = async () => {
      try {
        console.log(`[Background] Starting analysis for PDF: ${pdfId}`);
        
        // Classification
        const classification = await classifyDocument(base64Pdf, title, category, ANTHROPIC_API_KEY);
        console.log(`[Background] Classified as: ${classification.type} (${classification.confidence})`);
        
        // Analyse
        const { result, truncated, rateLimited, documentType } = await analyzeWithClaude(
          base64Pdf, title, category, ANTHROPIC_API_KEY, classification.type
        );
        
        if (rateLimited) {
          console.error("[Background] Rate limited for PDF:", pdfId);
          await supabase.from("pdf_extractions").update({
            summary: "Erreur: Rate limit API - réessayez dans quelques minutes",
            extraction_confidence: 0,
          }).eq("pdf_id", pdfId);
          return;
        }
        
        if (!result) {
          console.error("[Background] No analysis result for PDF:", pdfId);
          await supabase.from("pdf_extractions").update({
            summary: "Erreur: Analyse échouée",
            extraction_confidence: 0,
          }).eq("pdf_id", pdfId);
          return;
        }
        
        const isRegulatoryDoc = documentType === "regulatory";
        
        console.log("[Background] Analysis complete:",
          "HS codes:", result.hs_codes?.length || 0,
          "Tariff lines:", result.tariff_lines?.length || 0,
          "Notes:", result.extracted_notes?.length || 0,
          "Swaps:", result.raw_table_debug?.detectedSwaps || 0
        );
        
        // Mettre à jour l'extraction
        const { error: updateError } = await supabase.from("pdf_extractions").update({
          summary: result.summary || "Document analysé",
          key_points: result.key_points || [],
          mentioned_hs_codes: result.hs_codes?.map(h => h.code_clean) || [],
          detected_tariff_changes: result.tariff_lines || [],
          extracted_text: result.full_text || null,
          extracted_data: {
            chapter_info: result.chapter_info || null,
            notes: result.notes || null,
            footnotes: result.footnotes || null,
            tariff_lines_count: result.tariff_lines?.length || 0,
            inherited_lines_count: result.tariff_lines?.filter(l => l.is_inherited).length || 0,
            trade_agreements: result.trade_agreements || [],
            preferential_rates: result.preferential_rates || [],
            authorities: result.authorities || [],
            legal_references: result.legal_references || [],
            document_type: isRegulatoryDoc ? "regulatory" : "tariff",
            hs_codes_full: result.hs_codes || [],
            extracted_notes: result.extracted_notes || [],
            raw_table_debug: result.raw_table_debug || null,
          },
          extraction_model: CLAUDE_MODEL,
          extraction_confidence: 0.92,
          extracted_at: new Date().toISOString(),
        }).eq("pdf_id", pdfId);
        
        if (updateError) console.error("[Background] Extraction update error:", updateError);
        else console.log("[Background] ✅ Extraction saved for PDF:", pdfId);
        
        // ÉTAPE 7: Insérer les notes dans tariff_notes
        if (result.extracted_notes && result.extracted_notes.length > 0 && !previewOnly) {
          const chapterNum = result.chapter_info?.number?.toString() || null;
          
          const noteRows = result.extracted_notes.map((note: ExtractedNote) => ({
            country_code: countryCode,
            chapter_number: chapterNum,
            note_type: note.note_type,
            anchor: note.anchor || null,
            note_text: note.note_text,
            page_number: note.page_number || null,
            source_pdf: title,
            source_extraction_id: processingMarker?.id ? parseInt(processingMarker.id) : null
          }));
          
          const { error: noteError } = await supabase
            .from("tariff_notes")
            .insert(noteRows);
          
          if (noteError) console.error("[Background] Notes insert error:", noteError);
          else console.log(`[Background] ✅ Inserted ${noteRows.length} notes`);
        }
        
        // Insérer tarifs et codes HS
        if (!previewOnly) {
          // ÉTAPE 5: Insert tariff lines avec unit_comp
          if (result.tariff_lines && result.tariff_lines.length > 0) {
            const tariffRows = result.tariff_lines.map(line => ({
              country_code: countryCode,
              hs_code_6: line.hs_code_6,
              national_code: line.national_code,
              description_local: line.description,
              duty_rate: line.duty_rate,
              duty_note: line.duty_note,
              vat_rate: 20,
              unit_code: line.unit_norm || null,
              unit_complementary_code: line.unit_comp || null,  // ÉTAPE 5
              is_active: true,
              is_inherited: line.is_inherited,
              source: `PDF: ${title}`,
            }));
            
            const { error: tariffError } = await supabase
              .from("country_tariffs")
              .upsert(tariffRows, { onConflict: "country_code,national_code" });
            
            if (tariffError) console.error("[Background] Tariff insert error:", tariffError);
            else console.log(`[Background] ✅ Inserted ${tariffRows.length} tariff lines`);
          }
          
          // ÉTAPE 6: Insert HS codes depuis tariffLines
          if (result.hs_codes && result.hs_codes.length > 0) {
            const hsRows = result.hs_codes.map(hsCode => ({
              code: hsCode.code,
              code_clean: hsCode.code_clean,
              description_fr: hsCode.description,
              chapter_number: result.chapter_info?.number || parseInt(hsCode.code_clean?.slice(0, 2) || "0"),
              chapter_title_fr: result.chapter_info?.title,
              is_active: true,
              level: hsCode.level || "subheading",
              parent_code: hsCode.code_clean?.slice(0, 4),
            }));
            
            const { error: hsError } = await supabase
              .from("hs_codes")
              .upsert(hsRows, { onConflict: "code" });
            
            if (hsError) console.error("[Background] HS codes insert error:", hsError);
            else console.log(`[Background] ✅ Inserted ${hsRows.length} HS codes`);
          }
        }
        
        // Update PDF document metadata
        const chapterNumber = result.chapter_info?.number;
        const updateData: Record<string, any> = {
          is_verified: true,
          verified_at: new Date().toISOString(),
          related_hs_codes: result.hs_codes?.map(h => h.code_clean) || [],
          keywords: chapterNumber ? `Chapitre ${chapterNumber}` : null,
          document_reference: result.document_reference || null,
          issuing_authority: result.issuing_authority?.name || null,
          document_type: isRegulatoryDoc ? "regulatory" : "tariff",
        };
        
        // Renommer si tarif dans uploads/
        if (!isRegulatoryDoc && chapterNumber && filePath.startsWith("uploads/")) {
          const paddedChapter = String(chapterNumber).padStart(2, "0");
          const newFilePath = `tarifs/SH_CODE_${paddedChapter}.pdf`;
          
          console.log(`[Background] Renaming PDF: ${filePath} -> ${newFilePath}`);
          
          try {
            const { data: existingFile } = await supabase.storage
              .from("pdf-documents")
              .list("tarifs", { search: `SH_CODE_${paddedChapter}.pdf` });
            
            if (existingFile && existingFile.length > 0) {
              await supabase.storage.from("pdf-documents").remove([newFilePath]);
            }
            
            const { data: fileData, error: downloadErr } = await supabase.storage
              .from("pdf-documents")
              .download(filePath);
            
            if (!downloadErr && fileData) {
              const { error: uploadErr } = await supabase.storage
                .from("pdf-documents")
                .upload(newFilePath, fileData, { cacheControl: "3600", upsert: true, contentType: "application/pdf" });
              
              if (!uploadErr) {
                await supabase.storage.from("pdf-documents").remove([filePath]);
                updateData.file_path = newFilePath;
                updateData.title = `Chapitre SH ${paddedChapter}`;
                console.log(`[Background] ✅ PDF renamed to ${newFilePath}`);
              }
            }
          } catch (renameError) {
            console.error("[Background] PDF rename error:", renameError);
          }
        }
        
        await supabase.from("pdf_documents").update(updateData).eq("id", pdfId);
        
        // Documents réglementaires: sauvegarder données structurées
        if (isRegulatoryDoc) {
          console.log("[Background] Saving regulatory data for PDF:", pdfId);
          
          // Legal references
          if (result.legal_references && Array.isArray(result.legal_references) && result.legal_references.length > 0) {
            await supabase.from("legal_references").delete().eq("pdf_id", pdfId);
            
            const legalRefRows = result.legal_references
              .filter((ref: any) => ref && (typeof ref === 'object' ? ref.reference : ref))
              .map((ref: any) => {
                if (typeof ref === 'string') {
                  return { pdf_id: pdfId, reference_type: 'reference', reference_number: ref, country_code: countryCode };
                }
                return {
                  pdf_id: pdfId,
                  reference_type: ref.type || 'reference',
                  reference_number: ref.reference || '',
                  title: ref.title || null,
                  reference_date: ref.date ? parseFlexibleDate(ref.date) : null,
                  context: ref.context || null,
                  country_code: countryCode,
                };
              })
              .filter((r: any) => r.reference_number);
            
            if (legalRefRows.length > 0) {
              const { error: legalError } = await supabase.from("legal_references").insert(legalRefRows);
              if (!legalError) console.log(`[Background] ✅ Inserted ${legalRefRows.length} legal references`);
            }
          }
          
          // Important dates
          if (result.important_dates && Array.isArray(result.important_dates) && result.important_dates.length > 0) {
            await supabase.from("regulatory_dates").delete().eq("pdf_id", pdfId);
            
            const dateRows = result.important_dates
              .filter((d: any) => d && d.date)
              .map((d: any) => ({
                pdf_id: pdfId,
                date_value: parseFlexibleDate(d.date),
                date_type: d.type || 'référence',
                description: d.description || null,
                country_code: countryCode,
              }))
              .filter((d: any) => d.date_value);
            
            if (dateRows.length > 0) {
              const { error: dateError } = await supabase.from("regulatory_dates").insert(dateRows);
              if (!dateError) console.log(`[Background] ✅ Inserted ${dateRows.length} regulatory dates`);
            }
          }
          
          // Procedures
          if (result.procedures && Array.isArray(result.procedures) && result.procedures.length > 0) {
            await supabase.from("regulatory_procedures").delete().eq("pdf_id", pdfId);
            
            const procRows = result.procedures
              .filter((p: any) => p && p.name)
              .map((p: any) => ({
                pdf_id: pdfId,
                procedure_name: p.name,
                required_documents: p.required_documents || [],
                deadlines: p.deadlines || null,
                penalties: p.penalties || null,
                authority: p.authority || result.issuing_authority?.name || null,
                country_code: countryCode,
              }));
            
            if (procRows.length > 0) {
              const { error: procError } = await supabase.from("regulatory_procedures").insert(procRows);
              if (!procError) console.log(`[Background] ✅ Inserted ${procRows.length} procedures`);
            }
          }
        }
        
        console.log("[Background] ✅ PDF processing complete:", pdfId);
        
      } catch (bgError) {
        console.error("[Background] Error processing PDF:", pdfId, bgError);
        await supabase.from("pdf_extractions").update({
          summary: `Erreur: ${bgError instanceof Error ? bgError.message : "Erreur inconnue"}`,
          extraction_confidence: 0,
        }).eq("pdf_id", pdfId);
      }
    };
    
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      console.log("Using EdgeRuntime.waitUntil for background processing");
      // @ts-ignore
      EdgeRuntime.waitUntil(backgroundProcess());
    } else {
      console.log("EdgeRuntime.waitUntil not available, running synchronously");
      await backgroundProcess();
    }
    
    return new Response(
      JSON.stringify({
        status: "processing",
        message: "Analyse démarrée en arrière-plan.",
        pdfId,
        pdfTitle: title,
        countryCode,
        extractionId: processingMarker?.id,
      }),
      { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
    
  } catch (error) {
    logger.error("Analyze PDF error", error as Error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur d'analyse" }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
