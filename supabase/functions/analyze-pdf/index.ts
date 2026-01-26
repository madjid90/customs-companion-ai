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

interface AnalysisResult {
  summary: string;
  key_points: string[];
  hs_codes: string[];
  tariff_lines: TariffLine[];
  chapter_info?: { number: number; title: string };
  authorities?: string[];
}

async function analyzeWithAI(
  base64Pdf: string,
  title: string,
  category: string,
  apiKey: string,
  maxLines: number
): Promise<{ result: AnalysisResult | null; truncated: boolean }> {
  
  const analysisPrompt = `Tu es un expert en tarifs douaniers marocains. Analyse ce document PDF.

Document : ${title}
Catégorie : ${category}

STRUCTURE HIÉRARCHIQUE DU TARIF MAROCAIN :
Le tarif utilise un système de codes à 10 chiffres. Les sous-positions HÉRITENT du préfixe parent.

RÈGLES D'HÉRITAGE DES CODES :
1. Quand tu vois "04.01" → mémorise "0401" comme préfixe de position
2. Quand tu vois "0401.10" → mémorise "040110" comme préfixe de sous-position  
3. Quand tu vois une ligne avec juste "10 00" ou "90 00" → c'est un SUFFIXE à ajouter au préfixe courant

EXEMPLE DE RECONSTITUTION :
| Codification    | Ce que tu fais                                    |
|-----------------|---------------------------------------------------|
| 04.01           | Préfixe = "0401" (position parente)               |
| 0401.10         | Préfixe = "040110" (sous-position)                |
|      10 00      | Code = "040110" + "1000" = "0401101000"           |
|      90 00      | Code = "040110" + "9000" = "0401109000"           |
| 0401.20         | Préfixe = "040120" (nouvelle sous-position)       |
|      10 00      | Code = "040120" + "1000" = "0401201000"           |

IMPORTANT :
- Chaque national_code doit avoir EXACTEMENT 10 chiffres
- Retire TOUS les points, espaces et tirets
- hs_code_6 = les 6 premiers chiffres du national_code
- Extrais MAXIMUM ${maxLines} lignes tarifaires avec un taux DDI

Réponds avec CE JSON (et rien d'autre) :
{
  "summary": "Résumé court du chapitre",
  "key_points": ["Note 1", "Note 2"],
  "hs_codes": ["0401", "0402"],
  "tariff_lines": [
    {"national_code": "0401101000", "hs_code_6": "040110", "description": "Description", "duty_rate": 10, "unit": "kg"}
  ],
  "chapter_info": {"number": 4, "title": "Titre"}
}`;

  const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      max_tokens: 32000,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: analysisPrompt },
            {
              type: "image_url",
              image_url: { url: `data:application/pdf;base64,${base64Pdf}` }
            }
          ]
        }
      ],
    }),
  });

  if (!aiResponse.ok) {
    const errorText = await aiResponse.text();
    console.error("Lovable AI error:", aiResponse.status, errorText);
    throw new Error(`Lovable AI error: ${aiResponse.status}`);
  }

  const aiData = await aiResponse.json();
  const finishReason = aiData.choices?.[0]?.finish_reason;
  const truncated = finishReason === "length";
  
  console.log("AI response - finish_reason:", finishReason, "truncated:", truncated);
  
  const responseText = aiData.choices?.[0]?.message?.content || "{}";
  
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
    return { result, truncated };
  } catch (parseError) {
    console.error("Failed to parse AI response:", parseError);
    console.error("Raw response (first 1000):", responseText.substring(0, 1000));
    return { result: null, truncated };
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
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
      
      const { result, truncated } = await analyzeWithAI(
        base64Pdf,
        title,
        category,
        LOVABLE_API_KEY,
        maxLines
      );
      
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
        mentioned_hs_codes: analysisResult.hs_codes || [],
        detected_tariff_changes: analysisResult.tariff_lines || [],
        extracted_data: {
          chapter_info: analysisResult.chapter_info || null,
          authorities: analysisResult.authorities || [],
          tariff_lines_count: analysisResult.tariff_lines?.length || 0,
        },
        extraction_model: "google/gemini-2.5-flash",
        extraction_confidence: 0.85,
      });

    if (insertError) {
      console.error("Insert error:", insertError);
    }

    // Update PDF document with chapter info
    const updateData: Record<string, unknown> = {
      is_verified: true,
      verified_at: new Date().toISOString(),
      related_hs_codes: analysisResult.hs_codes || [],
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
