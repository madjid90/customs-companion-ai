import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.91.1";

const PRODUCTION_ORIGINS = [
  "https://customs-companion.vercel.app",
  "https://customs-companion.netlify.app",
  "https://customs-companion-ai.vercel.app",
  "https://customs-companion-ai-jurisai.vercel.app",
  "https://customs-companion-g3vhe2rp6-jurisai.vercel.app",
];

const PRODUCTION_ORIGIN_PATTERNS = [
  /^https:\/\/customs-companion-ai-[a-z0-9-]+\.vercel\.app$/,
  /^https:\/\/customs-companion-[a-z0-9-]+-jurisai\.vercel\.app$/,
];

const DOWNLOADABLE_CONNECTORS = new Set(["direct_pdf_fetcher", "spreadsheet_importer"]);
const COMPLEX_CONNECTORS = new Set(["html_crawler", "pdf_link_extractor", "portal_index_monitor"]);
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

type SupabaseClient = ReturnType<typeof createClient>;

type SourceRow = {
  id: string;
  source_code: string;
  name: string;
  official_url: string | null;
  formats: string[] | null;
  active: boolean;
};

type ConnectorRow = {
  id: string;
  source_catalog_id: string;
  connector_code: string;
  connector_type: string;
  pipeline_component: string;
  status: string;
};

type Target = {
  source: SourceRow;
  connector: ConnectorRow;
};

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return PRODUCTION_ORIGINS.includes(origin) || PRODUCTION_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": isOriginAllowed(origin) && origin ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "content-type": "application/json" },
  });
}

async function requireAdmin(req: Request, db: SupabaseClient): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return { ok: false, response: json(req, { error: "Non authentifié" }, 401) };
  const token = authHeader.slice("Bearer ".length);
  const { data: userData, error: userError } = await db.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return { ok: false, response: json(req, { error: "Session invalide" }, 401) };
  const { data: role, error: roleError } = await db.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (roleError || !role) return { ok: false, response: json(req, { error: "Accès administrateur requis" }, 403) };
  return { ok: true, userId: user.id };
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}

function cleanPathPart(value: string): string {
  return String(value).trim().replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/g, "").replace(/\.\.+/g, ".");
}

function filenameFromContentDisposition(value: string | null): string | null {
  if (!value) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (utf8) return decodeURIComponent(utf8.replaceAll('"', "")).trim();
  const ascii = /filename="?([^";]+)"?/i.exec(value)?.[1];
  return ascii?.trim() || null;
}

function filenameFromUrl(value: string): string {
  const pathname = new URL(value).pathname;
  return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) || "official-source-document");
}

function mimeFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".csv")) return "text/csv";
  return "application/octet-stream";
}

function normalizeLastModified(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)));
}

function detectDocumentType(target: Target): string {
  if (target.connector.pipeline_component === "tariff-extractor") return "tariff";
  if (target.connector.pipeline_component === "spreadsheet-parser") return "technical_control";
  if (target.connector.pipeline_component === "legal-structure-extractor") return "circular";
  if (target.connector.pipeline_component === "obligation-extractor") return "technical_control";
  return "other";
}

function shouldProcessTarget(target: Target, options: { includeDraft: boolean; planComplex: boolean; sourceCode: string | null; connectorType: string | null }) {
  if (!target.source.active) return { ok: false, reason: "inactive_source" };
  if (target.connector.status === "blocked") return { ok: false, reason: "blocked_connector" };
  if (target.connector.status !== "active" && !options.includeDraft) return { ok: false, reason: "connector_not_active" };
  if (options.sourceCode && target.source.source_code !== options.sourceCode) return { ok: false, reason: "source_filter" };
  if (options.connectorType && target.connector.connector_type !== options.connectorType) return { ok: false, reason: "connector_filter" };
  if (DOWNLOADABLE_CONNECTORS.has(target.connector.connector_type)) return { ok: true, mode: target.connector.connector_type === "spreadsheet_importer" ? "import" : "download" };
  if (options.planComplex && COMPLEX_CONNECTORS.has(target.connector.connector_type)) return { ok: true, mode: target.connector.connector_type === "portal_index_monitor" ? "snapshot" : "discovery" };
  return { ok: false, reason: `unsupported_connector:${target.connector.connector_type}` };
}

function createRunPayload(target: Target, mode: string, status = "planned") {
  return {
    source_catalog_id: target.source.id,
    source_connector_config_id: target.connector.id,
    connector_type: target.connector.connector_type,
    pipeline_component: target.connector.pipeline_component,
    run_mode: mode,
    status,
    started_at: status === "running" ? new Date().toISOString() : null,
    completed_at: null,
    discovered_count: 0,
    changed_count: 0,
    queued_asset_count: 0,
    blocked_reason: null,
    error_summary: null,
    plan: {
      version: "source-discovery-edge-v1",
      source_code: target.source.source_code,
      connector_code: target.connector.connector_code,
      connector_type: target.connector.connector_type,
      pipeline_component: target.connector.pipeline_component,
      official_url: target.source.official_url,
      formats: target.source.formats ?? [],
      canonical_fact_write: false,
    },
    metrics: {},
  };
}

async function loadTargets(db: SupabaseClient): Promise<Target[]> {
  const { data: sources, error: sourceError } = await db.from("source_catalog").select("id,source_code,name,official_url,formats,active").eq("active", true).order("source_code");
  if (sourceError) throw new Error(`source_catalog:${sourceError.message}`);
  const sourceIds = (sources ?? []).map((source: SourceRow) => source.id);
  if (!sourceIds.length) return [];
  const { data: connectors, error: connectorError } = await db.from("source_connector_configs").select("id,source_catalog_id,connector_code,connector_type,pipeline_component,status").in("source_catalog_id", sourceIds).order("connector_code");
  if (connectorError) throw new Error(`source_connector_configs:${connectorError.message}`);
  const sourceById = new Map((sources ?? []).map((source: SourceRow) => [source.id, source]));
  return (connectors ?? []).map((connector: ConnectorRow) => ({ source: sourceById.get(connector.source_catalog_id)!, connector })).filter((target: Target) => !!target.source);
}

async function downloadCandidate(target: Target, maxBytes: number) {
  if (!target.source.official_url) throw new Error("official_url_missing");
  const response = await fetch(target.source.official_url, { headers: { "user-agent": "DouaneAI Source Discovery Edge/1.0" } });
  if (!response.ok) throw new Error(`download_failed:${response.status}`);
  const contentLength = response.headers.get("content-length");
  const expectedLength = contentLength ? Number(contentLength) : null;
  if (expectedLength !== null && Number.isFinite(expectedLength) && expectedLength > maxBytes) throw new Error(`download_too_large:${expectedLength}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new Error(`download_too_large:${buffer.byteLength}`);
  const filename = filenameFromContentDisposition(response.headers.get("content-disposition")) || filenameFromUrl(target.source.official_url);
  const contentSha256 = await sha256Hex(buffer);
  return {
    bytes: buffer,
    url: target.source.official_url,
    filename,
    mime_type: response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || mimeFromFilename(filename),
    byte_size: buffer.byteLength,
    content_sha256: contentSha256,
    provider_modified_at: normalizeLastModified(response.headers.get("last-modified")),
    provider_revision: response.headers.get("etag")?.replaceAll('"', "") || null,
    detected_document_type: detectDocumentType(target),
    metadata: {
      content_type_header: response.headers.get("content-type"),
      content_length_header: contentLength,
      downloaded_by: "source-discovery-edge-v1",
      canonical_fact_write: false,
    },
  };
}

function createAssetPayload(target: Target, candidate: Awaited<ReturnType<typeof downloadCandidate>>, discoveryRunId: string | null) {
  const filename = cleanPathPart(candidate.filename.split("/").at(-1) || candidate.filename);
  return {
    provider: "official_web",
    external_id: `${target.source.source_code}:${candidate.content_sha256 || candidate.provider_revision || candidate.url}`,
    root_external_id: target.source.source_code,
    relative_path: `${target.source.source_code}/${filename}`,
    filename,
    mime_type: candidate.mime_type,
    byte_size: candidate.byte_size ?? null,
    content_sha256: candidate.content_sha256 ?? null,
    provider_modified_at: candidate.provider_modified_at ?? null,
    provider_revision: candidate.provider_revision ?? null,
    source_url: candidate.url,
    detected_document_type: candidate.detected_document_type ?? null,
    discovery_status: candidate.content_sha256 ? "queued" : "discovered",
    source_catalog_id: target.source.id,
    source_connector_config_id: target.connector.id,
    discovery_run_id: discoveryRunId,
    metadata: {
      ...(candidate.metadata || {}),
      source_code: target.source.source_code,
      connector_code: target.connector.connector_code,
      connector_type: target.connector.connector_type,
      pipeline_component: target.connector.pipeline_component,
      canonical_fact_write: false,
    },
  };
}

function storagePathForCandidate(target: Target, candidate: Awaited<ReturnType<typeof downloadCandidate>>): string {
  const filename = cleanPathPart(candidate.filename.split("/").at(-1) || candidate.filename);
  return `official/${target.source.source_code}/${candidate.content_sha256}/${filename}`;
}

function createSourceDocumentInsert(target: Target, candidate: Awaited<ReturnType<typeof downloadCandidate>>, storageBucket: string, storagePath: string) {
  return {
    source_catalog_id: target.source.id,
    title: cleanPathPart(candidate.filename).replace(/\.[a-z0-9]+$/i, "") || target.source.name || target.source.source_code,
    document_type: candidate.detected_document_type || "other",
    source_url: candidate.url,
    storage_bucket: storageBucket,
    storage_path: storagePath,
    mime_type: candidate.mime_type,
    byte_size: candidate.byte_size ?? null,
    sha256: candidate.content_sha256,
    lifecycle_status: "draft",
    metadata: {
      source_code: target.source.source_code,
      connector_code: target.connector.connector_code,
      connector_type: target.connector.connector_type,
      source_discovery_edge: "v1",
      canonical_fact_write: false,
    },
  };
}

async function materializeSourceDocument(db: SupabaseClient, target: Target, candidate: Awaited<ReturnType<typeof downloadCandidate>>, asset: { provider: string; external_id: string }, storageBucket: string) {
  const { data: existing, error: lookupError } = await db.from("source_documents").select("id,storage_path").eq("source_catalog_id", target.source.id).eq("sha256", candidate.content_sha256).maybeSingle();
  if (lookupError) throw new Error(`source_document_lookup:${lookupError.message}`);
  let documentId = existing?.id;
  const storagePath = existing?.storage_path || storagePathForCandidate(target, candidate);
  if (!documentId) {
    const blob = new Blob([candidate.bytes], { type: candidate.mime_type });
    const { error: uploadError } = await db.storage.from(storageBucket).upload(storagePath, blob, { contentType: candidate.mime_type, upsert: false });
    if (uploadError && !/already exists|duplicate/i.test(uploadError.message || "")) throw new Error(`source_document_upload:${uploadError.message}`);
    const payload = createSourceDocumentInsert(target, candidate, storageBucket, storagePath);
    const { data: created, error: insertError } = await db.from("source_documents").insert(payload).select("id").single();
    if (insertError || !created?.id) throw new Error(`source_document_insert:${insertError?.message || "missing id"}`);
    documentId = created.id;
  }
  const { error: assetError } = await db.from("source_assets").update({ source_document_id: documentId, discovery_status: "matched" }).eq("provider", asset.provider).eq("external_id", asset.external_id);
  if (assetError) throw new Error(`source_asset_document_link:${assetError.message}`);
  return { document_id: documentId, storage_bucket: storageBucket, storage_path: storagePath };
}

async function upsertAsset(db: SupabaseClient, payload: Record<string, unknown>) {
  const { data, error } = await db.from("source_assets").upsert(payload, { onConflict: "provider,external_id" }).select("id,provider,external_id,source_document_id,discovery_status").single();
  if (error) throw new Error(`source_asset_upsert:${error.message}`);
  return data;
}

async function runDiscovery(req: Request, db: SupabaseClient, input: Record<string, unknown>) {
  const execute = input.execute === true;
  const includeDraft = input.include_draft === true;
  const materializeDocuments = input.materialize_documents === true;
  const planComplex = input.plan_complex !== false;
  const sourceCode = typeof input.source_code === "string" && input.source_code.trim() ? input.source_code.trim() : null;
  const connectorType = typeof input.connector_type === "string" && input.connector_type.trim() ? input.connector_type.trim() : null;
  const limit = clampNumber(input.limit, 10, 1, 100);
  const maxBytes = clampNumber(input.max_bytes, DEFAULT_MAX_BYTES, 1, 250 * 1024 * 1024);
  const storageBucket = typeof input.storage_bucket === "string" && input.storage_bucket.trim() ? input.storage_bucket.trim() : "legal-source-pdfs";

  const targets = (await loadTargets(db)).filter((target) => {
    const decision = shouldProcessTarget(target, { includeDraft, planComplex, sourceCode, connectorType });
    return decision.ok;
  }).slice(0, limit);

  const results = [];
  for (const target of targets) {
    const decision = shouldProcessTarget(target, { includeDraft, planComplex, sourceCode, connectorType });
    const mode = decision.ok ? decision.mode : "skipped";
    const downloadable = DOWNLOADABLE_CONNECTORS.has(target.connector.connector_type);

    if (!execute) {
      results.push({
        source_code: target.source.source_code,
        connector_type: target.connector.connector_type,
        mode,
        status: "dry_run",
        will_download: downloadable,
        will_materialize_document: downloadable && materializeDocuments,
        canonical_fact_write: false,
      });
      continue;
    }

    const { data: run, error: runError } = await db.from("source_discovery_runs").insert(createRunPayload(target, String(mode), downloadable ? "running" : "planned")).select("id").single();
    if (runError || !run?.id) {
      results.push({ source_code: target.source.source_code, status: "failed", error: `run_insert:${runError?.message || "missing id"}` });
      continue;
    }

    if (!downloadable) {
      await db.from("source_discovery_runs").update({ status: "planned", completed_at: new Date().toISOString(), blocked_reason: "complex_connector_requires_adapter", metrics: { canonical_fact_write: false } }).eq("id", run.id);
      results.push({ source_code: target.source.source_code, run_id: run.id, connector_type: target.connector.connector_type, status: "planned", canonical_fact_write: false });
      continue;
    }

    try {
      const candidate = await downloadCandidate(target, maxBytes);
      const assetPayload = createAssetPayload(target, candidate, run.id);
      const asset = await upsertAsset(db, assetPayload);
      let document = null;
      if (materializeDocuments) document = await materializeSourceDocument(db, target, candidate, assetPayload, storageBucket);
      await db.from("source_discovery_runs").update({
        status: "completed",
        completed_at: new Date().toISOString(),
        discovered_count: 1,
        changed_count: 1,
        queued_asset_count: materializeDocuments ? 0 : 1,
        metrics: {
          byte_size: candidate.byte_size,
          content_sha256: candidate.content_sha256,
          materialized_document: !!document,
          canonical_fact_write: false,
        },
      }).eq("id", run.id);
      await db.from("source_connector_configs").update({ last_checked_at: new Date().toISOString(), last_success_at: new Date().toISOString(), last_error: null }).eq("id", target.connector.id);
      results.push({ source_code: target.source.source_code, run_id: run.id, asset_id: asset.id, document, status: "completed", sha256: candidate.content_sha256, canonical_fact_write: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.from("source_discovery_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_summary: message.slice(0, 2000), metrics: { canonical_fact_write: false } }).eq("id", run.id);
      await db.from("source_connector_configs").update({ last_checked_at: new Date().toISOString(), last_error: message.slice(0, 2000) }).eq("id", target.connector.id);
      results.push({ source_code: target.source.source_code, run_id: run.id, status: "failed", error: message });
    }
  }

  return json(req, {
    success: true,
    execute,
    include_draft: includeDraft,
    materialize_documents: materializeDocuments,
    selected_count: targets.length,
    results,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "Méthode non autorisée" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json(req, { error: "Configuration Supabase manquante" }, 500);

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const admin = await requireAdmin(req, db);
  if (!admin.ok) return admin.response;

  try {
    const input = await req.json().catch(() => ({}));
    return await runDiscovery(req, db, input && typeof input === "object" ? input as Record<string, unknown> : {});
  } catch (error) {
    console.error("[source-discovery] Error:", error);
    return json(req, { error: error instanceof Error ? error.message : "Erreur inconnue" }, 500);
  }
});
