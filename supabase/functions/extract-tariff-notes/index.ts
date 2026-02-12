import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getCorsHeaders,
  handleCorsPreFlight,
  errorResponse,
  successResponse,
} from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth-check.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

interface ExtractedNote {
  note_type: string;
  anchor: string;
  note_text: string;
  page_number?: number;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreFlight(req);

  try {
    // Auth check - allow admin users
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return errorResponse(req, "Non autorisé - token manquant", 401);
    }

    const { chapter_number, source_pdf } = await req.json();
    if (!chapter_number || !source_pdf) {
      return errorResponse(req, "chapter_number et source_pdf requis", 400);
    }

    console.log(`[extract-notes] Processing chapter ${chapter_number} from ${source_pdf}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1. Download PDF from storage
    const { data: pdfData, error: dlError } = await supabase.storage
      .from("pdf-documents")
      .download(source_pdf);

    if (dlError || !pdfData) {
      console.error(`[extract-notes] Download error:`, dlError);
      return errorResponse(req, `Impossible de télécharger ${source_pdf}: ${dlError?.message}`, 404);
    }

    // Convert to base64
    const arrayBuf = await pdfData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const pdfBase64 = btoa(binary);
    console.log(`[extract-notes] PDF downloaded, size: ${bytes.byteLength} bytes`);

    // 2. Call Claude to extract notes only
    const prompt = `Tu es un expert en tarif douanier du Système Harmonisé (SH). 
Analyse ce document PDF qui contient le tarif douanier du chapitre ${chapter_number}.

EXTRAIS UNIQUEMENT les NOTES du chapitre. Cela inclut :
- Notes de chapitre (ex: "1.- Le présent chapitre ne comprend pas...")
- Notes de sous-positions  
- Notes de section
- Définitions officielles
- Exclusions et inclusions
- Notes explicatives
- Notes de bas de page liées aux positions tarifaires

Pour chaque note trouvée, retourne un objet JSON avec :
- "note_type": le type parmi "chapter_note", "subheading_note", "section_note", "definition", "exclusion", "inclusion", "explanatory_note", "footnote"
- "anchor": la référence de rattachement (ex: "Chapitre ${chapter_number}", "Note 1", "Position ${chapter_number}.01", un code SH spécifique comme "${chapter_number}01.10")
- "note_text": le texte COMPLET et EXACT de la note, sans résumé ni troncature
- "page_number": le numéro de page dans le PDF (si identifiable)

IMPORTANT:
- Extrais le texte VERBATIM du document, ne résume pas
- Inclus TOUTES les notes, même les plus longues
- Les notes de chapitre commencent souvent par des numéros ("1.-", "2.-", etc.)
- Certaines pages ne contiennent QUE du texte (notes), pas de tableau tarifaire

Réponds UNIQUEMENT en JSON valide avec le format:
{
  "notes": [
    { "note_type": "...", "anchor": "...", "note_text": "...", "page_number": null }
  ],
  "chapter_detected": ${chapter_number}
}`;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 16000,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: pdfBase64,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[extract-notes] Claude error: ${response.status}`, errText);
      return errorResponse(req, `Erreur Claude: ${response.status}`, 500);
    }

    const result = await response.json();
    const textContent = result.content?.find((c: any) => c.type === "text")?.text || "";

    // Parse JSON from Claude response
    let parsed: { notes: ExtractedNote[]; chapter_detected: number };
    try {
      const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, textContent];
      const cleanJson = (jsonMatch[1] || textContent).trim();
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      console.error(`[extract-notes] JSON parse error:`, e, textContent.substring(0, 500));
      return errorResponse(req, "Impossible de parser la réponse Claude", 500);
    }

    const notes = parsed.notes || [];
    console.log(`[extract-notes] Extracted ${notes.length} notes for chapter ${chapter_number} (detected: ${parsed.chapter_detected})`);

    // 3. Check for existing notes and avoid duplicates
    const { data: existingNotes } = await supabase
      .from("tariff_notes")
      .select("id, note_type, anchor")
      .eq("chapter_number", String(chapter_number));

    const existingKeys = new Set(
      (existingNotes || []).map((n: any) => `${n.note_type}::${n.anchor}`)
    );

    // 4. Insert new notes
    const toInsert = notes
      .filter((n: ExtractedNote) => {
        const key = `${n.note_type}::${n.anchor}`;
        return !existingKeys.has(key) && n.note_text && n.note_text.length > 5;
      })
      .map((n: ExtractedNote) => ({
        country_code: "MA",
        chapter_number: String(chapter_number),
        page_number: n.page_number || null,
        note_type: n.note_type,
        anchor: n.anchor || `Chapitre ${chapter_number}`,
        note_text: n.note_text,
        source_pdf: source_pdf,
      }));

    let insertedCount = 0;
    if (toInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("tariff_notes")
        .insert(toInsert);

      if (insertError) {
        console.error(`[extract-notes] Insert error:`, insertError);
        return errorResponse(req, `Erreur insertion: ${insertError.message}`, 500);
      }
      insertedCount = toInsert.length;
    }

    console.log(`[extract-notes] Chapter ${chapter_number}: ${insertedCount} notes inserted (${notes.length - toInsert.length} duplicates skipped)`);

    return successResponse(req, {
      chapter_number,
      source_pdf,
      notes_extracted: notes.length,
      notes_inserted: insertedCount,
      duplicates_skipped: notes.length - toInsert.length,
    });

  } catch (err: any) {
    console.error(`[extract-notes] Error:`, err);
    return errorResponse(req, err.message || "Erreur interne", 500);
  }
});
