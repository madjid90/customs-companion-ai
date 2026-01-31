// =============================================================================
// TESTS POUR HS-CODE-UTILS
// Run: deno test --allow-none supabase/functions/_shared/hs-code-utils_test.ts
// =============================================================================

import { 
  normalize10Strict,
  normalize6Strict,
  normalize2Strict,
  normalize4Strict,
  extractHS6,
  digitsOnly,
  cleanHSCode,
  formatHSCode,
  getHSLevel,
  parseDetectedCode,
  isValidNationalCode,
  isValidHS6,
  runSelfTests
} from "./hs-code-utils.ts";
import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// =============================================================================
// TEST: normalize10Strict - Ne doit JAMAIS faire de padding
// =============================================================================

Deno.test("normalize10Strict: accepts exactly 10 digits", () => {
  assertEquals(normalize10Strict("8903110000"), "8903110000");
  assertEquals(normalize10Strict("0101210000"), "0101210000");
});

Deno.test("normalize10Strict: strips non-digits", () => {
  assertEquals(normalize10Strict("8903.11.00.00"), "8903110000");
  assertEquals(normalize10Strict("89.03.11.00.00"), "8903110000");
  assertEquals(normalize10Strict("8903 11 00 00"), "8903110000");
});

Deno.test("normalize10Strict: rejects 6 digits (NO PADDING)", () => {
  assertEquals(normalize10Strict("890311"), null);
});

Deno.test("normalize10Strict: rejects 8 digits (NO PADDING)", () => {
  assertEquals(normalize10Strict("89031100"), null);
});

Deno.test("normalize10Strict: rejects 4 digits (NO PADDING)", () => {
  assertEquals(normalize10Strict("8903"), null);
});

Deno.test("normalize10Strict: rejects invalid chapter 00", () => {
  assertEquals(normalize10Strict("0003110000"), null);
});

Deno.test("normalize10Strict: rejects empty/null", () => {
  assertEquals(normalize10Strict(""), null);
  assertEquals(normalize10Strict(null), null);
  assertEquals(normalize10Strict(undefined), null);
});

// =============================================================================
// TEST: normalize6Strict - Ne doit JAMAIS faire de padding
// =============================================================================

Deno.test("normalize6Strict: accepts exactly 6 digits", () => {
  assertEquals(normalize6Strict("890311"), "890311");
  assertEquals(normalize6Strict("010121"), "010121");
});

Deno.test("normalize6Strict: strips formatting", () => {
  assertEquals(normalize6Strict("8903.11"), "890311");
  assertEquals(normalize6Strict("89.03.11"), "890311");
});

Deno.test("normalize6Strict: rejects 4 digits (NO PADDING)", () => {
  assertEquals(normalize6Strict("8903"), null);
});

Deno.test("normalize6Strict: rejects 10 digits", () => {
  assertEquals(normalize6Strict("8903110000"), null);
});

Deno.test("normalize6Strict: rejects invalid chapter 00", () => {
  assertEquals(normalize6Strict("000311"), null);
});

// =============================================================================
// TEST: extractHS6 - Extrait les 6 premiers digits
// =============================================================================

Deno.test("extractHS6: from 10 digits", () => {
  assertEquals(extractHS6("8903110000"), "890311");
});

Deno.test("extractHS6: from 6 digits", () => {
  assertEquals(extractHS6("890311"), "890311");
});

Deno.test("extractHS6: returns null for < 6 digits", () => {
  assertEquals(extractHS6("8903"), null);
  assertEquals(extractHS6("89"), null);
  assertEquals(extractHS6(""), null);
});

// =============================================================================
// TEST: parseDetectedCode - Parse sans padding
// =============================================================================

Deno.test("parseDetectedCode: 10 digits complete", () => {
  const result = parseDetectedCode("8903.11.00.00");
  assertEquals(result.national_code, "8903110000");
  assertEquals(result.hs_code_6, "890311");
  assertEquals(result.is_complete, true);
  assertEquals(result.level, "national_line");
});

Deno.test("parseDetectedCode: 6 digits partial", () => {
  const result = parseDetectedCode("8903.11");
  assertEquals(result.national_code, null);
  assertEquals(result.hs_code_6, "890311");
  assertEquals(result.is_complete, false);
  assertEquals(result.level, "subheading");
});

Deno.test("parseDetectedCode: 4 digits no hs_code_6", () => {
  const result = parseDetectedCode("8903");
  assertEquals(result.national_code, null);
  assertEquals(result.hs_code_6, null);
  assertEquals(result.is_complete, false);
  assertEquals(result.level, "heading");
});

// =============================================================================
// TEST: Self-tests intégrés
// =============================================================================

Deno.test("runSelfTests: all pass", () => {
  const { passed, results } = runSelfTests();
  if (!passed) {
    console.log("Failed tests:", results.filter(r => r.startsWith("✗")));
  }
  assertEquals(passed, true);
});
