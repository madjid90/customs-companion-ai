#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { loadTargets, parseWorkerArgs, processTarget } from "./lib/source-discovery-worker.mjs";

const options = parseWorkerArgs();
if (options.help) {
  process.stdout.write(`Usage: npm run worker:source-discovery -- [options]

Options:
  --execute                 Persist discovery runs/assets. Default is dry-run.
  --include-draft           Include draft connectors. Default processes active connectors only.
  --plan-complex            Persist plan-only runs for HTML/index/portal connectors.
  --source-code CODE        Limit to one source_catalog source_code.
  --connector-type TYPE     Limit to one connector type.
  --limit N                 Max sources to inspect, default 10.
  --max-bytes N             Max download size, default 52428800.
  --materialize-documents   Upload file and create/link source_documents; requires latest migration.
  --storage-bucket NAME     Storage bucket for materialized documents; default legal-source-pdfs.

Required for non-help execution:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`);
  process.exit(0);
}
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const targets = await loadTargets(db, options);
const results = [];
for (const target of targets) {
  const result = await processTarget(db, target, options);
  results.push(result);
  const stream = result.status === "completed" || result.status === "planned" ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify({ event: "source_discovery", ...result })}\n`);
}
process.stdout.write(`${JSON.stringify({ event: "source_discovery_summary", execute: options.execute, dry_run: options.dryRun, total: results.length, completed: results.filter((item) => item.status === "completed").length, planned: results.filter((item) => item.status === "planned").length, skipped: results.filter((item) => item.status === "skipped").length }, null, 2)}\n`);
