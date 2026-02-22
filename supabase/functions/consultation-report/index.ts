// ============================================================================
// EDGE FUNCTION: CONSULTATION REPORT
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth-check.ts";
import { fetchWithRetry, RETRY_CONFIGS } from "../_shared/retry.ts";
import { calculateCAF, calculateTaxes, EXCHANGE_RATES, type TaxBreakdown } from "./tax-calculator.ts";
import {
  buildImportReportPrompt,
  buildMREReportPrompt,
  buildConformityReportPrompt,
  buildInvestorReportPrompt,
} from "./prompts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const LOVABLE_AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_AI_MODEL = "google/gemini-2.5-flash";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreFlight(req);
  const corsHeaders = getCorsHeaders(req);

  try {
    const authResult = await requireAuth(req);
    if (authResult.error) {
      return new Response(JSON.stringify({ error: "Non autorisé" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "Configuration manquante" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { type, inputs } = body;
    const startTime = Date.now();

    // =========================================================================
    // EXTRACT & ANALYZE UPLOADED FILES
    // =========================================================================
    const uploadedFiles = inputs._files || [];
    delete inputs._files;

    let fileContext = "";

    if (uploadedFiles.length > 0 && LOVABLE_API_KEY) {
      for (const f of uploadedFiles) {
        if (f.type === "image" && f.base64) {
          try {
            console.log("Analyzing image for consultation...");
            const imageAnalysis = await analyzeFileWithAI(
              f.base64,
              "image",
              f.file?.type || "image/jpeg",
              "Identifie le produit, extrais la description, le code SH si visible, la valeur, le pays d'origine, l'incoterm."
            );
            fileContext += `\n\n## ANALYSE IMAGE\n${imageAnalysis}\n`;
          } catch (err) {
            console.error("Image analysis error:", err);
          }
        } else if (f.type === "pdf" && f.base64) {
          try {
            console.log("Analyzing PDF for consultation...");
            const pdfAnalysis = await analyzeFileWithAI(
              f.base64,
              "pdf",
              "application/pdf",
              "Extrais TOUTES les informations utiles pour un rapport douanier: description produit, code SH, valeur, devise, incoterm, pays d'origine, poids, quantité."
            );
            fileContext += `\n\n## ANALYSE PDF\n${pdfAnalysis}\n`;
          } catch (err) {
            console.error("PDF analysis error:", err);
          }
        }
      }
      if (fileContext) {
        console.log(`File analysis context: ${fileContext.length} chars`);
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Generate reference
    const { data: refData } = await supabase.rpc("generate_consultation_ref", { type });
    const reference = refData || `CONS-${Date.now()}`;

    // Get phone_user_id
    const userId = authResult.user?.id;
    let phoneUserId = null;
    if (userId) {
      const { data: phoneUser } = await supabase
        .from("phone_users")
        .select("id")
        .eq("auth_user_id", userId)
        .maybeSingle();
      phoneUserId = phoneUser?.id || null;
    }

    // Save initial record
    const { data: consultation, error: insertError } = await supabase
      .from("consultations")
      .insert({
        reference,
        user_id: phoneUserId,
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
    let confidence: string = "medium";

    try {
      switch (type) {
        case "import":
          report = await processImportReport(supabase, inputs, fileContext);
          break;
        case "mre":
          report = await processMREReport(supabase, inputs, fileContext);
          break;
        case "conformity":
          report = await processConformityReport(supabase, inputs, fileContext);
          break;
        case "investor":
          report = await processInvestorReport(supabase, inputs, fileContext);
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
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ============================================================================
// FILE ANALYSIS HELPER
// ============================================================================
async function analyzeFileWithAI(base64: string, fileType: string, mimeType: string, instruction: string): Promise<string> {
  const content: any[] = [];
  
  if (fileType === "image") {
    content.push({
      type: "image_url",
      image_url: { url: `data:${mimeType};base64,${base64}` },
    });
  } else if (fileType === "pdf") {
    content.push({
      type: "image_url",
      image_url: { url: `data:application/pdf;base64,${base64}` },
    });
  }
  
  content.push({ type: "text", text: instruction });

  const response = await fetch(LOVABLE_AI_GATEWAY, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: LOVABLE_AI_MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content }],
    }),
  });

  if (!response.ok) throw new Error(`AI analysis error: ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// ============================================================================
// IMPORT STANDARD PROCESSOR
// ============================================================================
async function processImportReport(supabase: any, inputs: any, fileContext: string = "") {
  const {
    product_description, hs_code, country_code,
    value, currency, incoterm, freight, insurance,
    regime, agreement, sections = [],
  } = inputs;

  // 1. Fetch tariff data from DB
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

  // 2b. Si ANRT requis, vérifier si le produit est déjà homologué
  let anrtContext = "";
  if (controlledContext.includes("ANRT") && product_description) {
    try {
      const { data: anrtResults } = await supabase
        .rpc("search_anrt_equipment", {
          p_query: product_description,
          p_limit: 5,
        });

      if (anrtResults?.length) {
        anrtContext = `\n\n🔍 ÉQUIPEMENTS ANRT HOMOLOGUÉS CORRESPONDANTS:\n`;
        anrtContext += anrtResults.map((r: any) =>
          `- ✅ ${r.designation} | Marque: ${r.brand} | Type: ${r.type_ref} | Modèle: ${r.model || 'N/A'} | Agrément: ${r.approval_number}`
        ).join("\n");
        anrtContext += `\n\nSi le produit importé correspond à l'un de ces équipements, l'homologation ANRT est DÉJÀ OBTENUE. L'importateur doit simplement présenter le numéro d'agrément à la douane. Sinon, une nouvelle demande d'homologation est nécessaire.`;
      } else {
        anrtContext = `\n\n🔍 VÉRIFICATION ANRT: Aucun équipement correspondant trouvé dans la liste des 41 000+ équipements agréés. Une demande d'homologation ANRT sera nécessaire AVANT l'importation.`;
      }
    } catch (err) {
      console.error("ANRT search error:", err);
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
  const prompt = buildImportReportPrompt(
    product_description, hs_code, country_code || "MA",
    tariffContext, controlledContext + anrtContext, legalContext + fileContext, sections
  );
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
async function processMREReport(supabase: any, inputs: any, fileContext: string = "") {
  const {
    import_type, vehicle_brand, vehicle_year, vehicle_fuel, vehicle_cc,
    vehicle_value, vehicle_currency, vehicle_ownership_months,
    effects_description, effects_value, effects_transport,
    residence_country, residence_years, return_type,
    has_carte_sejour, has_certificat_residence, has_certificat_changement,
  } = inputs;

  const { data: rules } = await supabase.from("mre_rules").select("*").eq("is_active", true);

  let legalContext = "";
  const { data: chunks } = await supabase
    .from("legal_chunks")
    .select("chunk_text, source_id")
    .or("chunk_text.ilike.%MRE%,chunk_text.ilike.%retour définitif%,chunk_text.ilike.%abattement%,chunk_text.ilike.%article 164%")
    .limit(5);
  if (chunks?.length) {
    legalContext = chunks.map((c: any) => c.chunk_text.substring(0, 500)).join("\n\n");
  }

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

  const vehicleInfo = (import_type === "vehicle" || import_type === "both")
    ? `${vehicle_brand} ${vehicle_year}, ${vehicle_fuel}, ${vehicle_cc}cc, valeur ${vehicle_value} ${vehicle_currency}, possession: ${vehicle_ownership_months}`
    : "Pas de véhicule";

  const mreInfo = `Pays: ${residence_country}, Résidence: ${residence_years} ans, Retour: ${return_type}, Carte séjour: ${has_carte_sejour ? "Oui" : "Non"}, Cert. résidence: ${has_certificat_residence ? "Oui" : "Non"}, Cert. changement: ${has_certificat_changement ? "Oui" : "Non"}`;

  const prompt = buildMREReportPrompt(import_type, vehicleInfo, mreInfo, legalContext + fileContext);
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
async function processConformityReport(supabase: any, inputs: any, fileContext: string = "") {
  const { product_description, hs_code, country_code } = inputs;

  let controlledContext = "";
  if (hs_code) {
    const prefix = hs_code.replace(/[.\s-]/g, "").substring(0, 4);
    const { data } = await supabase
      .from("controlled_products")
      .select("*")
      .ilike("hs_code", `${prefix}%`)
      .eq("is_active", true);
    if (data?.length) {
      controlledContext = data.map((c: any) =>
        `HS: ${c.hs_code} | Type: ${c.control_type} | Autorité: ${c.control_authority} | Démarche: ${JSON.stringify(c.procedure_steps)} | Délai: ${c.estimated_delay} | Coût: ${c.estimated_cost}`
      ).join("\n");
    }
  }

  // ANRT verification for conformity
  let anrtContext = "";
  if (controlledContext.includes("ANRT") && product_description) {
    try {
      const { data: anrtResults } = await supabase
        .rpc("search_anrt_equipment", {
          p_query: product_description,
          p_limit: 5,
        });

      if (anrtResults?.length) {
        anrtContext = `\n\n🔍 ÉQUIPEMENTS ANRT HOMOLOGUÉS CORRESPONDANTS:\n`;
        anrtContext += anrtResults.map((r: any) =>
          `- ✅ ${r.designation} | Marque: ${r.brand} | Type: ${r.type_ref} | Modèle: ${r.model || 'N/A'} | Agrément: ${r.approval_number}`
        ).join("\n");
        anrtContext += `\n\nSi le produit importé correspond à l'un de ces équipements, l'homologation ANRT est DÉJÀ OBTENUE. L'importateur doit simplement présenter le numéro d'agrément à la douane. Sinon, une nouvelle demande d'homologation est nécessaire.`;
      } else {
        anrtContext = `\n\n🔍 VÉRIFICATION ANRT: Aucun équipement correspondant trouvé dans la liste des 41 000+ équipements agréés. Une demande d'homologation ANRT sera nécessaire AVANT l'importation.`;
      }
    } catch (err) {
      console.error("ANRT search error:", err);
    }
  }

  let legalContext = "";
  const searchTerms = ["ONSSA", "ANRT", "homologation", "conformité", "licence import"];
  for (const term of searchTerms) {
    const { data: chunks } = await supabase
      .from("legal_chunks")
      .select("chunk_text, source_id")
      .ilike("chunk_text", `%${term}%`)
      .limit(2);
    if (chunks?.length) {
      legalContext += chunks.map((c: any) => c.chunk_text.substring(0, 300)).join("\n");
    }
  }

  const prompt = buildConformityReportPrompt(product_description, hs_code, country_code || "MA", controlledContext + anrtContext, legalContext + fileContext);
  const aiReport = await callLLM(prompt);

  return { ...aiReport, input_summary: { product: product_description, hs_code, country: country_code } };
}

// ============================================================================
// INVESTOR PROCESSOR
// ============================================================================
async function processInvestorReport(supabase: any, inputs: any, fileContext: string = "") {
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

  const prompt = buildInvestorReportPrompt(sector, zone, material_description, `${material_value} ${material_currency}`, preferred_regime, legalContext + fileContext);
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
    throw new Error(`LLM error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (parseError) {
    console.error("JSON parse error:", parseError, "Content:", cleaned.substring(0, 200));
    return { raw_response: content, parse_error: true };
  }
}
