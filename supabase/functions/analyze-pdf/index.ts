import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TariffLine {
  national_code: string;
  hs_code_6: string;
  description: string;
  duty_rate: number;
  unit?: string;
}

interface HSCodeEntry {
  code: string;
  code_clean: string;
  description: string;
  level: string;
}

interface AnalysisResult {
  summary: string;
  key_points: string[];
  hs_codes: HSCodeEntry[];
  tariff_lines: TariffLine[];
  chapter_info?: { number: number; title: string };
  authorities?: string[];
}

// Helper function to delay execution
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function analyzeWithClaude(
  base64Pdf: string,
  title: string,
  category: string,
  apiKey: string,
  maxLines: number,
  retryCount = 0
): Promise<{ result: AnalysisResult | null; truncated: boolean; rateLimited: boolean }> {
  
  const MAX_RETRIES = 3;
  const BASE_DELAY = 5000; // 5 seconds base delay
  
  const analysisPrompt = `Tu es un expert en tarifs douaniers marocains. Analyse ce document PDF.

Document : ${title}
Catégorie : ${category}

STRUCTURE HIÉRARCHIQUE DU TARIF MAROCAIN :
Le tarif utilise un système de codes à 10 chiffres. Les sous-positions HÉRITENT du préfixe parent.

RÈGLES D'HÉRITAGE DES CODES :
1. Quand tu vois "04.01" → mémorise "0401" comme préfixe de position (4 chiffres)
2. Quand tu vois "0401.10" → c'est une SOUS-POSITION à 6 chiffres = "040110"  
3. Quand tu vois une ligne avec tirets et "10 00" ou "90 00" → c'est un SUFFIXE à ajouter au préfixe courant

EXEMPLE DE RECONSTITUTION :
| Codification          | Description dans le PDF               | Ce que tu extrais                     |
|-----------------------|---------------------------------------|---------------------------------------|
| 04.01                 | Lait et crème de lait                 | Position parente (préfixe "0401")     |
| 0401.10               | - Teneur en matières grasses <= 1%   | hs_code = "040110" + description      |
|      10 00            | -- Conditionné pour vente au détail  | national_code = "0401101000"          |
|      90 00            | -- Autres                            | national_code = "0401109000"          |

EXTRACTION DES HS_CODES (OBLIGATOIRE - 6 CHIFFRES) :
Pour CHAQUE sous-position dans le document, extrais :
- code: format "XXXX.XX" (ex: "0401.10")
- code_clean: 6 chiffres sans point (ex: "040110")  
- description: la VRAIE description du document (ex: "Lait d'une teneur en matières grasses n'excédant pas 1%")
- level: "subheading" pour 6 chiffres, "heading" pour 4 chiffres

IMPORTANT - VALIDATION :
- Chaque national_code doit avoir EXACTEMENT 10 chiffres
- Chaque hs_code dans la liste doit avoir EXACTEMENT 6 chiffres (pas 4 !)
- hs_code_6 dans tariff_lines = les 6 premiers chiffres du national_code
- Extrais MAXIMUM ${maxLines} lignes tarifaires avec un taux DDI
- Extrais TOUTES les sous-positions à 6 chiffres visibles dans le document

Réponds avec CE JSON (et rien d'autre) :
{
  "summary": "Résumé court du chapitre",
  "key_points": ["Note 1", "Note 2"],
  "hs_codes": [
    {"code": "0401.10", "code_clean": "040110", "description": "Lait d'une teneur en matières grasses n'excédant pas 1%", "level": "subheading"},
    {"code": "0401.20", "code_clean": "040120", "description": "Lait d'une teneur en matières grasses excédant 1% mais n'excédant pas 6%", "level": "subheading"}
  ],
  "tariff_lines": [
    {"national_code": "0401101000", "hs_code_6": "040110", "description": "Description précise", "duty_rate": 10, "unit": "kg"}
  ],
  "chapter_info": {"number": 4, "title": "Lait et produits de la laiterie"}
}`;

  // Call Claude API (Anthropic)
  const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: analysisPrompt },
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64Pdf,
              }
            }
          ]
        }
      ],
    }),
  });

  // Handle rate limiting with retry
  if (aiResponse.status === 429) {
    if (retryCount < MAX_RETRIES) {
      const delayMs = BASE_DELAY * Math.pow(2, retryCount); // Exponential backoff
      console.log(`Rate limited (429). Retry ${retryCount + 1}/${MAX_RETRIES} after ${delayMs}ms...`);
      await delay(delayMs);
      return analyzeWithClaude(base64Pdf, title, category, apiKey, maxLines, retryCount + 1);
    } else {
      console.error("Max retries reached for rate limiting");
      return { result: null, truncated: false, rateLimited: true };
    }
  }

  if (!aiResponse.ok) {
    const errorText = await aiResponse.text();
    console.error("Claude API error:", aiResponse.status, errorText);
    throw new Error(`Claude API error: ${aiResponse.status}`);
  }

  const aiData = await aiResponse.json();
  const stopReason = aiData.stop_reason;
  const truncated = stopReason === "max_tokens";
  
  console.log("Claude response - stop_reason:", stopReason, "truncated:", truncated);
  
  const responseText = aiData.content?.[0]?.text || "{}";
  
  // Parse AI response
  let cleanedResponse = responseText.trim();
  if (cleanedResponse.startsWith("```json")) cleanedResponse = cleanedResponse.slice(7);
  if (cleanedResponse.startsWith("```")) cleanedResponse = cleanedResponse.slice(3);
  if (cleanedResponse.endsWith("```")) cleanedResponse = cleanedResponse.slice(0, -3);
  cleanedResponse = cleanedResponse.trim();
  
  try {
    const result = JSON.parse(cleanedResponse) as AnalysisResult;
    
    // Validate and fix national codes
    if (result.tariff_lines) {
      result.tariff_lines = result.tariff_lines
        .map(line => {
          // Remove all non-digit characters
          let code = (line.national_code || "").replace(/\D/g, "");
          // Pad to 10 digits if needed
          if (code.length > 0 && code.length < 10) {
            code = code.padEnd(10, "0");
          }
          return {
            ...line,
            national_code: code,
            hs_code_6: code.substring(0, 6),
          };
        })
        .filter(line => line.national_code.length === 10 && line.duty_rate !== undefined);
    }
    
    console.log("Parsed result:", result.tariff_lines?.length || 0, "tariff lines");
    return { result, truncated, rateLimited: false };
  } catch (parseError) {
    console.error("Failed to parse Claude response:", parseError);
    console.error("Raw response (first 1000):", responseText.substring(0, 1000));
    return { result: null, truncated, rateLimited: false };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pdfId, filePath } = await req.json();

    if (!pdfId || !filePath) {
      return new Response(
        JSON.stringify({ error: "pdfId and filePath are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Download the PDF file
    const { data: pdfData, error: downloadError } = await supabase.storage
      .from("pdf-documents")
      .download(filePath);

    if (downloadError) {
      console.error("Download error:", downloadError);
      throw new Error(`Failed to download PDF: ${downloadError.message}`);
    }

    // Convert PDF to base64
    const arrayBuffer = await pdfData.arrayBuffer();
    const base64Pdf = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
    );

    console.log("PDF downloaded, base64 size:", base64Pdf.length);

    // Get PDF document metadata
    const { data: pdfDoc } = await supabase
      .from("pdf_documents")
      .select("title, category, country_code")
      .eq("id", pdfId)
      .single();

    const title = pdfDoc?.title || "Tarif douanier";
    const category = pdfDoc?.category || "tarif";

    // Try with progressively fewer lines if truncated
    const maxLinesToTry = [50, 30, 15];
    let analysisResult: AnalysisResult | null = null;
    
    for (const maxLines of maxLinesToTry) {
      console.log(`Attempting analysis with max ${maxLines} tariff lines...`);
      
      const { result, truncated, rateLimited } = await analyzeWithClaude(
        base64Pdf,
        title,
        category,
        ANTHROPIC_API_KEY,
        maxLines
      );
      
      // If rate limited after all retries, return error to client
      if (rateLimited) {
        return new Response(
          JSON.stringify({ 
            error: "Rate limited by AI service. Please wait a few minutes before retrying.",
            rateLimited: true 
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (result && !truncated) {
        analysisResult = result;
        console.log("Analysis successful with", maxLines, "max lines");
        break;
      } else if (result && truncated) {
        console.log("Response truncated, retrying with fewer lines...");
        // Keep the result in case all attempts fail
        analysisResult = result;
      }
    }
    
    if (!analysisResult) {
      analysisResult = {
        summary: "Analyse en attente de traitement manuel",
        key_points: [],
        hs_codes: [],
        tariff_lines: [],
        authorities: [],
      };
    }

    // Save extraction to database
    const { error: insertError } = await supabase
      .from("pdf_extractions")
      .insert({
        pdf_id: pdfId,
        summary: analysisResult.summary,
        key_points: analysisResult.key_points || [],
        mentioned_hs_codes: analysisResult.hs_codes?.map(h => h.code_clean) || [],
        detected_tariff_changes: analysisResult.tariff_lines || [],
        extracted_data: {
          chapter_info: analysisResult.chapter_info || null,
          authorities: analysisResult.authorities || [],
          tariff_lines_count: analysisResult.tariff_lines?.length || 0,
        },
        extraction_model: "claude-sonnet-4-20250514",
        extraction_confidence: 0.90,
      });

    if (insertError) {
      console.error("Insert extraction error:", insertError);
    }

    // INSERT TARIFF LINES INTO country_tariffs TABLE
    if (analysisResult.tariff_lines && analysisResult.tariff_lines.length > 0) {
      const countryCode = pdfDoc?.country_code || "MA";
      
      const tariffRows = analysisResult.tariff_lines.map(line => ({
        country_code: countryCode,
        hs_code_6: line.hs_code_6,
        national_code: line.national_code,
        description_local: line.description,
        duty_rate: line.duty_rate,
        vat_rate: 20, // Default Morocco VAT
        unit_code: line.unit || null,
        is_active: true,
        source: `PDF: ${title}`,
      }));

      // Upsert to avoid duplicates (update if exists)
      const { error: tariffError } = await supabase
        .from("country_tariffs")
        .upsert(tariffRows, { 
          onConflict: "country_code,national_code",
          ignoreDuplicates: false 
        });

      if (tariffError) {
        console.error("Tariff insert error:", tariffError);
      } else {
        console.log(`Inserted/updated ${tariffRows.length} tariff lines into country_tariffs`);
      }
    }

    // INSERT HS CODES INTO hs_codes TABLE with proper descriptions
    if (analysisResult.hs_codes && analysisResult.hs_codes.length > 0) {
      const chapterNumber = analysisResult.chapter_info?.number || null;
      const chapterTitle = analysisResult.chapter_info?.title || null;
      
      const hsRows = analysisResult.hs_codes.map(hsCode => ({
        code: hsCode.code,
        code_clean: hsCode.code_clean,
        description_fr: hsCode.description,
        chapter_number: chapterNumber || (hsCode.code_clean ? parseInt(hsCode.code_clean.slice(0, 2)) : null),
        chapter_title_fr: chapterTitle,
        is_active: true,
        level: hsCode.level || (hsCode.code_clean?.length === 6 ? "subheading" : "heading"),
        parent_code: hsCode.code_clean?.length === 6 ? hsCode.code_clean.slice(0, 4) : null,
      }));

      const { error: hsError } = await supabase
        .from("hs_codes")
        .upsert(hsRows, { 
          onConflict: "code",
          ignoreDuplicates: false // Update existing records with new descriptions
        });

      if (hsError) {
        console.error("HS codes insert error:", hsError);
      } else {
        console.log(`Inserted/updated ${hsRows.length} HS codes with descriptions into hs_codes table`);
      }
    }

    // Update PDF document with chapter info
    const updateData: Record<string, unknown> = {
      is_verified: true,
      verified_at: new Date().toISOString(),
      related_hs_codes: analysisResult.hs_codes?.map(h => h.code_clean) || [],
    };
    
    if (analysisResult.chapter_info?.number) {
      updateData.keywords = `Chapitre ${analysisResult.chapter_info.number}`;
    }

    await supabase
      .from("pdf_documents")
      .update(updateData)
      .eq("id", pdfId);

    console.log("Analysis complete for PDF:", pdfId, 
      "HS codes:", analysisResult.hs_codes?.length || 0,
      "Tariff lines:", analysisResult.tariff_lines?.length || 0
    );

    return new Response(
      JSON.stringify(analysisResult),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Analyze PDF error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur d'analyse" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
