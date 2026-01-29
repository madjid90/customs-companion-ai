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
// NOTE: Only Sonnet models support native PDF input (anthropic-beta header)
// Haiku does NOT support PDF input, so we use Sonnet for all PDF analysis
const CLAUDE_MODEL = "claude-sonnet-4-20250514"; // Sonnet 4 - supports native PDF input

// =============================================================================
// INTERFACES
// =============================================================================

interface RawTarifLine {
  // Structure SIMPLIFIÉE - Claude extrait directement le code national à 10 chiffres
  national_code: string;    // Code national COMPLET à 10 chiffres (ex: "3201100000")
  hs_code_6?: string;       // Code SH à 6 chiffres (optionnel, déduit si absent)
  description: string;
  duty_rate: string | number | null;
  unit: string | null;
}

interface TariffLine {
  national_code: string;   // 10 chiffres
  hs_code_6: string;       // 6 premiers chiffres
  description: string;
  duty_rate: number;
  duty_note: string | null;
  unit: string | null;
  is_inherited: boolean;
}

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
  raw_lines?: RawTarifLine[];  // Pour debug
  document_type?: string;  // "tariff" ou "regulatory"
  effective_date?: string;
  legal_references?: string[];
  full_text?: string;  // Texte intégral du document pour recherche RAG
}

// =============================================================================
// PROMPT CLAUDE - DOCUMENTS TARIFAIRES (tableaux SH codes)
// =============================================================================

const getTariffPrompt = (title: string, category: string) => `Expert en tarifs douaniers marocains. Analyse ce PDF et extrais TOUTES les lignes tarifaires.

Doc: ${title}
Catégorie : ${category}

=== TA MISSION ===

Extraire TOUTES les lignes tarifaires avec le CODE NATIONAL COMPLET À 10 CHIFFRES.
Le tarif marocain utilise un système de codification qui forme le code national.

⚠️⚠️⚠️ RÈGLE LA PLUS IMPORTANTE ⚠️⚠️⚠️
Tu DOIS analyser TOUTES LES PAGES du PDF, de la première à la dernière.
CHAQUE ligne tarifaire de CHAQUE page doit être extraite, y compris:
- Les lignes sur la DERNIÈRE PAGE du document
- Les lignes qui apparaissent APRÈS les notes de bas de page
- Les sous-lignes (ex: 10, 20, 30, 80, 90) même si elles sont sur une page différente de leur en-tête

=== STRUCTURE DU TARIF MAROCAIN ===

Les codes nationaux ont TOUJOURS 10 chiffres.

⚠️⚠️⚠️ RÈGLE CRITIQUE : COMMENT LIRE LE PDF ⚠️⚠️⚠️

STRUCTURE DU TABLEAU PDF:
Colonne 1 (Position) | Colonne 2 | Colonne 3 | Description | Taux | Unité

Le CODE NATIONAL = Position_6_chiffres + Colonne2 + Colonne3 = 10 chiffres

⚠️ RÈGLE D'HÉRITAGE MULTI-NIVEAUX ⚠️

Les valeurs des colonnes s'HÉRITENT de la ligne PARENT quand elles sont vides.
Tu dois SUIVRE la hiérarchie pour trouver les bonnes valeurs.

EXEMPLE CONCRET DU CHAPITRE 12 - POSITION 1205.90:

PDF (ce que tu vois) :
Position | Col2 | Col3 | Description                    | Taux
---------|------|------|--------------------------------|------
1205.90  |      |      | - Autres                       | (pas de taux = PARENT niveau 0)
         | 10   |      | --- de semence (a):            | (pas de taux = PARENT niveau 1)
         |      | 10   | ---- de navette (a)            | 2,5   ← LIGNE TARIFAIRE
         |      | 90   | ---- de colza (a)              | 2,5   ← LIGNE TARIFAIRE
         | 90   |      | --- autres:                    | (pas de taux = PARENT niveau 1)
         |      |      | ---- de navette:               | (pas de taux = catégorie)
         |      | 11   | ----- importées triturateurs   | 2,5   ← LIGNE TARIFAIRE
         |      | 19   | ----- autres                   | 2,5   ← LIGNE TARIFAIRE
         |      |      | ---- de colza:                 | (pas de taux = catégorie)
         |      | 91   | ----- importées triturateurs   | 2,5   ← LIGNE TARIFAIRE
         |      | 99   | ----- autres                   | 2,5   ← LIGNE TARIFAIRE

EXTRACTION CORRECTE:

Pour "| | 10 | de navette (a) | 2,5":
→ Position héritée = 1205.90 = 120590
→ Col2 héritée du parent "10" = 10 → positions 7-8
→ Col3 de cette ligne = 10 → positions 9-10
→ CODE = 120590 + 10 + 10 = 1205901010 ✓

Pour "| | 90 | de colza (a) | 2,5":
→ Position héritée = 1205.90 = 120590
→ Col2 héritée du parent "10" = 10 → positions 7-8
→ Col3 de cette ligne = 90 → positions 9-10
→ CODE = 120590 + 10 + 90 = 1205901090 ✓

Pour "| | 11 | importées triturateurs | 2,5":
→ Position héritée = 1205.90 = 120590
→ Col2 héritée du parent "90" = 90 → positions 7-8
→ Col3 de cette ligne = 11 → positions 9-10
→ CODE = 120590 + 90 + 11 = 1205909011 ✓

Pour "| | 99 | autres | 2,5":
→ Position héritée = 1205.90 = 120590
→ Col2 héritée du parent "90" = 90 → positions 7-8
→ Col3 de cette ligne = 99 → positions 9-10
→ CODE = 120590 + 90 + 99 = 1205909099 ✓

⚠️ ERREURS À NE JAMAIS FAIRE:
FAUX: 1205901000 (tu as mis 10 en pos 7-8 et 00 en pos 9-10)
VRAI: 1205901010 (10 hérité en pos 7-8, 10 de la ligne en pos 9-10)

FAUX: 1205909000 (tu as mis 90 en pos 7-8 et 00 en pos 9-10)
VRAI: 1205909011 (90 hérité en pos 7-8, 11 de la ligne en pos 9-10)

AUTRE EXEMPLE - POSITION 1206.00:

PDF:
Position | Col2 | Col3 | Description                    | Taux
---------|------|------|--------------------------------|------
1206.00  |      |      | Graines de tournesol           | (PARENT)
         | 10   | 00   | --- de semence                 | 2,5   ← LIGNE TARIFAIRE
         | 81   | 00   | --- importées triturateurs     | 2,5   ← LIGNE TARIFAIRE
         | 89   | 00   | --- autres                     | 2,5   ← LIGNE TARIFAIRE

Pour "| 10 | 00 | de semence | 2,5":
→ Position héritée = 1206.00 = 120600
→ Col2 de cette ligne = 10 → positions 7-8
→ Col3 de cette ligne = 00 → positions 9-10
→ CODE = 120600 + 10 + 00 = 1206001000 ✓

RÈGLE UNIVERSELLE:
1. TROUVE la Position 6 chiffres (héritée ou de la ligne)
2. TROUVE la Col2 (héritée de la ligne parent OU de cette ligne si présente)
3. TROUVE la Col3 (toujours de cette ligne car c'est le niveau le plus bas)
4. CONCATÈNE: Position + Col2 + Col3 = Code 10 chiffres

RAPPEL: Seules les lignes AVEC UN TAUX sont des lignes tarifaires.
Les lignes SANS TAUX sont des en-têtes/parents qui définissent le contexte.

=== CE QUE TU DOIS EXTRAIRE ===

Pour CHAQUE ligne tarifaire avec un taux de droit (duty_rate):
1. Reconstruire le CODE NATIONAL COMPLET À 10 CHIFFRES selon les règles ci-dessus
2. Les 6 premiers chiffres forment le code SH (hs_code_6)
3. La description exacte
4. Le taux de droit (avec notes si présentes, ex: "2,5(a)")
5. L'unité (kg, L, U, etc.)

=== RÈGLES D'HÉRITAGE ===

- Quand une colonne est VIDE, elle HÉRITE de la ligne précédente de niveau supérieur
- Les lignes SANS taux sont des EN-TÊTES qui établissent le contexte pour les sous-lignes
- Chaque ligne AVEC un taux doit avoir un code complet à 10 chiffres

=== FORMAT JSON DE SORTIE ===

{
  "summary": "Résumé du chapitre",
  "key_points": ["Note importante 1", "Note 2"],
  "chapter_info": {"number": 97, "title": "OBJETS D'ART, DE COLLECTION OU D'ANTIQUITE"},
  "notes": {
    "legal": ["1. Le présent chapitre ne comprend pas..."],
    "subposition": [],
    "complementary": []
  },
  "footnotes": {},
"raw_lines": [
    {"national_code": "9701210000", "hs_code_6": "970121", "description": "Tableaux, peintures et dessins ayant plus de 100 ans d'âge", "duty_rate": "2,5", "unit": "u"},
    {"national_code": "9701290010", "hs_code_6": "970129", "description": "Autres en liège ayant plus de 100 ans d'âge", "duty_rate": "2,5", "unit": "kg"},
    {"national_code": "9701290090", "hs_code_6": "970129", "description": "Autres ayant plus de 100 ans d'âge", "duty_rate": "2,5", "unit": "kg"}
  ],
  "hs_codes": [
    {"code": "9701.21", "code_clean": "970121", "description": "Tableaux, peintures et dessins ayant plus de 100 ans d'âge", "level": "subheading"},
    {"code": "9701.29", "code_clean": "970129", "description": "Autres ayant plus de 100 ans d'âge", "level": "subheading"}
  ],
  "trade_agreements": [],
  "preferential_rates": [],
  "full_text": "TEXTE INTÉGRAL DU DOCUMENT..."
}

=== RÈGLES STRICTES ===

✓ CHAQUE raw_line DOIT avoir un national_code de EXACTEMENT 10 CHIFFRES
✓ CHAQUE raw_line DOIT avoir un duty_rate non-vide (sinon c'est un en-tête, pas une ligne tarifaire)
✓ CHAQUE hs_codes DOIT avoir un code_clean de EXACTEMENT 6 CHIFFRES
✓ IGNORER les codes entre crochets [XX.XX] - ce sont des positions réservées
✓ EXTRAIRE ABSOLUMENT TOUTES LES LIGNES du tableau - sans limite, sans troncature
✓ Préserver les notes (a), (b) dans duty_rate: "2,5(a)"
✓ full_text doit contenir le TEXTE INTÉGRAL (jusqu'à 50000 caractères)

⚠️⚠️⚠️ VÉRIFICATION FINALE ⚠️⚠️⚠️
Avant de répondre, vérifie:
1. Tu as parcouru TOUTES les pages du PDF
2. Les codes qui finissent par "0010" ou "0090" sont corrects (pas "1000" ou "9000")
3. Les dernières lignes du chapitre sont incluses

**NE JAMAIS TRONQUER - EXTRAIRE 100% DES LIGNES TARIFAIRES DE TOUTES LES PAGES !**

RÉPONDS UNIQUEMENT AVEC LE JSON, RIEN D'AUTRE.`;

// =============================================================================
// PROMPT CLAUDE - DOCUMENTS RÉGLEMENTAIRES (circulaires, accords, notes)
// =============================================================================

const getRegulatoryPrompt = (title: string, category: string) => `Tu es un expert en réglementation douanière marocaine. Analyse ce document PDF (${category}) avec précision.

Document : ${title}
Type : ${category}

=== CONTEXTE ===
Ce document est un texte RÉGLEMENTAIRE/JURIDIQUE (circulaire, accord commercial, note, instruction, convention). 
Il NE CONTIENT PAS de tableau tarifaire avec des codes SH à extraire.
Tu dois extraire les informations juridiques et réglementaires pertinentes.

=== INFORMATIONS À EXTRAIRE ===

1. RÉSUMÉ : Une synthèse claire du contenu et de l'objectif du document

2. POINTS CLÉS : Les dispositions, règles ou obligations principales

3. ACCORDS COMMERCIAUX (si applicable) :
   - Nom de l'accord
   - Type (bilatéral, multilatéral, régional, transport, etc.)
   - Parties/Pays concernés
   - Date de signature et d'entrée en vigueur
   - Principales dispositions et avantages

4. TAUX PRÉFÉRENTIELS (si mentionnés) :
   - Code accord
   - Taux préférentiel
   - Conditions d'application
   - Pays d'origine concernés

5. CODES SH MENTIONNÉS (si le document fait référence à des codes spécifiques) :
   - Code au format XXXX.XX
   - Description associée

6. INFORMATIONS COMPLÉMENTAIRES :
   - Autorités compétentes citées
   - Dates importantes (application, expiration)
   - Références à d'autres textes

=== FORMAT JSON DE SORTIE ===

{
  "summary": "Résumé clair du document et son objectif principal",
  "key_points": [
    "Disposition principale 1",
    "Obligation ou règle importante 2",
    "Autre point clé 3"
  ],
  "chapter_info": {"number": null, "title": "Titre du document ou de l'accord"},
  "document_type": "${category}",
  "raw_lines": [],
  "hs_codes": [],
  "trade_agreements": [
    {
      "code": "CODE_ACCORD",
      "name": "Nom complet de l'accord",
      "type": "Type d'accord (bilatéral, transport, association, etc.)",
      "countries": ["Pays 1", "Pays 2"],
      "mentioned_benefits": ["Avantage 1", "Exemption X"]
    }
  ],
  "preferential_rates": [
    {
      "agreement_code": "CODE_ACCORD",
      "agreement_name": "Nom de l'accord",
      "hs_code": "XXXXXX",
      "preferential_rate": 0,
      "conditions": "Conditions d'application",
      "origin_countries": ["Pays d'origine"]
    }
  ],
  "authorities": ["Autorité compétente 1", "Ministère X"],
  "effective_date": "Date d'entrée en vigueur si mentionnée",
  "legal_references": ["Référence à d'autres textes"],
  "full_text": "TEXTE INTÉGRAL DU DOCUMENT - Copie ici TOUT le contenu textuel visible du PDF, incluant les articles, paragraphes, conditions, dispositions, annexes. Ce texte sera utilisé pour répondre aux questions précises."
}

=== RÈGLES ===
✓ raw_lines DOIT être un tableau VIDE [] car ce n'est pas un document tarifaire
✓ hs_codes peut contenir des codes SI le document y fait explicitement référence
✓ Concentre-toi sur le contenu juridique et réglementaire
✓ Extraire tous les accords commerciaux mentionnés avec leurs détails
✓ Si le document est un accord de transport, identifier les parties et conditions
✓ CRITIQUE: full_text doit contenir le TEXTE INTÉGRAL du document (jusqu'à 50000 caractères) pour permettre la recherche précise

RÉPONDS UNIQUEMENT AVEC LE JSON, RIEN D'AUTRE.`;

// =============================================================================
// SÉLECTION DU PROMPT APPROPRIÉ
// =============================================================================

const TARIFF_CATEGORIES = ["tarif", "chapitre", "chapter", "nomenclature", "sh_code", "hs_code"];
const REGULATORY_CATEGORIES = ["circulaire", "accord", "note", "instruction", "reglement", "règlement", "convention", "loi", "decret", "décret", "arrete", "arrêté"];

function getAnalysisPrompt(title: string, category: string): string {
  const categoryLower = category.toLowerCase();
  const titleLower = title.toLowerCase();
  
  // Vérifier si c'est un document tarifaire (PRIORITAIRE)
  // "SH CODE" dans le titre = TOUJOURS tarifaire
  const isTariff = TARIFF_CATEGORIES.some(t => categoryLower.includes(t) || titleLower.includes(t)) ||
                   titleLower.includes("chapitre") ||
                   /sh\s*code/i.test(titleLower) ||
                   /hs\s*code/i.test(titleLower);
  
  // Si c'est un document tarifaire, utiliser le prompt tarifaire (PRIORITÉ)
  if (isTariff) {
    console.log(`Using TARIFF prompt for: "${title}" (category: ${category}) - detected as tariff document`);
    return getTariffPrompt(title, category);
  }
  
  // Vérifier si c'est un document réglementaire
  const isRegulatory = REGULATORY_CATEGORIES.some(r => categoryLower.includes(r) || titleLower.includes(r));
  
  // Si explicitement réglementaire
  if (isRegulatory) {
    console.log(`Using REGULATORY prompt for: "${title}" (category: ${category})`);
    return getRegulatoryPrompt(title, category);
  }
  
  // Par défaut, utiliser le prompt tarifaire
  console.log(`Using TARIFF prompt for: "${title}" (category: ${category}) - default`);
  return getTariffPrompt(title, category);
}

// Fonction utilitaire pour vérifier le type de document
function isRegulatoryDocument(category: string, title: string): boolean {
  const categoryLower = category.toLowerCase();
  const titleLower = title.toLowerCase();
  
  return REGULATORY_CATEGORIES.some(r => categoryLower.includes(r) || titleLower.includes(r)) &&
         !TARIFF_CATEGORIES.some(t => categoryLower.includes(t) || titleLower.includes(t));
}

// =============================================================================
// FONCTIONS DE TRAITEMENT
// =============================================================================

/**
 * Nettoie un code SH (supprime points, espaces, tirets)
 * CRITIQUE: Préserve les zéros initiaux pour les chapitres 01-09
 */
function cleanCode(code: string): string {
  if (!code) return "";
  const raw = code.trim();
  
  // Traitement spécial pour les codes avec point (format XX.XX ou XXXX.XX)
  if (raw.includes(".")) {
    const parts = raw.split(".");
    
    // Format "XX.XX" (chapitre.position, ex: "07.02")
    if (parts.length === 2 && parts[0].length <= 2 && parts[1].length === 2) {
      // Préserver le zéro initial du chapitre: "07.02" → "0702"
      const chapter = parts[0].padStart(2, "0"); // "7" → "07", "07" → "07"
      const position = parts[1];
      return chapter + position; // "0702"
    }
    
    // Format "XXXX.XX" (position complète, ex: "0702.00" ou "1001.11")  
    if (parts[0].length === 4 && parts[1].length === 2) {
      // Préserver tel quel: "0702.00" → "070200"
      return parts[0] + parts[1];
    }
    
    // Autres formats avec point: supprimer les points et préserver les zéros initiaux
    const cleaned = raw.replace(/[.\-\s]/g, "");
    // Si le code original commençait par "0", s'assurer qu'il est préservé
    if (raw.startsWith("0") && !cleaned.startsWith("0")) {
      return "0" + cleaned;
    }
    return cleaned;
  }
  
  // Pas de point: nettoyer simplement
  const cleaned = raw.replace(/[.\-\s]/g, "");
  return cleaned;
}

/**
 * Parse le taux de droit et extrait la note
 */
function parseDutyRate(dutyStr: string | number | null): { rate: number | null; note: string | null } {
  if (dutyStr === null || dutyStr === undefined) {
    return { rate: null, note: null };
  }
  
  if (typeof dutyStr === "number") {
    return { rate: dutyStr, note: null };
  }
  
  const str = String(dutyStr).trim();
  if (str === "" || str === "–" || str === "-") {
    return { rate: null, note: null };
  }
  
  // Extraire note entre parenthèses
  const noteMatch = str.match(/\(([a-z])\)/i);
  const note = noteMatch ? noteMatch[1].toLowerCase() : null;
  
  // Extraire le nombre
  const numStr = str.replace(/\([a-z]\)/gi, "").replace(",", ".").trim();
  const rate = parseFloat(numStr);
  
  return {
    rate: isNaN(rate) ? null : rate,
    note,
  };
}

/**
 * Traite les lignes brutes extraites par Claude (nouvelle version simplifiée)
 * Claude fournit maintenant directement le national_code à 10 chiffres
 */
function processRawLines(rawLines: RawTarifLine[]): TariffLine[] {
  const results: TariffLine[] = [];
  
  console.log(`Processing ${rawLines.length} raw lines from Claude...`);
  
  for (const line of rawLines) {
    // Récupérer le code national directement fourni par Claude
    let nationalCode = (line.national_code || "").trim().replace(/[.\-\s]/g, "");
    
    // Vérifier qu'on a un code
    if (!nationalCode) {
      console.log(`Skipping line without national_code: ${line.description?.substring(0, 50)}`);
      continue;
    }
    
    // Préserver les zéros initiaux et compléter à 10 chiffres
    nationalCode = nationalCode.padEnd(10, "0").slice(0, 10);
    
    // Validation: doit être exactement 10 chiffres
    if (!/^\d{10}$/.test(nationalCode)) {
      console.warn(`Invalid national_code format: ${line.national_code} -> ${nationalCode}`);
      continue;
    }
    
    // Parser le taux de droit
    const { rate, note } = parseDutyRate(line.duty_rate);
    
    // Ne garder que les lignes avec un taux valide
    if (rate === null) {
      console.log(`Skipping line without duty_rate: ${nationalCode}`);
      continue;
    }
    
    // Déduire hs_code_6 si non fourni
    const hsCode6 = line.hs_code_6 ? cleanCode(line.hs_code_6).slice(0, 6).padEnd(6, "0") : nationalCode.slice(0, 6);
    
    console.log(`Processed: ${nationalCode} (HS6: ${hsCode6}) - ${line.description?.substring(0, 40)}`);
    
    results.push({
      national_code: nationalCode,
      hs_code_6: hsCode6,
      description: (line.description || "").replace(/^[–\-\s]+/, "").trim(),
      duty_rate: rate,
      duty_note: note,
      unit: line.unit || null,
      is_inherited: false,
    });
  }
  
  console.log(`Processed ${results.length} valid tariff lines`);
  return results;
}

/**
 * Vérifie si un code est entre crochets (position réservée/vide)
 * Détecte aussi les codes nettoyés qui contenaient des crochets
 * NOTE: Les codes VIDES ne sont PAS réservés - ils représentent des lignes héritées
 */
function isReservedCode(code: string): boolean {
  // IMPORTANT: code vide = ligne héritée, PAS réservée
  // Ces lignes doivent être traitées par la logique d'héritage (CAS 2b)
  if (!code || code.trim() === "") return false;
  const raw = code.trim();
  // Crochets présents = position réservée/vide
  if (raw.startsWith("[") || raw.endsWith("]") || raw.includes("[") || raw.includes("]")) {
    return true;
  }
  return false;
}

/**
 * Vérifie si un code clean est valide (6 chiffres uniquement)
 */
function isValidCleanCode(codeClean: string): boolean {
  if (!codeClean) return false;
  // Doit être exactement 6 chiffres
  return /^\d{6}$/.test(codeClean);
}

/**
 * Extrait les codes HS à 6 chiffres uniques (version simplifiée)
 * @param tariffLines - Lignes tarifaires reconstruites
 * @param rawLines - Lignes brutes de Claude (avec national_code)
 * @param claudeHSCodes - Codes SH directement fournis par Claude (optionnel)
 */
function extractHSCodes(tariffLines: TariffLine[], rawLines: RawTarifLine[], claudeHSCodes?: any[]): HSCodeEntry[] {
  const seen = new Set<string>();
  const results: HSCodeEntry[] = [];
  
  // Map pour stocker les descriptions de heading depuis Claude
  const headingDescriptions = new Map<string, string>();
  
  // ÉTAPE 1: Récupérer les descriptions depuis hs_codes de Claude (source fiable)
  if (claudeHSCodes && Array.isArray(claudeHSCodes)) {
    for (const hs of claudeHSCodes) {
      const code = hs.code_clean || cleanCode(hs.code || "");
      const desc = (hs.description || "").trim();
      if (code && code.length >= 4 && desc && desc.length > 2) {
        const code6 = code.length >= 6 ? code.slice(0, 6) : code.padEnd(6, "0");
        if (isValidCleanCode(code6) && !headingDescriptions.has(code6)) {
          headingDescriptions.set(code6, desc);
          console.log(`[Claude hs_codes] Description for ${code6}: "${desc.substring(0, 50)}..."`);
        }
      }
    }
  }
  
  // ÉTAPE 2: Extraire les codes SH depuis les hs_codes de Claude
  if (claudeHSCodes && Array.isArray(claudeHSCodes)) {
    for (const hs of claudeHSCodes) {
      const codeRaw = hs.code_clean || cleanCode(hs.code || "");
      if (!codeRaw) continue;
      
      const code6 = codeRaw.length >= 6 ? codeRaw.slice(0, 6) : codeRaw.padEnd(6, "0");
      
      if (isValidCleanCode(code6) && !seen.has(code6)) {
        seen.add(code6);
        const desc = headingDescriptions.get(code6) || (hs.description || "").trim();
        results.push({
          code: `${code6.slice(0, 4)}.${code6.slice(4, 6)}`,
          code_clean: code6,
          description: desc,
          level: hs.level || "subheading",
        });
      }
    }
  }
  
  console.log(`[extractHSCodes] Collected ${results.length} codes from Claude hs_codes`);
  
  // ÉTAPE 3: Compléter avec les codes depuis rawLines (hs_code_6)
  for (const line of rawLines) {
    const hsCode6 = line.hs_code_6 ? cleanCode(line.hs_code_6).slice(0, 6) : 
                    line.national_code ? line.national_code.replace(/[.\-\s]/g, "").slice(0, 6) : "";
    
    if (hsCode6 && isValidCleanCode(hsCode6) && !seen.has(hsCode6)) {
      seen.add(hsCode6);
      const desc = headingDescriptions.get(hsCode6) || 
                   (line.description || "").replace(/^[–\-\s]+/, "").trim();
      results.push({
        code: `${hsCode6.slice(0, 4)}.${hsCode6.slice(4, 6)}`,
        code_clean: hsCode6,
        description: desc,
        level: "subheading",
      });
    }
  }
  
  // ÉTAPE 4: Compléter avec les codes depuis tariffLines
  for (const line of tariffLines) {
    const code6 = line.hs_code_6;
    if (code6 && isValidCleanCode(code6) && !seen.has(code6)) {
      seen.add(code6);
      const desc = headingDescriptions.get(code6) || line.description;
      results.push({
        code: `${code6.slice(0, 4)}.${code6.slice(4, 6)}`,
        code_clean: code6,
        description: desc,
        level: "subheading",
      });
    }
  }
  
  console.log(`[extractHSCodes] Total HS codes extracted: ${results.length}`);
  return results;
}
// Code orphelin supprimé - fonction extractHSCodes complète ci-dessus

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// APPEL ANTHROPIC CLAUDE API (Native PDF Support)
// =============================================================================

async function analyzeWithClaude(
  base64Pdf: string,
  title: string,
  category: string,
  apiKey: string,
  retryCount = 0
): Promise<{ result: AnalysisResult | null; truncated: boolean; rateLimited: boolean }> {
  
  const MAX_RETRIES = 5;
  const BASE_DELAY = 5000;
  
  const prompt = getAnalysisPrompt(title, category);

  // All PDFs use Sonnet - it's the only model that supports native PDF input
  console.log(`PDF base64 size: ${base64Pdf.length} chars`);
  console.log("Using model:", CLAUDE_MODEL);

  // Claude API with native PDF support
  const requestBody = {
    model: CLAUDE_MODEL,
    max_tokens: 64000,
    system: "Tu es un expert en tarifs douaniers et nomenclature du Système Harmonisé (SH). Analyse les documents PDF de manière exhaustive et retourne les données structurées en JSON.",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Pdf
            }
          },
          { type: "text", text: prompt }
        ]
      }
    ],
  };

  console.log("Sending request to Claude API...");
  
  const controller = new AbortController();
  // Sonnet timeout: 290 seconds (just under 5 min Edge Function limit)
  const CLAUDE_TIMEOUT_MS = 290000;
  console.log(`Timeout set to ${CLAUDE_TIMEOUT_MS / 1000}s for Sonnet (max Edge Function limit ~300s)`);
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
      throw new Error(`Timeout après ${CLAUDE_TIMEOUT_MS / 60000} min - PDF trop volumineux. Divisez le document en parties plus petites.`);
    }
    throw fetchError;
  }
  
  clearTimeout(timeoutId);
  console.log("Claude response status:", aiResponse.status);

  // Handle rate limiting (429) and overloaded (529)
  if (aiResponse.status === 429 || aiResponse.status === 529) {
    if (retryCount < MAX_RETRIES) {
      const retryAfter = aiResponse.headers.get("Retry-After");
      const delayMs = retryAfter ? parseInt(retryAfter) * 1000 : BASE_DELAY * Math.pow(2, retryCount);
      console.log(`Rate limited (${aiResponse.status}). Retry ${retryCount + 1}/${MAX_RETRIES} after ${delayMs}ms...`);
      await delay(delayMs);
      return analyzeWithClaude(base64Pdf, title, category, apiKey, retryCount + 1);
    } else {
      console.error("Max retries reached for rate limiting");
      return { result: null, truncated: false, rateLimited: true };
    }
  }

  if (!aiResponse.ok) {
    const errorText = await aiResponse.text();
    console.error("Claude error:", aiResponse.status, errorText);
    throw new Error(`Claude error: ${aiResponse.status} - ${errorText}`);
  }

  const aiData = await aiResponse.json();
  
  // Claude format: stop_reason
  const stopReason = aiData.stop_reason;
  const truncated = stopReason === "max_tokens";
  
  console.log("Claude response - stop_reason:", stopReason, "truncated:", truncated);
  
  // Claude format: content[0].text
  const responseText = aiData.content?.[0]?.text || "{}";
  
  // Parse JSON
  let cleanedResponse = responseText.trim();
  
  // Remove markdown code blocks
  if (cleanedResponse.includes("```json")) {
    const jsonStart = cleanedResponse.indexOf("```json") + 7;
    const jsonEnd = cleanedResponse.indexOf("```", jsonStart);
    if (jsonEnd > jsonStart) {
      cleanedResponse = cleanedResponse.slice(jsonStart, jsonEnd).trim();
    }
  } else if (cleanedResponse.includes("```")) {
    const jsonStart = cleanedResponse.indexOf("```") + 3;
    const jsonEnd = cleanedResponse.indexOf("```", jsonStart);
    if (jsonEnd > jsonStart) {
      cleanedResponse = cleanedResponse.slice(jsonStart, jsonEnd).trim();
    }
  }
  
  // Extract JSON object
  if (!cleanedResponse.startsWith("{")) {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanedResponse = jsonMatch[0];
    }
  }
  
  // =========================================================================
  // PARSING JSON ROBUSTE MULTI-NIVEAUX
  // =========================================================================
  
  /**
   * Tente de réparer un JSON tronqué avec plusieurs stratégies
   */
  const repairTruncatedJson = (text: string): string => {
    let repaired = text.trim();
    
    // Stratégie 1: Supprimer les virgules pendantes
    repaired = repaired.replace(/,\s*([}\]])/g, '$1');
    
    // Stratégie 2: Compléter les chaînes de caractères ouvertes
    // Trouver les guillemets non fermés dans les 500 derniers caractères
    const lastPart = repaired.slice(-500);
    const lastQuote = lastPart.lastIndexOf('"');
    if (lastQuote !== -1) {
      const afterLastQuote = lastPart.slice(lastQuote + 1);
      // Si après le dernier guillemet on n'a pas de fermeture valide...
      if (!afterLastQuote.match(/^\s*[,:}\]]/)) {
        // Fermer la chaîne et ajouter une fermeture
        repaired = repaired + '"';
      }
    }
    
    // Stratégie 3: Équilibrer les accolades et crochets
    const openBraces = (repaired.match(/\{/g) || []).length;
    const closeBraces = (repaired.match(/\}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;
    
    for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += "]";
    for (let i = 0; i < openBraces - closeBraces; i++) repaired += "}";
    
    return repaired;
  };
  
  /**
   * Extrait les données partielles depuis un JSON malformé
   */
  const extractPartialData = (text: string): any => {
    const result: any = {};
    
    // Extraire le summary
    const summaryMatch = text.match(/"summary"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
    if (summaryMatch) result.summary = summaryMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
    
    // IMPORTANT: Extraire full_text (texte intégral du document)
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
    
    // Extraire raw_lines (le plus important!)
    const rawLinesMatch = text.match(/"raw_lines"\s*:\s*\[([\s\S]*?)(?:\](?:\s*,\s*"|\s*\})|$)/);
    if (rawLinesMatch) {
      const rawLinesContent = rawLinesMatch[1];
      const lines: any[] = [];
      
      // Parser chaque objet de ligne séparément
      const lineMatches = rawLinesContent.matchAll(/\{([^{}]*)\}/g);
      for (const match of lineMatches) {
        try {
          const lineObj: any = {};
          const content = match[1];
          
          // Extraire col1-col5
          for (let i = 1; i <= 5; i++) {
            const colMatch = content.match(new RegExp(`"col${i}"\\s*:\\s*"([^"]*)"`));
            lineObj[`col${i}`] = colMatch ? colMatch[1] : "";
          }
          
          // Extraire description
          const descMatch = content.match(/"description"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
          lineObj.description = descMatch ? descMatch[1].replace(/\\"/g, '"') : "";
          
          // Extraire duty_rate
          const dutyMatch = content.match(/"duty_rate"\s*:\s*(?:"([^"]+)"|(\d+\.?\d*)|null)/);
          if (dutyMatch) {
            lineObj.duty_rate = dutyMatch[1] || (dutyMatch[2] ? parseFloat(dutyMatch[2]) : null);
          } else {
            lineObj.duty_rate = null;
          }
          
          // Extraire unit
          const unitMatch = content.match(/"unit"\s*:\s*(?:"([^"]+)"|null)/);
          lineObj.unit = unitMatch ? unitMatch[1] || null : null;
          
          // Ne garder que si col1 a une valeur
          if (lineObj.col1 && lineObj.col1.trim() !== "") {
            lines.push(lineObj);
          }
        } catch (lineError) {
          console.warn("Failed to parse individual line, skipping:", match[0].substring(0, 100));
        }
      }
      
      if (lines.length > 0) {
        result.raw_lines = lines;
        console.log(`Extracted ${lines.length} raw_lines from partial data`);
      }
    }
    
    // Extraire hs_codes si raw_lines n'est pas disponible
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
        if (codes.length > 0) {
          result.hs_codes = codes;
          console.log(`Extracted ${codes.length} hs_codes from partial data`);
        }
      }
    }
    
    // Extraire trade_agreements
    const agreementsMatch = text.match(/"trade_agreements"\s*:\s*\[([\s\S]*?)(?:\](?:\s*,\s*"|\s*\})|$)/);
    if (agreementsMatch && agreementsMatch[1].trim().length > 2) {
      try {
        result.trade_agreements = JSON.parse('[' + agreementsMatch[1] + ']');
      } catch {}
    }
    
    // Extraire preferential_rates
    const prefRatesMatch = text.match(/"preferential_rates"\s*:\s*\[([\s\S]*?)(?:\](?:\s*,\s*"|\s*\})|$)/);
    if (prefRatesMatch && prefRatesMatch[1].trim().length > 2) {
      try {
        result.preferential_rates = JSON.parse('[' + prefRatesMatch[1] + ']');
      } catch {}
    }
    
    return result;
  };
  
  /**
   * Parser JSON avec tentatives multiples
   */
  const parseJsonRobust = (text: string): { parsed: any | null; method: string } => {
    // Tentative 1: Parse direct
    try {
      return { parsed: JSON.parse(text), method: "direct" };
    } catch {}
    
    // Tentative 2: Après réparation
    const repaired = repairTruncatedJson(text);
    try {
      return { parsed: JSON.parse(repaired), method: "repaired" };
    } catch {}
    
    // Tentative 3: Trouver le plus grand objet JSON valide
    let bestParsed: any = null;
    let bestLength = 0;
    
    for (let endPos = text.length; endPos > 100; endPos -= 50) {
      const truncatedText = repairTruncatedJson(text.slice(0, endPos));
      try {
        const attempt = JSON.parse(truncatedText);
        if (JSON.stringify(attempt).length > bestLength) {
          bestParsed = attempt;
          bestLength = JSON.stringify(attempt).length;
        }
        // Si on a trouvé un résultat avec des données, on arrête
        if (attempt.raw_lines?.length > 0 || attempt.hs_codes?.length > 0) {
          return { parsed: attempt, method: "truncated_search" };
        }
      } catch {}
    }
    
    if (bestParsed) {
      return { parsed: bestParsed, method: "best_truncated" };
    }
    
    // Tentative 4: Extraction partielle
    const partial = extractPartialData(text);
    if (partial.raw_lines?.length > 0 || partial.hs_codes?.length > 0 || partial.summary) {
      console.log("Using partial extraction method");
      return { parsed: partial, method: "partial_extraction" };
    }
    
    return { parsed: null, method: "failed" };
  };
  
  const { parsed, method } = parseJsonRobust(cleanedResponse);
  console.log(`JSON parsing method: ${method}`);
  
  // Log pour debug: vérifier ce que Claude a renvoyé
  console.log(`Parsed data check - raw_lines: ${parsed?.raw_lines?.length ?? 'undefined'}, hs_codes: ${parsed?.hs_codes?.length ?? 'undefined'}, summary: ${parsed?.summary?.substring(0, 50) ?? 'undefined'}`);
  
  // Vérifier si c'est un document réglementaire (circulaire, accord, etc.)
  const isRegulatory = isRegulatoryDocument(category, title);
  
  // Si parsed existe mais n'a pas de raw_lines, essayer une extraction plus agressive
  // SEULEMENT pour les documents tarifaires (pas les circulaires/accords)
  if (parsed && (!parsed.raw_lines || parsed.raw_lines.length === 0) && !isRegulatory) {
    console.log("No raw_lines found in parsed data (tariff document), attempting aggressive extraction...");
    console.log("Looking for raw_lines in response (first 3000 chars):", cleanedResponse.substring(0, 3000));
    
    // Tentative d'extraction directe avec regex plus flexible
    const rawLinesRegex = /["']raw_lines["']\s*:\s*\[\s*([\s\S]*?)\s*\]\s*(?:,\s*["']|$|\})/;
    const rawLinesMatch = cleanedResponse.match(rawLinesRegex);
    
    if (rawLinesMatch) {
      console.log("Found raw_lines section, attempting manual extraction...");
      const rawLinesContent = rawLinesMatch[1];
      const lines: any[] = [];
      
      // Regex pour matcher chaque objet de ligne individuellement
      const objectRegex = /\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
      let match;
      
      while ((match = objectRegex.exec(rawLinesContent)) !== null) {
        try {
          const lineObj = JSON.parse(match[0]);
          if (lineObj.col1 !== undefined || lineObj.description !== undefined) {
            lines.push(lineObj);
          }
        } catch {
          // Si le parse JSON échoue, extraire manuellement
          const lineData: any = {};
          for (let i = 1; i <= 5; i++) {
            const colMatch = match[0].match(new RegExp(`["']col${i}["']\\s*:\\s*["']([^"']*)["']`));
            lineData[`col${i}`] = colMatch ? colMatch[1] : "";
          }
          const descMatch = match[0].match(/["']description["']\s*:\s*["']([^"']*(?:\\.[^"']*)*)["']/);
          lineData.description = descMatch ? descMatch[1].replace(/\\"/g, '"') : "";
          const dutyMatch = match[0].match(/["']duty_rate["']\s*:\s*(?:["']([^"']+)["']|(\d+\.?\d*)|null)/);
          lineData.duty_rate = dutyMatch ? (dutyMatch[1] || (dutyMatch[2] ? parseFloat(dutyMatch[2]) : null)) : null;
          const unitMatch = match[0].match(/["']unit["']\s*:\s*(?:["']([^"']*)["']|null)/);
          lineData.unit = unitMatch ? unitMatch[1] || null : null;
          
          if (lineData.col1 || lineData.description) {
            lines.push(lineData);
          }
        }
      }
      
      if (lines.length > 0) {
        console.log(`Aggressive extraction found ${lines.length} raw_lines!`);
        parsed.raw_lines = lines;
      }
    }
    
    // Si toujours pas de raw_lines, chercher des hs_codes directement
    if (!parsed.raw_lines || parsed.raw_lines.length === 0) {
      console.log("Still no raw_lines, trying direct hs_codes extraction...");
      
      const hsCodesRegex = /["']hs_codes["']\s*:\s*\[\s*([\s\S]*?)\s*\]\s*(?:,\s*["']|$|\})/;
      const hsMatch = cleanedResponse.match(hsCodesRegex);
      
      if (hsMatch) {
        const codes: any[] = [];
        const codeObjectRegex = /\{[^{}]*\}/g;
        let codeMatch;
        
        while ((codeMatch = codeObjectRegex.exec(hsMatch[1])) !== null) {
          try {
            const codeObj = JSON.parse(codeMatch[0]);
            if (codeObj.code_clean && /^\d{6}$/.test(codeObj.code_clean)) {
              codes.push(codeObj);
            }
          } catch {}
        }
        
        if (codes.length > 0) {
          console.log(`Direct extraction found ${codes.length} hs_codes!`);
          parsed.hs_codes = codes;
        }
      }
    }
  }
  
  if (!parsed) {
    console.error("All JSON parsing methods failed");
    console.error("Raw response (first 2000):", responseText.substring(0, 2000));
    console.error("Raw response (last 500):", responseText.substring(responseText.length - 500));
    return { 
      result: {
        summary: "Analyse échouée - Impossible de parser la réponse. Veuillez réessayer.",
        key_points: ["Le document a été analysé mais le format de réponse était invalide."],
        hs_codes: [],
        tariff_lines: [],
      }, 
      truncated, 
      rateLimited: false 
    };
  }
  
  // POST-TRAITEMENT: Reconstruire les codes à partir des raw_lines
  let tariffLines: TariffLine[] = [];
  let hsCodeEntries: HSCodeEntry[] = [];
  
  // Pour les documents réglementaires (circulaires, accords), 
  // on utilise directement les hs_codes retournés par Claude (s'il y en a)
  if (isRegulatory) {
    console.log(`Processing REGULATORY document - no tariff lines expected`);
    
    // Utiliser les hs_codes mentionnés dans le document (si Claude en a trouvé)
    if (parsed.hs_codes && Array.isArray(parsed.hs_codes)) {
      hsCodeEntries = parsed.hs_codes.filter((hs: any) => 
        hs.code_clean && /^\d{6}$/.test(hs.code_clean)
      );
      console.log(`Found ${hsCodeEntries.length} HS codes mentioned in regulatory document`);
    }
    
    // Pas de lignes tarifaires pour les documents réglementaires
    tariffLines = [];
    
  } else if (parsed.raw_lines && Array.isArray(parsed.raw_lines) && parsed.raw_lines.length > 0) {
    // Pour les documents tarifaires: traitement normal avec héritage
    console.log(`Processing ${parsed.raw_lines.length} raw lines with inheritance...`);
    
    // Reconstruire avec l'héritage
    tariffLines = processRawLines(parsed.raw_lines);
    // Passer aussi les hs_codes de Claude pour récupérer les descriptions
    hsCodeEntries = extractHSCodes(tariffLines, parsed.raw_lines, parsed.hs_codes);
    
    console.log(`Reconstructed ${tariffLines.length} tariff lines and ${hsCodeEntries.length} HS codes`);
  } else if (parsed.tariff_lines) {
    // Fallback: utiliser tariff_lines si raw_lines n'est pas présent
    tariffLines = (parsed.tariff_lines as any[])
      .map(line => {
        const { rate, note } = parseDutyRate(line.duty_rate);
        let code = cleanCode(line.national_code || "");
        if (code.length > 0 && code.length < 10) {
          code = code.padEnd(10, "0");
        }
        return {
          national_code: code,
          hs_code_6: code.slice(0, 6),
          description: line.description || "",
          duty_rate: rate || 0,
          duty_note: note,
          unit: line.unit || null,
          is_inherited: false,
        };
      })
      .filter(line => line.national_code.length === 10 && line.duty_rate > 0);
    
    hsCodeEntries = parsed.hs_codes || [];
  } else {
    // Fallback pour les documents sans raw_lines ni tariff_lines
    hsCodeEntries = parsed.hs_codes || [];
  }
  
  // Récupérer le texte intégral du document (critique pour RAG)
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
    raw_lines: parsed.raw_lines,  // Garder pour debug
    document_type: isRegulatory ? "regulatory" : "tariff",
    authorities: parsed.authorities || [],
    effective_date: parsed.effective_date,
    legal_references: parsed.legal_references || [],
    full_text: fullText,  // TEXTE INTÉGRAL pour recherche RAG
  };
  
  console.log("Final result:", 
    "document_type:", isRegulatory ? "regulatory" : "tariff",
    "tariff_lines:", result.tariff_lines.length,
    "hs_codes:", result.hs_codes.length,
    "trade_agreements:", result.trade_agreements?.length || 0,
    "full_text_length:", fullText.length,
    isRegulatory ? "" : `inherited: ${result.tariff_lines.filter(l => l.is_inherited).length}`
  );
  
  return { result, truncated, rateLimited: false };
}

// =============================================================================
// HANDLER PRINCIPAL
// =============================================================================

serve(async (req) => {
  const logger = createLogger("analyze-pdf", req);
  
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }

  logger.info("Request received");

  // Rate limiting distribué (5 requests per minute for PDF analysis - more expensive)
  const clientId = getClientId(req);
  const rateLimit = await checkRateLimitDistributed(clientId, {
    maxRequests: 5,
    windowMs: 60000,
    blockDurationMs: 300000,
  });

  if (!rateLimit.allowed) {
    return rateLimitResponse(req, rateLimit.resetAt);
  }

  try {
    // Valider le body
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

    if (!filePath) {
      return errorResponse(req, "filePath is required", 400);
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Check file size
    const { data: fileList } = await supabase.storage
      .from("pdf-documents")
      .list(filePath.split('/').slice(0, -1).join('/') || '', {
        search: filePath.split('/').pop()
      });
    
    const fileInfo = fileList?.find(f => filePath.endsWith(f.name));
    const fileSizeMB = fileInfo?.metadata?.size ? fileInfo.metadata.size / (1024 * 1024) : 0;
    
    const MAX_FILE_SIZE_MB = 25;
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      return new Response(
        JSON.stringify({ 
          error: `Le PDF est trop volumineux (${fileSizeMB.toFixed(1)}MB). Limite: ${MAX_FILE_SIZE_MB}MB.`,
          fileSizeMB: fileSizeMB.toFixed(2)
        }),
        { status: 413, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    // Download PDF
    const { data: pdfData, error: downloadError } = await supabase.storage
      .from("pdf-documents")
      .download(filePath);

    if (downloadError) {
      throw new Error(`Failed to download PDF: ${downloadError.message}`);
    }

    // Convert to base64
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

    // Get PDF metadata
    const { data: pdfDoc } = await supabase
      .from("pdf_documents")
      .select("title, category, country_code")
      .eq("id", pdfId)
      .single();

    const title = pdfDoc?.title || "Tarif douanier";
    const category = pdfDoc?.category || "tarif";
    const countryCode = pdfDoc?.country_code || "MA";

    // === CRÉER UNE EXTRACTION "PROCESSING" IMMÉDIATEMENT ===
    // Ceci permet au client de savoir que l'analyse est en cours
    // et d'attendre plus longtemps via polling
    const { data: existingProcExtraction } = await supabase
      .from("pdf_extractions")
      .select("id, summary")
      .eq("pdf_id", pdfId)
      .maybeSingle();
    
    // Si une extraction complète existe déjà, la retourner immédiatement
    if (existingProcExtraction && existingProcExtraction.summary && existingProcExtraction.summary !== "__PROCESSING__") {
      console.log("Extraction already exists for PDF:", pdfId, "- returning cached data");
      
      // Récupérer les données complètes
      const { data: fullExtraction } = await supabase
        .from("pdf_extractions")
        .select("*")
        .eq("id", existingProcExtraction.id)
        .single();
      
      if (fullExtraction) {
        // Récupérer les codes SH complets depuis extracted_data (avec descriptions)
        const extractedData = fullExtraction.extracted_data as Record<string, any> || {};
        const hsCodesFull = extractedData.hs_codes_full as Array<{code: string; code_clean: string; description: string; level: string}> || [];
        
        // Si les codes complets sont stockés, les utiliser; sinon fallback sur mentioned_hs_codes
        const hsCodes = hsCodesFull.length > 0 
          ? hsCodesFull 
          : (fullExtraction.mentioned_hs_codes as string[] || []).map(code => ({
              code: code,
              code_clean: code.replace(/[^0-9]/g, ""),
              description: "",  // Fallback sans description
              level: "subheading"
            }));
        
        return new Response(
          JSON.stringify({
            summary: fullExtraction.summary,
            key_points: fullExtraction.key_points || [],
            hs_codes: hsCodes,
            tariff_lines: fullExtraction.detected_tariff_changes || [],
            full_text: fullExtraction.extracted_text || "",
            chapter_info: extractedData.chapter_info || null,
            trade_agreements: extractedData.trade_agreements || [],
            preferential_rates: extractedData.preferential_rates || [],
            pdfId,
            pdfTitle: title,
            countryCode,
            cached: true,
          }),
          { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
        );
      }
    }
    
    // Si le traitement est déjà en cours, retourner le statut
    if (existingProcExtraction && existingProcExtraction.summary === "__PROCESSING__") {
      console.log("PDF already being processed:", pdfId);
      return new Response(
        JSON.stringify({
          status: "processing",
          message: "L'analyse est en cours, veuillez patienter...",
          pdfId,
        }),
        { headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }
    
    // Créer le marqueur PROCESSING
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

    // === TRAITEMENT ASYNCHRONE AVEC EdgeRuntime.waitUntil ===
    // Répondre immédiatement au client, puis continuer le traitement en arrière-plan
    
    const backgroundProcess = async () => {
      try {
        console.log(`[Background] Starting analysis for PDF: ${pdfId}`);
        
        const { result, truncated, rateLimited } = await analyzeWithClaude(
          base64Pdf, title, category, ANTHROPIC_API_KEY
        );
        
        let analysisResult: AnalysisResult | null = result;
        
        if (rateLimited) {
          console.error("[Background] Rate limited for PDF:", pdfId);
          await supabase.from("pdf_extractions").update({
            summary: "Erreur: Rate limit API - réessayez dans quelques minutes",
            extraction_confidence: 0,
          }).eq("pdf_id", pdfId);
          return;
        }
        
        if (truncated && analysisResult) {
          console.warn("[Background] Response was truncated for PDF:", pdfId);
        }
        
        if (!analysisResult) {
          console.error("[Background] No analysis result for PDF:", pdfId);
          await supabase.from("pdf_extractions").update({
            summary: "Erreur: Analyse échouée - contenu non structuré",
            extraction_confidence: 0,
          }).eq("pdf_id", pdfId);
          return;
        }

        // Déterminer si c'est un document réglementaire
        const isRegulatoryDoc = isRegulatoryDocument(category, title);
        
        console.log("[Background] Analysis complete for PDF:", pdfId,
          "Document type:", isRegulatoryDoc ? "regulatory" : "tariff",
          "HS codes:", analysisResult.hs_codes?.length || 0,
          "Tariff lines:", analysisResult.tariff_lines?.length || 0,
          "Trade agreements:", analysisResult.trade_agreements?.length || 0
        );

        // Mettre à jour l'extraction avec les données complètes
        // IMPORTANT: Stocker les hs_codes complets (avec descriptions) dans extracted_data
        const { error: updateError } = await supabase.from("pdf_extractions").update({
          summary: analysisResult.summary || "Document analysé",
          key_points: analysisResult.key_points || [],
          mentioned_hs_codes: analysisResult.hs_codes?.map(h => h.code_clean) || [],
          detected_tariff_changes: analysisResult.tariff_lines || [],
          extracted_text: analysisResult.full_text || null,
          extracted_data: {
            chapter_info: analysisResult.chapter_info || null,
            notes: analysisResult.notes || null,
            footnotes: analysisResult.footnotes || null,
            tariff_lines_count: analysisResult.tariff_lines?.length || 0,
            inherited_lines_count: analysisResult.tariff_lines?.filter(l => l.is_inherited).length || 0,
            trade_agreements: analysisResult.trade_agreements || [],
            preferential_rates: analysisResult.preferential_rates || [],
            authorities: analysisResult.authorities || [],
            legal_references: analysisResult.legal_references || [],
            document_type: isRegulatoryDoc ? "regulatory" : "tariff",
            // NOUVEAU: Stocker les codes SH complets avec leurs descriptions
            hs_codes_full: analysisResult.hs_codes || [],
          },
          extraction_model: CLAUDE_MODEL,
          extraction_confidence: 0.92,
          extracted_at: new Date().toISOString(),
        }).eq("pdf_id", pdfId);
        
        if (updateError) {
          console.error("[Background] Extraction update error:", updateError);
        } else {
          console.log("[Background] ✅ Extraction saved for PDF:", pdfId, "- Full text length:", analysisResult.full_text?.length || 0);
        }

        // Pour les documents non-preview, insérer les tarifs et codes HS
        if (!previewOnly) {
          // Insert tariff lines
          if (analysisResult.tariff_lines && analysisResult.tariff_lines.length > 0) {
            const tariffRows = analysisResult.tariff_lines.map(line => ({
              country_code: countryCode,
              hs_code_6: line.hs_code_6,
              national_code: line.national_code,
              description_local: line.description,
              duty_rate: line.duty_rate,
              duty_note: line.duty_note,
              vat_rate: 20,
              unit_code: line.unit || null,
              is_active: true,
              is_inherited: line.is_inherited,
              source: `PDF: ${title}`,
            }));

            const { error: tariffError } = await supabase
              .from("country_tariffs")
              .upsert(tariffRows, { onConflict: "country_code,national_code" });

            if (tariffError) {
              console.error("[Background] Tariff insert error:", tariffError);
            } else {
              console.log(`[Background] Inserted ${tariffRows.length} tariff lines`);
            }
          }

          // Insert HS codes
          if (analysisResult.hs_codes && analysisResult.hs_codes.length > 0) {
            const hsRows = analysisResult.hs_codes.map(hsCode => ({
              code: hsCode.code,
              code_clean: hsCode.code_clean,
              description_fr: hsCode.description,
              chapter_number: analysisResult.chapter_info?.number || parseInt(hsCode.code_clean?.slice(0, 2) || "0"),
              chapter_title_fr: analysisResult.chapter_info?.title,
              is_active: true,
              level: hsCode.level || "subheading",
              parent_code: hsCode.code_clean?.slice(0, 4),
            }));

            const { error: hsError } = await supabase
              .from("hs_codes")
              .upsert(hsRows, { onConflict: "code" });

            if (hsError) {
              console.error("[Background] HS codes insert error:", hsError);
            } else {
              console.log(`[Background] Inserted ${hsRows.length} HS codes`);
            }
          }
        }

        // Update PDF document
        await supabase.from("pdf_documents").update({
          is_verified: true,
          verified_at: new Date().toISOString(),
          related_hs_codes: analysisResult.hs_codes?.map(h => h.code_clean) || [],
          keywords: analysisResult.chapter_info?.number ? `Chapitre ${analysisResult.chapter_info.number}` : null,
        }).eq("id", pdfId);
        
        console.log("[Background] ✅ PDF processing complete:", pdfId);
        
      } catch (bgError) {
        console.error("[Background] Error processing PDF:", pdfId, bgError);
        await supabase.from("pdf_extractions").update({
          summary: `Erreur: ${bgError instanceof Error ? bgError.message : "Erreur inconnue"}`,
          extraction_confidence: 0,
        }).eq("pdf_id", pdfId);
      }
    };

    // Utiliser EdgeRuntime.waitUntil pour traitement en arrière-plan
    // @ts-ignore - EdgeRuntime est disponible dans Supabase Edge Functions
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      console.log("Using EdgeRuntime.waitUntil for background processing");
      // @ts-ignore
      EdgeRuntime.waitUntil(backgroundProcess());
    } else {
      // Fallback: exécuter de manière synchrone (ancien comportement)
      console.log("EdgeRuntime.waitUntil not available, running synchronously");
      await backgroundProcess();
    }

    // Répondre immédiatement au client
    return new Response(
      JSON.stringify({
        status: "processing",
        message: "Analyse démarrée en arrière-plan. Le client peut polluer pour les résultats.",
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
