// Edge function: generate a printable PDF/HTML export of a user's saved responses.
// Returns text/html (browsers can print to PDF) — keeps deps minimal & instant.
//
// Request body: { ids?: string[] }   // if absent, exports all of the caller's saved responses
// Response: text/html (printable bookmark digest)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Very small markdown -> html (paragraphs + headings + bold + lists)
function mdToHtml(md: string): string {
  if (!md) return "";
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      out.push("");
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      const level = heading[1].length;
      out.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${escapeHtml(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    out.push(`<p>${escapeHtml(line).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "missing_auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use the caller's JWT to enforce RLS (only their own saved responses are visible)
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    let ids: string[] | undefined;
    try {
      const body = await req.json();
      if (Array.isArray(body?.ids)) ids = body.ids;
    } catch {
      /* empty body OK */
    }

    let query = client
      .from("saved_responses")
      .select("id, question, response, created_at, cited_circulars, conversation_id")
      .order("created_at", { ascending: false });
    if (ids && ids.length > 0) query = query.in("id", ids);

    const { data, error } = await query.limit(500);
    if (error) {
      console.error("[export-saved-pdf] query error", error);
      return new Response(JSON.stringify({ error: "db_error", details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const items = data || [];
    const dateStr = new Date().toLocaleString("fr-FR");

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>DouaneAI — Réponses sauvegardées</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #0f172a; line-height: 1.55; font-size: 12px; }
  header { border-bottom: 2px solid #0ea5e9; padding-bottom: 10px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: baseline; }
  header h1 { margin: 0; font-size: 18px; color: #0369a1; }
  header .meta { font-size: 10px; color: #64748b; }
  .empty { text-align: center; padding: 40px 0; color: #64748b; font-style: italic; }
  .item { page-break-inside: avoid; margin-bottom: 24px; padding: 14px 16px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
  .item .date { font-size: 10px; color: #64748b; margin-bottom: 6px; }
  .item .question { font-weight: 600; color: #0f172a; margin-bottom: 10px; font-size: 12.5px; }
  .item .response { font-size: 11.5px; color: #1e293b; }
  .item .response p { margin: 0 0 6px 0; }
  .item .response h1, .item .response h2, .item .response h3, .item .response h4 { margin: 10px 0 6px 0; color: #0c4a6e; font-size: 13px; }
  .item .response ul { padding-left: 18px; margin: 4px 0; }
  .citations { margin-top: 10px; padding-top: 8px; border-top: 1px dashed #cbd5e1; font-size: 10px; color: #475569; }
  .citations strong { color: #0369a1; }
  footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid #e2e8f0; font-size: 9px; color: #94a3b8; text-align: center; }
  .toolbar { position: fixed; top: 8px; right: 8px; background: #0ea5e9; color: white; padding: 6px 12px; border-radius: 6px; font-size: 11px; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
  @media print { .toolbar { display: none; } }
</style>
</head>
<body>
  <button class="toolbar" onclick="window.print()">Imprimer / Enregistrer en PDF</button>
  <header>
    <h1>DouaneAI — Réponses sauvegardées</h1>
    <div class="meta">${escapeHtml(dateStr)} · ${items.length} item${items.length > 1 ? "s" : ""}</div>
  </header>
  ${
    items.length === 0
      ? `<div class="empty">Aucune réponse sauvegardée.</div>`
      : items
          .map((item: any) => {
            const date = new Date(item.created_at).toLocaleString("fr-FR");
            const cits = Array.isArray(item.cited_circulars) ? item.cited_circulars : [];
            return `
    <div class="item">
      <div class="date">${escapeHtml(date)}</div>
      ${item.question ? `<div class="question">${escapeHtml(item.question)}</div>` : ""}
      <div class="response">${mdToHtml(item.response || "")}</div>
      ${
        cits.length > 0
          ? `<div class="citations"><strong>Sources citées :</strong> ${cits
              .map((c: any) =>
                escapeHtml(
                  [
                    c.reference_type,
                    c.reference_number || c.title,
                    c.page_number ? `p.${c.page_number}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")
                )
              )
              .join(" ; ")}</div>`
          : ""
      }
    </div>`;
          })
          .join("\n")
  }
  <footer>Généré par DouaneAI · ${escapeHtml(dateStr)}</footer>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[export-saved-pdf] fatal", e);
    return new Response(JSON.stringify({ error: "internal_error", message: e?.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
