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
    const body = await req.json().catch(() => ({}));

    let rowsToInsert: Record<string, unknown>[] = [];

    if (body.rows && Array.isArray(body.rows)) {
      // Direct rows from client-side XLSX parsing
      rowsToInsert = body.rows.filter((r: any) => r.designation);
      console.log(`Received ${rowsToInsert.length} rows directly`);
    } else if (body.csv_url) {
      // Fetch and parse CSV
      console.log("Fetching CSV from:", body.csv_url);
      const csvResp = await fetch(body.csv_url);
      if (!csvResp.ok) throw new Error(`Failed to fetch CSV: ${csvResp.status}`);
      const csvText = await csvResp.text();

      const lines = csvText.split("\n").filter(l => l.trim());
      const headers = parseCSVLine(lines[0]);
      console.log(`Headers: ${headers.join(", ")}, Total lines: ${lines.length - 1}`);

      for (let j = 1; j < lines.length; j++) {
        const values = parseCSVLine(lines[j]);
        if (values.length < 6) continue;

        const row: Record<string, unknown> = {};
        for (let k = 0; k < headers.length; k++) {
          const h = headers[k];
          let v: unknown = values[k] || null;
          if (h === "is_active") v = (values[k] || "true").toLowerCase() === "true";
          if (v === "") v = null;
          row[h] = v;
        }
        if (!row.designation) continue;
        rowsToInsert.push(row);
      }
    } else {
      return new Response(JSON.stringify({ error: "csv_url or rows required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clear existing data only on first batch
    if (!body.skip_delete) {
      const { error: deleteError } = await supabase
        .from("anrt_approved_equipment")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      if (deleteError) console.warn("Delete warning:", deleteError.message);
    }

    const BATCH = 500;
    let inserted = 0;
    let errors = 0;

    for (let i = 0; i < rowsToInsert.length; i += BATCH) {
      const batch = rowsToInsert.slice(i, i + BATCH).map(r => {
        const brandNorm = (r.brand as string)?.toUpperCase().trim() || null;
        const searchText = [r.designation, r.brand, r.model, r.type_ref, r.approval_number]
          .filter(Boolean).join(" ");
        return { ...r, brand_normalized: brandNorm, search_text: searchText };
      });

      if (batch.length === 0) continue;

      const { error } = await supabase.from("anrt_approved_equipment").insert(batch);
      if (error) {
        console.error(`Batch error at ${i}:`, error.message);
        errors++;
      } else {
        inserted += batch.length;
        if (inserted % 5000 === 0) console.log(`Progress: ${inserted}`);
      }
    }

    console.log(`Done: ${inserted} inserted, ${errors} batch errors`);

    return new Response(JSON.stringify({
      success: true, total: rowsToInsert.length, inserted, batch_errors: errors,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("Import error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
