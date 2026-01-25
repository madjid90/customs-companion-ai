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
    const { question, sessionId } = await req.json();

    if (!question) {
      return new Response(
        JSON.stringify({ error: "Question is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Create Supabase client for context search
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Extract potential HS codes or keywords from the question
    const codeMatch = question.match(/\b\d{4}(?:\.\d{2})?(?:\.\d{2})?\b/g);
    const keywords = question.toLowerCase()
      .replace(/[^\w\sàâäéèêëïîôùûüç]/g, ' ')
      .split(/\s+/)
      .filter((w: string) => w.length > 3);

    // Search for context in database
    let hsCodesContext: any[] = [];
    let tariffsContext: any[] = [];
    let controlledContext: any[] = [];

    // Search HS codes
    if (codeMatch) {
      for (const code of codeMatch) {
        const { data: codes } = await supabase
          .from('hs_codes')
          .select('code, description_fr, description_en, chapter_number, legal_notes')
          .ilike('code', `${code}%`)
          .eq('is_active', true)
          .limit(5);
        if (codes) hsCodesContext.push(...codes);
      }
    }

    // Search by keywords in descriptions
    for (const keyword of keywords.slice(0, 3)) {
      const { data: codes } = await supabase
        .from('hs_codes')
        .select('code, description_fr, description_en, chapter_number')
        .or(`description_fr.ilike.%${keyword}%,description_en.ilike.%${keyword}%`)
        .eq('is_active', true)
        .limit(5);
      if (codes) hsCodesContext.push(...codes);
    }

    // Remove duplicates
    hsCodesContext = [...new Map(hsCodesContext.map(item => [item.code, item])).values()].slice(0, 10);

    // Get tariffs for found codes
    if (hsCodesContext.length > 0) {
      const codes6 = [...new Set(hsCodesContext.map(c => c.code.substring(0, 6).replace(/\./g, '')))];
      const { data: tariffs } = await supabase
        .from('country_tariffs')
        .select('hs_code_6, national_code, description_local, duty_rate, vat_rate, is_prohibited, is_restricted')
        .eq('country_code', 'MA')
        .in('hs_code_6', codes6)
        .eq('is_active', true);
      if (tariffs) tariffsContext = tariffs;
    }

    // Check for controlled products
    if (hsCodesContext.length > 0) {
      const codes4 = [...new Set(hsCodesContext.map(c => c.code.substring(0, 4).replace(/\./g, '')))];
      for (const code4 of codes4) {
        const { data: controlled } = await supabase
          .from('controlled_products')
          .select('hs_code, control_type, control_authority, required_norm, required_documents')
          .eq('country_code', 'MA')
          .ilike('hs_code', `${code4}%`)
          .eq('is_active', true);
        if (controlled) controlledContext.push(...controlled);
      }
    }

    // Build context for AI
    const context = {
      hs_codes: hsCodesContext,
      tariffs: tariffsContext,
      controlled_products: controlledContext,
    };

    const systemPrompt = `Tu es DouaneAI, un expert en douane et commerce international spécialisé dans la réglementation marocaine.

RÈGLES STRICTES:
1. Réponds UNIQUEMENT en te basant sur le contexte fourni ci-dessous
2. Si une information n'est pas dans le contexte, dis clairement "Je n'ai pas cette information dans ma base de données"
3. Cite TOUJOURS tes sources (nom de la table: hs_codes, country_tariffs, controlled_products)
4. Indique le niveau de confiance à la fin de ta réponse:
   - 🟢 HAUTE: donnée vérifiée dans la base
   - 🟡 MOYENNE: information partielle ou ancienne
   - 🔴 FAIBLE: pas de source, information générale
5. Pour les calculs de droits, montre le détail du calcul
6. Alerte systématiquement sur les produits contrôlés avec l'autorité compétente
7. Réponds toujours en français
8. Sois concis mais complet

CONTEXTE BASE DE DONNÉES:
${JSON.stringify(context, null, 2)}

Si le contexte est vide, indique que tu n'as pas trouvé d'informations correspondantes et suggère à l'utilisateur de reformuler sa question ou d'utiliser la page Recherche.`;

    // Call Lovable AI Gateway
    const startTime = Date.now();
    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: question }
        ],
        max_tokens: 2048,
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Trop de requêtes. Veuillez réessayer dans quelques instants." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Limite d'utilisation atteinte. Contactez l'administrateur." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errorText);
      throw new Error("AI gateway error");
    }

    const aiData = await aiResponse.json();
    const responseTime = Date.now() - startTime;
    const responseText = aiData.choices?.[0]?.message?.content || "Je n'ai pas pu générer de réponse.";

    // Determine confidence level from response
    let confidence = "medium";
    if (responseText.includes("🟢")) confidence = "high";
    else if (responseText.includes("🔴")) confidence = "low";

    // Save conversation to database
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .insert({
        session_id: sessionId,
        question: question,
        response: responseText,
        detected_intent: codeMatch ? 'classification' : 'general',
        detected_hs_codes: hsCodesContext.map(c => c.code),
        context_used: context,
        confidence_level: confidence,
        response_time_ms: responseTime,
      })
      .select('id')
      .single();

    return new Response(
      JSON.stringify({
        response: responseText,
        confidence: confidence,
        conversationId: conversation?.id,
        context: {
          hs_codes_found: hsCodesContext.length,
          tariffs_found: tariffsContext.length,
          controlled_found: controlledContext.length,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur interne" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
