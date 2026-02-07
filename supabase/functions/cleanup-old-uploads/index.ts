// Edge Function to delete old files from uploads/ folder
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }

  const corsHeaders = getCorsHeaders(req);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { dryRun = true } = await req.json().catch(() => ({ dryRun: true }));

    console.log(`Starting cleanup of uploads/ folder (dryRun: ${dryRun})`);

    // List all files in uploads/ folder
    const { data: files, error: listError } = await supabase.storage
      .from("pdf-documents")
      .list("uploads", { limit: 1000 });

    if (listError) throw listError;

    if (!files || files.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No files found in uploads/ folder",
          deletedCount: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const filePaths = files
      .filter(f => f.name && !f.name.startsWith("."))
      .map(f => `uploads/${f.name}`);

    console.log(`Found ${filePaths.length} files to delete`);

    if (dryRun) {
      return new Response(
        JSON.stringify({
          success: true,
          dryRun: true,
          message: `Would delete ${filePaths.length} files`,
          files: filePaths,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Delete files in batches of 100
    const batchSize = 100;
    let deletedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < filePaths.length; i += batchSize) {
      const batch = filePaths.slice(i, i + batchSize);
      const { error: deleteError } = await supabase.storage
        .from("pdf-documents")
        .remove(batch);

      if (deleteError) {
        console.error(`Error deleting batch ${i / batchSize + 1}:`, deleteError);
        errors.push(`Batch ${i / batchSize + 1}: ${deleteError.message}`);
      } else {
        deletedCount += batch.length;
        console.log(`Deleted batch ${i / batchSize + 1}: ${batch.length} files`);
      }
    }

    return new Response(
      JSON.stringify({
        success: errors.length === 0,
        dryRun: false,
        deletedCount,
        totalFiles: filePaths.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error in cleanup-old-uploads:", error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});