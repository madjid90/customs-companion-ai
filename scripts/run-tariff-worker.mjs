#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { extractTariffPage } from "./lib/tariff-extractor.mjs";

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
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

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

async function gatewayRequest(gatewayUrl, token, action, body) {
  const response = await fetch(`${gatewayUrl}?action=${action}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`gateway_${action}:${result.error || response.status}`);
  return result;
}

async function processJob(gatewayUrl, token, job, workerId) {
  runtimeState.currentJobId = job.id;
  runtimeState.lastActivityAt = new Date().toISOString();
  try {
    const text = String(job.source_page?.text_content || "");
    const expectedHash = String(job.payload?.input_text_sha256 || job.source_page?.text_sha256 || "");
    const actualHash = sha256(text);
    if (expectedHash && expectedHash !== actualHash) throw new Error("input_text_hash_mismatch");
    const result = extractTariffPage(text, { source: "gateway_claim" });
    await gatewayRequest(gatewayUrl, token, "submit_tariff", {
      worker_id: workerId,
      job_id: job.id,
      input_text_sha256: result.input_text_sha256,
      status: result.status,
      table_count: result.table_count,
      row_count: result.row_count,
      valid_row_count: result.valid_row_count,
      quality_score: result.quality_score,
      metrics: result.metrics,
      tables: result.tables,
    });
    process.stdout.write(`${JSON.stringify({ event: "job_completed", job_id: job.id, status: result.status, rows: result.row_count, valid_rows: result.valid_row_count, quality_score: result.quality_score })}\n`);
    runtimeState.completed += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try { await gatewayRequest(gatewayUrl, token, "fail", { worker_id: workerId, job_id: job.id, error_code: message.split(":", 1)[0], error_message: message }); } catch {}
    process.stderr.write(`${JSON.stringify({ event: "job_failed", job_id: job.id, error: message })}\n`);
    runtimeState.failed += 1;
  } finally {
    runtimeState.currentJobId = null;
    runtimeState.lastActivityAt = new Date().toISOString();
  }
}

async function gatewayMode() {
  const gatewayUrl = process.env.CORPUS_GATEWAY_URL;
  const token = process.env.CORPUS_WORKER_TOKEN;
  if (!gatewayUrl || !token) throw new Error("CORPUS_GATEWAY_URL and CORPUS_WORKER_TOKEN are required");
  const workerId = process.env.CORPUS_WORKER_ID || `tariff-${process.pid}`;
  const batchSize = clamp(Number(process.env.WORKER_BATCH_SIZE || 5), 1, 20);
  const healthServer = startHealthServer();
  runtimeState.ready = true;
  try {
    do {
      const { jobs } = await gatewayRequest(gatewayUrl, token, "claim", { worker_id: workerId, batch_size: batchSize, job_type: "extract_tariff" });
      for (const job of jobs || []) {
        if (stopping) break;
        await processJob(gatewayUrl, token, job, workerId);
      }
      if (stopping || !args.has("--loop") || !jobs?.length) break;
    } while (!stopping);
  } finally {
    runtimeState.ready = false;
    healthServer?.close();
  }
}

if (args.has("--local-text")) {
  const result = extractTariffPage(String(args.get("--local-text")));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  await gatewayMode();
}
