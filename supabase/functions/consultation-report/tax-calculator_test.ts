import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";
import { calculateCAF, calculateTaxes, EXCHANGE_RATES } from "./tax-calculator.ts";

// ============================================================================
// CAF CALCULATION TESTS
// ============================================================================

Deno.test("calculateCAF - CIF incoterm includes freight+insurance", () => {
  const result = calculateCAF({ value: 10000, currency: "EUR", incoterm: "CIF", exchange_rate: 10.85 });
  assertEquals(result.caf_mad, Math.ceil(10000 * 10.85));
  assert(result.details.length > 0);
});

Deno.test("calculateCAF - FOB adds freight and default insurance", () => {
  const result = calculateCAF({ value: 10000, currency: "USD", incoterm: "FOB", freight: 500, exchange_rate: 10.2 });
  // insurance = (10000+500)*0.005 = 52.5
  const expected = Math.ceil((10000 + 500 + 52.5) * 10.2);
  assertEquals(result.caf_mad, expected);
});

Deno.test("calculateCAF - FOB with explicit insurance", () => {
  const result = calculateCAF({ value: 10000, currency: "EUR", incoterm: "FOB", freight: 1000, insurance: 200, exchange_rate: 10.85 });
  const expected = Math.ceil((10000 + 1000 + 200) * 10.85);
  assertEquals(result.caf_mad, expected);
});

Deno.test("calculateCAF - CFR adds only insurance", () => {
  const result = calculateCAF({ value: 10000, currency: "USD", incoterm: "CFR", exchange_rate: 10.2 });
  // insurance default = 10000*0.005 = 50
  const expected = Math.ceil((10000 + 50) * 10.2);
  assertEquals(result.caf_mad, expected);
});

// ============================================================================
// TAX CALCULATION TESTS
// ============================================================================

Deno.test("calculateTaxes - standard import 25% DI 20% TVA", () => {
  const result = calculateTaxes({ caf_mad: 100000, duty_rate: 25, vat_rate: 20 });
  
  assertEquals(result.caf_value_mad, 100000);
  
  // DI = 100000 * 25% = 25000
  const di = result.lines.find(l => l.tax.includes("Droit d'importation"));
  assert(di !== undefined, "DI line should exist");
  assertEquals(di!.amount, 25000);
  
  // TPF = 100000 * 0.25% = 250
  const tpf = result.lines.find(l => l.tax.includes("parafiscale"));
  assert(tpf !== undefined, "TPF line should exist");
  assertEquals(tpf!.amount, 250);
  
  // TVA base = 100000 + 25000 + 250 = 125250, TVA = 125250 * 20% = 25050
  const tva = result.lines.find(l => l.tax.includes("TVA"));
  assert(tva !== undefined, "TVA line should exist");
  assertEquals(tva!.amount, 25050);
  
  assertEquals(result.total, 25000 + 250 + 25050);
  assertEquals(result.total_with_goods, 100000 + result.total);
});

Deno.test("calculateTaxes - MRE abatement 90%", () => {
  const result = calculateTaxes({ caf_mad: 200000, duty_rate: 17.5, vat_rate: 20, mre_abatement: true });
  
  // DI with 90% abatement: 200000 * (17.5 * 0.10)% = 200000 * 1.75% = 3500
  const di = result.lines.find(l => l.tax.includes("DI"));
  assert(di !== undefined);
  assertEquals(di!.amount, 3500);
  
  // TPF exonéré MRE = 0
  const tpf = result.lines.find(l => l.tax.includes("TPF"));
  assert(tpf !== undefined);
  assertEquals(tpf!.amount, 0);
});

Deno.test("calculateTaxes - agreement full reduction", () => {
  const result = calculateTaxes({ caf_mad: 100000, duty_rate: 25, vat_rate: 20, agreement_reduction: 1.0 });
  
  const di = result.lines.find(l => l.tax.includes("Droit d'importation"));
  assert(di !== undefined);
  assertEquals(di!.amount, 0);
  assert(result.savings !== undefined && result.savings > 0, "Should show savings");
});

Deno.test("calculateTaxes - with TIC", () => {
  const result = calculateTaxes({ caf_mad: 50000, duty_rate: 10, vat_rate: 20, tic_rate: 5 });
  
  const tic = result.lines.find(l => l.tax.includes("TIC"));
  assert(tic !== undefined, "TIC line should exist");
  assertEquals(tic!.amount, 2500); // 50000 * 5%
  
  // TVA base = 50000 + 5000(DI) + 125(TPF) + 2500(TIC) = 57625
  const tva = result.lines.find(l => l.tax.includes("TVA"));
  assertEquals(tva!.base, 57625);
});

Deno.test("calculateTaxes - zero duties", () => {
  const result = calculateTaxes({ caf_mad: 100000, duty_rate: 0, vat_rate: 0 });
  
  // TPF still applies by default
  const tpf = result.lines.find(l => l.tax.includes("parafiscale"));
  assertEquals(tpf!.amount, 250);
  
  assertEquals(result.total, 250); // only TPF
});

// ============================================================================
// EXCHANGE RATES
// ============================================================================

Deno.test("EXCHANGE_RATES has standard currencies", () => {
  assert(EXCHANGE_RATES.EUR > 0);
  assert(EXCHANGE_RATES.USD > 0);
  assert(EXCHANGE_RATES.MAD === 1);
  assert(EXCHANGE_RATES.CNY > 0);
});
