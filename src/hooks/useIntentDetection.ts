import { useMemo } from "react";

/**
 * Détection d'intent côté client pour router automatiquement les messages
 * du chat vers les modules Classification ou Consultation sans aller-retour
 * réseau.
 *
 * Garde-fous anti-faux-positifs :
 *   - Une question "définitionnelle" ("c'est quoi", "qu'est-ce que",
 *     "comment ça marche") ne déclenche jamais le QCM ou le wizard.
 *   - Le QCM ne se lance que s'il y a une description produit
 *     (≥ 3 caractères significatifs hors mots-outils).
 *   - Le wizard Consultation se lance pour des intents transactionnels
 *     forts ("calculer mes droits", "import depuis X", "véhicule MRE", etc.).
 */

export type DetectedIntent =
  | { kind: "chat" }                                  // → flux chat normal
  | { kind: "classify"; productHint: string }         // → carte QCM inline
  | {
      kind: "consultation";
      mode: "import" | "mre" | "conformity" | "investor";
      hint: string;
    };                                                 // → carte mode + form

interface IntentInput {
  text: string;
  hasAttachment?: boolean;
}

const DEFINITIONAL_PATTERNS = [
  /\bc'?est\s+quoi\b/i,
  /\bqu'?est[- ]ce\s+qu[e']/i,
  /\bcomment\s+(ça|cela)\s+(marche|fonctionne)\b/i,
  /\bquelle?s?\s+(sont|est)\s+(la|le|les)\s+(différence|definition|définition)/i,
  /\bdéfini(s|tion|r)\b/i,
  /\bexpliqu(e|er|ez|e-moi|e moi)\b/i,
  /\bpourquoi\b/i,
];

const CLASSIFY_TRIGGERS = [
  /\b(classer|classifier|classification|nomenclature)\b/i,
  // "quel code SH", "quelle position tarifaire", "quel est le code SH", "le code SH de X"
  /\b(code|position)\s+(sh|hs|tarifaire|douani[èe]re?)\b/i,
  /\b(sh|hs)[\s-]?code\b/i,
  /\b(trouver|chercher|déterminer|identifier|donne(r|z|-?moi)?|connaître|savoir)\b.*\b(code|sh|hs|position)\b/i,
];

const IMPORT_TRIGGERS = [
  // calcul/combien + droit/taxe/...
  /\b(calcul(er|e|ez)?|combien)\b.*\b(droit|taxe|tva|ddi|cif|fob|coût|cout|frais|prix)/i,
  // importer + depuis + pays (liste élargie)
  /\b(import(er|ation|é|ée)?|importe|achat)\b.*\b(depuis|de\s+(la\s+|l['']\s*)?(chine|france|espagne|italie|turquie|inde|usa|allemagne|maroc|portugal|royaume[- ]uni|angleterre|belgique|tunisie|égypte|emirats?|dubai|asie|europe))\b/i,
  // droit/taxe d'import
  /\b(droit|taxe|ddi|tva)\b.*\b(d['']?\s*import|importation)\b/i,
  /\bcombien\s+(je\s+|ça\s+|cela\s+)?(vais\s+|va\s+)?(coûte(r|ra)?|payer|cost)/i,
  // "frais de douane", "dédouanement"
  /\b(frais\s+de\s+douane|dédouan(ement|er))\b/i,
];

const MRE_TRIGGERS = [
  /\b(mre|marocain.*(résident|resident).*étranger)\b/i,
  /\b(véhicule|voiture|effets?\s+personnels?|déménagement)\b.*\b(mre|maroc|retour)/i,
  /\bretour\s+(au\s+)?maroc\b/i,
];

const CONFORMITY_TRIGGERS = [
  /\b(conformit[ée]|onssa|anrt|coc|certificat\s+de\s+conformit[ée])\b/i,
  /\b(homologation|agr[ée]ment)\b/i,
];

const INVESTOR_TRIGGERS = [
  /\b(investi(sseur|ssement)|zone\s+franche|r[ée]gime\s+(suspensif|économique|economique))\b/i,
  /\b(usine|projet\s+industriel|matériel\s+d['']?investissement)\b/i,
];

function isDefinitional(text: string): boolean {
  return DEFINITIONAL_PATTERNS.some((re) => re.test(text));
}

function matchAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

/** Extrait un "product hint" simple : enlève les mots de question et garde le reste. */
function extractProductHint(text: string): string {
  return text
    .replace(/\b(quel|quelle|comment|combien|pourquoi|c'est|est-ce que|sh|hs|code|position|classer|classifier|le|la|les|un|une|des|du|de|pour|d'?un|d'?une)\b/gi, " ")
    .replace(/[?!.,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectIntent(input: IntentInput): DetectedIntent {
  const text = (input.text || "").trim();
  if (!text) return { kind: "chat" };

  // Une pièce jointe seule → on ne touche pas, le chat gère (vision/PDF).
  if (input.hasAttachment && text.length < 20) return { kind: "chat" };

  // Question définitionnelle → toujours du chat libre.
  if (isDefinitional(text)) return { kind: "chat" };

  // Consultation : on teste les modes les plus spécifiques avant Import.
  if (matchAny(text, MRE_TRIGGERS)) {
    return { kind: "consultation", mode: "mre", hint: text };
  }
  if (matchAny(text, INVESTOR_TRIGGERS)) {
    return { kind: "consultation", mode: "investor", hint: text };
  }
  if (matchAny(text, CONFORMITY_TRIGGERS)) {
    return { kind: "consultation", mode: "conformity", hint: text };
  }
  if (matchAny(text, IMPORT_TRIGGERS)) {
    return { kind: "consultation", mode: "import", hint: text };
  }

  // Classification : nécessite un trigger ET un hint produit non vide.
  if (matchAny(text, CLASSIFY_TRIGGERS)) {
    const hint = extractProductHint(text);
    if (hint.length >= 3) {
      return { kind: "classify", productHint: hint };
    }
  }

  return { kind: "chat" };
}

export function useIntentDetection(text: string, hasAttachment = false): DetectedIntent {
  return useMemo(() => detectIntent({ text, hasAttachment }), [text, hasAttachment]);
}
