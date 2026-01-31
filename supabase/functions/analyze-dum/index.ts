// ============================================================================
// EDGE FUNCTION: ANALYZE DUM (Déclaration Unique de Marchandises)
// ============================================================================
// Parses DUM PDFs, extracts structured data, calculates taxes with source tracking
// Production hardened: auth, masking, retries, observability
// ============================================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { maskSensitiveData, maskSensitiveObject, safeLog } from "../_shared/masking.ts";
import { parseJsonResilient } from "../_shared/json-resilient.ts";
import { requireAuth, isProductionMode } from "../_shared/auth-check.ts";
import { callAnthropicWithRetry } from "../_shared/retry.ts";

// ============================================================================
// CORS & CONFIG
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ============================================================================
// OBSERVABILITY METRICS
// ============================================================================

interface DumMetrics {
  run_id: string;
  start_time: number;
  items_extracted: number;
  taxes_calculated: boolean;
  saved_to_db: boolean;
  errors_count: number;
  llm_duration_ms: number;
}

function createDumMetrics(): DumMetrics {
  return {
    run_id: crypto.randomUUID(),
    start_time: Date.now(),
    items_extracted: 0,
    taxes_calculated: false,
    saved_to_db: false,
    errors_count: 0,
    llm_duration_ms: 0,
  };
}

function logDumMetrics(metrics: DumMetrics, status: "success" | "error"): void {
  console.log(JSON.stringify({
    type: "metrics",
    function: "analyze-dum",
    run_id: metrics.run_id,
    status,
    duration_ms: Date.now() - metrics.start_time,
    items_extracted: metrics.items_extracted,
    taxes_calculated: metrics.taxes_calculated,
    saved_to_db: metrics.saved_to_db,
    errors_count: metrics.errors_count,
    llm_duration_ms: metrics.llm_duration_ms,
    timestamp: new Date().toISOString(),
  }));
}

// ============================================================================
// TYPES
// ============================================================================

interface AnalyzeDumRequest {
  pdf_base64?: string;
  image_base64?: string;
  media_type?: string; // "application/pdf" | "image/jpeg" | "image/png"
  source_pdf_name?: string;
  country_code?: string;
  save_to_db?: boolean;
}

interface ExtractedParty {
  name: string | null;
  id: string | null;
  country: string | null;
  source: SourceRef;
}

interface ExtractedValue {
  value: number | null;
  currency: string | null;
  source: SourceRef;
}

interface SourceRef {
  page: number | null;
  field_anchor: string | null;
  confidence: "high" | "medium" | "low";
}

interface ExtractedItem {
  line_no: number;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  value: number | null;
  origin_country: string | null;
  hs_code: string | null;
  duty_rate: number | null;
  source: SourceRef;
}

interface ExtractedDum {
  // Header
  dum_number: string | null;
  regime_code: string | null;
  bureau_code: string | null;
  bureau_name: string | null;
  dum_date: string | null;
  
  // Parties
  importer: ExtractedParty;
  exporter: ExtractedParty;
  
  // Commercial
  incoterm: string | null;
  currency_code: string | null;
  invoice_value: ExtractedValue;
  freight_value: ExtractedValue;
  insurance_value: ExtractedValue;
  
  // Items
  items: ExtractedItem[];
  
  // Metadata
  page_count: number;
  extraction_warnings: string[];
}

interface TaxCalculation {
  cif_value: number;
  duty_rate: number | null;
  duty_rate_source: "extracted" | "database" | "missing";
  duty_amount: number;
  vat_base: number;
  vat_rate: number;
  vat_amount: number;
  other_taxes: Record<string, number>;
  other_taxes_amount: number;
  total_taxes: number;
  grand_total: number;
}

interface ComputedTotals {
  total_cif: number;
  total_duty: number;
  total_vat: number;
  total_other: number;
  grand_total: number;
  missing_rates: string[];
  is_complete: boolean;
}

interface AnalyzeDumResponse {
  success: boolean;
  dum_id: string | null;
  extracted_json: ExtractedDum | null;
  computed_totals: ComputedTotals | null;
  sources: Array<{
    field: string;
    page: number | null;
    anchor: string | null;
  }>;
  error?: string;
}

// ============================================================================
// EXTRACTION PROMPT
// ============================================================================

function getDumExtractionPrompt(): string {
  return `Tu es un expert en extraction de données douanières. Analyse cette Déclaration Unique de Marchandises (DUM) marocaine.

## CHAMPS À EXTRAIRE

### En-tête
- dum_number: Numéro de la DUM (ex: 123456/2024)
- regime_code: Code régime (ex: 10, 40, 73...)
- bureau_code: Code bureau (ex: 001, 120...)
- bureau_name: Nom du bureau (ex: Casa Port)
- dum_date: Date (format YYYY-MM-DD)

### Parties
- importer.name: Raison sociale importateur
- importer.id: ICE ou RC importateur
- exporter.name: Nom exportateur
- exporter.country: Pays exportateur (code ISO 2 lettres)

### Commercial
- incoterm: EXW, FOB, CIF, etc.
- currency_code: Devise (MAD, EUR, USD...)
- invoice_value: Valeur facture
- freight_value: Fret
- insurance_value: Assurance

### Lignes marchandises (items)
Pour chaque ligne:
- line_no: Numéro de ligne
- description: Désignation commerciale
- quantity: Quantité
- unit: Unité (KG, U, M2...)
- unit_price: Prix unitaire
- value: Valeur ligne
- origin_country: Pays d'origine (code ISO)
- hs_code: Code SH si présent (10 digits ou formaté)
- duty_rate: Taux DDI si visible (nombre, pas %)

## FORMAT DE RÉPONSE

Retourne un JSON strict:

\`\`\`json
{
  "dum_number": "...",
  "regime_code": "...",
  "bureau_code": "...",
  "bureau_name": "...",
  "dum_date": "YYYY-MM-DD",
  "importer": {
    "name": "...",
    "id": "...",
    "country": "MA",
    "source": {"page": 1, "field_anchor": "Case 8", "confidence": "high"}
  },
  "exporter": {
    "name": "...",
    "id": null,
    "country": "CN",
    "source": {"page": 1, "field_anchor": "Case 2", "confidence": "high"}
  },
  "incoterm": "CIF",
  "currency_code": "EUR",
  "invoice_value": {"value": 12500.00, "currency": "EUR", "source": {"page": 1, "field_anchor": "Case 22", "confidence": "high"}},
  "freight_value": {"value": 850.00, "currency": "EUR", "source": {"page": 1, "field_anchor": "Case 23", "confidence": "medium"}},
  "insurance_value": {"value": 125.00, "currency": "EUR", "source": {"page": 1, "field_anchor": "Case 23", "confidence": "medium"}},
  "items": [
    {
      "line_no": 1,
      "description": "Machines à laver le linge",
      "quantity": 100,
      "unit": "U",
      "unit_price": 125.00,
      "value": 12500.00,
      "origin_country": "CN",
      "hs_code": "8450110000",
      "duty_rate": 2.5,
      "source": {"page": 2, "field_anchor": "Article 1", "confidence": "high"}
    }
  ],
  "page_count": 3,
  "extraction_warnings": ["Taux DDI non visible pour article 2"]
}
\`\`\`

## RÈGLES

1. Les valeurs numériques doivent être des nombres, pas des chaînes
2. Les codes SH doivent être normalisés (10 digits si possible)
3. Indiquer la source (page, case/champ, confiance) pour chaque donnée extraite
4. Si une donnée est illisible ou absente, mettre null
5. Les pays doivent être en code ISO 2 lettres
6. Les dates en format YYYY-MM-DD`;
}

// ============================================================================
// AI EXTRACTION WITH RETRY
// ============================================================================

async function extractDumData(
  contentBase64: string,
  mediaType: string,
  metrics: DumMetrics
): Promise<ExtractedDum> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  safeLog("info", "analyze-dum", "Calling Claude for extraction", { mediaType });

  const documentContent = mediaType === "application/pdf"
    ? {
        type: "document" as const,
        source: {
          type: "base64" as const,
          media_type: "application/pdf",
          data: contentBase64,
        },
      }
    : {
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: mediaType,
          data: contentBase64,
        },
      };

  const llmStart = Date.now();
  
  // Use retry wrapper for resilience
  const response = await callAnthropicWithRetry(
    ANTHROPIC_API_KEY,
    {
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      system: getDumExtractionPrompt(),
      messages: [
        {
          role: "user",
          content: [
            documentContent,
            {
              type: "text",
              text: "Extrais toutes les données de cette DUM en JSON strict. Inclus les sources pour chaque champ.",
            },
          ],
        },
      ],
    },
    120000  // 2 minutes timeout for DUM
  );

  metrics.llm_duration_ms = Date.now() - llmStart;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${maskSensitiveData(errorText)}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || "";

  // Use resilient JSON parser
  const parseResult = parseJsonResilient(content);
  
  if (!parseResult.success || !parseResult.data) {
    // Try legacy pattern matching as fallback
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                      content.match(/\{[\s\S]*"items"[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("No valid JSON in Claude response after all fallbacks");
    }
    
    try {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      return normalizeExtractedDum(parsed);
    } catch (e) {
      throw new Error(`JSON parse error: ${e}`);
    }
  }
  
  if (parseResult.partial) {
    safeLog("warn", "analyze-dum", "JSON parsed with fallback", {
      recoveredFields: parseResult.recoveredFields?.slice(0, 5),
    });
  }

  return normalizeExtractedDum(parseResult.data);
}

function normalizeExtractedDum(raw: any): ExtractedDum {
  const defaultSource: SourceRef = { page: null, field_anchor: null, confidence: "low" };

  return {
    dum_number: raw.dum_number || null,
    regime_code: raw.regime_code || null,
    bureau_code: raw.bureau_code || null,
    bureau_name: raw.bureau_name || null,
    dum_date: raw.dum_date || null,
    
    importer: {
      name: raw.importer?.name || null,
      id: raw.importer?.id || null,
      country: raw.importer?.country || "MA",
      source: raw.importer?.source || defaultSource,
    },
    
    exporter: {
      name: raw.exporter?.name || null,
      id: raw.exporter?.id || null,
      country: raw.exporter?.country || null,
      source: raw.exporter?.source || defaultSource,
    },
    
    incoterm: raw.incoterm || null,
    currency_code: raw.currency_code || null,
    
    invoice_value: {
      value: parseFloat(raw.invoice_value?.value) || null,
      currency: raw.invoice_value?.currency || raw.currency_code || null,
      source: raw.invoice_value?.source || defaultSource,
    },
    
    freight_value: {
      value: parseFloat(raw.freight_value?.value) || null,
      currency: raw.freight_value?.currency || raw.currency_code || null,
      source: raw.freight_value?.source || defaultSource,
    },
    
    insurance_value: {
      value: parseFloat(raw.insurance_value?.value) || null,
      currency: raw.insurance_value?.currency || raw.currency_code || null,
      source: raw.insurance_value?.source || defaultSource,
    },
    
    items: (raw.items || []).map((item: any, idx: number) => ({
      line_no: item.line_no || idx + 1,
      description: item.description || null,
      quantity: parseFloat(item.quantity) || null,
      unit: item.unit || null,
      unit_price: parseFloat(item.unit_price) || null,
      value: parseFloat(item.value) || null,
      origin_country: item.origin_country || null,
      hs_code: normalizeHsCode(item.hs_code),
      duty_rate: parseFloat(item.duty_rate) || null,
      source: item.source || defaultSource,
    })),
    
    page_count: raw.page_count || 1,
    extraction_warnings: raw.extraction_warnings || [],
  };
}

function normalizeHsCode(code: any): string | null {
  if (!code) return null;
  const digits = String(code).replace(/\D/g, "");
  if (digits.length < 4) return null;
  return digits.padEnd(10, "0").slice(0, 10);
}

// ============================================================================
// TAX CALCULATION
// ============================================================================

interface TariffData {
  duty_rate: number | null;
  vat_rate: number;
  other_taxes: Record<string, number>;
}

async function fetchTariffForCode(
  supabase: any,
  hsCode: string,
  countryCode: string
): Promise<TariffData | null> {
  const { data } = await supabase
    .from("country_tariffs")
    .select("duty_rate, vat_rate, other_taxes")
    .eq("country_code", countryCode)
    .eq("is_active", true)
    .or(`national_code.eq.${hsCode},hs_code_6.eq.${hsCode.slice(0, 6)}`)
    .maybeSingle();

  if (data) {
    return {
      duty_rate: data.duty_rate,
      vat_rate: data.vat_rate || 20,
      other_taxes: data.other_taxes || {},
    };
  }
  return null;
}

function calculateTaxes(
  itemValue: number,
  freightShare: number,
  insuranceShare: number,
  dutyRate: number | null,
  vatRate: number = 20,
  otherTaxes: Record<string, number> = {}
): TaxCalculation {
  // CIF = Valeur + Fret + Assurance
  const cifValue = itemValue + freightShare + insuranceShare;
  
  // DDI = CIF × taux / 100
  const dutyAmount = dutyRate !== null ? cifValue * dutyRate / 100 : 0;
  
  // Base TVA = CIF + DDI
  const vatBase = cifValue + dutyAmount;
  
  // TVA = Base × taux / 100
  const vatAmount = vatBase * vatRate / 100;
  
  // Autres taxes (parafiscales, TPI, etc.)
  let otherTaxesAmount = 0;
  for (const [, rate] of Object.entries(otherTaxes)) {
    otherTaxesAmount += cifValue * (rate as number) / 100;
  }
  
  const totalTaxes = dutyAmount + vatAmount + otherTaxesAmount;
  
  return {
    cif_value: Math.round(cifValue * 100) / 100,
    duty_rate: dutyRate,
    duty_rate_source: dutyRate !== null ? "database" : "missing",
    duty_amount: Math.round(dutyAmount * 100) / 100,
    vat_base: Math.round(vatBase * 100) / 100,
    vat_rate: vatRate,
    vat_amount: Math.round(vatAmount * 100) / 100,
    other_taxes: otherTaxes,
    other_taxes_amount: Math.round(otherTaxesAmount * 100) / 100,
    total_taxes: Math.round(totalTaxes * 100) / 100,
    grand_total: Math.round((cifValue + totalTaxes) * 100) / 100,
  };
}

async function computeAllTaxes(
  supabase: any,
  extracted: ExtractedDum,
  countryCode: string
): Promise<{ items: Array<ExtractedItem & { taxes: TaxCalculation }>; totals: ComputedTotals }> {
  const items: Array<ExtractedItem & { taxes: TaxCalculation }> = [];
  const missingRates: string[] = [];
  
  // Calculate freight/insurance share per item
  const totalValue = extracted.items.reduce((sum, item) => sum + (item.value || 0), 0);
  const totalFreight = extracted.freight_value?.value || 0;
  const totalInsurance = extracted.insurance_value?.value || 0;
  
  let totalCif = 0;
  let totalDuty = 0;
  let totalVat = 0;
  let totalOther = 0;
  
  for (const item of extracted.items) {
    const itemValue = item.value || 0;
    const valueRatio = totalValue > 0 ? itemValue / totalValue : 0;
    const freightShare = totalFreight * valueRatio;
    const insuranceShare = totalInsurance * valueRatio;
    
    // Try to get rate from database
    let tariff: TariffData | null = null;
    if (item.hs_code) {
      tariff = await fetchTariffForCode(supabase, item.hs_code, countryCode);
    }
    
    // Use extracted rate if available, otherwise database rate
    let dutyRate = item.duty_rate;
    let dutyRateSource: "extracted" | "database" | "missing" = "extracted";
    
    if (dutyRate === null && tariff !== null && tariff.duty_rate !== null) {
      dutyRate = tariff.duty_rate;
      dutyRateSource = "database";
    } else if (dutyRate === null) {
      dutyRateSource = "missing";
      missingRates.push(item.hs_code || `Ligne ${item.line_no}`);
    }
    
    const taxes = calculateTaxes(
      itemValue,
      freightShare,
      insuranceShare,
      dutyRate,
      tariff?.vat_rate || 20,
      tariff?.other_taxes || {}
    );
    taxes.duty_rate_source = dutyRateSource;
    
    items.push({ ...item, taxes });
    
    totalCif += taxes.cif_value;
    totalDuty += taxes.duty_amount;
    totalVat += taxes.vat_amount;
    totalOther += taxes.other_taxes_amount;
  }
  
  return {
    items,
    totals: {
      total_cif: Math.round(totalCif * 100) / 100,
      total_duty: Math.round(totalDuty * 100) / 100,
      total_vat: Math.round(totalVat * 100) / 100,
      total_other: Math.round(totalOther * 100) / 100,
      grand_total: Math.round((totalCif + totalDuty + totalVat + totalOther) * 100) / 100,
      missing_rates: [...new Set(missingRates)],
      is_complete: missingRates.length === 0,
    },
  };
}

// ============================================================================
// DATABASE STORAGE
// ============================================================================

async function saveDumToDatabase(
  supabase: any,
  extracted: ExtractedDum,
  itemsWithTaxes: Array<ExtractedItem & { taxes: TaxCalculation }>,
  totals: ComputedTotals,
  sourcePdfName: string | null,
  countryCode: string
): Promise<string> {
  // 1. Insert dum_documents
  const { data: dum, error: dumError } = await supabase
    .from("dum_documents")
    .insert({
      country_code: countryCode,
      source_pdf: sourcePdfName,
      source_page_count: extracted.page_count,
      dum_number: extracted.dum_number,
      regime_code: extracted.regime_code,
      bureau_code: extracted.bureau_code,
      bureau_name: extracted.bureau_name,
      dum_date: extracted.dum_date,
      importer_name: extracted.importer?.name,
      importer_id: extracted.importer?.id,
      exporter_name: extracted.exporter?.name,
      exporter_country: extracted.exporter?.country,
      incoterm: extracted.incoterm,
      currency_code: extracted.currency_code,
      invoice_value: extracted.invoice_value?.value,
      freight_value: extracted.freight_value?.value,
      insurance_value: extracted.insurance_value?.value,
      cif_value: totals.total_cif,
      extracted_json: extracted,
      total_duty: totals.total_duty,
      total_vat: totals.total_vat,
      total_other_taxes: totals.total_other,
      grand_total: totals.grand_total,
      is_complete: totals.is_complete,
      missing_rates: totals.missing_rates,
      validation_warnings: extracted.extraction_warnings,
    })
    .select("id")
    .single();

  if (dumError) {
    throw new Error(`Failed to insert dum_documents: ${dumError.message}`);
  }

  const dumId = dum.id;

  // 2. Insert dum_items
  const itemRows = itemsWithTaxes.map((item) => ({
    dum_id: dumId,
    line_no: item.line_no,
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    unit_price: item.unit_price,
    value: item.value,
    origin_country: item.origin_country,
    hs_code: item.hs_code,
    hs_code_normalized: item.hs_code,
    duty_rate: item.taxes.duty_rate,
    duty_rate_source: item.taxes.duty_rate_source,
    vat_rate: item.taxes.vat_rate,
    other_taxes: item.taxes.other_taxes,
    duty_amount: item.taxes.duty_amount,
    vat_amount: item.taxes.vat_amount,
    other_taxes_amount: item.taxes.other_taxes_amount,
    total_taxes: item.taxes.total_taxes,
    source_page: item.source?.page,
    source_evidence: item.source?.field_anchor,
    extraction_confidence: item.source?.confidence,
  }));

  if (itemRows.length > 0) {
    const { error: itemsError } = await supabase.from("dum_items").insert(itemRows);
    if (itemsError) {
      console.error("[analyze-dum] Error inserting items:", itemsError);
    }
  }

  return dumId;
}

// ============================================================================
// BUILD SOURCES LIST
// ============================================================================

function buildSourcesList(extracted: ExtractedDum): Array<{ field: string; page: number | null; anchor: string | null }> {
  const sources: Array<{ field: string; page: number | null; anchor: string | null }> = [];
  
  const addSource = (field: string, src: SourceRef | undefined) => {
    if (src && (src.page || src.field_anchor)) {
      sources.push({ field, page: src.page, anchor: src.field_anchor });
    }
  };
  
  addSource("importer", extracted.importer?.source);
  addSource("exporter", extracted.exporter?.source);
  addSource("invoice_value", extracted.invoice_value?.source);
  addSource("freight_value", extracted.freight_value?.source);
  addSource("insurance_value", extracted.insurance_value?.source);
  
  extracted.items.forEach((item, idx) => {
    addSource(`item_${idx + 1}`, item.source);
  });
  
  return sources;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Initialize metrics
  const metrics = createDumMetrics();

  // ==========================================================================
  // AUTHENTICATION CHECK (Production)
  // ==========================================================================
  if (isProductionMode()) {
    const authResult = await requireAuth(req, corsHeaders);
    if (authResult.error) {
      safeLog("warn", "analyze-dum", "Unauthorized request blocked", {});
      return authResult.error;
    }
    safeLog("info", "analyze-dum", "Authenticated request", {
      userId: authResult.auth?.userId,
    });
  }

  try {
    const body: AnalyzeDumRequest = await req.json();

    // Validate input
    if (!body.pdf_base64 && !body.image_base64) {
      return new Response(
        JSON.stringify({ success: false, error: "pdf_base64 ou image_base64 requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const contentBase64 = body.pdf_base64 || body.image_base64!;
    const mediaType = body.pdf_base64 ? "application/pdf" : (body.media_type || "image/jpeg");
    const countryCode = body.country_code || "MA";
    const saveToDb = body.save_to_db !== false;

    safeLog("info", "analyze-dum", "Analyzing DUM", { 
      mediaType, 
      saveToDb,
      // Mask source name as it may contain sensitive info
      source: body.source_pdf_name ? maskSensitiveData(body.source_pdf_name) : null,
    });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Extract data from document (with retry)
    const extracted = await extractDumData(contentBase64, mediaType, metrics);
    metrics.items_extracted = extracted.items.length;
    
    safeLog("info", "analyze-dum", "Extraction complete", { 
      items: extracted.items.length,
      // Mask sensitive party names
      importer: extracted.importer?.name ? maskSensitiveData(extracted.importer.name) : null,
    });

    // 2. Calculate taxes
    const { items: itemsWithTaxes, totals } = await computeAllTaxes(supabase, extracted, countryCode);
    metrics.taxes_calculated = true;
    
    safeLog("info", "analyze-dum", "Taxes calculated", { 
      complete: totals.is_complete,
      missingRates: totals.missing_rates.length,
    });

    // 3. Build sources list
    const sources = buildSourcesList(extracted);

    // 4. Save to database if requested
    let dumId: string | null = null;
    if (saveToDb) {
      dumId = await saveDumToDatabase(
        supabase,
        extracted,
        itemsWithTaxes,
        totals,
        body.source_pdf_name || null,
        countryCode
      );
      metrics.saved_to_db = true;
      safeLog("info", "analyze-dum", "Saved to DB", { 
        dumId: maskSensitiveData(dumId || ""),
      });
    }

    // Log success metrics
    logDumMetrics(metrics, "success");

    // Mask sensitive data in response for logging
    const response: AnalyzeDumResponse = {
      success: true,
      dum_id: dumId,
      extracted_json: extracted,
      computed_totals: totals,
      sources,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    metrics.errors_count++;
    logDumMetrics(metrics, "error");
    
    const errorMessage = error instanceof Error ? error.message : "Erreur interne";
    safeLog("error", "analyze-dum", "Processing failed", {
      error: maskSensitiveData(errorMessage),
    });

    return new Response(
      JSON.stringify({
        success: false,
        dum_id: null,
        extracted_json: null,
        computed_totals: null,
        sources: [],
        error: errorMessage,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
