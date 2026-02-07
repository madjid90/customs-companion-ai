// ============================================================================
// EDGE FUNCTION: ANSWER WITH VERIFIED DB SOURCES
// ============================================================================
// Generates AI responses with 100% verifiable sources from database
// ============================================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ============================================================================
// CORS & CONFIG
// ============================================================================

import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ============================================================================
// TYPES
// ============================================================================

interface AnswerRequest {
  question: string;
  national_code?: string;
  hs_code?: string;
  country_code?: string;
}

interface SourceTariff {
  kind: "country_tariffs";
  key: { country_code: string; national_code: string };
  pdf: string | null;
  page: number | null;
  evidence: string | null;
  description: string | null;
  duty_rate: number | null;
}

interface SourceNote {
  kind: "tariff_notes";
  id: number;
  pdf: string | null;
  page: number | null;
  excerpt: string;
  note_type: string;
}

interface SourceLegal {
  kind: "legal_sources";
  id: number;
  source_type: string;
  source_ref: string;
  issuer: string | null;
  excerpt: string | null;
}

interface SourceEvidence {
  kind: "hs_evidence";
  id: number;
  national_code: string;
  evidence_text: string;
  confidence: string | null;
}

type VerifiedSource = SourceTariff | SourceNote | SourceLegal | SourceEvidence;

interface AnswerResponse {
  success: boolean;
  answer: string;
  sources: VerifiedSource[];
  sources_validated: boolean;
  validation_warnings: string[];
  context_used: {
    tariffs_count: number;
    notes_count: number;
    legal_sources_count: number;
    evidence_count: number;
  };
}

// ============================================================================
// DATABASE CONTEXT FETCHING
// ============================================================================

interface DBContext {
  tariffs: any[];
  notes: any[];
  legalSources: any[];
  evidence: any[];
}

async function fetchDBContext(
  supabase: any,
  question: string,
  nationalCode?: string,
  hsCode?: string,
  countryCode: string = "MA"
): Promise<DBContext> {
  const context: DBContext = {
    tariffs: [],
    notes: [],
    legalSources: [],
    evidence: [],
  };

  // Clean codes
  const cleanNational = nationalCode?.replace(/\D/g, "") || "";
  const cleanHs = hsCode?.replace(/\D/g, "") || cleanNational.slice(0, 6);
  const chapter = cleanHs.slice(0, 2);

  // 1. Fetch country_tariffs
  if (cleanNational.length >= 6) {
    const { data: tariffs } = await supabase
      .from("country_tariffs")
      .select("*")
      .eq("country_code", countryCode)
      .eq("is_active", true)
      .or(`national_code.eq.${cleanNational},national_code.like.${cleanNational.slice(0, 6)}%`)
      .limit(20);

    if (tariffs) context.tariffs = tariffs;
  } else if (cleanHs.length >= 4) {
    const { data: tariffs } = await supabase
      .from("country_tariffs")
      .select("*")
      .eq("country_code", countryCode)
      .eq("is_active", true)
      .like("hs_code_6", `${cleanHs}%`)
      .limit(20);

    if (tariffs) context.tariffs = tariffs;
  }

  // 2. Fetch tariff_notes for chapter
  if (chapter.length === 2) {
    const { data: notes } = await supabase
      .from("tariff_notes")
      .select("*")
      .eq("country_code", countryCode)
      .or(`chapter_number.eq.${chapter},chapter_number.is.null`)
      .limit(30);

    if (notes) context.notes = notes;
  }

  // 3. Fetch legal_sources (recent and relevant)
  const { data: legalSources } = await supabase
    .from("legal_sources")
    .select("*")
    .eq("country_code", countryCode)
    .order("created_at", { ascending: false })
    .limit(15);

  if (legalSources) context.legalSources = legalSources;

  // 4. Fetch hs_evidence for the code
  if (cleanNational.length >= 6) {
    const { data: evidence } = await supabase
      .from("hs_evidence")
      .select("*, legal_sources(*)")
      .eq("country_code", countryCode)
      .or(`national_code.eq.${cleanNational},national_code.like.${cleanNational.slice(0, 6)}%`)
      .limit(20);

    if (evidence) context.evidence = evidence;
  }

  return context;
}

// ============================================================================
// AI PROMPT CONSTRUCTION
// ============================================================================

function buildContextPrompt(context: DBContext): string {
  let prompt = "## SOURCES DISPONIBLES (OBLIGATOIRES)\n\n";
  prompt += "Tu ne peux citer QUE les sources listées ci-dessous. Chaque citation doit inclure l'identifiant exact.\n\n";

  // Tariffs
  if (context.tariffs.length > 0) {
    prompt += "### TARIFS DOUANIERS (country_tariffs)\n";
    context.tariffs.forEach((t) => {
      prompt += `- [TARIFF:${t.country_code}:${t.national_code}] Code: ${t.national_code}, `;
      prompt += `Description: ${t.description_local || "N/A"}, `;
      prompt += `DDI: ${t.duty_rate ?? "N/A"}%, TVA: ${t.vat_rate ?? 20}%`;
      if (t.source_pdf) prompt += `, Source: ${t.source_pdf} p.${t.source_page || "?"}`;
      if (t.source_evidence) prompt += `, Evidence: "${t.source_evidence}"`;
      prompt += "\n";
    });
    prompt += "\n";
  }

  // Notes
  if (context.notes.length > 0) {
    prompt += "### NOTES TARIFAIRES (tariff_notes)\n";
    context.notes.forEach((n) => {
      const excerpt = (n.note_text || "").slice(0, 200);
      prompt += `- [NOTE:${n.id}] Type: ${n.note_type}, Chapitre: ${n.chapter_number || "général"}, `;
      prompt += `Texte: "${excerpt}..."`;
      if (n.source_pdf) prompt += `, Source: ${n.source_pdf} p.${n.page_number || "?"}`;
      prompt += "\n";
    });
    prompt += "\n";
  }

  // Legal sources
  if (context.legalSources.length > 0) {
    prompt += "### SOURCES LÉGALES (legal_sources)\n";
    context.legalSources.forEach((l) => {
      prompt += `- [LEGAL:${l.id}] Type: ${l.source_type}, Ref: ${l.source_ref}`;
      if (l.issuer) prompt += `, Émetteur: ${l.issuer}`;
      if (l.title) prompt += `, Titre: ${l.title}`;
      if (l.excerpt) prompt += `, Extrait: "${l.excerpt.slice(0, 150)}..."`;
      prompt += "\n";
    });
    prompt += "\n";
  }

  // Evidence
  if (context.evidence.length > 0) {
    prompt += "### PREUVES HS (hs_evidence)\n";
    context.evidence.forEach((e) => {
      prompt += `- [EVIDENCE:${e.id}] Code: ${e.national_code}, `;
      prompt += `Texte: "${(e.evidence_text || "").slice(0, 150)}..."`;
      if (e.confidence) prompt += `, Confiance: ${e.confidence}`;
      prompt += "\n";
    });
    prompt += "\n";
  }

  if (context.tariffs.length === 0 && context.notes.length === 0 && 
      context.legalSources.length === 0 && context.evidence.length === 0) {
    prompt += "⚠️ AUCUNE SOURCE DISPONIBLE DANS LA BASE.\n";
    prompt += "Tu DOIS répondre: 'Source indisponible dans la base interne.'\n\n";
  }

  return prompt;
}

function buildSystemPrompt(context: DBContext, questionLanguage: 'ar' | 'fr' = 'fr'): string {
  const contextPrompt = buildContextPrompt(context);

  const langInstruction = questionLanguage === 'ar' 
    ? `## لغة الإجابة
أجب باللغة العربية. استخدم المصطلحات التقنية (رموز SH، DDI، TVA) كما هي أو مترجمة حسب السياق.`
    : `## LANGUE DE RÉPONSE
Réponds en français. Utilise les termes techniques (codes SH, DDI, TVA) tels quels.`;

  return `Tu es un expert douanier marocain. Tu réponds UNIQUEMENT en utilisant les sources fournies.

${langInstruction}

${contextPrompt}

## RÈGLES STRICTES

1. **Citations obligatoires** : Chaque affirmation doit être liée à une source via son identifiant exact.
2. **Format des citations** : Utilise [TARIFF:MA:XXXXXXXXXX], [NOTE:123], [LEGAL:77], [EVIDENCE:45]
3. **Pas d'invention** : Si l'information n'est pas dans les sources, dis "Information non disponible dans la base" / "المعلومات غير متوفرة في قاعدة البيانات".
4. **JSON strict** : Ta réponse doit être un JSON valide avec:
   - "answer": texte de la réponse avec citations inline
   - "cited_sources": tableau des identifiants cités

## FORMAT DE RÉPONSE

\`\`\`json
{
  "answer": "Le code 8903110000 est soumis à un DDI de 2,5% [TARIFF:MA:8903110000]. Selon la note de chapitre [NOTE:42], les bateaux de plaisance...",
  "cited_sources": [
    {"kind": "country_tariffs", "key": {"country_code": "MA", "national_code": "8903110000"}},
    {"kind": "tariff_notes", "id": 42},
    {"kind": "legal_sources", "id": 77}
  ]
}
\`\`\`

Si aucune source n'est disponible, réponds:
\`\`\`json
{
  "answer": "${questionLanguage === 'ar' ? 'المصدر غير متوفر في قاعدة البيانات الداخلية.' : 'Source indisponible dans la base interne.'}",
  "cited_sources": []
}
\`\`\``;
}

/**
 * Détecte la langue d'une question (arabe ou français)
 */
function detectQuestionLanguage(text: string): 'ar' | 'fr' {
  const arabicPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
  const arabicChars = (text.match(arabicPattern) || []).length;
  const totalChars = text.replace(/\s/g, '').length;
  
  return totalChars > 0 && arabicChars / totalChars > 0.3 ? 'ar' : 'fr';
}

// ============================================================================
// AI CALL
// ============================================================================

async function callClaudeForAnswer(
  systemPrompt: string,
  question: string
): Promise<{ answer: string; cited_sources: any[] }> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Question: ${question}\n\nRéponds en JSON strict avec les sources vérifiées.`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || "";

  // Extract JSON from response
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || 
                    content.match(/\{[\s\S]*"answer"[\s\S]*\}/);
  
  if (!jsonMatch) {
    console.warn("No JSON found in AI response, using raw text");
    return {
      answer: content,
      cited_sources: [],
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    return {
      answer: parsed.answer || content,
      cited_sources: parsed.cited_sources || [],
    };
  } catch (e) {
    console.warn("Failed to parse AI JSON:", e);
    return {
      answer: content,
      cited_sources: [],
    };
  }
}

// ============================================================================
// SOURCE VALIDATION
// ============================================================================

async function validateSources(
  supabase: any,
  citedSources: any[],
  context: DBContext,
  countryCode: string
): Promise<{ verified: VerifiedSource[]; warnings: string[] }> {
  const verified: VerifiedSource[] = [];
  const warnings: string[] = [];

  for (const source of citedSources) {
    try {
      if (source.kind === "country_tariffs" && source.key) {
        // Validate tariff exists
        const tariff = context.tariffs.find(
          (t) => t.country_code === source.key.country_code && 
                 t.national_code === source.key.national_code
        );
        
        if (tariff) {
          verified.push({
            kind: "country_tariffs",
            key: { country_code: tariff.country_code, national_code: tariff.national_code },
            pdf: tariff.source_pdf,
            page: tariff.source_page,
            evidence: tariff.source_evidence,
            description: tariff.description_local,
            duty_rate: tariff.duty_rate,
          });
        } else {
          warnings.push(`Tariff not found: ${source.key.country_code}:${source.key.national_code}`);
        }
      } else if (source.kind === "tariff_notes" && source.id) {
        // Validate note exists
        const note = context.notes.find((n) => n.id === source.id);
        
        if (note) {
          verified.push({
            kind: "tariff_notes",
            id: note.id,
            pdf: note.source_pdf,
            page: note.page_number,
            excerpt: (note.note_text || "").slice(0, 300),
            note_type: note.note_type,
          });
        } else {
          // Try to fetch from DB directly
          const { data: dbNote } = await supabase
            .from("tariff_notes")
            .select("*")
            .eq("id", source.id)
            .single();

          if (dbNote) {
            verified.push({
              kind: "tariff_notes",
              id: dbNote.id,
              pdf: dbNote.source_pdf,
              page: dbNote.page_number,
              excerpt: (dbNote.note_text || "").slice(0, 300),
              note_type: dbNote.note_type,
            });
          } else {
            warnings.push(`Note not found: ${source.id}`);
          }
        }
      } else if (source.kind === "legal_sources" && source.id) {
        // Validate legal source exists
        const legal = context.legalSources.find((l) => l.id === source.id);
        
        if (legal) {
          verified.push({
            kind: "legal_sources",
            id: legal.id,
            source_type: legal.source_type,
            source_ref: legal.source_ref,
            issuer: legal.issuer,
            excerpt: legal.excerpt,
          });
        } else {
          const { data: dbLegal } = await supabase
            .from("legal_sources")
            .select("*")
            .eq("id", source.id)
            .single();

          if (dbLegal) {
            verified.push({
              kind: "legal_sources",
              id: dbLegal.id,
              source_type: dbLegal.source_type,
              source_ref: dbLegal.source_ref,
              issuer: dbLegal.issuer,
              excerpt: dbLegal.excerpt,
            });
          } else {
            warnings.push(`Legal source not found: ${source.id}`);
          }
        }
      } else if (source.kind === "hs_evidence" && source.id) {
        // Validate evidence exists
        const ev = context.evidence.find((e) => e.id === source.id);
        
        if (ev) {
          verified.push({
            kind: "hs_evidence",
            id: ev.id,
            national_code: ev.national_code,
            evidence_text: ev.evidence_text,
            confidence: ev.confidence,
          });
        } else {
          const { data: dbEvidence } = await supabase
            .from("hs_evidence")
            .select("*")
            .eq("id", source.id)
            .single();

          if (dbEvidence) {
            verified.push({
              kind: "hs_evidence",
              id: dbEvidence.id,
              national_code: dbEvidence.national_code,
              evidence_text: dbEvidence.evidence_text,
              confidence: dbEvidence.confidence,
            });
          } else {
            warnings.push(`Evidence not found: ${source.id}`);
          }
        }
      } else {
        warnings.push(`Unknown source kind: ${JSON.stringify(source)}`);
      }
    } catch (e) {
      warnings.push(`Validation error for source: ${JSON.stringify(source)} - ${e}`);
    }
  }

  return { verified, warnings };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }

  const corsHeaders = getCorsHeaders(req);

  const startTime = Date.now();

  try {
    // Parse request
    const body: AnswerRequest = await req.json();
    const { question, national_code, hs_code, country_code = "MA" } = body;

    if (!question || question.trim().length < 3) {
      return new Response(
        JSON.stringify({ success: false, error: "Question requise (min 3 caractères)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[answer-with-sources] Question: "${question.slice(0, 100)}...", code: ${national_code || hs_code || "none"}`);

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch DB context
    const context = await fetchDBContext(supabase, question, national_code, hs_code, country_code);
    console.log(`[answer-with-sources] Context: ${context.tariffs.length} tariffs, ${context.notes.length} notes, ${context.legalSources.length} legal, ${context.evidence.length} evidence`);

    // Detect question language
    const questionLanguage = detectQuestionLanguage(question);
    console.log(`[answer-with-sources] Language detected: ${questionLanguage}`);

    // 2. Build prompt and call AI
    const systemPrompt = buildSystemPrompt(context, questionLanguage);
    const { answer, cited_sources } = await callClaudeForAnswer(systemPrompt, question);

    // 3. Validate all cited sources against DB
    const { verified, warnings } = await validateSources(supabase, cited_sources, context, country_code);
    console.log(`[answer-with-sources] Validated ${verified.length}/${cited_sources.length} sources, ${warnings.length} warnings`);

    // 4. Build response
    const response: AnswerResponse = {
      success: true,
      answer,
      sources: verified,
      sources_validated: warnings.length === 0,
      validation_warnings: warnings,
      context_used: {
        tariffs_count: context.tariffs.length,
        notes_count: context.notes.length,
        legal_sources_count: context.legalSources.length,
        evidence_count: context.evidence.length,
      },
    };

    const duration = Date.now() - startTime;
    console.log(`[answer-with-sources] Completed in ${duration}ms`);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[answer-with-sources] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Erreur interne",
        answer: "Une erreur s'est produite lors de la génération de la réponse.",
        sources: [],
        sources_validated: false,
        validation_warnings: [],
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
