import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current.trim()); current = ""; }
      else { current += ch; }
    }
  }
  result.push(current.trim());
  return result;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreFlight(req);
  const corsHeaders = getCorsHeaders(req);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch CSV from the app's public URL
    const body = await req.json().catch(() => ({}));
    const csvUrl = body.csv_url;
    if (!csvUrl) {
      return new Response(JSON.stringify({ error: "csv_url required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Fetching CSV from:", csvUrl);
    const csvResp = await fetch(csvUrl);
    if (!csvResp.ok) throw new Error(`Failed to fetch CSV: ${csvResp.status}`);
    const csvText = await csvResp.text();

    const lines = csvText.split("\n").filter(l => l.trim());
    const headers = parseCSVLine(lines[0]);
    console.log(`Headers: ${headers.join(", ")}`);
    console.log(`Total data lines: ${lines.length - 1}`);

    // Clear existing data first
    const { error: deleteError } = await supabase
      .from("anrt_approved_equipment")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (deleteError) console.warn("Delete warning:", deleteError.message);

    const BATCH = 500;
    let inserted = 0;
    let errors = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i += BATCH) {
      const batch: Record<string, unknown>[] = [];
      const end = Math.min(i + BATCH, lines.length);

      for (let j = i; j < end; j++) {
        const values = parseCSVLine(lines[j]);
        if (values.length < 6) { skipped++; continue; }

        const row: Record<string, unknown> = {};
        for (let k = 0; k < headers.length; k++) {
          const h = headers[k];
          let v: unknown = values[k] || null;
          if (h === "is_active") v = (values[k] || "true").toLowerCase() === "true";
          if (v === "") v = null;
          row[h] = v;
        }
        // Ensure required field
        if (!row.designation) { skipped++; continue; }
        batch.push(row);
      }

      if (batch.length === 0) continue;

      const { error } = await supabase
        .from("anrt_approved_equipment")
        .insert(batch);

      if (error) {
        console.error(`Batch ${Math.floor((i - 1) / BATCH) + 1} error:`, error.message);
        errors++;
      } else {
        inserted += batch.length;
        if (inserted % 5000 === 0) console.log(`Progress: ${inserted} inserted`);
      }
    }

    console.log(`Done: ${inserted} inserted, ${errors} batch errors, ${skipped} skipped`);

    return new Response(JSON.stringify({
      success: true,
      total_lines: lines.length - 1,
      inserted,
      batch_errors: errors,
      skipped,
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
