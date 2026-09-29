import { createHash } from "node:crypto";

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DOWNLOADABLE_CONNECTORS = new Set(["direct_pdf_fetcher", "spreadsheet_importer"]);
const COMPLEX_CONNECTORS = new Set(["html_crawler", "pdf_link_extractor", "portal_index_monitor"]);

export function parseWorkerArgs(argv = process.argv.slice(2)) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const next = argv[index + 1];
    if (key.startsWith("--")) {
      args.set(key, next && !next.startsWith("--") ? next : true);
      if (next && !next.startsWith("--")) index += 1;
    }
  }
  return {
    help: args.has("--help") || args.has("-h"),
    execute: args.has("--execute"),
    dryRun: !args.has("--execute"),
    includeDraft: args.has("--include-draft"),
    planComplex: args.has("--plan-complex"),
    sourceCode: typeof args.get("--source-code") === "string" ? String(args.get("--source-code")) : null,
    connectorType: typeof args.get("--connector-type") === "string" ? String(args.get("--connector-type")) : null,
    limit: clampNumber(Number(args.get("--limit") || 10), 1, 100),
    maxBytes: clampNumber(Number(args.get("--max-bytes") || DEFAULT_MAX_BYTES), 1, 250 * 1024 * 1024),
    materializeDocuments: args.has("--materialize-documents"),
    storageBucket: typeof args.get("--storage-bucket") === "string" ? String(args.get("--storage-bucket")) : (process.env.SOURCE_DOCUMENT_BUCKET || "legal-source-pdfs"),
  };
}

function clampNumber(value, min, max) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : min;
}

function nowIso() {
  return new Date().toISOString();
}

export function isDownloadableConnector(connectorType) {
  return DOWNLOADABLE_CONNECTORS.has(connectorType);
}

export function isComplexConnector(connectorType) {
  return COMPLEX_CONNECTORS.has(connectorType);
}

export function shouldProcessTarget(target, options = {}) {
  const connector = target.connector;
  if (!target.source?.active) return { ok: false, reason: "inactive_source" };
  if (!connector) return { ok: false, reason: "missing_connector" };
  if (connector.status === "blocked") return { ok: false, reason: "blocked_connector" };
  if (connector.status !== "active" && !options.includeDraft) return { ok: false, reason: "connector_not_active" };
  if (options.sourceCode && target.source.source_code !== options.sourceCode) return { ok: false, reason: "source_filter" };
  if (options.connectorType && connector.connector_type !== options.connectorType) return { ok: false, reason: "connector_filter" };
  if (isDownloadableConnector(connector.connector_type)) return { ok: true, mode: connector.connector_type === "spreadsheet_importer" ? "import" : "download" };
  if (options.planComplex && isComplexConnector(connector.connector_type)) return { ok: true, mode: connector.connector_type === "portal_index_monitor" ? "snapshot" : "discovery" };
  return { ok: false, reason: `unsupported_connector:${connector.connector_type}` };
}

export function createRunPayload(target, mode, status = "planned") {
  return {
    source_catalog_id: target.source.id,
    source_connector_config_id: target.connector?.id ?? null,
    connector_type: target.connector?.connector_type ?? "missing",
    pipeline_component: target.connector?.pipeline_component ?? "missing",
    run_mode: mode,
    status,
    discovered_count: 0,
    changed_count: 0,
    queued_asset_count: 0,
    blocked_reason: status === "blocked" ? "blocked_connector" : null,
    plan: {
      version: "source-discovery-worker-v1",
      source_code: target.source.source_code,
      connector_code: target.connector?.connector_code ?? null,
      connector_type: target.connector?.connector_type ?? null,
      pipeline_component: target.connector?.pipeline_component ?? null,
      official_url: target.source.official_url,
      formats: target.source.formats ?? [],
      canonical_fact_write: false,
    },
    metrics: {},
  };
}

function filenameFromContentDisposition(value) {
  if (!value) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (utf8) return decodeURIComponent(utf8.replaceAll('"', "")).trim();
  const ascii = /filename="?([^";]+)"?/i.exec(value)?.[1];
  return ascii?.trim() || null;
}

function filenameFromUrl(value) {
  const pathname = new URL(value).pathname;
  return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) || "official-source-document");
}

function mimeFromFilename(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".csv")) return "text/csv";
  return "application/octet-stream";
}

function normalizeLastModified(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sha256Hex(buffer) {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

export async function downloadCandidate(target, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!fetchImpl) throw new Error("fetch_unavailable");
  const url = target.source.official_url;
  if (!url) throw new Error("official_url_missing");
  const response = await fetchImpl(url, { headers: { "user-agent": options.userAgent || "DouaneAI Source Discovery Worker/1.0" } });
  if (!response.ok) throw new Error(`download_failed:${response.status}`);
  const contentLength = response.headers.get("content-length");
  const expectedLength = contentLength ? Number(contentLength) : null;
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  if (expectedLength !== null && Number.isFinite(expectedLength) && expectedLength > maxBytes) throw new Error(`download_too_large:${expectedLength}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new Error(`download_too_large:${buffer.byteLength}`);
  const filename = filenameFromContentDisposition(response.headers.get("content-disposition")) || filenameFromUrl(url);
  const contentSha256 = sha256Hex(buffer);
  return {
    bytes: Buffer.from(buffer),
    url,
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
      downloaded_by: "source-discovery-worker-v1",
      canonical_fact_write: false,
    },
  };
}

function detectDocumentType(target) {
  const component = target.connector?.pipeline_component;
  if (component === "tariff-extractor") return "tariff";
  if (component === "spreadsheet-parser") return "technical_control";
  if (component === "legal-structure-extractor") return "circular";
  if (component === "obligation-extractor") return "technical_control";
  return "other";
}

function cleanPathPart(value) {
  return String(value).trim().replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/g, "").replace(/\.\.+/g, ".");
}

export function createAssetPayload(target, candidate, discoveryRunId) {
  const filename = cleanPathPart(candidate.filename.split("/").at(-1) || candidate.filename);
  return {
    provider: target.connector?.connector_type === "manual_upload" ? "manual_upload" : "official_web",
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
    source_connector_config_id: target.connector?.id ?? null,
    discovery_run_id: discoveryRunId ?? null,
    metadata: {
      ...(candidate.metadata || {}),
      source_code: target.source.source_code,
      connector_code: target.connector?.connector_code ?? null,
      connector_type: target.connector?.connector_type ?? null,
      pipeline_component: target.connector?.pipeline_component ?? null,
      canonical_fact_write: false,
    },
  };
}


export function storagePathForCandidate(target, candidate) {
  const filename = cleanPathPart(candidate.filename.split("/").at(-1) || candidate.filename);
  return `official/${target.source.source_code}/${candidate.content_sha256}/${filename}`;
}

export function createSourceDocumentInsert(target, candidate, storageBucket, storagePath) {
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
      connector_code: target.connector?.connector_code ?? null,
      connector_type: target.connector?.connector_type ?? null,
      source_discovery_worker: "v1",
      canonical_fact_write: false,
    },
  };
}

export async function materializeSourceDocument(db, target, candidate, asset, options = {}) {
  if (!candidate?.bytes || !candidate.content_sha256) throw new Error("candidate_bytes_required");
  const bucket = options.storageBucket || "legal-source-pdfs";
  const storagePath = storagePathForCandidate(target, candidate);
  const { data: existing, error: lookupError } = await db.from("source_documents")
    .select("id,storage_path")
    .eq("source_catalog_id", target.source.id)
    .eq("sha256", candidate.content_sha256)
    .maybeSingle();
  if (lookupError) throw new Error(`source_document_lookup:${lookupError.message}`);
  let documentId = existing?.id;
  if (!documentId) {
    const { error: uploadError } = await db.storage.from(bucket).upload(storagePath, candidate.bytes, { contentType: candidate.mime_type, upsert: false });
    if (uploadError && !/already exists|duplicate/i.test(uploadError.message || "")) throw new Error(`source_document_upload:${uploadError.message}`);
    const payload = createSourceDocumentInsert(target, candidate, bucket, storagePath);
    const { data: created, error: insertError } = await db.from("source_documents").insert(payload).select("id").single();
    if (insertError || !created?.id) throw new Error(`source_document_insert:${insertError?.message || "missing id"}`);
    documentId = created.id;
  }
  if (asset?.external_id) {
    const { error: assetError } = await db.from("source_assets").update({ source_document_id: documentId, discovery_status: "matched" }).eq("provider", asset.provider).eq("external_id", asset.external_id);
    if (assetError) throw new Error(`source_asset_document_link:${assetError.message}`);
  }
  return { document_id: documentId, storage_bucket: bucket, storage_path: existing?.storage_path || storagePath };
}

export async function loadTargets(db, options = {}) {
  let query = db.from("source_catalog")
    .select("id,source_code,name,source_family,official_url,access_method,automation_status,priority,update_frequency,data_domains,formats,reuse_status,reliability_level,ingestion_strategy,active,notes,regulatory_source_id,authority_catalog(authority_code)")
    .eq("active", true)
    .order("priority", { ascending: true })
    .limit(options.limit || 10);
  if (options.sourceCode) query = query.eq("source_code", options.sourceCode);
  const { data: sources, error: sourceError } = await query;
  if (sourceError) throw new Error(`source_catalog_load:${sourceError.message}`);
  if (!sources?.length) return [];
  const { data: connectors, error: connectorError } = await db.from("source_connector_configs")
    .select("id,source_catalog_id,connector_code,connector_type,pipeline_component,schedule_policy,status")
    .in("source_catalog_id", sources.map((source) => source.id));
  if (connectorError) throw new Error(`source_connector_configs_load:${connectorError.message}`);
  const bySource = new Map((connectors || []).map((connector) => [connector.source_catalog_id, connector]));
  return sources.map((source) => ({ source, connector: bySource.get(source.id) || null }));
}

export async function persistDiscovery(db, target, mode, candidate) {
  const runPayload = createRunPayload(target, mode, "planned");
  const { data: run, error: runError } = await db.from("source_discovery_runs").insert(runPayload).select("id").single();
  if (runError || !run?.id) throw new Error(`source_discovery_run_insert:${runError?.message || "missing id"}`);
  try {
    const assets = candidate ? [createAssetPayload(target, candidate, run.id)] : [];
    if (assets.length) {
      const { error: assetError } = await db.from("source_assets").upsert(assets, { onConflict: "provider,external_id" });
      if (assetError) throw new Error(`source_asset_upsert:${assetError.message}`);
    }
    const update = {
      status: "completed",
      completed_at: nowIso(),
      discovered_count: assets.length,
      changed_count: assets.length,
      queued_asset_count: assets.filter((asset) => asset.discovery_status === "queued").length,
      metrics: { persisted_assets: assets.length, canonical_fact_write: false },
    };
    const { error: completeError } = await db.from("source_discovery_runs").update(update).eq("id", run.id);
    if (completeError) throw new Error(`source_discovery_run_complete:${completeError.message}`);
    return { run_id: run.id, assets, ...update };
  } catch (error) {
    await db.from("source_discovery_runs").update({ status: "failed", completed_at: nowIso(), error_summary: error instanceof Error ? error.message : String(error) }).eq("id", run.id);
    throw error;
  }
}

export async function processTarget(db, target, options = {}) {
  const decision = shouldProcessTarget(target, options);
  if (!decision.ok) return { source_code: target.source?.source_code, status: "skipped", reason: decision.reason };
  const planned = { source_code: target.source.source_code, connector_type: target.connector.connector_type, mode: decision.mode, dry_run: options.dryRun !== false };
  if (options.dryRun !== false) return { ...planned, status: "planned" };
  const candidate = isDownloadableConnector(target.connector.connector_type) ? await downloadCandidate(target, options) : null;
  const persisted = await persistDiscovery(db, target, decision.mode, candidate);
  let document = null;
  if (options.materializeDocuments && candidate) {
    document = await materializeSourceDocument(db, target, candidate, persisted.assets[0], options);
  }
  return { ...planned, status: "completed", run_id: persisted.run_id, asset_count: persisted.assets.length, ...(document ? { document_id: document.document_id } : {}) };
}
