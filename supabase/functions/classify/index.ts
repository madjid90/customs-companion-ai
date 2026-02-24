// ============================================================================
// CLASSIFY EDGE FUNCTION - Classification tarifaire structurée
// ============================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders,
  handleCorsPreFlight,
  errorResponse,
  successResponse,
} from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth-check.ts";

const LOVABLE_AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_AI_MODEL = "google/gemini-2.5-flash";

serve(async (req) => {
  if (req.method === "OPTIONS") return handleCorsPreFlight(req);

  const corsHeaders = getCorsHeaders(req);

  // Auth
  const { error: authError, auth } = await requireAuth(req, corsHeaders);
  if (authError) return authError;

  try {
    const body = await req.json();
    const { description, hs_code_hint, origin_country } = body;

    if (!description || typeof description !== "string" || description.trim().length < 3) {
      return errorResponse(req, "Description du produit requise (min 3 caractères)", 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!LOVABLE_API_KEY) {
      return errorResponse(req, "Configuration serveur manquante", 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // =========================================================================
    // 1. Recherche sémantique des codes SH pertinents
    // =========================================================================
    let hsContext = "";
    let tariffContext = "";

    // Generate embedding if OpenAI key available
    let queryEmbedding: number[] | null = null;
    if (OPENAI_API_KEY) {
      try {
        const embRes = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: description,
          }),
        });
        if (embRes.ok) {
          const embData = await embRes.json();
          queryEmbedding = embData.data?.[0]?.embedding;
        }
      } catch (e) {
        console.warn("Embedding generation failed:", e);
      }
    }

    // Hybrid HS code search
    if (queryEmbedding) {
      const { data: hsResults } = await supabase.rpc("search_hs_codes_hybrid", {
        query_text: description,
        query_embedding: JSON.stringify(queryEmbedding),
        semantic_weight: 0.6,
        match_count: 15,
      });
      if (hsResults?.length) {
        hsContext = hsResults
          .map((h: any) => `${h.code} — ${h.description_fr} (score: ${(h.combined_score * 100).toFixed(0)}%)`)
          .join("\n");
      }
    }

    // Fallback: text search
    if (!hsContext) {
      const { data: hsText } = await supabase.rpc("search_hs_codes", {
        search_query: description,
      });
      if (hsText?.length) {
        hsContext = hsText
          .slice(0, 15)
          .map((h: any) => `${h.code} — ${h.description_fr}`)
          .join("\n");
      }
    }

    // HS code hint: fetch tariff details
    if (hs_code_hint) {
      const cleanHint = hs_code_hint.replace(/[^0-9]/g, "");
      if (cleanHint.length >= 4) {
        const { data: tariffs } = await supabase.rpc("get_tariff_details", {
          p_hs_code: cleanHint,
          p_country: "MA",
        });
        if (tariffs?.length) {
          tariffContext = tariffs
            .slice(0, 10)
            .map((t: any) => `${t.national_code} — ${t.description_local || "N/A"} | DDI: ${t.duty_rate ?? "?"}% | TVA: ${t.vat_rate ?? 20}%`)
            .join("\n");
        }
      }
    }

    // Search legal chunks for relevant notes/RGI
    let legalContext = "";
    if (queryEmbedding) {
      const { data: legalResults } = await supabase.rpc("search_legal_chunks_hybrid", {
        query_text: description,
        query_embedding: JSON.stringify(queryEmbedding),
        semantic_weight: 0.5,
        match_count: 5,
      });
      if (legalResults?.length) {
        legalContext = legalResults
          .map((l: any) => `[${l.chunk_type || "Legal"}] ${l.section_title || ""}: ${l.chunk_text?.substring(0, 500)}`)
          .join("\n\n");
      }
    }

    // Search tariff notes
    let notesContext = "";
    if (queryEmbedding) {
      const { data: noteResults } = await supabase.rpc("search_tariff_notes_hybrid", {
        query_text: description,
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: 5,
      });
      if (noteResults?.length) {
        notesContext = noteResults
          .map((n: any) => `[${n.note_type}] Chapitre ${n.chapter_number}: ${n.note_text?.substring(0, 400)}`)
          .join("\n\n");
      }
    }

    // =========================================================================
    // 2. Appel LLM pour classification structurée
    // =========================================================================
    const systemPrompt = `Tu es un expert en classification tarifaire douanière marocaine (SH / Code des Douanes).
L'utilisateur décrit un produit. Tu dois proposer EXACTEMENT 3 alternatives de classification.

Pour chaque alternative, fournis:
- hs_code: code SH au format 10 chiffres (ex: "8528.72.00.10")
- description: libellé officiel du code SH
- score: probabilité en % (entier, les 3 scores doivent totaliser 100)
- duty_rate: taux de Droit d'Importation (DDI) en %
- reasoning: argumentaire de 2-3 phrases basé sur les RGI, Notes de section/chapitre
- sources: tableau de sources citées, chacune avec:
  - type: "rgi" | "note" | "circulaire" | "db"
  - ref: référence précise (ex: "RGI 1", "Note 5(a), Section XVI")
  - text: explication courte

Règles:
- La 1ère alternative est la plus probable (score le plus élevé)
- Base tes classifications sur les RGI (Règles Générales d'Interprétation) du Système Harmonisé
- Cite les Notes de section et de chapitre pertinentes
- Le score doit refléter la confiance réelle (ne pas inventer un score élevé si c'est ambigu)

CONTEXTE BASE DE DONNÉES:
${hsContext ? `=== CODES SH PERTINENTS ===\n${hsContext}` : "Aucun code SH trouvé"}
${tariffContext ? `\n=== TARIFS (indice code) ===\n${tariffContext}` : ""}
${legalContext ? `\n=== TEXTES JURIDIQUES ===\n${legalContext}` : ""}
${notesContext ? `\n=== NOTES TARIFAIRES ===\n${notesContext}` : ""}

Réponds UNIQUEMENT en JSON valide avec cette structure exacte:
{
  "confidence": "high" | "medium" | "low",
  "alternatives": [
    {
      "hs_code": "XXXX.XX.XX.XX",
      "description": "...",
      "score": 70,
      "duty_rate": 25,
      "reasoning": "...",
      "sources": [
        { "type": "rgi", "ref": "RGI 1", "text": "..." }
      ]
    }
  ]
}`;

    const userMessage = `Produit à classifier: "${description}"${origin_country ? `\nPays d'origine: ${origin_country}` : ""}${hs_code_hint ? `\nIndice code SH: ${hs_code_hint}` : ""}`;

    const llmResponse = await fetch(LOVABLE_AI_GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LOVABLE_AI_MODEL,
        max_tokens: 3000,
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error("LLM error:", llmResponse.status, errText);
      return errorResponse(req, "Erreur lors de la classification", 500);
    }

    const llmData = await llmResponse.json();
    const rawContent = llmData.choices?.[0]?.message?.content || "";

    // Parse JSON from LLM response (handle markdown code blocks)
    let parsed: any;
    try {
      const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, rawContent];
      parsed = JSON.parse(jsonMatch[1].trim());
    } catch (parseErr) {
      console.error("Failed to parse LLM JSON:", rawContent.substring(0, 500));
      return errorResponse(req, "Erreur d'analyse de la réponse IA", 500);
    }

    // Validate structure
    if (!parsed.alternatives || !Array.isArray(parsed.alternatives) || parsed.alternatives.length === 0) {
      return errorResponse(req, "Réponse IA invalide: pas d'alternatives", 500);
    }

    // Enrich alternatives with tariff data from DB
    for (const alt of parsed.alternatives) {
      if (!alt.duty_rate && alt.hs_code) {
        const cleanCode = alt.hs_code.replace(/[^0-9]/g, "").substring(0, 6);
        const { data: tariffData } = await supabase.rpc("get_tariff_details", {
          p_hs_code: cleanCode,
          p_country: "MA",
        });
        if (tariffData?.[0]) {
          alt.duty_rate = tariffData[0].duty_rate ?? alt.duty_rate;
        }
      }
    }

    return successResponse(req, {
      query: description,
      confidence: parsed.confidence || "medium",
      alternatives: parsed.alternatives,
    });
  } catch (err) {
    console.error("Classify error:", err);
    return errorResponse(req, "Erreur interne lors de la classification", 500);
  }
});
