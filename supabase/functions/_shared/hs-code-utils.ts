// =============================================================================
// SHARED HS CODE UTILITIES - STRICT VALIDATION (NO PADDING)
// =============================================================================
// 
// RÈGLE FONDAMENTALE: Ne JAMAIS fabriquer un code national.
// - Si on n'a pas exactement 10 digits → national_code = null
// - Si on n'a que 6 digits → stocker hs_code_6 uniquement
//
// =============================================================================

/**
 * Extrait uniquement les chiffres d'une chaîne
 */
export function digitsOnly(str: string | null | undefined): string {
  if (!str) return "";
  return str.replace(/[^0-9]/g, "");
}

/**
 * Nettoie un code SH en supprimant ponctuation et espaces
 */
export function cleanHSCode(code: string | null | undefined): string {
  if (!code) return "";
  return code.replace(/[\.\s\-–—]/g, "").trim();
}

/**
 * Valide et normalise un code national à 10 chiffres EXACT
 * @returns Le code à 10 chiffres ou null si invalide
 * 
 * IMPORTANT: Ne fait JAMAIS de padding. Si le code n'a pas 10 digits, retourne null.
 */
export function normalize10Strict(str: string | null | undefined): string | null {
  if (!str) return null;
  const digits = digitsOnly(str);
  if (digits.length !== 10) return null;
  // Validation supplémentaire: doit commencer par un chapitre valide (01-99)
  const chapter = parseInt(digits.slice(0, 2), 10);
  if (chapter < 1 || chapter > 99) return null;
  return digits;
}

/**
 * Valide et normalise un code SH à 6 chiffres EXACT
 * @returns Le code à 6 chiffres ou null si invalide
 * 
 * IMPORTANT: Ne fait JAMAIS de padding. Si le code n'a pas 6 digits, retourne null.
 */
export function normalize6Strict(str: string | null | undefined): string | null {
  if (!str) return null;
  const cleaned = cleanHSCode(str);
  const digits = digitsOnly(cleaned);
  if (digits.length !== 6) return null;
  // Validation supplémentaire: doit commencer par un chapitre valide (01-99)
  const chapter = parseInt(digits.slice(0, 2), 10);
  if (chapter < 1 || chapter > 99) return null;
  return digits;
}

/**
 * Valide et normalise un code à 2 chiffres (col2/col3)
 * @returns Le code à 2 chiffres ou null si invalide
 */
export function normalize2Strict(str: string | null | undefined): string | null {
  if (!str) return null;
  const digits = digitsOnly(str);
  if (digits.length !== 2) return null;
  return digits;
}

/**
 * Valide et normalise un code à 4 chiffres (position)
 * @returns Le code à 4 chiffres ou null si invalide
 */
export function normalize4Strict(str: string | null | undefined): string | null {
  if (!str) return null;
  const digits = digitsOnly(str);
  if (digits.length !== 4) return null;
  const chapter = parseInt(digits.slice(0, 2), 10);
  if (chapter < 1 || chapter > 99) return null;
  return digits;
}

/**
 * Extrait le code HS6 d'un code plus long (sans padding)
 * @returns Les 6 premiers chiffres ou null si moins de 6 digits
 */
export function extractHS6(code: string | null | undefined): string | null {
  if (!code) return null;
  const digits = digitsOnly(code);
  if (digits.length < 6) return null;
  return digits.slice(0, 6);
}

/**
 * Vérifie si un code est un code national valide (10 digits)
 */
export function isValidNationalCode(code: string | null | undefined): boolean {
  return normalize10Strict(code) !== null;
}

/**
 * Vérifie si un code est un code HS6 valide (6 digits)
 */
export function isValidHS6(code: string | null | undefined): boolean {
  return normalize6Strict(code) !== null;
}

/**
 * Détermine le niveau d'un code HS basé sur sa longueur
 */
export function getHSLevel(code: string | null | undefined): string {
  const len = digitsOnly(code).length;
  if (len <= 2) return "chapter";
  if (len <= 4) return "heading";
  if (len <= 6) return "subheading";
  if (len <= 8) return "tariff_item";
  return "national_line";
}

/**
 * Formate un code HS avec des points (XX.XX.XX.XX.XX)
 */
export function formatHSCode(code: string | null | undefined): string {
  const clean = digitsOnly(code);
  if (clean.length <= 2) return clean;
  if (clean.length <= 4) return `${clean.slice(0, 2)}.${clean.slice(2)}`;
  if (clean.length <= 6) return `${clean.slice(0, 4)}.${clean.slice(4)}`;
  if (clean.length <= 8) return `${clean.slice(0, 4)}.${clean.slice(4, 6)}.${clean.slice(6)}`;
  return `${clean.slice(0, 4)}.${clean.slice(4, 6)}.${clean.slice(6, 8)}.${clean.slice(8)}`;
}

/**
 * Résultat de l'analyse d'un code détecté
 */
export interface ParsedHSCode {
  raw: string;
  hs_code_6: string | null;
  national_code: string | null;
  level: string;
  is_complete: boolean;  // true si on a un code national complet
}

/**
 * Parse un code détecté et extrait les composants valides
 * NE FAIT JAMAIS DE PADDING
 */
export function parseDetectedCode(raw: string): ParsedHSCode {
  const digits = digitsOnly(raw);
  
  return {
    raw,
    hs_code_6: digits.length >= 6 ? digits.slice(0, 6) : null,
    national_code: digits.length === 10 ? digits : null,
    level: getHSLevel(digits),
    is_complete: digits.length === 10
  };
}

// =============================================================================
// TESTS INTÉGRÉS (à exécuter via Deno test)
// =============================================================================

export function runSelfTests(): { passed: boolean; results: string[] } {
  const results: string[] = [];
  let allPassed = true;

  const test = (name: string, condition: boolean) => {
    if (condition) {
      results.push(`✓ ${name}`);
    } else {
      results.push(`✗ ${name}`);
      allPassed = false;
    }
  };

  // Tests normalize10Strict
  test("normalize10Strict: 10 digits valid", normalize10Strict("8903110000") === "8903110000");
  test("normalize10Strict: 10 digits with dots", normalize10Strict("8903.11.00.00") === "8903110000");
  test("normalize10Strict: 6 digits returns null", normalize10Strict("890311") === null);
  test("normalize10Strict: 8 digits returns null", normalize10Strict("89031100") === null);
  test("normalize10Strict: empty returns null", normalize10Strict("") === null);
  test("normalize10Strict: invalid chapter returns null", normalize10Strict("0003110000") === null);

  // Tests normalize6Strict
  test("normalize6Strict: 6 digits valid", normalize6Strict("890311") === "890311");
  test("normalize6Strict: 6 digits with dots", normalize6Strict("8903.11") === "890311");
  test("normalize6Strict: 4 digits returns null", normalize6Strict("8903") === null);
  test("normalize6Strict: 10 digits returns null", normalize6Strict("8903110000") === null);
  test("normalize6Strict: empty returns null", normalize6Strict("") === null);

  // Tests extractHS6
  test("extractHS6: from 10 digits", extractHS6("8903110000") === "890311");
  test("extractHS6: from 6 digits", extractHS6("890311") === "890311");
  test("extractHS6: from 4 digits returns null", extractHS6("8903") === null);

  // Tests parseDetectedCode
  const parsed10 = parseDetectedCode("8903.11.00.00");
  test("parseDetectedCode: 10 digits has national_code", parsed10.national_code === "8903110000");
  test("parseDetectedCode: 10 digits has hs_code_6", parsed10.hs_code_6 === "890311");
  test("parseDetectedCode: 10 digits is_complete", parsed10.is_complete === true);

  const parsed6 = parseDetectedCode("8903.11");
  test("parseDetectedCode: 6 digits no national_code", parsed6.national_code === null);
  test("parseDetectedCode: 6 digits has hs_code_6", parsed6.hs_code_6 === "890311");
  test("parseDetectedCode: 6 digits not is_complete", parsed6.is_complete === false);

  const parsed4 = parseDetectedCode("8903");
  test("parseDetectedCode: 4 digits no national_code", parsed4.national_code === null);
  test("parseDetectedCode: 4 digits no hs_code_6", parsed4.hs_code_6 === null);

  return { passed: allPassed, results };
}
