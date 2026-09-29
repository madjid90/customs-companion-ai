import { z } from "zod";
import { buildSourceAdapterPlan, type SourceAdapterPlan } from "./source-adapters";
import { downloadOfficialAssetCandidate, type OfficialAssetDownloadOptions } from "./source-discovery-fetcher";
import { persistSourceDiscoveryPlan, type PersistSourceDiscoveryResult, type SourceDiscoveryDbClient } from "./source-discovery-store";
import { sourceCatalogSchema, sourceConnectorPlanSchema, type SourceCatalogEntry, type SourceConnectorPlan } from "./source-registry";

const sourceCatalogRowSchema = z.object({
  id: z.string().uuid(),
  source_code: z.string().min(2),
  authority_code: z.string().min(2).nullable().optional(),
  authority_catalog: z.object({ authority_code: z.string().min(2) }).nullable().optional(),
  name: z.string().min(2),
  source_family: z.string().min(2),
  official_url: z.string().url(),
  access_method: z.string().min(2),
  automation_status: z.string().min(2),
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  update_frequency: z.string().min(2),
  data_domains: z.array(z.string()).default([]),
  formats: z.array(z.string()).default([]),
  reuse_status: z.string().min(2),
  reliability_level: z.string().min(2),
  ingestion_strategy: z.string().min(2),
  active: z.boolean(),
  notes: z.string().nullable().optional(),
});

const sourceConnectorConfigRowSchema = z.object({
  id: z.string().uuid(),
  source_catalog_id: z.string().uuid(),
  connector_code: z.string().min(2),
  connector_type: z.string().min(2),
  pipeline_component: z.string().min(2),
  schedule_policy: z.string().min(2),
  status: z.string().min(2),
});

export const sourceDiscoveryTargetSchema = z.object({
  source: sourceCatalogRowSchema,
  connector: sourceConnectorConfigRowSchema.nullable().optional(),
});

export type SourceCatalogRow = z.infer<typeof sourceCatalogRowSchema>;
export type SourceConnectorConfigRow = z.infer<typeof sourceConnectorConfigRowSchema>;
export type SourceDiscoveryTarget = z.infer<typeof sourceDiscoveryTargetSchema>;

export type RunSourceDiscoveryOptions = OfficialAssetDownloadOptions & {
  executeNetwork?: boolean;
};

export type RunSourceDiscoveryResult = PersistSourceDiscoveryResult & {
  sourceCode: string;
  connectorType: string;
  networkExecuted: boolean;
  candidateCount: number;
};

type LoadableDiscoveryDbClient = SourceDiscoveryDbClient & {
  from(table: "source_catalog"): {
    select(columns?: string): {
      eq(column: string, value: unknown): {
        order(column: string, options?: { ascending?: boolean }): {
          limit(count: number): PromiseLike<{ data: SourceCatalogRow[] | null; error: { message?: string } | null }>;
        };
      };
    };
  };
  from(table: "source_connector_configs"): {
    select(columns?: string): {
      in(column: string, values: string[]): PromiseLike<{ data: SourceConnectorConfigRow[] | null; error: { message?: string } | null }>;
    };
  };
};

function dbError(error: { message?: string } | null, fallback: string) {
  return error?.message || fallback;
}

export function mapSourceCatalogRow(row: SourceCatalogRow): SourceCatalogEntry {
  const parsed = sourceCatalogRowSchema.parse(row);
  return sourceCatalogSchema.parse({
    sourceCode: parsed.source_code,
    authorityCode: parsed.authority_catalog?.authority_code ?? parsed.authority_code ?? "UNKNOWN",
    name: parsed.name,
    sourceFamily: parsed.source_family,
    officialUrl: parsed.official_url,
    accessMethod: parsed.access_method,
    automationStatus: parsed.automation_status,
    priority: parsed.priority,
    updateFrequency: parsed.update_frequency,
    dataDomains: parsed.data_domains,
    formats: parsed.formats,
    reuseStatus: parsed.reuse_status,
    reliabilityLevel: parsed.reliability_level,
    ingestionStrategy: parsed.ingestion_strategy,
    active: parsed.active,
    notes: parsed.notes ?? null,
  });
}

export function mapConnectorConfigRow(row: SourceConnectorConfigRow | null | undefined): SourceConnectorPlan | undefined {
  if (!row) return undefined;
  const parsed = sourceConnectorConfigRowSchema.parse(row);
  const status = parsed.status === "retired" ? "deprecated" : parsed.status;
  return sourceConnectorPlanSchema.parse({
    connectorCode: parsed.connector_code,
    connectorType: parsed.connector_type,
    pipelineComponent: parsed.pipeline_component,
    schedulePolicy: parsed.schedule_policy === "disabled" ? "manual" : parsed.schedule_policy,
    status,
    requiresReviewBeforeActivation: status !== "active",
  });
}

export function buildDiscoveryTargetPlan(target: SourceDiscoveryTarget) {
  const parsed = sourceDiscoveryTargetSchema.parse(target);
  const source = mapSourceCatalogRow(parsed.source);
  const connector = mapConnectorConfigRow(parsed.connector);
  const plan = buildSourceAdapterPlan(source, connector);
  return { source, connector, plan };
}

function contextForTarget(target: SourceDiscoveryTarget, plan: SourceAdapterPlan) {
  return {
    sourceCatalogId: target.source.id,
    sourceConnectorConfigId: target.connector?.id ?? null,
    sourceCode: target.source.source_code,
    connectorCode: plan.connectorCode,
    connectorType: plan.connectorType,
    pipelineComponent: plan.pipelineComponent,
  };
}

export async function runSourceDiscoveryTarget(
  db: SourceDiscoveryDbClient,
  target: SourceDiscoveryTarget,
  options: RunSourceDiscoveryOptions = {},
): Promise<RunSourceDiscoveryResult> {
  const { plan } = buildDiscoveryTargetPlan(target);
  const canFetch = ["direct_pdf_fetcher", "spreadsheet_importer"].includes(plan.connectorType);
  const candidates = options.executeNetwork === false || !canFetch
    ? []
    : [await downloadOfficialAssetCandidate(plan, options)];
  const persisted = await persistSourceDiscoveryPlan(db, contextForTarget(target, plan), plan, candidates);
  return {
    ...persisted,
    sourceCode: target.source.source_code,
    connectorType: plan.connectorType,
    networkExecuted: candidates.length > 0,
    candidateCount: candidates.length,
  };
}

export async function loadActiveSourceDiscoveryTargets(
  db: LoadableDiscoveryDbClient,
  limit = 25,
): Promise<SourceDiscoveryTarget[]> {
  const { data: sources, error: sourceError } = await db.from("source_catalog")
    .select("id,source_code,name,source_family,official_url,access_method,automation_status,priority,update_frequency,data_domains,formats,reuse_status,reliability_level,ingestion_strategy,active,notes,authority_catalog(authority_code)")
    .eq("active", true)
    .order("priority", { ascending: true })
    .limit(limit);
  if (sourceError) throw new Error(dbError(sourceError, "source_catalog_load_failed"));
  const rows = (sources ?? []).map((source) => sourceCatalogRowSchema.parse(source));
  if (rows.length === 0) return [];

  const { data: connectors, error: connectorError } = await db.from("source_connector_configs")
    .select("id,source_catalog_id,connector_code,connector_type,pipeline_component,schedule_policy,status")
    .in("source_catalog_id", rows.map((source) => source.id));
  if (connectorError) throw new Error(dbError(connectorError, "source_connector_configs_load_failed"));

  const bySource = new Map((connectors ?? []).map((connector) => {
    const parsed = sourceConnectorConfigRowSchema.parse(connector);
    return [parsed.source_catalog_id, parsed] as const;
  }));
  return rows.map((source) => ({ source, connector: bySource.get(source.id) ?? null }));
}
