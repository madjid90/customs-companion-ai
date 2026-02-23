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
      else if (ch === ',' || ch === '\t' || ch === '|') { result.push(current.trim()); current = ""; }
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
    
    // Accept either raw rows or a CSV URL
    let rows: Array<{designation: string; brand?: string; type_model?: string; dispensation_number?: string}> = [];
    
    if (body.csv_url) {
      console.log("Fetching CSV from:", body.csv_url);
      const resp = await fetch(body.csv_url);
      if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status}`);
      const text = await resp.text();
      const lines = text.split("\n").filter(l => l.trim());
      
      // Skip header
      for (let i = 1; i < lines.length; i++) {
        const vals = parseCSVLine(lines[i]);
        if (vals.length < 1 || !vals[0]?.trim()) continue;
        rows.push({
          designation: vals[0]?.trim() || "",
          brand: vals[1]?.trim() || null,
          type_model: vals[2]?.trim() || null,
          dispensation_number: vals[3]?.trim() || null,
        });
      }
    } else if (body.rows && Array.isArray(body.rows)) {
      rows = body.rows;
    } else {
      return new Response(JSON.stringify({ error: "csv_url or rows required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Total rows to import: ${rows.length}`);

    // Clear existing data only on first batch
    if (!body.skip_delete) {
      const { error: deleteError } = await supabase
        .from("anrt_dispensed_equipment")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
      if (deleteError) console.warn("Delete warning:", deleteError.message);
    }

    const BATCH = 500;
    let inserted = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH).map(r => {
        const brandNorm = r.brand?.toUpperCase().trim() || null;
        const searchText = [r.designation, r.brand, r.type_model, r.dispensation_number]
          .filter(Boolean).join(" ");
        return {
          designation: r.designation,
          brand: r.brand || null,
          type_model: r.type_model || null,
          dispensation_number: r.dispensation_number || null,
          brand_normalized: brandNorm,
          search_text: searchText,
        };
      }).filter(r => r.designation);

      if (batch.length === 0) continue;

      const { error } = await supabase.from("anrt_dispensed_equipment").insert(batch);
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
      success: true, total: rows.length, inserted, batch_errors: errors,
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
