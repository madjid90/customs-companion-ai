import type { SourceAdapterPlan } from "./source-adapters";
import {
  createDiscoveryRunInsert,
  createSourceAssetUpsert,
  summarizeDiscoveryPersistence,
  type DiscoveredAssetCandidate,
  type SourceDiscoveryContext,
  type SourceAssetUpsert,
} from "./source-discovery";

type SupabaseResult<T> = PromiseLike<{ data: T | null; error: { message?: string } | null }>;

type InsertBuilder<T> = {
  select(columns?: string): { single(): SupabaseResult<T> };
};

type UpsertBuilder = PromiseLike<{ data: unknown; error: { message?: string } | null }>;

type UpdateBuilder<T> = {
  eq(column: string, value: unknown): SupabaseResult<T>;
};

type SourceDiscoveryTableClient = {
  insert(values: unknown): InsertBuilder<{ id: string }>;
  update(values: unknown): UpdateBuilder<unknown>;
};

type SourceAssetTableClient = {
  upsert(values: unknown, options: { onConflict: string }): UpsertBuilder;
};

export type SourceDiscoveryDbClient = {
  from(table: "source_discovery_runs"): SourceDiscoveryTableClient;
  from(table: "source_assets"): SourceAssetTableClient;
};

export type PersistSourceDiscoveryResult = {
  runId: string;
  runStatus: "blocked" | "completed" | "completed_with_warnings";
  assets: SourceAssetUpsert[];
  summary: ReturnType<typeof summarizeDiscoveryPersistence> & {
    run_id: string;
    changed_count: number;
  };
};

function dbErrorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message || fallback;
}

export async function persistSourceDiscoveryPlan(
  db: SourceDiscoveryDbClient,
  context: SourceDiscoveryContext,
  plan: SourceAdapterPlan,
  candidates: DiscoveredAssetCandidate[] = [],
): Promise<PersistSourceDiscoveryResult> {
  const initialRun = createDiscoveryRunInsert(context, plan);
  const { data: run, error: runError } = await db.from("source_discovery_runs").insert(initialRun).select("id").single();
  if (runError || !run?.id) throw new Error(dbErrorMessage(runError, "source_discovery_run_insert_failed"));

  const assets = candidates.map((candidate) => createSourceAssetUpsert(context, plan, candidate, run.id));
  try {
    if (assets.length > 0) {
      const { error: assetError } = await db.from("source_assets").upsert(assets, { onConflict: "provider,external_id" });
      if (assetError) throw new Error(dbErrorMessage(assetError, "source_asset_upsert_failed"));
    }

    const finalStatus = initialRun.status === "blocked" ? "blocked" : "completed";
    const update = {
      status: finalStatus,
      completed_at: new Date().toISOString(),
      discovered_count: assets.length,
      changed_count: assets.length,
      queued_asset_count: assets.filter((asset) => asset.discovery_status === "queued").length,
      metrics: {
        persisted_assets: assets.length,
        queued_assets: assets.filter((asset) => asset.discovery_status === "queued").length,
        canonical_fact_write: false,
      },
    };
    const { error: completeError } = await db.from("source_discovery_runs").update(update).eq("id", run.id);
    if (completeError) throw new Error(dbErrorMessage(completeError, "source_discovery_run_complete_failed"));

    const summary = summarizeDiscoveryPersistence({ ...initialRun, ...update }, assets);
    return {
      runId: run.id,
      runStatus: finalStatus,
      assets,
      summary: {
        ...summary,
        run_id: run.id,
        changed_count: assets.length,
      },
    };
  } catch (error) {
    await db.from("source_discovery_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_summary: error instanceof Error ? error.message : String(error),
    }).eq("id", run.id);
    throw error;
  }
}
