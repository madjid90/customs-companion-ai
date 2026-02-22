// ============================================================================
// PIPELINE D'EXTRACTION DES TABLES DE RÉFÉRENCE
// ============================================================================
// Utilise Lovable AI (Gemini) pour extraire des données structurées
// depuis les legal_chunks existants vers les tables de référence :
// trade_agreements, origin_rules, controlled_products, knowledge_documents
// + Liaison des taux préférentiels (country_tariffs.agreement_code)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth-check.ts";

const LOVABLE_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const CHUNK_BATCH_SIZE = 15; // Chunks per AI call
const MAX_SOURCES = 50; // Max sources to process per run

// ============================================================================
// KEYWORD CONFIGS PER TABLE
// ============================================================================

const TABLE_KEYWORDS: Record<string, string[]> = {
  trade_agreements: [
    "accord", "convention", "ALE", "libre-échange", "zone de libre",
    "préférentiel", "preferentiel", "bilatéral", "multilatéral",
    "union douanière", "agadir", "ZLECAF", "partenariat",
  ],
  origin_rules: [
    "règle d'origine", "origine", "transformation suffisante",
    "valeur ajoutée", "cumul", "certificat d'origine", "EUR.1",
    "critère d'origine", "ouvraison", "changement de position",
  ],
  controlled_products: [
    "contrôle", "licence", "autorisation", "prohibition", "restriction",
    "interdit", "soumis à", "produit réglementé", "normes obligatoires",
    "contrôle sanitaire", "phytosanitaire", "ONSSA", "conformité",
  ],
  knowledge_documents: [], // Uses legal_sources directly
  preferential_tariffs: [
    "préférentiel", "preferentiel", "accord", "ALE", "libre-échange",
    "taux réduit", "taux préférentiel", "droit de douane",
    "démantèlement", "contingent", "EUR.1", "certificat",
    "DI préférentiel", "contingents tarifaires",
  ],
};

// ============================================================================
// AI EXTRACTION HELPERS
// ============================================================================

interface AIExtractionResult {
  items: any[];
  source_info?: string;
}

async function callLovableAI(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  tools: any[],
  toolChoice: any,
): Promise<any> {
  const response = await fetch(LOVABLE_GATEWAY, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools,
      tool_choice: toolChoice,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[populate-references] AI error ${response.status}: ${errText}`);
    if (response.status === 429) throw new Error("RATE_LIMITED");
    if (response.status === 402) throw new Error("PAYMENT_REQUIRED");
    throw new Error(`AI gateway error: ${response.status}`);
  }

  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall) {
    console.warn("[populate-references] No tool call in AI response");
    return { items: [] };
  }

  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    console.error("[populate-references] Failed to parse tool call arguments");
    return { items: [] };
  }
}

// ============================================================================
// TRADE AGREEMENTS EXTRACTION
// ============================================================================

const TRADE_AGREEMENTS_TOOL = {
  type: "function",
  function: {
    name: "extract_trade_agreements",
    description: "Extract trade agreements from legal text chunks",
    parameters: {
      type: "object",
      properties: {
        agreements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string", description: "Short code (e.g. ALE-MA-UE, AGADIR, ZLECAF)" },
              name_fr: { type: "string", description: "Full name in French" },
              name_en: { type: "string", description: "Full name in English (if available)" },
              agreement_type: { type: "string", enum: ["bilateral", "regional", "multilateral", "preferential"] },
              parties: { type: "array", items: { type: "string" }, description: "Country codes or names of parties" },
              signature_date: { type: "string", description: "ISO date if mentioned" },
              entry_into_force: { type: "string", description: "ISO date if mentioned" },
              summary: { type: "string", description: "Brief summary of the agreement" },
              proof_required: { type: "string", description: "Required proof of origin (EUR.1, etc.)" },
              notes: { type: "string", description: "Additional notes" },
            },
            required: ["code", "name_fr", "agreement_type", "parties"],
          },
        },
      },
      required: ["agreements"],
    },
  },
};

async function extractTradeAgreements(
  supabase: any,
  apiKey: string,
  chunks: any[],
): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  const result = { inserted: 0, skipped: 0, errors: [] as string[] };

  const systemPrompt = `Tu es un expert en droit douanier marocain et accords commerciaux.
Extrais les accords commerciaux mentionnés dans les textes juridiques fournis.
Ne retourne que les accords clairement identifiés avec suffisamment d'informations.
Génère un code court unique pour chaque accord (ex: ALE-MA-UE, AGADIR, ZLECAF).
Les parties doivent être des codes pays ISO ou noms d'organisations.`;

  // Process chunks in batches
  for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
    const batch = chunks.slice(i, i + CHUNK_BATCH_SIZE);
    const textsBlock = batch.map((c: any, idx: number) =>
      `[Chunk ${idx + 1} - Source: ${c.section_title || ""}]\n${c.chunk_text}`
    ).join("\n\n---\n\n");

    try {
      const extracted = await callLovableAI(
        apiKey,
        systemPrompt,
        `Analyse ces textes juridiques et extrais les accords commerciaux mentionnés:\n\n${textsBlock}`,
        [TRADE_AGREEMENTS_TOOL],
        { type: "function", function: { name: "extract_trade_agreements" } },
      );

      for (const agreement of extracted.agreements || []) {
        // Check for duplicate by code
        const { data: existing } = await supabase
          .from("trade_agreements")
          .select("id")
          .eq("code", agreement.code)
          .maybeSingle();

        if (existing) {
          result.skipped++;
          continue;
        }

        const { error } = await supabase.from("trade_agreements").insert({
          code: agreement.code,
          name_fr: agreement.name_fr,
          name_en: agreement.name_en || null,
          agreement_type: agreement.agreement_type,
          parties: agreement.parties,
          signature_date: agreement.signature_date || null,
          entry_into_force: agreement.entry_into_force || null,
          summary: agreement.summary || null,
          proof_required: agreement.proof_required || null,
          notes: agreement.notes || null,
          is_active: true,
        });

        if (error) {
          result.errors.push(`${agreement.code}: ${error.message}`);
        } else {
          result.inserted++;
        }
      }
    } catch (e) {
      if ((e as Error).message === "RATE_LIMITED") throw e;
      result.errors.push(`Batch ${i}: ${(e as Error).message}`);
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 1000));
  }

  return result;
}

// ============================================================================
// ORIGIN RULES EXTRACTION
// ============================================================================

const ORIGIN_RULES_TOOL = {
  type: "function",
  function: {
    name: "extract_origin_rules",
    description: "Extract rules of origin from legal text chunks",
    parameters: {
      type: "object",
      properties: {
        rules: {
          type: "array",
          items: {
            type: "object",
            properties: {
              agreement_code: { type: "string", description: "Trade agreement code this rule belongs to" },
              hs_code: { type: "string", description: "HS code (2, 4, or 6 digits)" },
              rule_type: { type: "string", enum: ["ctc", "value_added", "specific_process", "wholly_obtained", "mixed"] },
              rule_text: { type: "string", description: "Full text of the origin rule" },
              value_added_percent: { type: "number", description: "Required value added percentage" },
              de_minimis_percent: { type: "number", description: "De minimis tolerance percentage" },
              cumulation_type: { type: "string", enum: ["bilateral", "diagonal", "full", "none"] },
              proof_required: { type: "string", description: "Required proof document" },
            },
            required: ["agreement_code", "hs_code", "rule_type", "rule_text"],
          },
        },
      },
      required: ["rules"],
    },
  },
};

async function extractOriginRules(
  supabase: any,
  apiKey: string,
  chunks: any[],
): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  const result = { inserted: 0, skipped: 0, errors: [] as string[] };

  // Get existing agreement codes for validation
  const { data: agreements } = await supabase
    .from("trade_agreements")
    .select("code")
    .eq("is_active", true);
  const validCodes = new Set((agreements || []).map((a: any) => a.code));

  const systemPrompt = `Tu es un expert en règles d'origine douanières.
Extrais les règles d'origine spécifiques mentionnées dans les textes.
Chaque règle doit être liée à un code d'accord commercial et un code SH.
Les codes d'accords existants sont: ${[...validCodes].join(", ") || "aucun encore - crée des codes descriptifs"}.
Types de règles: ctc (changement de classification), value_added, specific_process, wholly_obtained, mixed.`;

  for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
    const batch = chunks.slice(i, i + CHUNK_BATCH_SIZE);
    const textsBlock = batch.map((c: any, idx: number) =>
      `[Chunk ${idx + 1}]\n${c.chunk_text}`
    ).join("\n\n---\n\n");

    try {
      const extracted = await callLovableAI(
        apiKey,
        systemPrompt,
        `Extrais les règles d'origine de ces textes:\n\n${textsBlock}`,
        [ORIGIN_RULES_TOOL],
        { type: "function", function: { name: "extract_origin_rules" } },
      );

      for (const rule of extracted.rules || []) {
        // Check for duplicate
        const { data: existing } = await supabase
          .from("origin_rules")
          .select("id")
          .eq("agreement_code", rule.agreement_code)
          .eq("hs_code", rule.hs_code)
          .maybeSingle();

        if (existing) {
          result.skipped++;
          continue;
        }

        // If agreement_code doesn't exist yet, create it first
        if (!validCodes.has(rule.agreement_code)) {
          const { error: agError } = await supabase.from("trade_agreements").insert({
            code: rule.agreement_code,
            name_fr: rule.agreement_code,
            agreement_type: "bilateral",
            parties: [],
            is_active: true,
          });
          if (!agError) validCodes.add(rule.agreement_code);
        }

        const { error } = await supabase.from("origin_rules").insert({
          agreement_code: rule.agreement_code,
          hs_code: rule.hs_code,
          rule_type: rule.rule_type,
          rule_text: rule.rule_text,
          value_added_percent: rule.value_added_percent || null,
          de_minimis_percent: rule.de_minimis_percent || null,
          cumulation_type: rule.cumulation_type || null,
          proof_required: rule.proof_required || null,
          is_active: true,
        });

        if (error) {
          result.errors.push(`${rule.hs_code}: ${error.message}`);
        } else {
          result.inserted++;
        }
      }
    } catch (e) {
      if ((e as Error).message === "RATE_LIMITED") throw e;
      result.errors.push(`Batch ${i}: ${(e as Error).message}`);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  return result;
}

// ============================================================================
// CONTROLLED PRODUCTS EXTRACTION
// ============================================================================

const CONTROLLED_PRODUCTS_TOOL = {
  type: "function",
  function: {
    name: "extract_controlled_products",
    description: "Extract controlled/restricted products from legal text",
    parameters: {
      type: "object",
      properties: {
        products: {
          type: "array",
          items: {
            type: "object",
            properties: {
              country_code: { type: "string", description: "Country code (default: MA)" },
              hs_code: { type: "string", description: "HS code of the controlled product" },
              control_type: { type: "string", enum: ["license", "prohibition", "restriction", "standard", "sanitary", "phytosanitary", "quota"] },
              control_authority: { type: "string", description: "Authority managing the control (e.g. ADII, ONSSA, MCE)" },
              standard_required: { type: "string", description: "Required standard if applicable" },
              procedure_description: { type: "string", description: "Description of the control procedure" },
              notes: { type: "string", description: "Additional notes" },
            },
            required: ["country_code", "hs_code", "control_type"],
          },
        },
      },
      required: ["products"],
    },
  },
};

async function extractControlledProducts(
  supabase: any,
  apiKey: string,
  chunks: any[],
): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  const result = { inserted: 0, skipped: 0, errors: [] as string[] };

  const systemPrompt = `Tu es un expert en réglementation douanière marocaine.
Extrais les produits soumis à contrôle, licence, prohibition ou restriction.
Chaque produit doit avoir un code SH identifié et un type de contrôle.
Country code par défaut: MA (Maroc).
Autorités courantes: ADII, ONSSA, Ministère du Commerce, Office des Changes, ANRT.`;

  for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
    const batch = chunks.slice(i, i + CHUNK_BATCH_SIZE);
    const textsBlock = batch.map((c: any, idx: number) =>
      `[Chunk ${idx + 1}]\n${c.chunk_text}`
    ).join("\n\n---\n\n");

    try {
      const extracted = await callLovableAI(
        apiKey,
        systemPrompt,
        `Extrais les produits contrôlés/réglementés de ces textes:\n\n${textsBlock}`,
        [CONTROLLED_PRODUCTS_TOOL],
        { type: "function", function: { name: "extract_controlled_products" } },
      );

      for (const product of extracted.products || []) {
        // Check for duplicate
        const { data: existing } = await supabase
          .from("controlled_products")
          .select("id")
          .eq("hs_code", product.hs_code)
          .eq("control_type", product.control_type)
          .eq("country_code", product.country_code || "MA")
          .maybeSingle();

        if (existing) {
          result.skipped++;
          continue;
        }

        const { error } = await supabase.from("controlled_products").insert({
          country_code: product.country_code || "MA",
          hs_code: product.hs_code,
          control_type: product.control_type,
          control_authority: product.control_authority || null,
          standard_required: product.standard_required || null,
          procedure_description: product.procedure_description || null,
          notes: product.notes || null,
          is_active: true,
        });

        if (error) {
          result.errors.push(`${product.hs_code}: ${error.message}`);
        } else {
          result.inserted++;
        }
      }
    } catch (e) {
      if ((e as Error).message === "RATE_LIMITED") throw e;
      result.errors.push(`Batch ${i}: ${(e as Error).message}`);
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  return result;
}

// ============================================================================
// KNOWLEDGE DOCUMENTS SYNTHESIS
// ============================================================================

const KNOWLEDGE_DOC_TOOL = {
  type: "function",
  function: {
    name: "synthesize_knowledge",
    description: "Synthesize a knowledge document from source chunks",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string", description: "Concise summary (2-3 sentences)" },
        content: { type: "string", description: "Full synthesized content (key information)" },
        category: { type: "string", enum: ["legislation", "procedure", "classification", "taxation", "compliance", "trade_agreement", "origin", "valuation"] },
        subcategory: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        related_hs_codes: { type: "array", items: { type: "string" } },
      },
      required: ["title", "summary", "content", "category"],
    },
  },
};

async function synthesizeKnowledgeDocs(
  supabase: any,
  apiKey: string,
): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  const result = { inserted: 0, skipped: 0, errors: [] as string[] };

  // Get legal_sources that don't have a knowledge_document yet
  const { data: sources, error: srcError } = await supabase
    .from("legal_sources")
    .select("id, source_ref, title, source_type, excerpt, full_text, country_code, total_chunks")
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(MAX_SOURCES);

  if (srcError || !sources?.length) {
    result.errors.push(srcError?.message || "No sources found");
    return result;
  }

  const systemPrompt = `Tu es un expert en droit douanier.
Synthétise le document juridique fourni en un document de connaissance structuré.
Le contenu doit être clair, précis et utilisable pour un chatbot RAG.
Catégories possibles: legislation, procedure, classification, taxation, compliance, trade_agreement, origin, valuation.
Inclus les codes SH mentionnés dans related_hs_codes.`;

  for (const source of sources) {
    // Check if knowledge doc already exists for this source
    const { data: existing } = await supabase
      .from("knowledge_documents")
      .select("id")
      .eq("reference", source.source_ref)
      .maybeSingle();

    if (existing) {
      result.skipped++;
      continue;
    }

    // Get chunks for this source
    const { data: chunks } = await supabase
      .from("legal_chunks")
      .select("chunk_text, section_title, article_number, chunk_type")
      .eq("source_id", source.id)
      .eq("is_active", true)
      .order("chunk_index")
      .limit(20);

    if (!chunks?.length) continue;

    const sourceText = chunks.map((c: any) =>
      `${c.section_title ? `## ${c.section_title}` : ""}${c.article_number ? ` (Art. ${c.article_number})` : ""}\n${c.chunk_text}`
    ).join("\n\n");

    try {
      const doc = await callLovableAI(
        apiKey,
        systemPrompt,
        `Synthétise ce document juridique:\nTitre: ${source.title || source.source_ref}\nType: ${source.source_type}\n\n${sourceText.substring(0, 12000)}`,
        [KNOWLEDGE_DOC_TOOL],
        { type: "function", function: { name: "synthesize_knowledge" } },
      );

      const { error } = await supabase.from("knowledge_documents").insert({
        title: doc.title || source.title || source.source_ref,
        content: doc.content,
        summary: doc.summary || null,
        category: doc.category || "legislation",
        subcategory: doc.subcategory || null,
        country_code: source.country_code || "MA",
        language: "fr",
        source_name: source.source_type,
        reference: source.source_ref,
        tags: doc.tags || [],
        related_hs_codes: doc.related_hs_codes || [],
        is_active: true,
      });

      if (error) {
        result.errors.push(`${source.source_ref}: ${error.message}`);
      } else {
        result.inserted++;
      }
    } catch (e) {
      if ((e as Error).message === "RATE_LIMITED") throw e;
      result.errors.push(`${source.source_ref}: ${(e as Error).message}`);
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  return result;
}

// ============================================================================
// PREFERENTIAL TARIFF LINKING
// ============================================================================
// Scans circulars (legal_chunks from circular sources) to identify which
// trade agreement each preferential tariff entry belongs to, then updates
// country_tariffs.agreement_code accordingly.

const PREFERENTIAL_EXTRACT_TOOL = {
  type: "function",
  function: {
    name: "extract_preferential_tariffs",
    description: "Extract preferential tariff rates from circular text chunks and link them to trade agreements",
    parameters: {
      type: "object",
      properties: {
        tariffs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              national_code: { type: "string", description: "The national tariff code (8 or 10 digits)" },
              hs_code_6: { type: "string", description: "The 6-digit HS code prefix" },
              description: { type: "string", description: "Product description" },
              agreement_code: { type: "string", description: "The trade agreement code (must match an existing agreement)" },
              preferential_rate: { type: "number", description: "The preferential duty rate (%)" },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["national_code", "agreement_code", "preferential_rate", "confidence"],
          },
        },
      },
      required: ["tariffs"],
    },
  },
};

async function linkPreferentialTariffs(
  supabase: any,
  apiKey: string,
  chunks: any[],
): Promise<{ linked: number; skipped: number; errors: string[] }> {
  const result = { linked: 0, skipped: 0, errors: [] as string[] };

  // Load existing agreements for matching
  const { data: agreements } = await supabase
    .from("trade_agreements")
    .select("code, name_fr, countries_covered, preferential_duty_rate")
    .eq("is_active", true);

  if (!agreements?.length) {
    result.errors.push("No trade agreements found in database");
    return result;
  }

  const agreementList = agreements.map((a: any) =>
    `- ${a.code}: ${a.name_fr} (pays: ${(a.countries_covered || []).join(", ")}, taux par défaut: ${a.preferential_duty_rate ?? "?"}%)`
  ).join("\n");

  const validCodes = new Set(agreements.map((a: any) => a.code));

  // Filter chunks that contain tariff tables with preferential rates
  const relevantChunks = chunks.filter((c: any) => {
    const text = (c.chunk_text || "").toLowerCase();
    const hasHsCodes = /\d{4,10}/.test(c.chunk_text);
    const isTable = c.chunk_type === "table";
    
    // Table chunks with HS codes are always relevant (they contain tariff data)
    if (isTable && hasHsCodes) return true;
    
    // Non-table chunks need preferential keywords + HS codes
    return hasHsCodes && (
      text.includes("préférentiel") || text.includes("preferentiel") ||
      text.includes("di préférentiel") || text.includes("contingent") ||
      text.includes("démantèlement") || text.includes("taux réduit") ||
      text.includes("accord") || text.includes("libre-échange") ||
      text.includes("contingents tarifaires")
    );
  });

  console.log(`[populate-references] preferential_tariffs: ${relevantChunks.length} relevant chunks (from ${chunks.length} total)`);

  if (relevantChunks.length === 0) {
    result.errors.push("No chunks with preferential tariff data found in circulars");
    return result;
  }

  const BATCH_SIZE = 10; // Smaller batches for complex extraction

  const systemPrompt = `Tu es un expert en douanes marocaines et accords commerciaux préférentiels.
Analyse les extraits de circulaires douanières et extrais les taux préférentiels mentionnés.

ACCORDS DISPONIBLES:
${agreementList}

RÈGLES D'EXTRACTION:
- Extrais les codes tarifaires (8 ou 10 chiffres) avec leur taux préférentiel
- Le hs_code_6 est les 6 premiers chiffres du code national
- Identifie l'accord commercial correspondant à partir du contexte de la circulaire
- Les circulaires mentionnent souvent l'accord dans leur titre ou en-tête
- Confidence "high" si l'accord et le taux sont explicitement mentionnés
- Confidence "medium" si déduit du contexte
- Ne retourne PAS les taux normaux (droit commun), seulement les préférentiels
- Retourne un tableau vide si aucun taux préférentiel n'est trouvé`;

  for (let i = 0; i < relevantChunks.length; i += BATCH_SIZE) {
    const batch = relevantChunks.slice(i, i + BATCH_SIZE);
    const textsBlock = batch.map((c: any, idx: number) =>
      `[Chunk ${idx + 1} - Section: ${c.section_title || "?"} | Type: ${c.chunk_type || "general"}]\n${c.chunk_text}`
    ).join("\n\n---\n\n");

    try {
      const extracted = await callLovableAI(
        apiKey,
        systemPrompt,
        `Extrais les taux préférentiels de ces extraits de circulaires:\n\n${textsBlock}`,
        [PREFERENTIAL_EXTRACT_TOOL],
        { type: "function", function: { name: "extract_preferential_tariffs" } },
      );

      for (const tariff of extracted.tariffs || []) {
        if (!validCodes.has(tariff.agreement_code)) {
          result.skipped++;
          continue;
        }

        if (tariff.confidence === "low") {
          result.skipped++;
          continue;
        }

        const nationalCode = tariff.national_code.replace(/[.\s-]/g, "");
        const hsCode6 = tariff.hs_code_6?.replace(/[.\s-]/g, "") || nationalCode.substring(0, 6);

        // Try to update existing tariff first
        const { data: existing } = await supabase
          .from("country_tariffs")
          .select("id, agreement_code")
          .eq("national_code", nationalCode)
          .eq("is_active", true)
          .maybeSingle();

        if (existing) {
          if (existing.agreement_code) {
            result.skipped++; // Already linked
            continue;
          }
          // Update with agreement link
          const { error } = await supabase
            .from("country_tariffs")
            .update({
              agreement_code: tariff.agreement_code,
              duty_rate: tariff.preferential_rate,
              source_evidence: `Taux préférentiel ${tariff.agreement_code}: ${tariff.preferential_rate}%`,
            })
            .eq("id", existing.id);

          if (error) {
            result.errors.push(`Update ${nationalCode}: ${error.message}`);
          } else {
            result.linked++;
          }
        } else {
          // Insert new preferential tariff entry
          const { error } = await supabase
            .from("country_tariffs")
            .insert({
              country_code: "MA",
              hs_code_6: hsCode6,
              national_code: nationalCode,
              description_local: tariff.description || null,
              duty_rate: tariff.preferential_rate,
              vat_rate: 20,
              agreement_code: tariff.agreement_code,
              source: "circular",
              source_evidence: `Taux préférentiel ${tariff.agreement_code}: ${tariff.preferential_rate}%`,
              is_active: true,
            });

          if (error) {
            // Skip duplicates silently
            if (error.code === "23505") {
              result.skipped++;
            } else {
              result.errors.push(`Insert ${nationalCode}: ${error.message}`);
            }
          } else {
            result.linked++;
          }
        }
      }
    } catch (e) {
      if ((e as Error).message === "RATE_LIMITED") throw e;
      result.errors.push(`Batch ${i}: ${(e as Error).message}`);
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  return result;
}

// ============================================================================
// CHUNK QUERYING
// ============================================================================

async function getRelevantChunks(
  supabase: any,
  keywords: string[],
  limit: number = 200,
): Promise<any[]> {
  // Build OR filter for keywords
  const orFilter = keywords.map(k => `chunk_text.ilike.%${k}%`).join(",");

  const { data, error } = await supabase
    .from("legal_chunks")
    .select("id, chunk_text, section_title, article_number, chunk_type, source_id")
    .eq("is_active", true)
    .or(orFilter)
    .order("id", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[populate-references] Chunk query error:", error);
    return [];
  }

  return data || [];
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") return handleCorsPreFlight(req);

  const corsHeaders = getCorsHeaders(req);
  const { error: authError } = await requireAuth(req, corsHeaders, true);
  if (authError) return authError;

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !LOVABLE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "Missing configuration" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let targetTable: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    targetTable = body.table || null;
  } catch {
    // defaults
  }

  const validTables = ["trade_agreements", "origin_rules", "controlled_products", "knowledge_documents", "preferential_tariffs"];
  if (targetTable && !validTables.includes(targetTable)) {
    return new Response(
      JSON.stringify({ error: `Invalid table. Must be one of: ${validTables.join(", ")}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const startTime = Date.now();
  const results: Record<string, any> = {};

  try {
    const tablesToProcess = targetTable ? [targetTable] : validTables;

    for (const table of tablesToProcess) {
      console.log(`[populate-references] Processing ${table}...`);

      if (table === "knowledge_documents") {
        results[table] = await synthesizeKnowledgeDocs(supabase, LOVABLE_API_KEY);
      } else if (table === "preferential_tariffs") {
        // Fetch table-type chunks with tariff data directly (more targeted than keyword search)
        const { data: tableChunks, error: tcErr } = await supabase
          .from("legal_chunks")
          .select("id, chunk_text, section_title, article_number, chunk_type, source_id")
          .eq("is_active", true)
          .eq("chunk_type", "table")
          .or("chunk_text.ilike.%préférentiel%,chunk_text.ilike.%contingent%,chunk_text.ilike.%démantèlement%,chunk_text.ilike.%DI préférentiel%,section_title.ilike.%taux%,section_title.ilike.%contingent%,section_title.ilike.%préférentiel%")
          .order("id", { ascending: true })
          .limit(200);
        
        if (tcErr) {
          console.error("[populate-references] Table chunk query error:", tcErr);
          results[table] = { linked: 0, skipped: 0, errors: [tcErr.message] };
        } else {
          // Also add keyword-matched non-table chunks
          const keywords = TABLE_KEYWORDS.preferential_tariffs;
          const keywordChunks = await getRelevantChunks(supabase, keywords, 100);
          
          // Merge and deduplicate
          const allChunks = [...(tableChunks || [])];
          const existingIds = new Set(allChunks.map((c: any) => c.id));
          for (const kc of keywordChunks) {
            if (!existingIds.has(kc.id)) allChunks.push(kc);
          }
          
          console.log(`[populate-references] preferential_tariffs: Found ${tableChunks?.length || 0} table chunks + ${keywordChunks.length} keyword chunks = ${allChunks.length} total`);
          results[table] = await linkPreferentialTariffs(supabase, LOVABLE_API_KEY, allChunks);
        }
      } else {
        const keywords = TABLE_KEYWORDS[table];
        const chunks = await getRelevantChunks(supabase, keywords);
        console.log(`[populate-references] ${table}: Found ${chunks.length} relevant chunks`);

        if (chunks.length === 0) {
          results[table] = { inserted: 0, skipped: 0, errors: ["No relevant chunks found"] };
          continue;
        }

        switch (table) {
          case "trade_agreements":
            results[table] = await extractTradeAgreements(supabase, LOVABLE_API_KEY, chunks);
            break;
          case "origin_rules":
            results[table] = await extractOriginRules(supabase, LOVABLE_API_KEY, chunks);
            break;
          case "controlled_products":
            results[table] = await extractControlledProducts(supabase, LOVABLE_API_KEY, chunks);
            break;
        }
      }

      console.log(`[populate-references] ${table}:`, JSON.stringify(results[table]));
    }
  } catch (e) {
    const errMsg = (e as Error).message;
    if (errMsg === "RATE_LIMITED") {
      return new Response(
        JSON.stringify({ error: "Rate limited by AI gateway. Please retry later.", results }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (errMsg === "PAYMENT_REQUIRED") {
      return new Response(
        JSON.stringify({ error: "AI credits exhausted. Please add funds.", results }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ error: errMsg, results }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      success: true,
      duration_ms: Date.now() - startTime,
      results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
