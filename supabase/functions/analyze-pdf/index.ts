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

    // Get public URL of the PDF
    const { data: publicUrlData } = supabase.storage
      .from("pdf-documents")
      .getPublicUrl(filePath);

    const pdfUrl = publicUrlData?.publicUrl;
    console.log("PDF URL:", pdfUrl);

    // Get PDF document metadata
    const { data: pdfDoc } = await supabase
      .from("pdf_documents")
      .select("title, category, country_code")
      .eq("id", pdfId)
      .single();

    // Call Lovable AI to analyze based on document metadata
    const analysisPrompt = `Tu es un expert en douane et commerce international spécialisé dans les tarifs douaniers marocains.

Analyse ce document PDF douanier :
- Titre : ${pdfDoc?.title || "Document sans titre"}
- Catégorie : ${pdfDoc?.category || "Non spécifié"}
- Pays : ${pdfDoc?.country_code || "MA"}
- URL : ${pdfUrl}

Ce document est un tarif douanier marocain avec des tableaux structurés contenant :
- Colonne "Codification" : codes tarifaires (format XXXX.XX XX XX pour 10 chiffres)
- Colonne "Désignation des Produits" : descriptions avec hiérarchie (– pour niveau 1, – – pour niveau 2, etc.)
- Colonne "Droit d'Importation" : taux DDI en pourcentage
- Colonne "Unité" : unité de mesure (kg, u, l, etc.)

IMPORTANT - Structure hiérarchique :
- Les codes partiels (ex: "10 00") héritent du code parent (ex: "9601.10")
- Les lignes avec ":" à la fin sont des en-têtes sans taux
- La hiérarchie est indiquée par les tirets : – (niveau 1), – – (niveau 2), – – – (niveau 3)

Génère une analyse structurée au format JSON avec :
1. "summary" : Résumé incluant le numéro et titre du chapitre
2. "key_points" : Notes légales importantes du chapitre (les exclusions, définitions)
3. "hs_codes" : Liste des positions 4 chiffres détectées (format: ["9601", "9602", "9603"])
4. "tariff_lines" : Lignes tarifaires extraites (max 50), format:
   [{"national_code": "9601100000", "hs_code_6": "960110", "description": "Ivoire travaillé", "duty_rate": 2.5, "unit": "kg", "hierarchy": 1}]
5. "chapter_info" : {"number": 96, "title": "Ouvrages divers", "edition": "2022"}
6. "authorities" : Autorités mentionnées (ADII, Douanes, etc.)

Réponds UNIQUEMENT avec le JSON valide, sans markdown ni explication.`;

    // Use Lovable AI Gateway (OpenAI-compatible format)
    const aiResponse = await fetch("https://api.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        max_tokens: 2048,
        messages: [
          { role: "user", content: analysisPrompt }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("Lovable AI error:", aiResponse.status, errorText);
      throw new Error(`Lovable AI error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
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
      analysisResult = JSON.parse(cleanedResponse.trim());
    } catch {
      console.warn("Failed to parse AI response, using defaults");
      analysisResult = {
        summary: "Analyse en attente de traitement manuel",
        key_points: [],
        hs_codes: [],
        tariff_changes: [],
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

    console.log("Analysis complete for PDF:", pdfId);

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
