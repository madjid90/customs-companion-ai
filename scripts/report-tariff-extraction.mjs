#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function count(table, filter = (query) => query) {
  const { count: value, error } = await filter(db.from(table).select("id", { count: "exact", head: true }));
  if (error) throw new Error(`${table}_count:${error.message}`);
  return value || 0;
}

async function grouped(table, column, limit = 20) {
  const { data, error } = await db.from(table).select(column).limit(100000);
  if (error) throw new Error(`${table}_${column}:${error.message}`);
  const totals = new Map();
  for (const row of data || []) {
    const value = row[column];
    if (Array.isArray(value)) {
      for (const item of value) totals.set(item, (totals.get(item) || 0) + 1);
    } else {
      totals.set(value ?? "null", (totals.get(value ?? "null") || 0) + 1);
    }
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value, total]) => ({ value, total }));
}

const [
  queued,
  running,
  completed,
  quarantined,
  runs,
  rows,
  validRows,
  ambiguousRows,
  invalidRows,
  rowsWithDuty,
  rowsWithVat,
  rowsWithUnit,
  cells,
  rowStatuses,
  validationCodes,
] = await Promise.all([
  count("ingestion_jobs", (query) => query.eq("job_type", "extract_tariff").eq("pipeline_version_id", "tariff-extractor-v2").eq("status", "queued")),
  count("ingestion_jobs", (query) => query.eq("job_type", "extract_tariff").eq("pipeline_version_id", "tariff-extractor-v2").eq("status", "running")),
  count("ingestion_jobs", (query) => query.eq("job_type", "extract_tariff").eq("pipeline_version_id", "tariff-extractor-v2").eq("status", "completed")),
  count("ingestion_jobs", (query) => query.eq("job_type", "extract_tariff").eq("pipeline_version_id", "tariff-extractor-v2").eq("status", "quarantined")),
  count("tariff_extraction_runs"),
  count("tariff_row_candidates"),
  count("tariff_row_candidates", (query) => query.eq("validation_status", "valid")),
  count("tariff_row_candidates", (query) => query.eq("validation_status", "ambiguous")),
  count("tariff_row_candidates", (query) => query.eq("validation_status", "invalid")),
  count("tariff_row_candidates", (query) => query.not("duty_rate", "is", null)),
  count("tariff_row_candidates", (query) => query.not("vat_rate", "is", null)),
  count("tariff_row_candidates", (query) => query.not("unit_code", "is", null)),
  count("tariff_cell_evidence"),
  grouped("tariff_row_candidates", "validation_status"),
  grouped("tariff_row_candidates", "validation_codes"),
]);

process.stdout.write(`${JSON.stringify({
  pipeline_version: "tariff-extractor-v2",
  jobs: { queued, running, completed, quarantined },
  extraction_runs: runs,
  row_candidates: {
    total: rows,
    valid: validRows,
    ambiguous: ambiguousRows,
    invalid: invalidRows,
    with_duty_rate: rowsWithDuty,
    with_vat_rate: rowsWithVat,
    with_unit: rowsWithUnit,
  },
  cell_evidence: cells,
  grouped: {
    row_statuses: rowStatuses,
    validation_codes: validationCodes,
  },
}, null, 2)}\n`);
