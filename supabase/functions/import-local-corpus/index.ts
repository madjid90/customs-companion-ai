import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const allowedTypes = new Set(["customs_code", "law", "decree", "order", "circular", "instruction", "tariff", "hs_nomenclature", "section_note", "chapter_note", "classification_opinion", "agreement", "origin_rule", "procedure", "authorization", "technical_control", "tax_rule", "guide", "other"]);
const allowedProviders = new Set(["google_drive", "local_filesystem", "official_web", "manual_upload"]);
const allowedDetectedTypes = new Set([...allowedTypes, "regulation"]);
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
async function sha256(data: Uint8Array) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", data))); }
function fail(error: unknown) { return json({ error: error instanceof Error ? error.message : (typeof error === "object" ? JSON.stringify(error) : String(error)) }, 400); }

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const token = req.headers.get("x-corpus-import-token") || "";
    if (token.length < 40 || token.length > 200) return json({ error: "Unauthorized" }, 401);
    const tokenHash = await sha256(new TextEncoder().encode(token));
    const { data: authorized, error: tokenError } = await db.rpc("verify_corpus_import_token", { input_hash: tokenHash });
    if (tokenError || !authorized) return json({ error: "Unauthorized" }, 401);
    const action = new URL(req.url).searchParams.get("action");
    const { data: source, error: sourceError } = await db.from("regulatory_sources").select("id").eq("code", "MA_MANUAL_CORPUS").single();
    if (sourceError) throw sourceError;

    if (action === "asset") {
      const input = await req.json();
      if (!input || !allowedProviders.has(input.provider) || typeof input.external_id !== "string" || typeof input.relative_path !== "string" || typeof input.filename !== "string") return json({ error: "Invalid asset identity" }, 400);
      if (input.external_id.length > 1000 || input.relative_path.length > 1000 || input.filename.length > 500 || input.relative_path.includes("..")) return json({ error: "Invalid asset path" }, 400);
      if (input.mime_type !== "application/pdf" || !Number.isInteger(input.byte_size) || input.byte_size < 20 || !/^[a-f0-9]{64}$/.test(input.sha256 || "") || !allowedDetectedTypes.has(input.document_type || "other")) return json({ error: "Invalid asset metadata" }, 400);
      const { data: assetId, error: assetError } = await db.rpc("register_source_asset", {
        input_provider: input.provider,
        input_external_id: input.external_id,
        input_relative_path: input.relative_path,
        input_filename: input.filename,
        input_mime_type: input.mime_type,
        input_byte_size: input.byte_size,
        input_sha256: input.sha256,
        input_root_external_id: input.root_external_id || null,
        input_source_url: input.source_url || null,
        input_provider_modified_at: input.provider_modified_at || null,
        input_detected_document_type: input.document_type || "other",
        input_metadata: input.metadata || {},
      });
      if (assetError) throw assetError;
      return json({ status: "registered", asset_id: assetId });
    }

    if (action === "file") {
      const expectedSha = req.headers.get("x-file-sha256") || "";
      const encodedRelative = req.headers.get("x-relative-path") || "";
      const documentType = req.headers.get("x-document-type") || "other";
      if (!/^[a-f0-9]{64}$/.test(expectedSha) || !encodedRelative || !allowedTypes.has(documentType)) return json({ error: "Invalid file metadata" }, 400);
      const relativePath = decodeURIComponent(encodedRelative);
      if (relativePath.length > 500 || relativePath.includes("..") || !relativePath.toLowerCase().endsWith(".pdf")) return json({ error: "Invalid relative path" }, 400);
      const filename = relativePath.split("/").at(-1) || "document.pdf";
      const body = new Uint8Array(await req.arrayBuffer());
      if (body.length < 20 || body.length > 15 * 1024 * 1024 || !new TextDecoder().decode(body.slice(0, 1024)).includes("%PDF-")) return json({ error: "Invalid PDF or file size" }, 400);
      if (await sha256(body) !== expectedSha) return json({ error: "SHA-256 mismatch" }, 400);
      const { data: existing, error: lookupError } = await db.from("source_documents").select("id,lifecycle_status").eq("source_id", source.id).eq("sha256", expectedSha).maybeSingle();
      if (lookupError) throw lookupError;
      if (existing && existing.lifecycle_status !== "draft") return json({ status: "duplicate", document_id: existing.id });
      let documentId = existing?.id;
      if (!documentId) {
        const path = `manual/${expectedSha}.pdf`;
        const { error: storageError } = await db.storage.from("legal-source-pdfs").upload(path, body, { contentType: "application/pdf", upsert: false });
        if (storageError && !/already exists|duplicate/i.test(storageError.message)) throw storageError;
        const { data: document, error: documentError } = await db.from("source_documents").insert({ source_id: source.id, title: filename.replace(/\.pdf$/i, ""), document_type: documentType, storage_bucket: "legal-source-pdfs", storage_path: path, mime_type: "application/pdf", byte_size: body.length, sha256: expectedSha, lifecycle_status: "draft", metadata: { original_relative_path: relativePath, classification_unverified: true } }).select("id").single();
        if (documentError) throw documentError;
        documentId = document.id;
      }
      const { data: run, error: runError } = await db.from("ingestion_runs").insert({ source_document_id: documentId, pipeline_version: "local-pypdf-v1", extraction_method: "native_pdf", status: "processing", started_at: new Date().toISOString() }).select("id").single();
      if (runError) throw runError;
      return json({ status: "uploaded", document_id: documentId, run_id: run.id });
    }

    const input = await req.json();
    if (!input || typeof input.run_id !== "string") return json({ error: "run_id required" }, 400);
    const { data: run, error: runError } = await db.from("ingestion_runs").select("id,source_document_id,status").eq("id", input.run_id).single();
    if (runError || !run || run.status !== "processing") return json({ error: "Processing run required" }, 400);
    if (action === "pages") {
      if (!Array.isArray(input.pages) || input.pages.length < 1 || input.pages.length > 25) return json({ error: "1-25 pages required" }, 400);
      const rows = [];
      const issues = [];
      for (const page of input.pages) {
        if (!Number.isInteger(page.number) || page.number < 1 || typeof page.text !== "string" || page.text.length > 250000) return json({ error: "Invalid page" }, 400);
        const text = page.text.replaceAll("\u0000", "").trim();
        rows.push({ source_document_id: run.source_document_id, page_number: page.number, text_content: text, text_sha256: await sha256(new TextEncoder().encode(text)), extraction_method: "native_pdf", extraction_confidence: text.length < 80 ? 0 : 70, review_status: text.length < 80 ? "needs_review" : "unreviewed", metadata: { chars: text.length } });
        if (text.length < 80) issues.push({ ingestion_run_id: run.id, page_number: page.number, issue_type: "empty_page", severity: "blocking", description: "Texte absent ou insuffisant : OCR et contrôle visuel requis", evidence: { chars: text.length } });
      }
      const { error: pageError } = await db.from("source_pages").upsert(rows, { onConflict: "source_document_id,page_number" });
      if (pageError) throw pageError;
      if (issues.length) {
        const { data: prior, error: priorError } = await db.from("ingestion_issues").select("page_number").eq("ingestion_run_id", run.id).eq("issue_type", "empty_page").in("page_number", issues.map((issue) => issue.page_number));
        if (priorError) throw priorError;
        const existingNumbers = new Set((prior || []).map((issue) => issue.page_number));
        const fresh = issues.filter((issue) => !existingNumbers.has(issue.page_number));
        if (fresh.length) { const { error: issueError } = await db.from("ingestion_issues").insert(fresh); if (issueError) throw issueError; }
      }
      return json({ status: "pages_saved", count: rows.length });
    }
    if (action === "complete") {
      if (!Number.isInteger(input.total_pages) || input.total_pages < 1) return json({ error: "total_pages required" }, 400);
      const { count, error: countError } = await db.from("source_pages").select("id", { count: "exact", head: true }).eq("source_document_id", run.source_document_id);
      if (countError) throw countError;
      if (count !== input.total_pages) return json({ error: `Page count mismatch: ${count}/${input.total_pages}` }, 409);
      const { count: failed, error: failedError } = await db.from("source_pages").select("id", { count: "exact", head: true }).eq("source_document_id", run.source_document_id).eq("review_status", "needs_review");
      if (failedError) throw failedError;
      const { error: finishError } = await db.from("ingestion_runs").update({ status: "quality_review", total_pages: count, processed_pages: count, failed_pages: failed || 0, quality_score: Math.round(100 * (count - (failed || 0)) / count), completed_at: new Date().toISOString() }).eq("id", run.id);
      if (finishError) throw finishError;
      const { error: documentError } = await db.from("source_documents").update({ lifecycle_status: "quality_review" }).eq("id", run.source_document_id);
      if (documentError) throw documentError;
      return json({ status: "quality_review", pages: count, pages_requiring_review: failed || 0 });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (error) { return fail(error); }
});
