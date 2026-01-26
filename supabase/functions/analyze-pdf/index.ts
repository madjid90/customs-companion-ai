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
    const analysisPrompt = `Tu es un expert en tarifs douaniers marocains. Analyse ce document PDF.

Document : ${pdfDoc?.title || "Tarif douanier"}
Catégorie : ${pdfDoc?.category || "tarif"}

STRUCTURE HIÉRARCHIQUE DU TARIF MAROCAIN :
Le tarif utilise un système de codes à 10 chiffres où les sous-positions HÉRITENT du code parent.

EXEMPLE CONCRET du document :
┌─────────────────┬─────────────────────────────────────┬───────┐
│ Codification    │ Désignation                         │ DDI % │
├─────────────────┼─────────────────────────────────────┼───────┤
│ 03.01           │ Poissons vivants                    │       │
│ 0301.11 00 00   │ -- D'eau douce                      │ 10    │
│ 0301.91         │ -- Truites                          │       │
│      10 00      │ --- destinées au repeuplement       │ 10    │
│      90 00      │ --- autres                          │ 10    │
└─────────────────┴─────────────────────────────────────┴───────┘

RÈGLES DE RECONSTITUTION DES CODES :
1. "03.01" = position (4 chiffres) → mémorise "0301" comme préfixe
2. "0301.11 00 00" = code complet 10 chiffres → national_code = "0301110000"
3. "0301.91" = sous-position 6 chiffres → mémorise "030191" comme préfixe courant
4. "10 00" ou "90 00" = suffixe 4 chiffres → AJOUTE au préfixe courant
   - Préfixe "030191" + "10 00" = "0301911000"
   - Préfixe "030191" + "90 00" = "0301919000"

IMPORTANT : Chaque code national doit avoir EXACTEMENT 10 chiffres !

Génère ce JSON :
{
  "summary": "Résumé du chapitre avec son numéro et titre",
  "key_points": ["Note légale 1", "Note légale 2"],
  "hs_codes": ["0301", "0302"],  // Positions 4 chiffres UNIQUES trouvées
  "tariff_lines": [
    {
      "national_code": "0301110000",  // TOUJOURS 10 chiffres, sans espaces/points
      "hs_code_6": "030111",          // 6 premiers chiffres du national_code
      "description": "Poissons d'ornement d'eau douce",
      "duty_rate": 10,                // Taux DDI (nombre, pas texte)
      "unit": "kg"
    }
  ],
  "chapter_info": {"number": 3, "title": "Titre du chapitre"},
  "authorities": []
}

VALIDATION : 
- Vérifie que chaque national_code a 10 chiffres
- hs_code_6 = les 6 premiers chiffres de national_code
- N'inclus QUE les lignes avec un taux DDI

Réponds UNIQUEMENT avec le JSON valide.`;

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
