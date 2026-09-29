import { z } from "zod";
import type { SourceAdapterPlan } from "./source-adapters";

export const discoveryRunModeSchema = z.enum(["plan_only", "discovery", "download", "snapshot", "import"]);
export const discoveryRunStatusSchema = z.enum(["planned", "running", "completed", "completed_with_warnings", "failed", "blocked", "cancelled"]);
export const sourceAssetProviderSchema = z.enum(["google_drive", "local_filesystem", "official_web", "manual_upload"]);
export const sourceAssetStatusSchema = z.enum(["discovered", "matched", "queued", "processing", "ingested", "unchanged", "superseded", "failed", "ignored"]);

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const nullableSha256 = sha256.nullable();
const optionalUrl = z.string().url().nullable().optional();

export const sourceDiscoveryContextSchema = z.object({
  sourceCatalogId: uuid,
  sourceConnectorConfigId: uuid.nullable().optional(),
  sourceCode: z.string().trim().min(2),
  connectorCode: z.string().trim().min(2),
  connectorType: z.string().trim().min(2),
  pipelineComponent: z.string().trim().min(2),
});

export const discoveredAssetCandidateSchema = z.object({
  url: z.string().url(),
  filename: z.string().trim().min(1),
  mimeType: z.string().trim().min(1),
  byteSize: z.number().int().nonnegative().nullable().optional(),
  contentSha256: nullableSha256.optional(),
  providerModifiedAt: z.string().datetime().nullable().optional(),
  providerRevision: z.string().trim().min(1).nullable().optional(),
  detectedDocumentType: z.string().trim().min(2).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const discoveryRunInsertSchema = z.object({
  source_catalog_id: uuid,
  source_connector_config_id: uuid.nullable(),
  connector_type: z.string().min(2),
  pipeline_component: z.string().min(2),
  run_mode: discoveryRunModeSchema,
  status: discoveryRunStatusSchema,
  discovered_count: z.number().int().nonnegative(),
  changed_count: z.number().int().nonnegative(),
  queued_asset_count: z.number().int().nonnegative(),
  blocked_reason: z.string().nullable(),
  plan: z.record(z.unknown()),
  metrics: z.record(z.unknown()),
});

export const sourceAssetUpsertSchema = z.object({
  provider: sourceAssetProviderSchema,
  external_id: z.string().min(2),
  root_external_id: z.string().nullable(),
  relative_path: z.string().min(1),
  filename: z.string().min(1),
  mime_type: z.string().min(1),
  byte_size: z.number().int().nonnegative().nullable(),
  content_sha256: nullableSha256,
  provider_modified_at: z.string().datetime().nullable(),
  provider_revision: z.string().nullable(),
  source_url: z.string().url(),
  detected_document_type: z.string().nullable(),
  discovery_status: sourceAssetStatusSchema,
  source_catalog_id: uuid,
  source_connector_config_id: uuid.nullable(),
  discovery_run_id: uuid.nullable(),
  metadata: z.record(z.unknown()),
});

export type SourceDiscoveryContext = z.infer<typeof sourceDiscoveryContextSchema>;
export type DiscoveredAssetCandidate = z.infer<typeof discoveredAssetCandidateSchema>;
export type DiscoveryRunInsert = z.infer<typeof discoveryRunInsertSchema>;
export type SourceAssetUpsert = z.infer<typeof sourceAssetUpsertSchema>;

export function inferRunMode(plan: SourceAdapterPlan): z.infer<typeof discoveryRunModeSchema> {
  const actionType = plan.actions[0]?.actionType;
  if (plan.status === "blocked" || actionType === "blocked_pending_license") return "plan_only";
  if (actionType === "fetch_direct_document") return "download";
  if (actionType === "capture_portal_snapshot") return "snapshot";
  if (actionType === "import_spreadsheet") return "import";
  return "discovery";
}

export function createDiscoveryRunInsert(context: SourceDiscoveryContext, plan: SourceAdapterPlan): DiscoveryRunInsert {
  const parsedContext = sourceDiscoveryContextSchema.parse(context);
  const mode = inferRunMode(plan);
  const isBlocked = plan.status === "blocked";
  return discoveryRunInsertSchema.parse({
    source_catalog_id: parsedContext.sourceCatalogId,
    source_connector_config_id: parsedContext.sourceConnectorConfigId ?? null,
    connector_type: parsedContext.connectorType,
    pipeline_component: parsedContext.pipelineComponent,
    run_mode: mode,
    status: isBlocked ? "blocked" : "planned",
    discovered_count: 0,
    changed_count: 0,
    queued_asset_count: 0,
    blocked_reason: isBlocked ? plan.blockers.join(",") || "blocked" : null,
    plan: {
      version: "source-adapter-plan-v1",
      source_code: parsedContext.sourceCode,
      connector_code: parsedContext.connectorCode,
      adapter_status: plan.status,
      blockers: plan.blockers,
      actions: plan.actions,
      writes_canonical_facts: false,
    },
    metrics: {},
  });
}

function normalizePathPart(value: string) {
  return value.trim().replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/g, "").replace(/\.\.+/g, ".");
}

function inferProvider(plan: SourceAdapterPlan) {
  return plan.connectorType === "manual_upload" ? "manual_upload" : "official_web";
}

function externalIdFor(context: SourceDiscoveryContext, candidate: DiscoveredAssetCandidate) {
  const identity = candidate.contentSha256 ?? candidate.providerRevision ?? candidate.url;
  return `${context.sourceCode}:${identity}`;
}

export function createSourceAssetUpsert(
  context: SourceDiscoveryContext,
  plan: SourceAdapterPlan,
  candidate: DiscoveredAssetCandidate,
  discoveryRunId?: string | null,
): SourceAssetUpsert {
  const parsedContext = sourceDiscoveryContextSchema.parse(context);
  const parsedCandidate = discoveredAssetCandidateSchema.parse(candidate);
  const provider = inferProvider(plan);
  const filename = normalizePathPart(parsedCandidate.filename.split("/").at(-1) || parsedCandidate.filename);
  const sourcePath = normalizePathPart(`${parsedContext.sourceCode}/${filename}`);

  return sourceAssetUpsertSchema.parse({
    provider,
    external_id: externalIdFor(parsedContext, parsedCandidate),
    root_external_id: parsedContext.sourceCode,
    relative_path: sourcePath,
    filename,
    mime_type: parsedCandidate.mimeType,
    byte_size: parsedCandidate.byteSize ?? null,
    content_sha256: parsedCandidate.contentSha256 ?? null,
    provider_modified_at: parsedCandidate.providerModifiedAt ?? null,
    provider_revision: parsedCandidate.providerRevision ?? null,
    source_url: parsedCandidate.url,
    detected_document_type: parsedCandidate.detectedDocumentType ?? null,
    discovery_status: parsedCandidate.contentSha256 ? "queued" : "discovered",
    source_catalog_id: parsedContext.sourceCatalogId,
    source_connector_config_id: parsedContext.sourceConnectorConfigId ?? null,
    discovery_run_id: discoveryRunId ?? null,
    metadata: {
      ...(parsedCandidate.metadata ?? {}),
      source_code: parsedContext.sourceCode,
      connector_code: parsedContext.connectorCode,
      connector_type: parsedContext.connectorType,
      pipeline_component: parsedContext.pipelineComponent,
      adapter_action: plan.actions[0]?.actionType ?? "unknown",
      canonical_fact_write: false,
    },
  });
}

export function summarizeDiscoveryPersistence(run: DiscoveryRunInsert, assets: SourceAssetUpsert[]) {
  return {
    source_catalog_id: run.source_catalog_id,
    connector_type: run.connector_type,
    run_mode: run.run_mode,
    status: run.status,
    discovered_count: assets.length,
    queued_asset_count: assets.filter((asset) => asset.discovery_status === "queued").length,
    writes_canonical_facts: false,
  };
}
