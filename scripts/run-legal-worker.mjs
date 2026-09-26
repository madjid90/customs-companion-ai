#!/usr/bin/env node
import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { extractLegalStructureFromPages } from "./lib/legal-structure-extractor.mjs";

const PIPELINE_VERSION = "legal-structure-extractor-v1";
const args = new Map();
let stopping = false;
const runtimeState = { ready: false, currentJobId: null, completed: 0, failed: 0, startedAt: new Date().toISOString(), lastActivityAt: null };

for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { stopping = true; });
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  const next = process.argv[index + 1];
  if (key.startsWith("--")) {
    args.set(key, next && !next.startsWith("--") ? next : true);
    if (next && !next.startsWith("--")) index += 1;
  }
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function startHealthServer() {
  const port = Number(process.env.HEALTH_PORT || 0);
  if (!port) return null;
  const server = createServer((req, res) => {
    const ready = runtimeState.ready && !stopping;
    const status = req.url === "/readyz" && !ready ? 503 : 200;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: ready ? "ready" : stopping ? "stopping" : "starting", ...runtimeState }));
  });
  server.listen(port, "0.0.0.0");
  return server;
}

function supabaseClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function fetchDocumentPages(db, sourceDocumentId) {
  const { data, error } = await db
    .from("source_pages")
    .select("id,page_number,text_content,text_sha256,review_status")
    .eq("source_document_id", sourceDocumentId)
    .neq("review_status", "rejected")
    .order("page_number", { ascending: true });
  if (error) throw new Error(`fetch_pages:${error.message}`);
  return (data || []).map((page) => ({
    source_page_id: page.id,
    page_number: page.page_number,
    text_content: page.text_content || "",
  }));
}

async function saveExtractionResult(db, job, result) {
  const runRecord = {
    source_document_id: job.source_document_id,
    pipeline_version_id: PIPELINE_VERSION,
    input_signature_sha256: result.input_signature_sha256,
    status: result.status,
    provision_count: result.provision_count,
    article_count: result.article_count,
    relationship_count: result.relationship_count,
    quality_score: result.quality_score,
    metrics: result.metrics || {},
  };
  const { data: prior, error: priorError } = await db
    .from("legal_extraction_runs")
    .select("id")
    .match({ source_document_id: job.source_document_id, pipeline_version_id: PIPELINE_VERSION, input_signature_sha256: result.input_signature_sha256 })
    .maybeSingle();
  if (priorError) throw new Error(`find_run:${priorError.message}`);
  let runId = prior?.id;
  if (!runId) {
    const { data, error } = await db.from("legal_extraction_runs").insert(runRecord).select("id").single();
    if (error) throw new Error(`insert_run:${error.message}`);
    runId = data.id;
  }

  const { count, error: countError } = await db
    .from("legal_provision_candidates")
    .select("id", { count: "exact", head: true })
    .eq("extraction_run_id", runId);
  if (countError) throw new Error(`count_candidates:${countError.message}`);
  if (!count) {
    if (result.provisions.length) {
      const { error } = await db.from("legal_provision_candidates").insert(result.provisions.map((provision) => ({
        extraction_run_id: runId,
        source_document_id: job.source_document_id,
        source_page_id: provision.source_page_id || null,
        provision_type: provision.provision_type,
        number: provision.number || null,
        heading: provision.heading || null,
        body_text: String(provision.body_text || "").slice(0, 250000),
        hierarchy_path: provision.hierarchy_path,
        parent_hierarchy_path: provision.parent_hierarchy_path || null,
        sequence_number: Number(provision.sequence_number || 0),
        page_start: provision.page_start || null,
        page_end: provision.page_end || null,
        extraction_confidence: Number(provision.extraction_confidence || 0),
        validation_status: provision.validation_status || "proposed",
        publication_status: provision.publication_status || "candidate",
        evidence_sha256: provision.evidence_sha256,
        metadata: provision.metadata || {},
      })));
      if (error) throw new Error(`insert_provisions:${error.message}`);
    }
    if (result.relationships.length) {
      const { error } = await db.from("legal_relationship_candidates").insert(result.relationships.map((relationship) => ({
        extraction_run_id: runId,
        source_document_id: job.source_document_id,
        source_page_id: relationship.source_page_id || null,
        relationship_index: Number(relationship.relationship_index || 0),
        reference_type: relationship.reference_type,
        reference_raw: relationship.reference_raw,
        reference_normalized: relationship.reference_normalized,
        relationship_type: relationship.relationship_type,
        evidence_text: String(relationship.evidence_text || "").slice(0, 250000),
        effective_date_text: relationship.effective_date_text || null,
        effective_from: relationship.effective_from || null,
        confidence: Number(relationship.confidence || 0),
        validation_status: relationship.validation_status || "proposed",
        publication_status: relationship.publication_status || "candidate",
        evidence_sha256: relationship.evidence_sha256,
      })));
      if (error) throw new Error(`insert_relationships:${error.message}`);
    }
  }
  return runId;
}

async function processJob(db, job, workerId) {
  runtimeState.currentJobId = job.id;
  runtimeState.lastActivityAt = new Date().toISOString();
  try {
    const pages = await fetchDocumentPages(db, job.source_document_id);
    if (!pages.length) throw new Error("no_source_pages");
    const result = extractLegalStructureFromPages(pages, { source: "source_pages" });
    const runId = await saveExtractionResult(db, job, result);
    const { data: completed, error: completeError } = await db.rpc("complete_ingestion_job", {
      job_id: job.id,
      worker_id: workerId,
      job_result: {
        legal_extraction_run_id: runId,
        status: result.status,
        provision_count: result.provision_count,
        article_count: result.article_count,
        relationship_count: result.relationship_count,
        quality_score: result.quality_score,
      },
    });
    if (completeError || !completed) throw new Error(`complete_job:${completeError?.message || "lease_lost"}`);
    process.stdout.write(`${JSON.stringify({ event: "job_completed", job_id: job.id, status: result.status, provisions: result.provision_count, articles: result.article_count, relationships: result.relationship_count, quality_score: result.quality_score })}\n`);
    runtimeState.completed += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await db.rpc("fail_ingestion_job", { job_id: job.id, worker_id: workerId, error_code: message.split(":", 1)[0].slice(0, 120), error_message: message.slice(0, 2000) });
    } catch {}
    process.stderr.write(`${JSON.stringify({ event: "job_failed", job_id: job.id, error: message })}\n`);
    runtimeState.failed += 1;
  } finally {
    runtimeState.currentJobId = null;
    runtimeState.lastActivityAt = new Date().toISOString();
  }
}

async function workerMode() {
  const db = supabaseClient();
  const workerId = process.env.CORPUS_WORKER_ID || `legal-${process.pid}`;
  const batchSize = clamp(Number(process.env.WORKER_BATCH_SIZE || 3), 1, 10);
  const healthServer = startHealthServer();
  runtimeState.ready = true;
  try {
    do {
      const { data: jobs, error } = await db.rpc("claim_ingestion_jobs", { worker_id: workerId, accepted_types: ["extract_legal"], batch_size: batchSize });
      if (error) throw new Error(`claim_jobs:${error.message}`);
      for (const job of jobs || []) {
        if (stopping) break;
        await processJob(db, job, workerId);
      }
      if (stopping || !args.has("--loop") || !jobs?.length) break;
    } while (!stopping);
  } finally {
    runtimeState.ready = false;
    healthServer?.close();
  }
}

if (args.has("--local-text")) {
  const result = extractLegalStructureFromPages([{ page_number: 1, text: String(args.get("--local-text")) }]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  await workerMode();
}
