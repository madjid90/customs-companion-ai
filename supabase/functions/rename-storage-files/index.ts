// Edge Function to rename files in storage to match their actual chapter content
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { dryRun = true } = await req.json().catch(() => ({ dryRun: true }));

    console.log(`Starting file rename operation (dryRun: ${dryRun})`);

    // Get all unique PDF documents (latest version of each chapter)
    const { data: pdfs, error: fetchError } = await supabase
      .from("pdf_documents")
      .select("id, title, file_name, file_path, category")
      .eq("is_active", true)
      .eq("category", "tarif")
      .order("created_at", { ascending: false });

    if (fetchError) throw fetchError;

    const results: { id: string; title: string; oldPath: string; newPath: string; status: string }[] = [];
    const processedChapters = new Set<string>();

    for (const pdf of pdfs || []) {
      // Skip if we already processed this chapter (keep only latest)
      if (processedChapters.has(pdf.title)) {
        continue;
      }
      processedChapters.add(pdf.title);

      // Extract chapter number from title (e.g., "Chapitre SH 83" -> "83")
      const chapterMatch = pdf.title.match(/(?:Chapitre\s+)?SH\s*(?:CODE\s+)?(\d+)/i);
      if (!chapterMatch) {
        results.push({
          id: pdf.id,
          title: pdf.title,
          oldPath: pdf.file_path,
          newPath: "",
          status: "skipped - no chapter number found",
        });
        continue;
      }

      const chapterNum = chapterMatch[1].padStart(2, "0");
      const expectedFileName = `SH_CODE_${chapterNum}.pdf`;
      
      // Check if file already has correct name
      if (pdf.file_path.includes(expectedFileName) || pdf.file_path.endsWith(`SH CODE ${chapterNum}.pdf`)) {
        results.push({
          id: pdf.id,
          title: pdf.title,
          oldPath: pdf.file_path,
          newPath: pdf.file_path,
          status: "already correct",
        });
        continue;
      }

      const newPath = `tarifs/${expectedFileName}`;

      if (dryRun) {
        results.push({
          id: pdf.id,
          title: pdf.title,
          oldPath: pdf.file_path,
          newPath: newPath,
          status: "would rename",
        });
      } else {
        try {
          // Download the file from old location
          const { data: fileData, error: downloadError } = await supabase.storage
            .from("pdf-documents")
            .download(pdf.file_path);

          if (downloadError) {
            console.error(`Download error for ${pdf.file_path}:`, downloadError);
            results.push({
              id: pdf.id,
              title: pdf.title,
              oldPath: pdf.file_path,
              newPath: newPath,
              status: `error downloading: ${downloadError.message}`,
            });
            continue;
          }

          // Upload to new location
          const { error: uploadError } = await supabase.storage
            .from("pdf-documents")
            .upload(newPath, fileData, {
              contentType: "application/pdf",
              upsert: true,
            });

          if (uploadError) {
            console.error(`Upload error for ${newPath}:`, uploadError);
            results.push({
              id: pdf.id,
              title: pdf.title,
              oldPath: pdf.file_path,
              newPath: newPath,
              status: `error uploading: ${uploadError.message}`,
            });
            continue;
          }

          // Update database record
          const { error: updateError } = await supabase
            .from("pdf_documents")
            .update({
              file_path: newPath,
              file_name: expectedFileName,
            })
            .eq("id", pdf.id);

          if (updateError) {
            console.error(`Update error for ${pdf.id}:`, updateError);
            results.push({
              id: pdf.id,
              title: pdf.title,
              oldPath: pdf.file_path,
              newPath: newPath,
              status: `error updating db: ${updateError.message}`,
            });
            continue;
          }

          // Delete old file
          const { error: deleteError } = await supabase.storage
            .from("pdf-documents")
            .remove([pdf.file_path]);

          if (deleteError) {
            console.warn(`Warning: Could not delete old file ${pdf.file_path}:`, deleteError);
          }

          results.push({
            id: pdf.id,
            title: pdf.title,
            oldPath: pdf.file_path,
            newPath: newPath,
            status: "renamed successfully",
          });

          console.log(`Renamed: ${pdf.file_path} -> ${newPath}`);
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          results.push({
            id: pdf.id,
            title: pdf.title,
            oldPath: pdf.file_path,
            newPath: newPath,
            status: `error: ${errorMessage}`,
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
      JSON.stringify({
        success: true,
        dryRun,
        summary,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error in rename-storage-files:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
