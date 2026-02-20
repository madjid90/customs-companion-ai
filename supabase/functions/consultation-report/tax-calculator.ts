// ============================================================================
// CALCULATEUR DE DROITS ET TAXES — CALCUL MATHÉMATIQUE (PAS D'IA)
// ============================================================================

export interface TaxInput {
  caf_mad: number;
  duty_rate: number;
  vat_rate: number;
  tpi_rate?: number;
  tic_rate?: number;
  agreement_reduction?: number;
  mre_abatement?: boolean;
}

export interface TaxLine {
  tax: string;
  rate: number;
  base: number;
  amount: number;
}

export interface TaxBreakdown {
  caf_value_mad: number;
  lines: TaxLine[];
  total: number;
  total_with_goods: number;
  savings?: number;
}

export interface CAFInput {
  value: number;
  currency: string;
  incoterm: string;
  freight?: number;
  insurance?: number;
  exchange_rate: number;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("fr-MA", { maximumFractionDigits: 0 }).format(n);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function calculateCAF(input: CAFInput): { caf_mad: number; details: string[] } {
  const details: string[] = [];
  let caf = input.value;
  const incoterm = input.incoterm.toUpperCase();

  if (["CIF", "CIP"].includes(incoterm)) {
    details.push(`Valeur ${incoterm}: ${fmt(input.value)} ${input.currency} (fret + assurance inclus)`);
  } else if (["CFR", "CPT"].includes(incoterm)) {
    const insurance = input.insurance ?? caf * 0.005;
    caf += insurance;
    details.push(`Valeur ${incoterm}: ${fmt(input.value)} ${input.currency}`);
    details.push(`Assurance: ${fmt(insurance)} ${input.currency}${!input.insurance ? " (forfait 0.5%)" : ""}`);
  } else {
    const freight = input.freight ?? 0;
    const insurance = input.insurance ?? (input.value + freight) * 0.005;
    caf += freight + insurance;
    details.push(`Valeur ${incoterm}: ${fmt(input.value)} ${input.currency}`);
    if (freight > 0) details.push(`Fret: ${fmt(freight)} ${input.currency}`);
    details.push(`Assurance: ${fmt(insurance)} ${input.currency}${!input.insurance ? " (forfait 0.5%)" : ""}`);
  }

  const caf_mad = Math.ceil(caf * input.exchange_rate);
  details.push(`Taux de change: 1 ${input.currency} = ${input.exchange_rate} MAD`);
  details.push(`Valeur en douane (CAF): ${fmt(caf_mad)} MAD`);

  return { caf_mad, details };
}

export function calculateTaxes(input: TaxInput): TaxBreakdown {
  const caf = input.caf_mad;
  const lines: TaxLine[] = [];

  // 1. Droit d'importation (DI)
  let effective_duty_rate = input.duty_rate;
  let di_label = "Droit d'importation (DI)";

  if (input.agreement_reduction && input.agreement_reduction > 0) {
    const original_rate = effective_duty_rate;
    effective_duty_rate = effective_duty_rate * (1 - input.agreement_reduction);
    if (input.agreement_reduction >= 1) {
      di_label += " (exonéré — accord préférentiel)";
    } else {
      di_label += ` (réduit de ${original_rate}% → ${effective_duty_rate.toFixed(2)}%)`;
    }
  }

  if (input.mre_abatement) {
    effective_duty_rate = input.duty_rate * 0.10;
    di_label = "DI (abattement MRE 90%)";
  }

  const di = Math.ceil(caf * effective_duty_rate / 100);
  lines.push({ tax: di_label, rate: round2(effective_duty_rate), base: caf, amount: di });

  // 2. Taxe parafiscale (TPF)
  const tpi_rate = input.tpi_rate ?? 0.25;
  const tpf = input.mre_abatement ? 0 : Math.ceil(caf * tpi_rate / 100);
  lines.push({
    tax: input.mre_abatement ? "TPF (exonéré MRE)" : "Taxe parafiscale (TPF)",
    rate: input.mre_abatement ? 0 : tpi_rate,
    base: input.mre_abatement ? 0 : caf,
    amount: tpf,
  });

  // 3. TIC
  let tic = 0;
  if (input.tic_rate && input.tic_rate > 0) {
    tic = Math.ceil(caf * input.tic_rate / 100);
    lines.push({ tax: "TIC (Taxe intérieure de consommation)", rate: input.tic_rate, base: caf, amount: tic });
  }

  // 4. TVA
  const tva_base = caf + di + tpf + tic;
  const vat_rate = input.vat_rate ?? 20;
  const tva = Math.ceil(tva_base * vat_rate / 100);
  lines.push({ tax: "TVA à l'importation", rate: vat_rate, base: tva_base, amount: tva });

  const total = di + tpf + tic + tva;

  let savings: number | undefined;
  if (input.agreement_reduction && input.agreement_reduction > 0) {
    const di_without = Math.ceil(caf * input.duty_rate / 100);
    const tva_base_without = caf + di_without + tpf + tic;
    const tva_without = Math.ceil(tva_base_without * vat_rate / 100);
    savings = (di_without + tpf + tic + tva_without) - total;
  }

  return { caf_value_mad: caf, lines, total, total_with_goods: caf + total, savings };
}

export const EXCHANGE_RATES: Record<string, number> = {
  MAD: 1, USD: 10.2, EUR: 10.85, GBP: 12.8, CNY: 1.4,
  AED: 2.78, SAR: 2.72, CAD: 7.5, CHF: 11.5, JPY: 0.068, KRW: 0.0076,
};
