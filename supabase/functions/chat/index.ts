import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Analyze question to extract intent, codes, and keywords
function analyzeQuestion(question: string) {
  const lowerQ = question.toLowerCase();
  
  // Detect HS codes (various formats)
  const hsPattern = /\b(\d{2}[\.\s]?\d{2}[\.\s]?\d{0,2}[\.\s]?\d{0,2})\b/g;
  const detectedCodes = [...question.matchAll(hsPattern)]
    .map(m => m[1].replace(/[\.\s]/g, ''))
    .filter(c => c.length >= 4);
  
  // Detect intent
  let intent = 'info';
  if (/class|code|position|nomenclature|sh\s/i.test(lowerQ)) intent = 'classify';
  else if (/droit|ddi|tva|tax|payer|combien|calcul|coût|prix/i.test(lowerQ)) intent = 'calculate';
  else if (/origine|eur\.?1|préférentiel|accord|certificat/i.test(lowerQ)) intent = 'origin';
  else if (/contrôl|interdit|autoris|mcinet|onssa|anrt|permis|licence/i.test(lowerQ)) intent = 'control';
  else if (/document|formalité|procédure|étape/i.test(lowerQ)) intent = 'procedure';
  
  // Extract meaningful keywords (remove stop words)
  const stopWords = ['le','la','les','un','une','des','pour','sur','est','que','quel','quels','quelle',
    'quelles','comment','combien','dans','avec','sans','par','vers','chez','être','avoir','faire',
    'douane','maroc','marocain','produit','marchandise'];
  const keywords = lowerQ
    .replace(/[^\w\sàâäéèêëïîôùûüç]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.includes(w));
  
  // Detect country (default to Morocco)
  let country = 'MA';
  if (/sénégal|senegal/i.test(lowerQ)) country = 'SN';
  else if (/côte d'ivoire|cote d'ivoire|ivoirien/i.test(lowerQ)) country = 'CI';
  else if (/cameroun/i.test(lowerQ)) country = 'CM';
  
  return { detectedCodes, intent, keywords, country };
}

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

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Analyze the question
    const analysis = analyzeQuestion(question);
    console.log("Question analysis:", JSON.stringify(analysis));

    // Collect context from database
    const context: {
      hs_codes: any[];
      tariffs: any[];
      controlled_products: any[];
      knowledge_documents: any[];
      pdf_summaries: any[];
    } = {
      hs_codes: [],
      tariffs: [],
      controlled_products: [],
      knowledge_documents: [],
      pdf_summaries: [],
    };

    // 1. Search HS codes by detected codes
    if (analysis.detectedCodes.length > 0) {
      for (const code of analysis.detectedCodes.slice(0, 3)) {
        const { data } = await supabase
          .from('hs_codes')
          .select('code, description_fr, description_en, chapter_number, section_number, legal_notes, explanatory_notes')
          .or(`code.ilike.${code}%,code_clean.ilike.${code}%`)
          .eq('is_active', true)
          .limit(5);
        if (data) context.hs_codes.push(...data);
      }
    }
    
    // 2. Search HS codes by keywords
    if (analysis.keywords.length > 0 && context.hs_codes.length < 10) {
      for (const keyword of analysis.keywords.slice(0, 3)) {
        const { data } = await supabase
          .from('hs_codes')
          .select('code, description_fr, description_en, chapter_number')
          .or(`description_fr.ilike.%${keyword}%,description_en.ilike.%${keyword}%`)
          .eq('is_active', true)
          .limit(5);
        if (data) context.hs_codes.push(...data);
      }
    }
    
    // Remove duplicates
    context.hs_codes = [...new Map(context.hs_codes.map(item => [item.code, item])).values()].slice(0, 15);

    // 3. Get tariffs for found codes
    const codes6 = [...new Set(context.hs_codes.map(c => c.code.substring(0, 6).replace(/\./g, '')))];
    if (codes6.length > 0) {
      const { data } = await supabase
        .from('country_tariffs')
        .select('hs_code_6, national_code, description_local, duty_rate, vat_rate, other_taxes, is_prohibited, is_restricted')
        .eq('country_code', analysis.country)
        .in('hs_code_6', codes6)
        .eq('is_active', true)
        .limit(20);
      if (data) context.tariffs = data;
    }

    // 4. Check for controlled products
    const codes4 = [...new Set(context.hs_codes.map(c => c.code.substring(0, 4).replace(/\./g, '')))];
    if (codes4.length > 0) {
      for (const code4 of codes4.slice(0, 5)) {
        const { data } = await supabase
          .from('controlled_products')
          .select('hs_code, control_type, control_authority, required_norm, required_documents, notes')
          .eq('country_code', analysis.country)
          .ilike('hs_code', `${code4}%`)
          .eq('is_active', true);
        if (data?.length) context.controlled_products.push(...data);
      }
    }

    // 5. Search knowledge documents
    if (analysis.keywords.length > 0) {
      const searchTerms = analysis.keywords.slice(0, 2);
      for (const term of searchTerms) {
        const { data } = await supabase
          .from('knowledge_documents')
          .select('title, content, category, source_url')
          .or(`title.ilike.%${term}%,content.ilike.%${term}%`)
          .eq('is_active', true)
          .limit(3);
        if (data) context.knowledge_documents.push(...data);
      }
      context.knowledge_documents = [...new Map(context.knowledge_documents.map(d => [d.title, d])).values()].slice(0, 5);
    }

    // 6. Get relevant PDF summaries
    if (codes4.length > 0 || analysis.keywords.length > 0) {
      let pdfQuery = supabase
        .from('pdf_extractions')
        .select(`
          summary,
          key_points,
          mentioned_hs_codes,
          pdf_documents!inner(title, category, country_code)
        `)
        .limit(3);
      
      // Search by HS codes or keywords
      if (codes4.length > 0) {
        pdfQuery = pdfQuery.contains('mentioned_hs_codes', [codes4[0]]);
      }
      
      const { data } = await pdfQuery;
      if (data) {
        context.pdf_summaries = data.map((p: any) => ({
          title: p.pdf_documents?.title,
          category: p.pdf_documents?.category,
          summary: p.summary,
          key_points: p.key_points,
        }));
      }
    }

    console.log("Context collected:", {
      hs_codes: context.hs_codes.length,
      tariffs: context.tariffs.length,
      controlled: context.controlled_products.length,
      documents: context.knowledge_documents.length,
      pdfs: context.pdf_summaries.length,
    });

    // Build system prompt
    const systemPrompt = `Tu es **DouaneAI**, un assistant expert en douane et commerce international, spécialisé dans la réglementation ${analysis.country === 'MA' ? 'marocaine' : 'africaine'}.

## RÈGLES IMPÉRATIVES

1. **Base-toi UNIQUEMENT sur le contexte fourni** ci-dessous pour répondre
2. Si une information n'est pas dans le contexte, dis clairement : "Je n'ai pas cette information dans ma base de données"
3. **Cite TOUJOURS tes sources** entre parenthèses : (Source: table_name)
4. **Structure ta réponse** avec des titres markdown (##, ###) et des listes
5. Pour les **calculs de droits**, montre le détail complet :
   - Valeur CIF
   - DDI (Droit de Douane à l'Importation) = Valeur CIF × taux%
   - Base TVA = Valeur CIF + DDI
   - TVA = Base TVA × taux%
   - Total = Valeur CIF + DDI + TVA + autres taxes
6. **Alerte sur les produits contrôlés** avec l'autorité compétente (MCINET, ONSSA, ANRT, etc.)
7. **Alerte sur les produits interdits** ou restreints
8. Termine par un indicateur de confiance :
   - 🟢 **CONFIANCE HAUTE** : données vérifiées dans la base officielle
   - 🟡 **CONFIANCE MOYENNE** : information partielle ou à vérifier
   - 🔴 **CONFIANCE FAIBLE** : pas de source directe, conseil général

## CONTEXTE BASE DE DONNÉES

### Codes SH trouvés
${context.hs_codes.length > 0 ? JSON.stringify(context.hs_codes, null, 2) : "Aucun code SH correspondant trouvé"}

### Tarifs douaniers (${analysis.country})
${context.tariffs.length > 0 ? JSON.stringify(context.tariffs, null, 2) : "Aucun tarif trouvé"}

### Produits contrôlés
${context.controlled_products.length > 0 ? JSON.stringify(context.controlled_products, null, 2) : "Aucun contrôle spécifique trouvé"}

### Documents de référence
${context.knowledge_documents.length > 0 ? context.knowledge_documents.map(d => `- **${d.title}**: ${d.content?.substring(0, 200)}...`).join('\n') : "Aucun document de référence"}

### Résumés PDF pertinents
${context.pdf_summaries.length > 0 ? context.pdf_summaries.map(p => `- **${p.title}** (${p.category}): ${p.summary?.substring(0, 150)}...`).join('\n') : "Aucun PDF pertinent"}

---
Réponds maintenant à la question de l'utilisateur en français, de manière claire et structurée.`;

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
        max_tokens: 3000,
        temperature: 0.2,
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
    let confidence: "high" | "medium" | "low" = "medium";
    if (responseText.includes("🟢") || responseText.includes("CONFIANCE HAUTE")) confidence = "high";
    else if (responseText.includes("🔴") || responseText.includes("CONFIANCE FAIBLE")) confidence = "low";
    else if (context.tariffs.length > 0 || context.hs_codes.length > 3) confidence = "high";
    else if (context.hs_codes.length === 0 && context.knowledge_documents.length === 0) confidence = "low";

    // Save conversation to database
    const { data: conversation } = await supabase
      .from('conversations')
      .insert({
        session_id: sessionId,
        question: question,
        response: responseText,
        detected_intent: analysis.intent,
        detected_hs_codes: context.hs_codes.map(c => c.code),
        context_used: {
          hs_codes: context.hs_codes.length,
          tariffs: context.tariffs.length,
          controlled: context.controlled_products.length,
          documents: context.knowledge_documents.length,
          pdfs: context.pdf_summaries.length,
        },
        pdfs_used: context.pdf_summaries.map(p => p.title),
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
          hs_codes_found: context.hs_codes.length,
          tariffs_found: context.tariffs.length,
          controlled_found: context.controlled_products.length,
          documents_found: context.knowledge_documents.length,
          pdfs_used: context.pdf_summaries.length,
        },
        metadata: {
          intent: analysis.intent,
          country: analysis.country,
          response_time_ms: responseTime,
        }
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
