import { describe, expect, it } from "vitest";
import { buildSourceAdapterPlan } from "./source-adapters";
import { moroccoV1SourceRegistry } from "./country-packs/morocco-v1";
import { persistSourceDiscoveryPlan, type SourceDiscoveryDbClient } from "./source-discovery-store";

function createFakeDb(options: { failAssets?: boolean } = {}) {
  const calls: Array<{ table: string; operation: string; values?: unknown; options?: unknown; column?: string; value?: unknown }> = [];
  const db: SourceDiscoveryDbClient = {
    from(table: "source_discovery_runs" | "source_assets") {
      if (table === "source_discovery_runs") {
        return {
          insert(values: unknown) {
            calls.push({ table, operation: "insert", values });
            return { select: () => ({ single: async () => ({ data: { id: "33333333-3333-4333-8333-333333333333" }, error: null }) }) };
          },
          update(values: unknown) {
            calls.push({ table, operation: "update", values });
            return { eq: async (column: string, value: unknown) => { calls.push({ table, operation: "eq", column, value }); return { data: null, error: null }; } };
          },
        };
      }
      return {
        upsert: async (values: unknown, upsertOptions: { onConflict: string }) => {
          calls.push({ table, operation: "upsert", values, options: upsertOptions });
          return options.failAssets ? { data: null, error: { message: "asset write failed" } } : { data: null, error: null };
        },
      };
    },
  };
  return { db, calls };
}

const context = {
  sourceCatalogId: "11111111-1111-4111-8111-111111111111",
  sourceConnectorConfigId: "22222222-2222-4222-8222-222222222222",
  sourceCode: "ADII_CIRCULAR_PDFS",
  connectorCode: "adii_circular_pdfs_connector",
  connectorType: "direct_pdf_fetcher",
  pipelineComponent: "legal-structure-extractor",
};

describe("source discovery store", () => {
  it("persists a discovery run and idempotent asset upserts", async () => {
    const source = moroccoV1SourceRegistry.sources.find((item) => item.sourceCode === "ADII_CIRCULAR_PDFS")!;
    const plan = buildSourceAdapterPlan(source);
    const { db, calls } = createFakeDb();

    const result = await persistSourceDiscoveryPlan(db, context, plan, [{
      url: "https://www.douane.gov.ma/adil/PDF/5740.PDF",
      filename: "5740.PDF",
      mimeType: "application/pdf",
      contentSha256: "c".repeat(64),
      detectedDocumentType: "circular",
    }]);

    expect(result).toMatchObject({
      runId: "33333333-3333-4333-8333-333333333333",
      runStatus: "completed",
      summary: {
        discovered_count: 1,
        queued_asset_count: 1,
        writes_canonical_facts: false,
      },
    });
    expect(calls.find((call) => call.table === "source_assets" && call.operation === "upsert")).toMatchObject({
      options: { onConflict: "provider,external_id" },
    });
    expect(calls.filter((call) => call.table === "source_discovery_runs" && call.operation === "update").at(-1)?.values).toMatchObject({
      status: "completed",
      discovered_count: 1,
      changed_count: 1,
      queued_asset_count: 1,
    });
  });

  it("marks the run failed if asset persistence fails", async () => {
    const source = moroccoV1SourceRegistry.sources.find((item) => item.sourceCode === "ADII_CIRCULAR_PDFS")!;
    const plan = buildSourceAdapterPlan(source);
    const { db, calls } = createFakeDb({ failAssets: true });

    await expect(persistSourceDiscoveryPlan(db, context, plan, [{
      url: "https://www.douane.gov.ma/adil/PDF/5740.PDF",
      filename: "5740.PDF",
      mimeType: "application/pdf",
      contentSha256: "d".repeat(64),
    }])).rejects.toThrow("asset write failed");

    expect(calls.filter((call) => call.table === "source_discovery_runs" && call.operation === "update").at(-1)?.values).toMatchObject({
      status: "failed",
      error_summary: "asset write failed",
    });
  });
});
