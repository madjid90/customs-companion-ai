import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    console.log("PDF downloaded and converted to base64, size:", base64Pdf.length);

    // Get PDF document metadata
    const { data: pdfDoc } = await supabase
      .from("pdf_documents")
      .select("title, category, country_code")
      .eq("id", pdfId)
      .single();

    // Call Lovable AI to analyze the PDF
    const analysisPrompt = `Tu es un expert en douane et commerce international spécialisé dans les tarifs douaniers marocains.

Analyse ce document PDF douanier :
- Titre : ${pdfDoc?.title || "Document sans titre"}
- Catégorie : ${pdfDoc?.category || "Non spécifié"}
- Pays : ${pdfDoc?.country_code || "MA"}

STRUCTURE DU TARIF MAROCAIN - TRÈS IMPORTANT :
Le tarif marocain a une structure hiérarchique où les CODES PARENTS NE SONT PAS RÉPÉTÉS sur chaque ligne.

Exemple de structure dans le document :
| Codification | Désignation |
| 03.01        | Poissons vivants. |
|              | – Poissons d'ornement : |
| 0301.11 00 00| – – D'eau douce |
| 0301.19 00 00| – – Autres |
|              | – Autres poissons vivants : |
| 0301.91      | – – Truites (...) |
| 10 00        | – – – destinées au repeuplement |
| 90 00        | – – – autres |

RÈGLES D'HÉRITAGE DES CODES :
1. Code position 4 chiffres (ex: "03.01") = en-tête de position
2. Code 6-10 chiffres complet (ex: "0301.11 00 00") = ligne tarifaire complète
3. Code partiel 4-6 chiffres (ex: "0301.91") = sous-position parent pour les lignes suivantes
4. Code 2-4 chiffres seul (ex: "10 00", "90 00") = HÉRITE du code parent précédent
   → Si parent était "0301.91", alors "10 00" devient "0301.91 10 00" = "0301911000"

EXTRACTION DEMANDÉE :
Pour chaque ligne tarifaire avec un taux, reconstitue le code national COMPLET à 10 chiffres.

Génère une analyse structurée au format JSON avec :
1. "summary" : Résumé incluant le numéro et titre du chapitre
2. "key_points" : Notes légales importantes du chapitre (exclusions, définitions)
3. "hs_codes" : Liste des positions 4 chiffres détectées (format: ["0301", "0302", "0303"])
4. "tariff_lines" : Lignes tarifaires extraites (max 100), format:
   [{"national_code": "0301110000", "hs_code_6": "030111", "description": "Poissons d'ornement d'eau douce", "duty_rate": 10, "unit": "kg", "hierarchy": 2, "parent_code": "0301.11"}]
   - national_code : Code COMPLET à 10 chiffres sans espaces ni points
   - hs_code_6 : Les 6 premiers chiffres
   - duty_rate : Taux DDI en nombre (2.5 pour 2.5%)
   - hierarchy : Niveau de profondeur (1, 2, 3, 4...)
5. "chapter_info" : {"number": 3, "title": "Poissons et crustacés...", "edition": "2022"}
6. "authorities" : Autorités mentionnées

Réponds UNIQUEMENT avec le JSON valide, sans markdown ni explication.`;

    // Use Lovable AI Gateway with PDF as inline data
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        max_tokens: 16384,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: analysisPrompt
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:application/pdf;base64,${base64Pdf}`
                }
              }
            ]
          }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("Lovable AI error:", aiResponse.status, errorText);
      throw new Error(`Lovable AI error: ${aiResponse.status} - ${errorText}`);
    }

    const aiData = await aiResponse.json();
    console.log("AI response received:", JSON.stringify(aiData).substring(0, 500));
    
    const responseText = aiData.choices?.[0]?.message?.content || "{}";
    
    // Parse AI response - clean markdown if present
    let analysisResult;
    try {
      let cleanedResponse = responseText.trim();
      // Remove markdown code blocks if present
      if (cleanedResponse.startsWith("```json")) {
        cleanedResponse = cleanedResponse.slice(7);
      }
      if (cleanedResponse.startsWith("```")) {
        cleanedResponse = cleanedResponse.slice(3);
      }
      if (cleanedResponse.endsWith("```")) {
        cleanedResponse = cleanedResponse.slice(0, -3);
      }
      cleanedResponse = cleanedResponse.trim();
      
      analysisResult = JSON.parse(cleanedResponse);
      console.log("Parsed analysis result:", JSON.stringify(analysisResult).substring(0, 300));
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      console.error("Raw response:", responseText.substring(0, 500));
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
        detected_tariff_changes: analysisResult.tariff_lines || analysisResult.tariff_changes || [],
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
    const updateData: Record<string, any> = {
      is_verified: true,
      verified_at: new Date().toISOString(),
      related_hs_codes: analysisResult.hs_codes || [],
    };
    
    // Add chapter info to keywords if available
    if (analysisResult.chapter_info?.number) {
      updateData.keywords = `Chapitre ${analysisResult.chapter_info.number}`;
    }

    await supabase
      .from("pdf_documents")
      .update(updateData)
      .eq("id", pdfId);

    console.log("Analysis complete for PDF:", pdfId, "HS codes found:", analysisResult.hs_codes?.length || 0);

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
