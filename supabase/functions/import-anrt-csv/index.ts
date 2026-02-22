import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreFlight(req);
  const corsHeaders = getCorsHeaders(req);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json();
    const { rows } = body;

    if (!rows?.length) {
      return new Response(JSON.stringify({ error: "rows[] required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Inserting ${rows.length} rows...`);

    const BATCH = 500;
    let inserted = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await supabase
        .from("anrt_approved_equipment")
        .insert(batch);

      if (error) {
        console.error(`Batch ${Math.floor(i / BATCH) + 1} error:`, error.message);
        errors++;
      } else {
        inserted += batch.length;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total: rows.length,
      inserted,
      batch_errors: errors,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Import error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
