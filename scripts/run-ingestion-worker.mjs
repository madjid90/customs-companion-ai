#!/usr/bin/env node
/** Durable PDF/OCR worker for service environments.
 *
 * Required in queue mode: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Local verification: node scripts/run-ingestion-worker.mjs --local-pdf file.pdf --page 1
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { createWorker } from "tesseract.js";

const execFileAsync = promisify(execFile);
const PIPELINE_VERSION = "page-diagnostic-v1";
const ENGINE_VERSION = "tesseract.js-6.0.1";
const args = new Map();
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
const compact = (value) => value.replaceAll("\u0000", "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const wordCount = (value) => value ? value.split(/\s+/u).filter(Boolean).length : 0;
const tesseractOptions = () => ({ cachePath: process.env.TESSERACT_CACHE_PATH || path.join(tmpdir(), "douane-ai-tesseract-cache") });
const qualityScore = (text, confidence) => {
  const lengthScore = clamp(Math.log10(Math.max(text.length, 1)) * 22, 0, 75);
  return Math.round(clamp(lengthScore + confidence * 0.25, 0, 100) * 100) / 100;
};

function locatePdfToPpm() {
  return process.env.PDFTOPPM_PATH || "pdftoppm";
}

async function renderPage(pdfPath, pageNumber, outputDirectory) {
  const prefix = path.join(outputDirectory, `page-${pageNumber}`);
  await execFileAsync(locatePdfToPpm(), ["-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", "-png", "-r", process.env.OCR_DPI || "220", pdfPath, prefix], { timeout: 120_000, maxBuffer: 2_000_000 });
  return `${prefix}.png`;
}

function flattenBlocks(blocks) {
  return (blocks || []).map((block, index) => ({
    block_type: "paragraph",
    reading_order: index,
    text_content: compact(block.text || ""),
    bbox: block.bbox || {},
    confidence: Number.isFinite(block.confidence) ? clamp(block.confidence, 0, 100) : null,
    metadata: { coordinate_space: "rendered_page_pixels", source: ENGINE_VERSION },
  })).filter((block) => block.text_content || Object.keys(block.bbox).length);
}

async function recognizePage(ocrWorker, pdfPath, pageNumber) {
  const directory = await mkdtemp(path.join(tmpdir(), "douane-ai-ocr-"));
  try {
    const imagePath = await renderPage(pdfPath, pageNumber, directory);
    const image = await readFile(imagePath);
    const result = await ocrWorker.recognize(image, {}, { text: true, blocks: true });
    const text = compact(result.data.text || "");
    const confidence = clamp(Number(result.data.confidence || 0), 0, 100);
    return { text, confidence, blocks: flattenBlocks(result.data.blocks), imageSha256: sha256(image) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function downloadDocument(db, job, directory) {
  const { data: document, error } = await db.from("source_documents").select("storage_bucket,storage_path").eq("id", job.source_document_id).single();
  if (error) throw new Error(`document_lookup:${error.message}`);
  const { data: blob, error: downloadError } = await db.storage.from(document.storage_bucket).download(document.storage_path);
  if (downloadError) throw new Error(`storage_download:${downloadError.message}`);
  const filePath = path.join(directory, `${job.source_document_id}.pdf`);
  await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
  return filePath;
}

async function saveOutput(db, job, recognized) {
  const outputSha256 = sha256(recognized.text);
  const identity = {
    source_page_id: job.source_page_id,
    pipeline_version_id: PIPELINE_VERSION,
    engine: "tesseract.js",
    engine_version: ENGINE_VERSION,
    output_kind: "ocr",
    output_sha256: outputSha256,
  };
  let { data: existing, error: existingError } = await db.from("page_engine_outputs").select("id").match(identity).maybeSingle();
  if (existingError) throw new Error(`output_lookup:${existingError.message}`);
  let outputId = existing?.id;
  if (!outputId) {
    const { data: inserted, error } = await db.from("page_engine_outputs").insert({
      ...identity,
      text_content: recognized.text,
      confidence: recognized.confidence,
      payload: { image_sha256: recognized.imageSha256, languages: process.env.OCR_LANGUAGES || "fra+ara+eng" },
    }).select("id").single();
    if (error) throw new Error(`output_insert:${error.message}`);
    outputId = inserted.id;
    if (recognized.blocks.length) {
      const { error: blockError } = await db.from("page_blocks").insert(recognized.blocks.map((block) => ({ ...block, source_page_id: job.source_page_id, engine_output_id: outputId })));
      if (blockError) throw new Error(`blocks_insert:${blockError.message}`);
    }
  }
  const score = qualityScore(recognized.text, recognized.confidence);
  const { error: diagnosticError } = await db.from("page_diagnostics").update({
    status: recognized.text.length >= 80 ? "complete" : "incomplete",
    recommended_strategy: recognized.text.length >= 80 ? "ocr" : "vision",
    character_count: recognized.text.length,
    word_count: wordCount(recognized.text),
    line_count: Math.max(1, recognized.text.split("\n").length),
    requires_ocr: recognized.text.length < 80,
    quality_score: score,
    metrics: { basis: "ocr", engine: ENGINE_VERSION, ocr_confidence: recognized.confidence, image_sha256: recognized.imageSha256 },
  }).eq("source_page_id", job.source_page_id).eq("pipeline_version_id", PIPELINE_VERSION);
  if (diagnosticError) throw new Error(`diagnostic_update:${diagnosticError.message}`);
  return { output_id: outputId, chars: recognized.text.length, confidence: recognized.confidence, quality_score: score, blocks: recognized.blocks.length };
}

async function processJob(db, ocrWorker, job, workerId) {
  const directory = await mkdtemp(path.join(tmpdir(), "douane-ai-pdf-"));
  try {
    const pageNumber = Number(job.payload?.page_number);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new Error("invalid_page_number");
    const pdfPath = await downloadDocument(db, job, directory);
    const recognized = await recognizePage(ocrWorker, pdfPath, pageNumber);
    const summary = await saveOutput(db, job, recognized);
    const { data: completed, error } = await db.rpc("complete_ingestion_job", { job_id: job.id, worker_id: workerId, job_result: summary });
    if (error || !completed) throw new Error(`complete_job:${error?.message || "lease lost"}`);
    process.stdout.write(`${JSON.stringify({ event: "job_completed", job_id: job.id, ...summary })}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { error: failError } = await db.rpc("fail_ingestion_job", { job_id: job.id, worker_id: workerId, error_code: message.split(":", 1)[0], error_message: message });
    if (failError) process.stderr.write(`${JSON.stringify({ event: "job_fail_update_error", job_id: job.id, error: failError.message })}\n`);
    process.stderr.write(`${JSON.stringify({ event: "job_failed", job_id: job.id, error: message })}\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function localMode(pdfPath, pageNumber) {
  const worker = await createWorker((process.env.OCR_LANGUAGES || "fra+ara+eng").split("+"), 1, tesseractOptions());
  try {
    const result = await recognizePage(worker, pdfPath, pageNumber);
    process.stdout.write(`${JSON.stringify({ page: pageNumber, chars: result.text.length, confidence: result.confidence, quality_score: qualityScore(result.text, result.confidence), blocks: result.blocks.length, excerpt: result.text.slice(0, 300) }, null, 2)}\n`);
  } finally {
    await worker.terminate();
  }
}

async function queueMode() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const workerId = process.env.CORPUS_WORKER_ID || `ocr-${process.pid}`;
  const batchSize = clamp(Number(process.env.WORKER_BATCH_SIZE || 3), 1, 10);
  const ocrWorker = await createWorker((process.env.OCR_LANGUAGES || "fra+ara+eng").split("+"), 1, tesseractOptions());
  try {
    do {
      const { data: jobs, error } = await db.rpc("claim_ingestion_jobs", { worker_id: workerId, accepted_types: ["ocr_page"], batch_size: batchSize });
      if (error) throw new Error(`claim_jobs:${error.message}`);
      for (const job of jobs || []) await processJob(db, ocrWorker, job, workerId);
      if (!args.has("--loop") || !jobs?.length) break;
    } while (true);
  } finally {
    await ocrWorker.terminate();
  }
}

const localPdf = args.get("--local-pdf");
if (localPdf) await localMode(path.resolve(String(localPdf)), Number(args.get("--page") || 1));
else await queueMode();
