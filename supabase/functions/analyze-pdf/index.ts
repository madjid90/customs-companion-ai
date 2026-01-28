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
const CLAUDE_MODEL = "claude-sonnet-4-20250514"; // Native PDF support with anthropic-beta header

// =============================================================================
// INTERFACES
// =============================================================================

interface RawTarifLine {
  // Colonnes brutes extraites par Claude
  col1: string;      // Position/Sous-position ou "1" pour héritage
  col2: string;      // Extension 2 chiffres
  col3: string;      // Extension 2 chiffres  
  col4: string;      // Extension 2 chiffres
  col5: string;      // Extension 2 chiffres
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

const getTariffPrompt = (title: string, category: string) => `Expert en tarifs douaniers. Analyse ce PDF et extrais TOUTES les lignes tarifaires.

Doc: ${title}
Catégorie : ${category}

=== STRUCTURE EXACTE DU TABLEAU TARIFAIRE MAROCAIN ===

Le tableau possède 5 colonnes de CODIFICATION qui doivent être lues SÉPARÉMENT :

┌─────────────────────────────────────────────────────────────────────────────────────┐
│        CODIFICATION (5 colonnes)       │ Désignation  │ Droit │ Unité QN │ UC     │
├──────────┬──────┬──────┬──────┬────────┼──────────────┼───────┼──────────┼────────┤
│  Col1    │ Col2 │ Col3 │ Col4 │ Col5   │              │       │          │        │
├──────────┼──────┼──────┼──────┼────────┼──────────────┼───────┼──────────┼────────┤
│ 14.04    │      │      │      │        │ Produits...  │       │          │        │
│ 1404.90  │ 00   │      │      │        │ – – Autres   │       │          │        │
│          │ 40   │ 00   │      │        │ – – – matièr │ 2,5   │ kg       │        │
│          │      │ 10   │      │        │ – – – – alfa │ 2,5   │ kg       │        │
│          │      │ 90   │      │        │ – – – – autr │ 2,5   │ kg       │        │
│          │ 80   │      │      │        │ – – – Autre: │       │          │   ← HEADER     │
│          │      │ 10   │      │        │ – – – – ...  │ 2,5   │ kg       │        │
│          │      │ 90   │      │        │ – – – – ...  │ 2,5   │ kg       │        │
└──────────┴──────┴──────┴──────┴────────┴──────────────┴───────┴──────────┴────────┘

=== RÈGLES CRITIQUES D'HÉRITAGE ===

1. MARQUEUR "1" EN COL1:
   Quand Col1 contient "1" (ou 2-9), c'est un MARQUEUR D'HÉRITAGE
   → Les 6 premiers chiffres viennent de la DERNIÈRE ligne avec un code complet

2. EN-TÊTES INTERMÉDIAIRES (SANS TAUX):
   TRÈS IMPORTANT: Quand une ligne a:
   - Col1 VIDE et Col2 contient un nombre (40, 80, etc.)
   - PAS de duty_rate (ou duty_rate vide)
   → C'est un EN-TÊTE qui établit les 7e-8e chiffres pour les sous-lignes suivantes
   → Les lignes suivantes avec col2 VIDE hériteront de ce "40" ou "80"

3. EXTENSIONS (AVEC TAUX):
   Quand Col1 VIDE, Col2 VIDE, Col3 contient un nombre (10, 90), et duty_rate présent
   → Col3 = 9e-10e chiffre, et on HÉRITE les 7e-8e du dernier en-tête

EXEMPLE DE RECONSTRUCTION AVEC EN-TÊTE:
Ligne: "1404.90 | 00 |    |    |" → Code de base: 140490 + 00 = 14049000XX
Ligne: "        | 80 |    |    |" → EN-TÊTE: établit 7e-8e = "80", pas de ligne créée
Ligne: "        |    | 10 |    |" → HÉRITAGE 140490 + 80 + 10 = 1404908010
Ligne: "        |    | 90 |    |" → HÉRITAGE 140490 + 80 + 90 = 1404908090

=== EXTRACTION DEMANDÉE ===

1. NOTES DU CHAPITRE - Extraire intégralement :
   - Notes légales (après "Notes.")
   - Notes de sous-position  
   - Notes complémentaires
   - Notes de bas de page : (a), (b), (c), (f) avec leur texte

2. LIGNES BRUTES - Pour CHAQUE ligne du tableau, extraire :
   - col1: valeur exacte de la colonne 1 (position ou "1")
   - col2: valeur colonne 2 (ou "" si vide)
   - col3: valeur colonne 3 (ou "" si vide)
   - col4: valeur colonne 4 (ou "" si vide)
   - col5: valeur colonne 5 (ou "" si vide)
   - description: texte complet avec les tirets
   - duty_rate: taux ou null (garder les notes comme "170(b)")
   - unit: unité (kg, L, U, etc.)

3. HS_CODES (6 chiffres) :
   - Extraire chaque sous-position unique
   - Format "XXXX.XX" et code_clean "XXXXXX"

4. ACCORDS COMMERCIAUX ET TAUX PRÉFÉRENTIELS

=== FORMAT JSON DE SORTIE ===

{
  "summary": "Résumé du chapitre",
  "key_points": ["Note importante 1", "Note 2"],
  "chapter_info": {"number": 10, "title": "CEREALES"},
  "notes": {
    "legal": ["1. A) Les produits...", "1. B) Le présent..."],
    "subposition": ["1. On considère comme..."],
    "complementary": ["1) comme riz en paille..."]
  },
  "footnotes": {
    "a": "Aux conditions fixées par la réglementation en vigueur.",
    "b": "Ce taux est appliqué à la tranche ≤ 1000 DH/tonne, au-delà = 2,5%",
    "f": "Ce taux est appliqué à la tranche ≤ 1000 DH/tonne, au-delà = 2,5%"
  },
  "raw_lines": [
    {"col1": "14.04", "col2": "", "col3": "", "col4": "", "col5": "", "description": "Produits végétaux...", "duty_rate": null, "unit": null},
    {"col1": "1404.90", "col2": "00", "col3": "", "col4": "", "col5": "", "description": "– – Autres", "duty_rate": null, "unit": null},
    {"col1": "", "col2": "40", "col3": "00", "col4": "", "col5": "", "description": "– – – matières végétales...", "duty_rate": "2,5", "unit": "kg"},
    {"col1": "", "col2": "", "col3": "10", "col4": "", "col5": "", "description": "– – – – alfa...", "duty_rate": "2,5", "unit": "kg"},
    {"col1": "", "col2": "", "col3": "90", "col4": "", "col5": "", "description": "– – – – autres", "duty_rate": "2,5", "unit": "kg"},
    {"col1": "", "col2": "80", "col3": "", "col4": "", "col5": "", "description": "– – – Autre:", "duty_rate": null, "unit": null},
    {"col1": "", "col2": "", "col3": "10", "col4": "", "col5": "", "description": "– – – – henné...", "duty_rate": "2,5", "unit": "kg"},
    {"col1": "", "col2": "", "col3": "90", "col4": "", "col5": "", "description": "– – – – autres", "duty_rate": "2,5", "unit": "kg"}
  ],
  "hs_codes": [
    {"code": "1404.90", "code_clean": "140490", "description": "Autres", "level": "subheading"}
  ],
  "trade_agreements": [],
  "preferential_rates": [],
  "full_text": "TEXTE INTÉGRAL DU DOCUMENT - Copie ici TOUT le contenu textuel visible du PDF, incluant les titres, notes, descriptions, conditions, articles, paragraphes. Ce texte sera utilisé pour répondre aux questions précises."
}

=== RÈGLES STRICTES ===
✓ **EXTRAIRE ABSOLUMENT TOUTES LES LIGNES DU TABLEAU** - sans limite, sans troncature !
✓ Parcourir le PDF de la PREMIÈRE à la DERNIÈRE page
✓ Chaque position (ex: 07.01, 07.02... jusqu'à 07.14) doit apparaître dans raw_lines
✓ Le "1" en col1 est un MARQUEUR, pas un chiffre du code
✓ Préserver les notes (a), (b) etc. dans duty_rate
✓ Les tirets "–" dans description indiquent le niveau hiérarchique
✓ IGNORER les codes entre crochets [XX.XX] ou [XXXX.XX] - positions RÉSERVÉES
✓ Les positions simples XX.XX (ex: 07.01, 07.11) sont des headings valides
✓ TOUS les codes dans hs_codes doivent avoir un code_clean de EXACTEMENT 6 CHIFFRES
✓ CRITIQUE: full_text doit contenir le TEXTE INTÉGRAL du document (jusqu'à 50000 caractères)

**NE JAMAIS TRONQUER LE RÉSULTAT - EXTRAIRE 100% DES LIGNES DU TABLEAU !**

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
  
  // Vérifier si c'est un document tarifaire
  const isTariff = TARIFF_CATEGORIES.some(t => categoryLower.includes(t) || titleLower.includes(t)) ||
                   titleLower.includes("chapitre") ||
                   /sh\s*code/i.test(titleLower);
  
  // Vérifier si c'est un document réglementaire
  const isRegulatory = REGULATORY_CATEGORIES.some(r => categoryLower.includes(r) || titleLower.includes(r));
  
  // Si explicitement réglementaire, ou si pas tarifaire et catégorie suggère réglementaire
  if (isRegulatory || (!isTariff && !categoryLower.includes("tarif"))) {
    console.log(`Using REGULATORY prompt for: "${title}" (category: ${category})`);
    return getRegulatoryPrompt(title, category);
  }
  
  console.log(`Using TARIFF prompt for: "${title}" (category: ${category})`);
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
 * Reconstruit les codes SH à partir des lignes brutes avec gestion de l'héritage
 */
function processRawLines(rawLines: RawTarifLine[]): TariffLine[] {
  const results: TariffLine[] = [];
  
  // État de l'héritage - mémorise le dernier code complet à chaque niveau
  let lastPosition: string = "";     // 4 chiffres (position SH, ex: "1001")
  let lastSubheading: string = "";   // 2 chiffres supplémentaires (sous-position, ex: "11" → total "100111")
  let lastCol2: string = "";         // Extension colonne 2
  let lastCol3: string = "";         // Extension colonne 3
  let lastCol4: string = "";         // Extension colonne 4
  let lastCol5: string = "";         // Extension colonne 5
  
  for (const line of rawLines) {
    const col1Raw = (line.col1 || "").trim();
    const col2 = (line.col2 || "").trim();
    const col3 = (line.col3 || "").trim();
    const col4 = (line.col4 || "").trim();
    const col5 = (line.col5 || "").trim();
    
    let nationalCode: string;
    let isInherited = false;
    
    // IGNORER les codes réservés entre crochets [XX.XX] ou [XXXX.XX]
    if (isReservedCode(col1Raw)) {
      console.log(`Skipping reserved code in processRawLines: "${col1Raw}"`);
      continue;
    }
    
    // Nettoyer col1 des points et espaces APRÈS vérification des crochets
    const col1Clean = cleanCode(col1Raw);
    
    // Vérification supplémentaire après nettoyage - le code doit être numérique
    if (col1Raw.includes(".") && col1Clean.length >= 4 && !/^\d+$/.test(col1Clean)) {
      console.log(`Skipping non-numeric code: "${col1Raw}" -> "${col1Clean}"`);
      continue;
    }
    
    // CAS 1: Col1 contient un point → c'est un code SH complet ou partiel
    if (col1Raw.includes(".")) {
      const parts = col1Raw.split(".");
      
      // Format "XX.XX" (ou "X.XX") → Position heading (chapitre.position)
      // Ex: "07.02" → position 0702, mais le CODE réel peut être en Col2
      if (parts[0].length <= 2 && parts[1]?.length === 2) {
        // CRITIQUE: Préserver le zéro initial du chapitre
        const chapter = parts[0].padStart(2, "0"); // "7" → "07"
        const positionPart = parts[1]; // "02"
        lastPosition = chapter + positionPart; // "0702"
        lastSubheading = "";
        lastCol2 = "";
        lastCol3 = "";
        lastCol4 = "";
        lastCol5 = "";
        
        // NOUVEAU: Vérifier si Col2 contient un code sous-position "XXXX.XX"
        // C'est le cas pour le format du tarif marocain où la colonne 1 est la position
        // et la colonne 2 contient le code SH à 6 chiffres (ex: "0702.00")
        if (col2 && col2.includes(".")) {
          const col2Parts = col2.split(".");
          // Format "XXXX.XX" dans col2
          if (col2Parts[0].length === 4 && col2Parts[1]?.length === 2) {
            // CRITIQUE: Utiliser le chapitre de COL1 (qui a le zéro initial correct)
            // et non celui de col2 qui peut avoir perdu le zéro
            // Ex: col1="07.02", col2="0702.00" → chapitre = "07" de col1
            const chapterFromCol1 = chapter; // déjà calculé avec padStart(2, "0")
            
            // Prendre la sous-position de col2 (les 2 derniers chiffres après le point)
            const subheadingFromCol2 = col2Parts[1]; // "00"
            
            // Construire lastPosition avec le chapitre de col1 + position
            // col1="07.02" → chapter="07", positionPart="02"
            // Donc lastPosition = "07" + "02" = "0702"
            lastSubheading = subheadingFromCol2;
            
            // col3, col4, col5 deviennent les extensions
            lastCol2 = (col3 && /^\d+$/.test(col3)) ? col3.padStart(2, "0") : "";
            lastCol3 = (col4 && /^\d+$/.test(col4)) ? col4.padStart(2, "0") : "";
            lastCol4 = (col5 && /^\d+$/.test(col5)) ? col5.padStart(2, "0") : "";
            lastCol5 = "";
            
            console.log(`Format Marocain: col1="${col1Raw}", col2="${col2}" → position=${lastPosition}, subheading=${lastSubheading}`);
            
            // Pas de ligne tarifaire pour les headings sans taux
            if (!line.duty_rate) continue;
            
            // Construire le code: position + subheading + extensions
            let code = lastPosition + lastSubheading;
            code += lastCol2 || "00";
            code += lastCol3 || "00";
            nationalCode = code.slice(0, 10);
            
            console.log(`Generated national code: ${nationalCode}`);
          } else {
            // Col2 a un point mais pas le format attendu
            if (!line.duty_rate) continue;
            nationalCode = lastPosition.padEnd(10, "0");
          }
        } else {
          // Format classique: col2 contient juste "00" ou une extension numérique
          // CRITIQUE: Toujours mettre à jour lastCol2/lastCol3 pour l'héritage AVANT de vérifier le taux
          const newCol2 = (col2 && /^\d+$/.test(col2)) ? col2.padStart(2, "0") : "";
          const newCol3 = (col3 && /^\d+$/.test(col3)) ? col3.padStart(2, "0") : "";
          
          // Mettre à jour l'état d'héritage
          lastCol2 = newCol2;
          lastCol3 = newCol3;
          
          // Si pas de taux → c'est un en-tête intermédiaire (ex: "1401.90 00")
          // Ne pas créer de ligne, mais l'héritage est déjà établi
          if (!line.duty_rate) {
            console.log(`Subheading header: col1="${col1Raw}", col2="${col2}" → setting lastPosition="${lastPosition}", lastCol2="${lastCol2}" for inheritance`);
            continue;
          }
          
          // Construire: position (4) + "00" (subheading) + col2 + col3
          let code = lastPosition + "00";
          code += lastCol2 || "00";
          code += lastCol3 || "00";
          nationalCode = code.slice(0, 10);
        }
        
      } else if (col1Clean.length >= 6) {
        // Format "XXXX.XX" ou plus → Sous-position à 6+ chiffres
        // CRITIQUE: Toujours mettre à jour lastPosition et lastSubheading pour l'héritage
        lastPosition = col1Clean.slice(0, 4);
        lastSubheading = col1Clean.slice(4, 6).padEnd(2, "0");
        
        // CRITIQUE: Mettre à jour les colonnes d'extension AVANT de vérifier le taux
        // Ceci assure que même les en-têtes sans taux (comme "1401.90 00") établissent
        // lastCol2 pour les sous-lignes qui suivent
        const newCol2 = (col2 && /^\d+$/.test(col2)) ? col2.padStart(2, "0") : "";
        const newCol3 = (col3 && /^\d+$/.test(col3)) ? col3.padStart(2, "0") : "";
        const newCol4 = (col4 && /^\d+$/.test(col4)) ? col4.padStart(2, "0") : "";
        const newCol5 = (col5 && /^\d+$/.test(col5)) ? col5.padStart(2, "0") : "";
        
        // Mettre à jour l'état d'héritage
        lastCol2 = newCol2;
        lastCol3 = newCol3;
        lastCol4 = newCol4;
        lastCol5 = newCol5;
        
        console.log(`Subheading ${col1Raw}: position=${lastPosition}, subheading=${lastSubheading}, lastCol2=${lastCol2}`);
        
        // Si pas de taux → c'est un en-tête (ex: "1401.90 00" sans taux)
        // L'héritage est maintenant établi (lastCol2 est mis à jour), on passe à la ligne suivante
        if (!line.duty_rate) {
          console.log(`Subheading header without rate: ${col1Raw} col2="${col2}" → lastSubheading="${lastSubheading}", lastCol2="${lastCol2}" for inheritance`);
          continue;
        }
        
        // Construire le code national (uniquement si on a un taux)
        let code = lastPosition + lastSubheading;
        code += lastCol2 || "00";
        code += lastCol3 || "00";
        nationalCode = code.slice(0, 10);
        
      } else {
        // Autre format avec point - traiter comme position
        lastPosition = col1Clean.padEnd(4, "0").slice(0, 4);
        lastSubheading = "";
        if (!line.duty_rate) continue;
        nationalCode = lastPosition.padEnd(10, "0");
      }
      
    // CAS 2a: Col1 = nombre à 2 chiffres (ex: "80", "20") → C'EST UN EN-TÊTE INTERMÉDIAIRE
    // Dans le tarif marocain, "80" signifie le 7e-8e chiffre du code, pas une catégorie
    } else if (/^\d{2}$/.test(col1Clean) && parseInt(col1Clean) >= 10) {
      // C'est un en-tête intermédiaire qui établit le segment 7e-8e pour les sous-lignes
      lastCol2 = col1Clean.padStart(2, "0");
      lastCol3 = "00"; // Réinitialiser pour les sous-lignes
      console.log(`Intermediate header in col1: "${col1Clean}" → setting lastCol2="${lastCol2}" for inheritance`);
      continue; // Ne pas créer de ligne tarifaire, juste établir l'héritage
      
    // CAS 2b: Col1 = chiffre catégorie (1, 2, 3...) ou col1 vide/tiret → HÉRITAGE du niveau précédent
    // Dans le tarif marocain, col1 peut contenir la catégorie tarifaire (1, 2, 3, etc.)
    // Ces lignes héritent du code HS de la position/sous-position précédente
    } else if (/^[1-9]$/.test(col1Clean) || col1Clean === "" || col1Raw === "–" || col1Raw === "-") {
      isInherited = true;
      
      // La base est toujours position + sous-position (6 chiffres)
      let baseCode = lastPosition + (lastSubheading || "00");
      
      // Détecter quel format de colonnes est utilisé pour cette ligne
      // IMPORTANT: Claude peut compacter les colonnes vides, donc "10" peut arriver dans col2
      // même si dans le PDF original il était dans la 4e colonne (9e-10e chiffre)
      
      const hasCol2 = col2 && /^\d+$/.test(col2);
      const hasCol3 = col3 && /^\d+$/.test(col3);
      const hasCol4 = col4 && /^\d+$/.test(col4);
      
      // Compter combien de colonnes numériques on a
      const numericColCount = [hasCol2, hasCol3, hasCol4].filter(Boolean).length;
      
      // CAS SPECIAL 1: En-tête intermédiaire sans taux (ex: "20", "80" → matières premières, autre)
      // Établit un nouveau lastCol2 hérité par les sous-lignes
      // On détecte via: pas de taux ET col2 est 2 chiffres ≥ 10 ET (col3 absent OU col3="00")
      const hasDutyRate = line.duty_rate && line.duty_rate.toString().trim() !== "";
      const col2IsTwoDigitHeader = hasCol2 && /^\d{2}$/.test(col2) && parseInt(col2) >= 10;
      // col3 "vide" = soit pas de col3, soit col3="00" (placeholder)
      const col3IsEmptyOrZero = !hasCol3 || col3 === "00";
      const isIntermediateHeader = !hasDutyRate && col2IsTwoDigitHeader && col3IsEmptyOrZero;
      
      if (isIntermediateHeader) {
        // Cette ligne établit le nouveau segment 7e-8e chiffre
        lastCol2 = col2.padStart(2, "0");
        // Réinitialiser lastCol3 pour les sous-lignes
        lastCol3 = "";
        console.log(`Intermediate header (col1 empty): col2="${col2}", col3="${col3}" → setting lastCol2="${lastCol2}", lastCol3="" for inheritance`);
        continue; // Ne pas créer de ligne tarifaire
      }
      
      // CAS 2: Ligne avec 2 colonnes numériques ET un taux (ex: "40 00 ... 2,5")
      // C'est une ligne tarifaire complète: col2=7e-8e, col3=9e-10e
      if (hasDutyRate && hasCol2 && hasCol3) {
        lastCol2 = col2.padStart(2, "0");
        lastCol3 = col3.padStart(2, "0");
        console.log(`Full line with 2 cols: col2="${col2}", col3="${col3}" → code segment ${lastCol2}${lastCol3}`);
      }
      // CAS 3: Ligne avec 1 colonne numérique ET un taux → extension 9e-10e
      else if (hasDutyRate && numericColCount === 1 && hasCol2) {
        // col2 = 9e-10e chiffre, on garde lastCol2 hérité
        lastCol3 = col2.padStart(2, "0");
        console.log(`Extension line: col2="${col2}" → 9th-10th digit, keeping lastCol2="${lastCol2}"`);
      }
      // CAS 4: col2 vide → chercher dans col3 ou col4
      else if (!hasCol2) {
        if (hasCol3) {
          lastCol3 = col3.padStart(2, "0");
        } else if (hasCol4) {
          lastCol3 = col4.padStart(2, "0");
        }
      }
      
      if (hasCol4 && hasCol3) {
        lastCol4 = col4.padStart(2, "0");
      }
      if (col5 && /^\d+$/.test(col5)) {
        lastCol5 = col5.padStart(2, "0");
      }
      
      // Construire le code: base + lastCol2 + lastCol3 (10 chiffres au total)
      let code = baseCode;
      code += lastCol2 || "00";
      code += lastCol3 || "00";
      nationalCode = code.slice(0, 10);
      
    // CAS 3: Col1 contient uniquement des chiffres (6 ou plus) → Code complet sans point
    } else if (/^\d{4,}$/.test(col1Clean)) {
      // Ex: "100111" au lieu de "1001.11"
      lastPosition = col1Clean.slice(0, 4);
      lastSubheading = col1Clean.length >= 6 ? col1Clean.slice(4, 6) : "";
      
      lastCol2 = (col2 && /^\d+$/.test(col2)) ? col2.padStart(2, "0") : "";
      lastCol3 = (col3 && /^\d+$/.test(col3)) ? col3.padStart(2, "0") : "";
      lastCol4 = (col4 && /^\d+$/.test(col4)) ? col4.padStart(2, "0") : "";
      lastCol5 = (col5 && /^\d+$/.test(col5)) ? col5.padStart(2, "0") : "";
      
      let code = lastPosition + (lastSubheading || "00");
      code += lastCol2 || "00";
      code += lastCol3 || "00";
      nationalCode = code.slice(0, 10);
      
    // CAS 4: Autre valeur non reconnue → ignorer
    } else {
      console.log(`Ignoring unrecognized col1 format: "${col1Raw}"`);
      continue;
    }
    
    // Parser le taux
    const { rate, note } = parseDutyRate(line.duty_rate);
    
    // Ne garder que les lignes avec un taux valide
    if (rate === null) continue;
    
    // Validation: le code doit avoir exactement 10 chiffres
    const cleanNationalCode = cleanCode(nationalCode).padEnd(10, "0");
    if (cleanNationalCode.length !== 10 || !/^\d{10}$/.test(cleanNationalCode)) {
      console.warn(`Invalid national code: ${nationalCode} (cleaned: ${cleanNationalCode}) from col1="${col1Raw}"`);
      continue;
    }
    
    results.push({
      national_code: cleanNationalCode,
      hs_code_6: cleanNationalCode.slice(0, 6),
      description: (line.description || "").replace(/^[–\-\s]+/, "").trim(),
      duty_rate: rate,
      duty_note: note,
      unit: line.unit || null,
      is_inherited: isInherited,
    });
  }
  
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
 * Extrait les codes HS à 6 chiffres uniques
 */
function extractHSCodes(tariffLines: TariffLine[], rawLines: RawTarifLine[]): HSCodeEntry[] {
  const seen = new Set<string>();
  const results: HSCodeEntry[] = [];
  
  // D'abord depuis les lignes tarifaires
  for (const line of tariffLines) {
    const code6 = line.hs_code_6;
    // Validation stricte : 6 chiffres uniquement
    if (code6 && isValidCleanCode(code6) && !seen.has(code6)) {
      seen.add(code6);
      results.push({
        code: `${code6.slice(0, 4)}.${code6.slice(4, 6)}`,
        code_clean: code6,
        description: line.description,
        level: "subheading",
      });
    }
  }
  
  // Ensuite depuis les lignes brutes (pour capter les codes sans taux)
  for (const line of rawLines) {
    const col1 = (line.col1 || "").trim();
    
    // IGNORER les codes réservés entre crochets [XX.XX]
    if (isReservedCode(col1)) {
      console.log(`Ignoring reserved/empty code in extractHSCodes: "${col1}"`);
      continue;
    }
    
    if (col1.includes(".") && col1 !== "1") {
      const clean = cleanCode(col1);
      
      // Validation stricte après nettoyage
      if (!isValidCleanCode(clean.slice(0, 6)) && clean.length >= 6) {
        console.log(`Skipping invalid code after cleaning: "${col1}" -> "${clean}"`);
        continue;
      }
      
      if (clean.length >= 6 && isValidCleanCode(clean.slice(0, 6))) {
        // Sous-position à 6 chiffres (XXXX.XX)
        const code6 = clean.slice(0, 6);
        if (!seen.has(code6)) {
          seen.add(code6);
          results.push({
            code: `${code6.slice(0, 4)}.${code6.slice(4, 6)}`,
            code_clean: code6,
            description: (line.description || "").replace(/^[–\-\s]+/, "").trim(),
            level: "subheading",
          });
        }
      } else if (clean.length === 4 && /^\d{4}$/.test(clean)) {
        // Position à 4 chiffres (XX.XX) → convertir en 6 chiffres
        const code6 = clean.padEnd(6, "0");
        if (!seen.has(code6)) {
          seen.add(code6);
          results.push({
            code: `${clean.slice(0, 2)}.${clean.slice(2, 4)}`,
            code_clean: code6,
            description: (line.description || "").replace(/^[–\-\s]+/, "").trim(),
            level: "heading",
          });
        }
      }
    }
  }
  
  // Filtrage final : ne garder que les codes valides
  return results.filter(hs => isValidCleanCode(hs.code_clean));
}

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

  console.log("Calling Claude with model:", CLAUDE_MODEL);
  console.log("PDF base64 size:", base64Pdf.length, "chars");

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
  // RÉDUIT à 3 minutes - Supabase EdgeRuntime a un timeout global de ~5 minutes
  // 3 min pour Claude + marge pour sauvegarde
  const CLAUDE_TIMEOUT_MS = 180000;
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
    hsCodeEntries = extractHSCodes(tariffLines, parsed.raw_lines);
    
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
        return new Response(
          JSON.stringify({
            summary: fullExtraction.summary,
            key_points: fullExtraction.key_points || [],
            hs_codes: (fullExtraction.mentioned_hs_codes as string[] || []).map(code => ({
              code: code,
              code_clean: code.replace(/[^0-9]/g, ""),
              description: "",
              level: "subheading"
            })),
            tariff_lines: fullExtraction.detected_tariff_changes || [],
            full_text: fullExtraction.extracted_text || "",
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
