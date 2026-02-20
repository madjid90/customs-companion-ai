// ============================================================================
// CONSULTATION REPORT EDGE FUNCTION
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchWithRetry, RETRY_CONFIGS } from "../_shared/retry.ts";
import { calculateCAF, calculateTaxes, EXCHANGE_RATES, type TaxBreakdown } from "./tax-calculator.ts";
import { buildImportReportPrompt, buildMREReportPrompt, buildConformityReportPrompt, buildInvestorReportPrompt } from "./prompts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const LOVABLE_AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_AI_MODEL = "google/gemini-2.5-flash";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const token = authHeader.replace("Bearer ", "");
    
    // Use anon client to get user from token
    const anonClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") || token);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json();
    const { type, inputs } = body;

    if (!type || !inputs) {
      return new Response(JSON.stringify({ error: "Type et inputs requis" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get phone_user_id
    const { data: phoneUser } = await supabase
      .from("phone_users")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    // Generate reference
    const { data: refData } = await supabase.rpc("generate_consultation_ref", { type });
    const reference = refData || `CONS-${Date.now()}`;

    // Save initial record
    const { data: consultation, error: insertError } = await supabase
      .from("consultations")
      .insert({
        reference,
        user_id: phoneUser?.id || null,
        consultation_type: type,
        inputs,
        status: "processing",
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
    }

    // =========================================================================
    // DISPATCH BY TYPE
    // =========================================================================
    let report: any;
    let confidence = "medium";

    try {
      switch (type) {
        case "import":
          report = await processImportReport(supabase, inputs);
          break;
        case "mre":
          report = await processMREReport(supabase, inputs);
          break;
        case "conformity":
          report = await processConformityReport(supabase, inputs);
          break;
        case "investor":
          report = await processInvestorReport(supabase, inputs);
          break;
        default:
          throw new Error(`Type inconnu: ${type}`);
      }
      confidence = report?.classification?.confidence || "medium";
    } catch (processError: any) {
      console.error("Process error:", processError);
      if (consultation?.id) {
        await supabase.from("consultations").update({
          status: "error",
          error_message: processError.message,
          processing_time_ms: Date.now() - startTime,
        }).eq("id", consultation.id);
      }
      return new Response(JSON.stringify({ error: processError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update consultation with result
    const processingTime = Date.now() - startTime;
    if (consultation?.id) {
      await supabase.from("consultations").update({
        report,
        status: "completed",
        confidence,
        processing_time_ms: processingTime,
      }).eq("id", consultation.id);
    }

    return new Response(JSON.stringify({
      reference,
      date: new Date().toLocaleDateString("fr-MA", { day: "2-digit", month: "2-digit", year: "numeric" }),
      type,
      confidence,
      processing_time_ms: processingTime,
      report,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("Unhandled error:", error);
    return new Response(JSON.stringify({ error: "Erreur interne" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ============================================================================
// IMPORT STANDARD PROCESSOR
// ============================================================================
async function processImportReport(supabase: any, inputs: any) {
  const {
    product_description, hs_code, country_code, value, currency,
    incoterm, freight, insurance, regime, agreement, sections = [],
  } = inputs;

  // 1. Fetch tariff data
  let tariffContext = "";
  let dutyRate = 25;
  let vatRate = 20;
  let tariffFound = false;

  if (hs_code) {
    const cleanCode = hs_code.replace(/[.\s-]/g, "");
    const code6 = cleanCode.substring(0, 6);

    const { data: tariffs } = await supabase
      .from("country_tariffs")
      .select("*")
      .eq("country_code", country_code || "MA")
      .or(`national_code.eq.${cleanCode},hs_code_6.eq.${code6}`)
      .eq("is_active", true)
      .limit(5);

    if (tariffs?.length > 0) {
      dutyRate = tariffs[0].duty_rate ?? 25;
      vatRate = tariffs[0].vat_rate ?? 20;
      tariffFound = true;
      tariffContext = tariffs.map((t: any) =>
        `Code: ${t.national_code || t.hs_code_6} | Désignation: ${t.description_local} | DI: ${t.duty_rate}% | TVA: ${t.vat_rate}%`
      ).join("\n");
    }
  }

  // Search by product keywords if no tariff found
  if (!tariffFound && product_description) {
    const keywords = product_description.split(/\s+/).filter((w: string) => w.length > 3).slice(0, 3);
    for (const kw of keywords) {
      const { data } = await supabase
        .from("country_tariffs")
        .select("*")
        .eq("country_code", country_code || "MA")
        .ilike("description_local", `%${kw}%`)
        .eq("is_active", true)
        .limit(5);
      if (data?.length > 0) {
        if (!tariffFound) {
          dutyRate = data[0].duty_rate ?? 25;
          vatRate = data[0].vat_rate ?? 20;
          tariffFound = true;
        }
        tariffContext += data.map((t: any) =>
          `Code: ${t.national_code || t.hs_code_6} | Désignation: ${t.description_local} | DI: ${t.duty_rate}% | TVA: ${t.vat_rate}%`
        ).join("\n") + "\n";
      }
    }
  }

  // 2. Fetch controlled products
  let controlledContext = "";
  const codePrefix = hs_code ? hs_code.replace(/[.\s-]/g, "").substring(0, 4) : "";
  if (codePrefix) {
    const { data: controlled } = await supabase
      .from("controlled_products")
      .select("*")
      .eq("country_code", country_code || "MA")
      .ilike("hs_code", `${codePrefix}%`)
      .eq("is_active", true);
    if (controlled?.length) {
      controlledContext = controlled.map((c: any) =>
        `HS: ${c.hs_code} | Contrôle: ${c.control_type} | Autorité: ${c.control_authority} | Documents: ${JSON.stringify(c.required_documents)}`
      ).join("\n");
    }
  }

  // 3. Fetch legal chunks
  let legalContext = "";
  if (product_description) {
    const keywords = product_description.split(/\s+/).filter((w: string) => w.length > 3).slice(0, 3);
    for (const kw of keywords) {
      const { data: chunks } = await supabase
        .from("legal_chunks")
        .select("chunk_text, source_id")
        .ilike("chunk_text", `%${kw}%`)
        .limit(3);
      if (chunks?.length) {
        legalContext += chunks.map((c: any) => c.chunk_text.substring(0, 500)).join("\n\n");
      }
    }
  }

  // 4. Calculate taxes
  const exchangeRate = EXCHANGE_RATES[currency] || 10;
  const cafResult = calculateCAF({
    value: parseFloat(value) || 0,
    currency,
    incoterm: incoterm || "FOB",
    freight: freight ? parseFloat(freight) : undefined,
    insurance: insurance ? parseFloat(insurance) : undefined,
    exchange_rate: exchangeRate,
  });

  // Check agreement reduction
  let agreementReduction = 0;
  if (agreement && agreement !== "none") {
    const { data: agreements } = await supabase
      .from("trade_agreements")
      .select("*")
      .eq("code", agreement)
      .eq("is_active", true)
      .limit(1);
    if (agreements?.length) {
      agreementReduction = 1.0;
    }
  }

  const taxes = calculateTaxes({
    caf_mad: cafResult.caf_mad,
    duty_rate: dutyRate,
    vat_rate: vatRate,
    agreement_reduction: agreementReduction,
  });

  // 5. Call LLM
  const prompt = buildImportReportPrompt(product_description, hs_code, country_code || "MA", tariffContext, controlledContext, legalContext, sections);
  const aiReport = await callLLM(prompt);

  return {
    ...aiReport,
    taxes: {
      caf_details: cafResult.details,
      caf_value_mad: cafResult.caf_mad,
      exchange_rate: exchangeRate,
      currency,
      tariff_from_db: tariffFound,
      duty_rate: dutyRate,
      vat_rate: vatRate,
      ...taxes,
    },
    input_summary: {
      product: product_description,
      hs_code: hs_code || aiReport?.classification?.hs_code || "Non déterminé",
      country: country_code,
      value: `${value} ${currency} ${incoterm}`,
      regime,
      agreement,
    },
  };
}

// ============================================================================
// MRE PROCESSOR
// ============================================================================
async function processMREReport(supabase: any, inputs: any) {
  const {
    import_type, vehicle_brand, vehicle_year, vehicle_fuel, vehicle_cc,
    vehicle_value, vehicle_currency, vehicle_ownership_months,
    effects_description, effects_value, effects_transport,
    residence_country, residence_years, return_type,
    has_carte_sejour, has_certificat_residence, has_certificat_changement,
  } = inputs;

  // Fetch MRE rules
  const { data: rules } = await supabase.from("mre_rules").select("*").eq("is_active", true);

  // Fetch legal context
  let legalContext = "";
  const { data: chunks } = await supabase
    .from("legal_chunks")
    .select("chunk_text, source_id")
    .or("chunk_text.ilike.%MRE%,chunk_text.ilike.%retour définitif%,chunk_text.ilike.%abattement%,chunk_text.ilike.%article 164%")
    .limit(5);
  if (chunks?.length) {
    legalContext = chunks.map((c: any) => c.chunk_text.substring(0, 500)).join("\n\n");
  }

  // Calculate vehicle taxes with MRE abatement
  let vehicleTaxes: TaxBreakdown | null = null;
  let vehicleTaxesWithout: TaxBreakdown | null = null;

  if (import_type === "vehicle" || import_type === "both") {
    const vValue = parseFloat(vehicle_value) || 0;
    const vCurrency = vehicle_currency || "EUR";
    const exchangeRate = EXCHANGE_RATES[vCurrency] || 10;
    const caf_mad = Math.ceil(vValue * exchangeRate);

    let vehicleDutyRate = 17.5;
    if (vehicle_fuel === "electrique") vehicleDutyRate = 2.5;

    vehicleTaxes = calculateTaxes({ caf_mad, duty_rate: vehicleDutyRate, vat_rate: 20, mre_abatement: true });
    vehicleTaxesWithout = calculateTaxes({ caf_mad, duty_rate: vehicleDutyRate, vat_rate: 20, mre_abatement: false });
  }

  const vehicleInfo = (import_type === "vehicle" || import_type === "both") ?
    `${vehicle_brand} ${vehicle_year}, ${vehicle_fuel}, ${vehicle_cc}cc, valeur ${vehicle_value} ${vehicle_currency}, possession: ${vehicle_ownership_months} mois` :
    "Pas de véhicule";

  const mreInfo = `Pays: ${residence_country}, Résidence: ${residence_years} ans, Retour: ${return_type}, Carte séjour: ${has_carte_sejour ? "Oui" : "Non"}, Cert. résidence: ${has_certificat_residence ? "Oui" : "Non"}, Cert. changement: ${has_certificat_changement ? "Oui" : "Non"}`;

  const prompt = buildMREReportPrompt(import_type, vehicleInfo, mreInfo, legalContext);
  const aiReport = await callLLM(prompt);

  return {
    ...aiReport,
    vehicle_taxes: vehicleTaxes ? {
      with_mre: vehicleTaxes,
      without_mre: vehicleTaxesWithout,
      savings: vehicleTaxesWithout ? vehicleTaxesWithout.total - vehicleTaxes.total : 0,
    } : null,
    input_summary: { import_type, vehicle: vehicleInfo, mre_situation: mreInfo },
  };
}

// ============================================================================
// CONFORMITY PROCESSOR
// ============================================================================
async function processConformityReport(supabase: any, inputs: any) {
  const { product_description, hs_code, country_code } = inputs;

  let controlledContext = "";
  if (hs_code) {
    const prefix = hs_code.replace(/[.\s-]/g, "").substring(0, 4);
    const { data } = await supabase.from("controlled_products").select("*").ilike("hs_code", `${prefix}%`).eq("is_active", true);
    if (data?.length) {
      controlledContext = data.map((c: any) =>
        `HS: ${c.hs_code} | Type: ${c.control_type} | Autorité: ${c.control_authority} | Démarche: ${JSON.stringify(c.procedure_steps)} | Délai: ${c.estimated_delay} | Coût: ${c.estimated_cost}`
      ).join("\n");
    }
  }

  let legalContext = "";
  const searchTerms = ["ONSSA", "ANRT", "homologation", "conformité", "licence import"];
  for (const term of searchTerms) {
    const { data: chunks } = await supabase.from("legal_chunks").select("chunk_text, source_id").ilike("chunk_text", `%${term}%`).limit(2);
    if (chunks?.length) {
      legalContext += chunks.map((c: any) => c.chunk_text.substring(0, 300)).join("\n");
    }
  }

  const prompt = buildConformityReportPrompt(product_description, hs_code, country_code || "MA", controlledContext, legalContext);
  const aiReport = await callLLM(prompt);

  return { ...aiReport, input_summary: { product: product_description, hs_code, country: country_code } };
}

// ============================================================================
// INVESTOR PROCESSOR
// ============================================================================
async function processInvestorReport(supabase: any, inputs: any) {
  const { sector, zone, material_description, material_hs_code, material_value, material_currency, preferred_regime } = inputs;

  const mValue = parseFloat(material_value) || 0;
  const exchangeRate = EXCHANGE_RATES[material_currency] || 10;
  const caf_mad = Math.ceil(mValue * exchangeRate);

  let dutyRate = 2.5;
  if (material_hs_code) {
    const code6 = material_hs_code.replace(/[.\s-]/g, "").substring(0, 6);
    const { data } = await supabase.from("country_tariffs").select("duty_rate").eq("country_code", "MA").ilike("hs_code_6", `${code6}%`).eq("is_active", true).limit(1);
    if (data?.[0]) dutyRate = data[0].duty_rate;
  }

  const regime_common = calculateTaxes({ caf_mad, duty_rate: dutyRate, vat_rate: 20 });
  const regime_franchise = calculateTaxes({ caf_mad, duty_rate: 0, vat_rate: 0, tpi_rate: 0.25 });
  const regime_zone_franche = calculateTaxes({ caf_mad, duty_rate: 0, vat_rate: 0, tpi_rate: 0 });

  let legalContext = "";
  const { data: chunks } = await supabase.from("legal_chunks").select("chunk_text, source_id")
    .or("chunk_text.ilike.%investissement%,chunk_text.ilike.%zone franche%,chunk_text.ilike.%franchise%,chunk_text.ilike.%charte%")
    .limit(5);
  if (chunks?.length) {
    legalContext = chunks.map((c: any) => c.chunk_text.substring(0, 400)).join("\n\n");
  }

  const prompt = buildInvestorReportPrompt(sector, zone, material_description, `${material_value} ${material_currency}`, preferred_regime, legalContext);
  const aiReport = await callLLM(prompt);

  return {
    ...aiReport,
    regime_comparison: { droit_commun: regime_common, franchise: regime_franchise, zone_franche: regime_zone_franche, caf_mad },
    input_summary: { sector, zone, material: material_description, value: `${material_value} ${material_currency}` },
  };
}

// ============================================================================
// LLM CALL HELPER
// ============================================================================
async function callLLM(prompt: string): Promise<any> {
  const response = await fetchWithRetry(
    LOVABLE_AI_GATEWAY,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LOVABLE_AI_MODEL,
        max_tokens: 4096,
        temperature: 0.1,
        messages: [{ role: "user", content: prompt }],
      }),
    },
    {
      ...RETRY_CONFIGS.lovableAI,
      onRetry: (attempt: number, error: Error, delay: number) => {
        console.warn(`LLM retry ${attempt}: ${error.message} (wait ${delay}ms)`);
      },
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    console.error("LLM error:", response.status, errText);

    if (response.status === 429) {
      throw new Error("Limite de requêtes atteinte. Réessayez dans quelques instants.");
    }
    if (response.status === 402) {
      throw new Error("Crédits IA insuffisants.");
    }
    throw new Error(`LLM error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  // Parse JSON from response
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    console.error("JSON parse error, content:", cleaned.substring(0, 200));
    return { raw_response: content, parse_error: true };
  }
}
