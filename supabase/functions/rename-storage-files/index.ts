// Edge Function to rename files in storage to match their actual chapter content
// Uses country_tariffs as source of truth for chapter detection
import { createClient } from "npm:@supabase/supabase-js@2";

import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth-check.ts";

interface PDFRecord {
  id: string;
  title: string;
  file_name: string;
  file_path: string;
  category: string;
}

// Detect actual chapter from country_tariffs data
async function detectChapterFromTariffs(
  supabase: ReturnType<typeof createClient>,
  filePath: string
): Promise<number | null> {
  const { data, error } = await supabase
    .from("country_tariffs")
    .select("national_code")
    .eq("source_pdf", filePath)
    .eq("is_active", true)
    .limit(50);

  if (error || !data || data.length === 0) return null;

  // Count chapter prefixes
  const chapterCounts: Record<number, number> = {};
  for (const row of data) {
    const prefix = parseInt(row.national_code?.substring(0, 2) || "0", 10);
    if (prefix >= 1 && prefix <= 99) {
      chapterCounts[prefix] = (chapterCounts[prefix] || 0) + 1;
    }
  }

  // Find dominant chapter
  let maxCount = 0;
  let dominant: number | null = null;
  for (const [ch, count] of Object.entries(chapterCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominant = parseInt(ch, 10);
    }
  }

  return maxCount >= 2 ? dominant : null;
}

// Detect chapter from pdf_extractions mentioned_hs_codes
async function detectChapterFromExtractions(
  supabase: ReturnType<typeof createClient>,
  pdfId: string
): Promise<number | null> {
  const { data } = await supabase
    .from("pdf_extractions")
    .select("mentioned_hs_codes")
    .eq("pdf_id", pdfId)
    .limit(1);

  const hsCodes = (data?.[0]?.mentioned_hs_codes as string[] | null) || [];
  if (hsCodes.length === 0) return null;

  const chapterCounts: Record<number, number> = {};
  for (const code of hsCodes) {
    const clean = code.replace(/[^0-9]/g, "");
    if (clean.length >= 2) {
      const ch = parseInt(clean.substring(0, 2), 10);
      if (ch >= 1 && ch <= 99) {
        chapterCounts[ch] = (chapterCounts[ch] || 0) + 1;
      }
    }
  }

  let maxCount = 0;
  let dominant: number | null = null;
  for (const [ch, count] of Object.entries(chapterCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominant = parseInt(ch, 10);
    }
  }

  return maxCount >= 3 ? dominant : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }

  const corsHeaders = getCorsHeaders(req);
  const { error: authError } = await requireAuth(req, corsHeaders, true);
  if (authError) return authError;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { dryRun = true } = await req.json().catch(() => ({ dryRun: true }));

    console.log(`Starting file rename operation (dryRun: ${dryRun})`);

    // Fetch all active tariff PDFs
    const { data: pdfs, error: fetchError } = await supabase
      .from("pdf_documents")
      .select("id, title, file_name, file_path, category")
      .eq("is_active", true)
      .eq("category", "tarif")
      .order("created_at", { ascending: false });

    if (fetchError) throw fetchError;

    const results: {
      id: string;
      title: string;
      oldPath: string;
      newPath: string;
      detectedChapter: number | null;
      detectionMethod: string;
      status: string;
    }[] = [];

    const processedChapters = new Set<number>();

    for (const pdf of (pdfs as PDFRecord[]) || []) {
      // 1. Try country_tariffs first (most reliable)
      let chapter = await detectChapterFromTariffs(supabase, pdf.file_path);
      let method = "country_tariffs";

      // 2. Fallback: pdf_extractions mentioned_hs_codes
      if (!chapter) {
        chapter = await detectChapterFromExtractions(supabase, pdf.id);
        method = "pdf_extractions";
      }

      // 3. Fallback: title parsing
      if (!chapter) {
        const match = pdf.title.match(/(?:Chapitre\s*)?(\d+)/i);
        if (match) {
          const parsed = parseInt(match[1], 10);
          if (parsed >= 1 && parsed <= 99) {
            chapter = parsed;
            method = "title_fallback";
          }
        }
      }

      if (!chapter) {
        results.push({
          id: pdf.id,
          title: pdf.title,
          oldPath: pdf.file_path,
          newPath: "",
          detectedChapter: null,
          detectionMethod: "none",
          status: "skipped - impossible de détecter le chapitre",
        });
        continue;
      }

      // Skip duplicates (keep most recent)
      if (processedChapters.has(chapter)) {
        results.push({
          id: pdf.id,
          title: pdf.title,
          oldPath: pdf.file_path,
          newPath: "",
          detectedChapter: chapter,
          detectionMethod: method,
          status: "skipped - doublon (version plus récente existe)",
        });
        continue;
      }
      processedChapters.add(chapter);

      const padded = String(chapter).padStart(2, "0");
      const expectedFileName = `SH_CODE_${padded}.pdf`;
      const newPath = `tarifs/${expectedFileName}`;
      const newTitle = `Chapitre ${padded} - Tarif douanier SH`;

      // Already correct?
      if (pdf.file_path === newPath) {
        results.push({
          id: pdf.id,
          title: pdf.title,
          oldPath: pdf.file_path,
          newPath,
          detectedChapter: chapter,
          detectionMethod: method,
          status: "already correct",
        });
        continue;
      }

      if (dryRun) {
        results.push({
          id: pdf.id,
          title: pdf.title,
          oldPath: pdf.file_path,
          newPath,
          detectedChapter: chapter,
          detectionMethod: method,
          status: "would rename",
        });
      } else {
        try {
          // 1. Download source file
          const { data: fileData, error: downloadError } = await supabase.storage
            .from("pdf-documents")
            .download(pdf.file_path);

          if (downloadError) {
            results.push({
              id: pdf.id, title: pdf.title, oldPath: pdf.file_path, newPath,
              detectedChapter: chapter, detectionMethod: method,
              status: `error downloading: ${downloadError.message}`,
            });
            continue;
          }

          // 2. Upload to new path
          const { error: uploadError } = await supabase.storage
            .from("pdf-documents")
            .upload(newPath, fileData, { contentType: "application/pdf", upsert: true });

          if (uploadError) {
            results.push({
              id: pdf.id, title: pdf.title, oldPath: pdf.file_path, newPath,
              detectedChapter: chapter, detectionMethod: method,
              status: `error uploading: ${uploadError.message}`,
            });
            continue;
          }

          // 3. Update pdf_documents record
          const { error: updateError } = await supabase
            .from("pdf_documents")
            .update({ file_path: newPath, file_name: expectedFileName, title: newTitle })
            .eq("id", pdf.id);

          if (updateError) {
            results.push({
              id: pdf.id, title: pdf.title, oldPath: pdf.file_path, newPath,
              detectedChapter: chapter, detectionMethod: method,
              status: `error updating pdf_documents: ${updateError.message}`,
            });
            continue;
          }

          // 4. Update country_tariffs.source_pdf
          const { error: tariffError } = await supabase
            .from("country_tariffs")
            .update({ source_pdf: newPath })
            .eq("source_pdf", pdf.file_path);

          if (tariffError) {
            console.warn(`Warning: Could not update country_tariffs for ${pdf.file_path}:`, tariffError);
          }

          // 5. Delete old file
          if (pdf.file_path !== newPath) {
            const { error: deleteError } = await supabase.storage
              .from("pdf-documents")
              .remove([pdf.file_path]);
            if (deleteError) {
              console.warn(`Warning: Could not delete old file ${pdf.file_path}:`, deleteError);
            }
          }

          results.push({
            id: pdf.id, title: pdf.title, oldPath: pdf.file_path, newPath,
            detectedChapter: chapter, detectionMethod: method,
            status: "renamed successfully",
          });
          console.log(`✅ Renamed: ${pdf.file_path} -> ${newPath} (Chapter ${chapter}, via ${method})`);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({
            id: pdf.id, title: pdf.title, oldPath: pdf.file_path, newPath,
            detectedChapter: chapter, detectionMethod: method,
            status: `error: ${msg}`,
          });
        }
      }
    }

    const summary = {
      total: results.length,
      wouldRename: results.filter((r) => r.status === "would rename").length,
      renamed: results.filter((r) => r.status === "renamed successfully").length,
      alreadyCorrect: results.filter((r) => r.status === "already correct").length,
      errors: results.filter((r) => r.status.startsWith("error")).length,
      skipped: results.filter((r) => r.status.startsWith("skipped")).length,
    };

    return new Response(
      JSON.stringify({ success: true, dryRun, summary, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Error in rename-storage-files:", error);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
