// ============================================================================
// CLASSIFY EDGE FUNCTION - Classification tarifaire structurée (v2)
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
  const { error: authError, auth } = await requireAuth(req, corsHeaders);
  if (authError) return authError;

  try {
    const body = await req.json();
    const {
      description,
      hs_code_hint,
      origin_country,
      material,
      condition,
      packaging,
      weight_info,
      usage,
      images,
      pdf_documents,
    } = body;

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
    // 1. ANALYSE DES DOCUMENTS UPLOADÉS (images via Gemini)
    // =========================================================================
    let documentExtractedInfo = "";
    const hasDocuments = (images && images.length > 0) || (pdf_documents && pdf_documents.length > 0);

    if (hasDocuments && images?.length) {
      try {
        const imgRes = await fetch(LOVABLE_AI_GATEWAY, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: LOVABLE_AI_MODEL,
            max_tokens: 1000,
            messages: [{
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${images[0].mediaType};base64,${images[0].base64}`,
                  },
                },
                {
                  type: "text",
                  text: `Décris ce produit pour la classification douanière SH. Extrais: nom, matière, dimensions, marque, modèle, caractéristiques techniques. Contexte: "${description}". Réponds en français, format concis.`,
                },
              ],
            }],
          }),
        });

        if (imgRes.ok) {
          const imgData = await imgRes.json();
          documentExtractedInfo = imgData.choices?.[0]?.message?.content || "";
        }
      } catch (e) {
        console.warn("Image analysis failed:", e);
      }
    }

    // =========================================================================
    // 2. RECHERCHE SÉMANTIQUE
    // =========================================================================
    let hsContext = "";
    let tariffContext = "";

    const enrichedDescription = [
      description,
      documentExtractedInfo ? `\nInfos documents: ${documentExtractedInfo}` : "",
    ].join("");

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
            input: enrichedDescription.substring(0, 8000),
          }),
        });
        if (embRes.ok) {
          const embData = await embRes.json();
          queryEmbedding = embData.data?.[0]?.embedding;
        }
      } catch (e) {
        console.warn("Embedding failed:", e);
      }
    }

    // Hybrid HS code search
    if (queryEmbedding) {
      const { data: hsResults } = await supabase.rpc("search_hs_codes_hybrid", {
        query_text: enrichedDescription.substring(0, 2000),
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
        hsContext = hsText.slice(0, 15)
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
          tariffContext = tariffs.slice(0, 10)
            .map((t: any) => `${t.national_code} — ${t.description_local || "N/A"} | DDI: ${t.duty_rate ?? "?"}% | TVA: ${t.vat_rate ?? 20}%`)
            .join("\n");
        }
      }
    }

    // Search legal chunks
    let legalContext = "";
    if (queryEmbedding) {
      const { data: legalResults } = await supabase.rpc("search_legal_chunks_hybrid", {
        query_text: enrichedDescription.substring(0, 2000),
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
        query_text: enrichedDescription.substring(0, 2000),
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
    // 3. APPEL LLM — PROMPT AMÉLIORÉ
    // =========================================================================
    const productProfile = [
      `Description: ${description}`,
      material ? `Matière principale: ${material}` : null,
      condition ? `État: ${condition}` : null,
      packaging ? `Conditionnement: ${packaging}` : null,
      weight_info ? `Poids/Quantité: ${weight_info}` : null,
      usage ? `Usage prévu: ${usage}` : null,
      origin_country ? `Pays d'origine: ${origin_country}` : null,
      hs_code_hint ? `Indice code SH: ${hs_code_hint}` : null,
      documentExtractedInfo ? `\n--- INFOS EXTRAITES DES DOCUMENTS ---\n${documentExtractedInfo}` : null,
    ].filter(Boolean).join("\n");

    const systemPrompt = `Tu es un expert senior en classification tarifaire douanière marocaine (SH / CDII).
Propose EXACTEMENT 3 alternatives de classification.

## RÈGLES DE SCORING
- **70-95%** : Code quasi-certain (description claire, un seul code évident)
- **40-70%** : Code probable mais ambiguïté possible
- **10-40%** : Code possible mais peu probable
- Les 3 scores totalisent 100%
- Si matière + usage + caractéristiques sont connus → 1er score ≥ 70%
- Si produit ambigu → 1er score 40-60%

## CRITÈRES QUI AUGMENTENT LA CONFIANCE
- Matière principale connue → chapitre SH déterminé
- État (neuf/occasion) → règles spécifiques
- Conditionnement → sous-position (RGI 2a pour kits)
- Documents analysés (facture, fiche technique) → données fiables
- Indice code SH → confirmer/infirmer

## FORMAT JSON (strictement)
Pour chaque alternative:
- hs_code: "XXXX.XX.XX.XX" (10 chiffres avec points)
- description: libellé officiel du code SH
- score: % entier
- duty_rate: taux DDI %
- reasoning: 2-4 phrases avec RGI citée + Notes section/chapitre
- sources: [{type: "rgi"|"note"|"circulaire"|"db", ref: "...", text: "..."}]

CONTEXTE BD:
${hsContext ? `=== CODES SH ===\n${hsContext}` : "Aucun code trouvé"}
${tariffContext ? `\n=== TARIFS ===\n${tariffContext}` : ""}
${legalContext ? `\n=== JURIDIQUE ===\n${legalContext}` : ""}
${notesContext ? `\n=== NOTES ===\n${notesContext}` : ""}

Réponds UNIQUEMENT en JSON:
{
  "confidence": "high"|"medium"|"low",
  "ai_extracted_info": "résumé infos documents ou null",
  "alternatives": [{
    "hs_code": "XXXX.XX.XX.XX",
    "description": "...",
    "score": 70,
    "duty_rate": 25,
    "reasoning": "...",
    "sources": [{"type":"rgi","ref":"...","text":"..."}]
  }]
}`;

    const llmResponse = await fetch(LOVABLE_AI_GATEWAY, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LOVABLE_AI_MODEL,
        max_tokens: 4000,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `PROFIL PRODUIT:\n${productProfile}` },
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

    // Parse JSON from LLM response
    let parsed: any;
    try {
      const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, rawContent];
      parsed = JSON.parse(jsonMatch[1].trim());
    } catch {
      console.error("JSON parse failed:", rawContent.substring(0, 500));
      return errorResponse(req, "Erreur d'analyse de la réponse IA", 500);
    }

    if (!parsed.alternatives?.length) {
      return errorResponse(req, "Réponse IA invalide: pas d'alternatives", 500);
    }

    // Normalize scores to 100%
    const totalScore = parsed.alternatives.reduce((s: number, a: any) => s + (a.score || 0), 0);
    if (totalScore !== 100 && totalScore > 0) {
      const factor = 100 / totalScore;
      parsed.alternatives.forEach((a: any) => { a.score = Math.round((a.score || 0) * factor); });
      const newTotal = parsed.alternatives.reduce((s: number, a: any) => s + a.score, 0);
      if (newTotal !== 100) parsed.alternatives[0].score += 100 - newTotal;
    }

    // Enrich alternatives with tariff data from DB
    for (const alt of parsed.alternatives) {
      if (alt.hs_code) {
        const cleanCode = alt.hs_code.replace(/[^0-9]/g, "").substring(0, 6);
        if (cleanCode.length >= 4) {
          const { data: tariffData } = await supabase.rpc("get_tariff_details", {
            p_hs_code: cleanCode,
            p_country: "MA",
          });
          if (tariffData?.[0]) {
            if (tariffData[0].duty_rate != null) alt.duty_rate = tariffData[0].duty_rate;
            if (!alt.sources?.some((s: any) => s.type === "db")) {
              alt.sources = alt.sources || [];
              alt.sources.push({
                type: "db",
                ref: `Base tarifs: ${tariffData[0].national_code || cleanCode}`,
                text: `DDI: ${tariffData[0].duty_rate ?? "?"}% | TVA: ${tariffData[0].vat_rate ?? 20}%`,
              });
            }
          }
        }
      }
    }

    // Determine final confidence
    let confidence = parsed.confidence || "medium";
    if (parsed.alternatives[0]?.score >= 75) confidence = "high";
    else if (parsed.alternatives[0]?.score <= 45) confidence = "low";
    else confidence = "medium";

    return successResponse(req, {
      query: description,
      confidence,
      ai_extracted_info: parsed.ai_extracted_info || (documentExtractedInfo ? documentExtractedInfo.substring(0, 300) : null),
      alternatives: parsed.alternatives,
    });
  } catch (err) {
    console.error("Classify error:", err);
    return errorResponse(req, "Erreur interne lors de la classification", 500);
  }
});
