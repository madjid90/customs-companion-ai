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

STRUCTURE DU TABLEAU - 5 COLONNES DE CODIFICATION :
Le tarif marocain utilise un tableau avec ces colonnes :
1. CODIFICATION : 5 sous-colonnes qui forment le code national à 10 chiffres
   - Col 1-2 : Position SH (4 chiffres, format XX.XX)
   - Col 3 : Sous-position (2 chiffres après les 4 premiers)
   - Col 4-5 : Lignes nationales (4 derniers chiffres, souvent "XX 00")
2. DÉSIGNATION DES PRODUITS : Description du produit (peut contenir des tirets "-" pour la hiérarchie)
3. DROIT D'IMPORTATION : Taux DDI en pourcentage
4. UNITÉ DE QUANTITÉ NORMALISÉE : Unité de mesure (kg, L, U, etc.)

RÈGLE CRITIQUE - HÉRITAGE DES CODES :
Les codes sont HÉRITÉS d'une ligne à l'autre ! 
- Si une ligne n'a que les colonnes 4-5 remplies (ex: "10 00"), elle HÉRITE du préfixe des lignes précédentes
- Tu dois MÉMORISER le préfixe courant et le COMBINER avec les suffixes

EXEMPLE CONCRET D'HÉRITAGE :
| Col1-2 | Col3 | Col4-5 | Désignation                   | DDI  | Unité | → Code reconstitué |
|--------|------|--------|-------------------------------|------|-------|-------------------|
| 07.01  |      |        | Pommes de terre               | -    | -     | Préfixe = "0701"  |
|        | 10   |        | - Plants                      | -    | -     | Préfixe = "070110"|
|        |      | 00 00  | -- Plants                     | 25%  | kg    | 0701100000        |
|        | 90   |        | - Autres                      | -    | -     | Préfixe = "070190"|
|        |      | 11 00  | -- Fraîches, conditionnées    | 40%  | kg    | 0701901100        |
|        |      | 19 00  | -- Autres fraîches            | 40%  | kg    | 0701901900        |

EXTRACTION - HS_CODES (codes à 6 chiffres) :
Pour chaque SOUS-POSITION (6 chiffres), extrais :
- code: format "XXXX.XX" (ex: "0701.10")
- code_clean: 6 chiffres (ex: "070110")
- description: texte de "Désignation des Produits" SANS les tirets de début
- level: "subheading"

EXTRACTION - TARIFF_LINES (codes à 10 chiffres avec DDI) :
Pour chaque ligne AVEC un taux de droit d'importation, extrais :
- national_code: 10 chiffres reconstitués par héritage (ex: "0701901100")
- hs_code_6: les 6 premiers chiffres (ex: "070190")
- description: texte complet de "Désignation des Produits"
- duty_rate: le taux DDI en nombre (ex: 40 pour 40%)
- unit: l'unité de quantité normalisée (ex: "kg")

VALIDATION OBLIGATOIRE :
- national_code = EXACTEMENT 10 chiffres numériques
- hs_code_6 = les 6 premiers chiffres du national_code
- Ne PAS extraire les lignes sans taux DDI (positions parentes)
- Extrais MAXIMUM ${maxLines} lignes tarifaires
- Extrais TOUTES les sous-positions à 6 chiffres visibles

Réponds UNIQUEMENT avec ce JSON :
{
  "summary": "Résumé court du chapitre",
  "key_points": ["Note légale 1", "Note légale 2"],
  "hs_codes": [
    {"code": "0701.10", "code_clean": "070110", "description": "Plants", "level": "subheading"},
    {"code": "0701.90", "code_clean": "070190", "description": "Autres", "level": "subheading"}
  ],
  "tariff_lines": [
    {"national_code": "0701100000", "hs_code_6": "070110", "description": "Plants de pommes de terre", "duty_rate": 25, "unit": "kg"},
    {"national_code": "0701901100", "hs_code_6": "070190", "description": "Pommes de terre fraîches conditionnées", "duty_rate": 40, "unit": "kg"}
  ],
  "chapter_info": {"number": 7, "title": "Légumes, plantes, racines et tubercules alimentaires"}
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
