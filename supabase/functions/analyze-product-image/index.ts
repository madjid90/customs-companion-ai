// ============================================================================
// ANALYSE PHOTO PRODUIT → CODES SH
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// TYPES
// ============================================================================

interface ProductIdentification {
  label: string;
  attributes: {
    material?: string;
    function?: string;
    dimensions?: string;
    weight?: string;
    components?: string[];
    manufacturing?: string;
    [key: string]: unknown;
  };
  confidence: "high" | "medium" | "low";
}

interface HSCandidate {
  hs_code_6: string;
  national_code_hint: string;
  description: string;
  reasoning: string;
  confidence: "high" | "medium" | "low";
  duty_rate?: number;
  vat_rate?: number;
}

interface SourceReference {
  kind: "hs_codes" | "country_tariffs" | "tariff_notes" | "legal_chunks";
  id?: string | number;
  key?: { country_code: string; national_code: string };
  code?: string;
  description?: string;
  excerpt?: string;
  page_number?: number;
  source_ref?: string;
}

interface AnalysisResult {
  product_identification: ProductIdentification;
  hs_candidates: HSCandidate[];
  needed_questions: string[];
  sources: SourceReference[];
}

// ============================================================================
// CLAUDE VISION ANALYSIS
// ============================================================================

async function analyzeImageWithClaude(
  imageBase64: string,
  mediaType: string,
  context: { country_code: string; usage?: string; material?: string; additional_info?: string },
  apiKey: string
): Promise<{ label: string; attributes: Record<string, unknown>; keywords: string[]; ambiguities: string[] }> {
  const contextInfo = [
    `Pays de destination: ${context.country_code === "MA" ? "Maroc" : context.country_code}`,
    context.usage ? `Usage prévu: ${context.usage}` : null,
    context.material ? `Matière connue: ${context.material}` : null,
    context.additional_info ? `Info supplémentaire: ${context.additional_info}` : null,
  ].filter(Boolean).join("\n");

  const prompt = `Tu es un expert en classification douanière SH (Système Harmonisé).

Analyse cette image de produit et identifie:
1. Le type de produit (label précis)
2. Ses attributs techniques (matière, fonction, dimensions estimées, composants, mode de fabrication)
3. Des mots-clés pour la recherche dans le tarif douanier
4. Les ambiguïtés qui nécessiteraient des clarifications

Contexte:
${contextInfo}

Réponds UNIQUEMENT en JSON valide:
{
  "label": "nom du produit identifié",
  "attributes": {
    "material": "matière principale",
    "function": "fonction/usage",
    "dimensions": "estimation taille",
    "weight": "estimation poids si visible",
    "components": ["composant1", "composant2"],
    "manufacturing": "mode de fabrication si identifiable"
  },
  "keywords": ["mot1", "mot2", "mot3"],
  "ambiguities": ["question si ambiguïté 1", "question si ambiguïté 2"]
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: imageBase64,
            },
          },
          { type: "text", text: prompt },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error("Claude Vision error:", response.status, error);
    throw new Error(`Vision API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "{}";
  
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Failed to parse vision response:", e);
  }

  return {
    label: "Produit non identifié",
    attributes: {},
    keywords: [],
    ambiguities: ["Impossible d'analyser l'image correctement"],
  };
}

// ============================================================================
// DATABASE SEARCH
// ============================================================================

async function searchHSCodes(
  supabase: any,
  keywords: string[],
  limit: number = 20
): Promise<Array<{ id: string; code: string; description_fr: string; chapter_number: number }>> {
  const results: Array<{ id: string; code: string; description_fr: string; chapter_number: number }> = [];
  
  for (const keyword of keywords.slice(0, 5)) {
    const { data, error } = await supabase
      .from("hs_codes")
      .select("id, code, description_fr, chapter_number")
      .or(`description_fr.ilike.%${keyword}%,description_en.ilike.%${keyword}%`)
      .eq("is_active", true)
      .limit(10);
    
    if (!error && data) {
      for (const item of data as Array<{ id: string; code: string; description_fr: string; chapter_number: number }>) {
        if (!results.find(r => r.code === item.code)) {
          results.push(item);
        }
      }
    }
  }
  
  return results.slice(0, limit);
}

async function searchCountryTariffs(
  supabase: any,
  countryCode: string,
  hsCodes6: string[]
): Promise<Array<{
  national_code: string;
  hs_code_6: string;
  description_local: string | null;
  duty_rate: number | null;
  vat_rate: number | null;
  source_pdf: string | null;
  source_page: number | null;
  source_evidence: string | null;
}>> {
  if (hsCodes6.length === 0) return [];
  
  const { data, error } = await supabase
    .from("country_tariffs")
    .select("national_code, hs_code_6, description_local, duty_rate, vat_rate, source_pdf, source_page, source_evidence")
    .eq("country_code", countryCode)
    .eq("is_active", true)
    .in("hs_code_6", hsCodes6)
    .limit(50);
  
  if (error) {
    console.error("Error searching country_tariffs:", error);
    return [];
  }
  
  return data || [];
}

async function searchTariffNotes(
  supabase: any,
  countryCode: string,
  chapterNumbers: string[]
): Promise<Array<{
  id: number;
  note_type: string;
  note_text: string;
  chapter_number: string | null;
  page_number: number | null;
  source_pdf: string | null;
}>> {
  if (chapterNumbers.length === 0) return [];
  
  const { data, error } = await supabase
    .from("tariff_notes")
    .select("id, note_type, note_text, chapter_number, page_number, source_pdf")
    .eq("country_code", countryCode)
    .in("chapter_number", chapterNumbers)
    .limit(20);
  
  if (error) {
    console.error("Error searching tariff_notes:", error);
    return [];
  }
  
  return data || [];
}

interface LegalChunkResult {
  id: number;
  chunk_text: string;
  page_number: number | null;
  source_id: number;
  source_ref: string;
  source_type: string;
}

async function searchLegalChunks(
  supabase: any,
  keywords: string[],
  limit: number = 10
): Promise<LegalChunkResult[]> {
  const results: LegalChunkResult[] = [];
  
  for (const keyword of keywords.slice(0, 3)) {
    const { data, error } = await supabase
      .from("legal_chunks")
      .select(`
        id, chunk_text, page_number, source_id,
        legal_sources!inner(source_ref, source_type)
      `)
      .ilike("chunk_text", `%${keyword}%`)
      .limit(5);
    
    if (!error && data) {
      for (const item of data as any[]) {
        if (!results.find(r => r.id === item.id)) {
          results.push({
            id: item.id,
            chunk_text: item.chunk_text,
            page_number: item.page_number,
            source_id: item.source_id,
            source_ref: item.legal_sources?.source_ref || "",
            source_type: item.legal_sources?.source_type || "",
          });
        }
      }
    }
  }
  
  return results.slice(0, limit);
}

// ============================================================================
// AI CLASSIFICATION WITH DB CONTEXT
// ============================================================================

async function generateHSCandidates(
  productInfo: { label: string; attributes: Record<string, unknown>; keywords: string[] },
  dbContext: {
    hsCodes: Array<{ id: string; code: string; description_fr: string }>;
    tariffs: Array<{ national_code: string; hs_code_6: string; description_local: string | null; duty_rate: number | null; vat_rate: number | null }>;
    notes: Array<{ id: number; note_text: string; chapter_number: string | null }>;
  },
  countryCode: string,
  apiKey: string
): Promise<HSCandidate[]> {
  // Build context from DB
  const hsContext = dbContext.hsCodes.map(h => 
    `- ${h.code}: ${h.description_fr}`
  ).join("\n");
  
  const tariffContext = dbContext.tariffs.map(t =>
    `- ${t.national_code} (${t.hs_code_6}): ${t.description_local || "N/A"} | DDI: ${t.duty_rate ?? "?"}% | TVA: ${t.vat_rate ?? "?"}%`
  ).join("\n");
  
  const notesContext = dbContext.notes.map(n =>
    `- Note (ch.${n.chapter_number}): ${n.note_text.substring(0, 200)}...`
  ).join("\n");

  const prompt = `Tu es un expert en classification douanière pour le ${countryCode === "MA" ? "Maroc" : countryCode}.

PRODUIT IDENTIFIÉ:
- Label: ${productInfo.label}
- Attributs: ${JSON.stringify(productInfo.attributes)}
- Mots-clés: ${productInfo.keywords.join(", ")}

CODES SH DISPONIBLES EN BASE:
${hsContext || "Aucun code trouvé"}

LIGNES TARIFAIRES NATIONALES:
${tariffContext || "Aucune ligne tarifaire trouvée"}

NOTES TARIFAIRES PERTINENTES:
${notesContext || "Aucune note trouvée"}

RÈGLES STRICTES:
1. Tu ne peux suggérer QUE des codes présents dans les données ci-dessus
2. Si plusieurs codes sont possibles, donne TOUTES les alternatives (min 2, max 5)
3. Explique ton raisonnement pour chaque suggestion
4. Indique le niveau de confiance (high/medium/low)
5. Si le code 6 digits est trouvé mais pas le 10 digits exact, mets "?" à la fin du national_code_hint

Réponds UNIQUEMENT en JSON valide:
{
  "candidates": [
    {
      "hs_code_6": "XXXXXX",
      "national_code_hint": "XXXXXXXXXX",
      "description": "description du code",
      "reasoning": "explication du choix",
      "confidence": "high|medium|low",
      "duty_rate": 10.0,
      "vat_rate": 20.0
    }
  ]
}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    console.error("Claude classification error:", response.status);
    return [];
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "{}";
  
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.candidates || [];
    }
  } catch (e) {
    console.error("Failed to parse classification response:", e);
  }

  return [];
}

// ============================================================================
// BUILD VERIFIABLE SOURCES
// ============================================================================

function buildSources(
  hsCodes: Array<{ id: string; code: string; description_fr: string }>,
  tariffs: Array<{ national_code: string; hs_code_6: string; description_local: string | null; source_pdf: string | null; source_page: number | null; source_evidence: string | null }>,
  notes: Array<{ id: number; note_text: string; chapter_number: string | null; page_number: number | null; source_pdf: string | null }>,
  legalChunks: Array<{ id: number; chunk_text: string; page_number: number | null; source_ref: string; source_type: string }>,
  candidates: HSCandidate[],
  countryCode: string
): SourceReference[] {
  const sources: SourceReference[] = [];
  const usedHsCodes = new Set(candidates.map(c => c.hs_code_6));
  const usedNationalCodes = new Set(candidates.map(c => c.national_code_hint.replace("?", "")));
  
  // Add HS codes sources
  for (const hs of hsCodes) {
    const code6 = hs.code.replace(/\./g, "").substring(0, 6);
    if (usedHsCodes.has(code6)) {
      sources.push({
        kind: "hs_codes",
        id: hs.id,
        code: hs.code,
        description: hs.description_fr,
      });
    }
  }
  
  // Add country_tariffs sources
  for (const t of tariffs) {
    const code10 = t.national_code.replace(/\./g, "");
    if (usedHsCodes.has(t.hs_code_6) || usedNationalCodes.has(code10)) {
      sources.push({
        kind: "country_tariffs",
        key: { country_code: countryCode, national_code: t.national_code },
        description: t.description_local || undefined,
        excerpt: t.source_evidence || undefined,
        page_number: t.source_page || undefined,
      });
    }
  }
  
  // Add tariff_notes sources
  for (const note of notes) {
    sources.push({
      kind: "tariff_notes",
      id: note.id,
      excerpt: note.note_text.substring(0, 300),
      page_number: note.page_number || undefined,
    });
  }
  
  // Add legal_chunks sources
  for (const chunk of legalChunks) {
    sources.push({
      kind: "legal_chunks",
      id: chunk.id,
      excerpt: chunk.chunk_text.substring(0, 300),
      page_number: chunk.page_number || undefined,
      source_ref: chunk.source_ref,
    });
  }
  
  return sources;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      image_base64, 
      media_type = "image/jpeg",
      country_code = "MA",
      usage,
      material,
      additional_info 
    } = await req.json();

    if (!image_base64) {
      return new Response(
        JSON.stringify({ error: "image_base64 est requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate media type
    const validMediaTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!validMediaTypes.includes(media_type)) {
      return new Response(
        JSON.stringify({ error: `Type de média non supporté: ${media_type}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY non configurée");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`Analyzing product image for country: ${country_code}`);

    // Step 1: Analyze image with Claude Vision
    const productInfo = await analyzeImageWithClaude(
      image_base64,
      media_type,
      { country_code, usage, material, additional_info },
      ANTHROPIC_API_KEY
    );

    console.log("Product identified:", productInfo.label);
    console.log("Keywords:", productInfo.keywords);

    // Step 2: Search database for matching codes
    const hsCodes = await searchHSCodes(supabase, productInfo.keywords);
    console.log(`Found ${hsCodes.length} HS codes in database`);

    // Extract unique 6-digit codes
    const hsCodes6 = [...new Set(hsCodes.map(h => h.code.replace(/\./g, "").substring(0, 6)))];
    
    // Search country tariffs
    const tariffs = await searchCountryTariffs(supabase, country_code, hsCodes6);
    console.log(`Found ${tariffs.length} tariff lines`);

    // Extract chapter numbers for notes
    const chapterNumbers = [...new Set(hsCodes.map(h => String(h.chapter_number).padStart(2, "0")))];
    
    // Search tariff notes
    const notes = await searchTariffNotes(supabase, country_code, chapterNumbers);
    console.log(`Found ${notes.length} tariff notes`);

    // Search legal chunks
    const legalChunks = await searchLegalChunks(supabase, productInfo.keywords);
    console.log(`Found ${legalChunks.length} legal chunks`);

    // Step 3: Generate HS candidates with AI using DB context
    const candidates = await generateHSCandidates(
      productInfo,
      { hsCodes, tariffs, notes },
      country_code,
      ANTHROPIC_API_KEY
    );

    // Step 4: Build verifiable sources
    const sources = buildSources(hsCodes, tariffs, notes, legalChunks, candidates, country_code);

    // Step 5: Determine confidence and needed questions
    const overallConfidence = candidates.length > 0
      ? (candidates.every(c => c.confidence === "high") ? "high" : 
         candidates.some(c => c.confidence === "high") ? "medium" : "low")
      : "low";

    const neededQuestions: string[] = [...productInfo.ambiguities];
    
    // Add questions if ambiguous
    if (candidates.length > 2 && candidates.some(c => c.confidence !== "high")) {
      neededQuestions.push("Quelle est la fonction principale de ce produit ?");
    }
    if (!productInfo.attributes.material) {
      neededQuestions.push("Quelle est la matière principale de ce produit ?");
    }

    // Build result
    const result: AnalysisResult = {
      product_identification: {
        label: productInfo.label,
        attributes: productInfo.attributes as ProductIdentification["attributes"],
        confidence: overallConfidence as "high" | "medium" | "low",
      },
      hs_candidates: candidates,
      needed_questions: neededQuestions,
      sources,
    };

    // Add fallback message if no candidates found
    if (candidates.length === 0) {
      result.hs_candidates = [];
      result.needed_questions.unshift(
        "Aucun code SH correspondant trouvé dans la base. Veuillez fournir plus de détails sur le produit."
      );
    }

    console.log(`Analysis complete: ${candidates.length} candidates, ${sources.length} sources`);

    return new Response(
      JSON.stringify({
        success: true,
        ...result,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in analyze-product-image:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Erreur inconnue" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
