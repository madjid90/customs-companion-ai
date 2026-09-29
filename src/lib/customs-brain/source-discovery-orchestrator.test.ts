import { describe, expect, it } from "vitest";
import { buildDiscoveryTargetPlan, mapConnectorConfigRow, mapSourceCatalogRow, runSourceDiscoveryTarget, type SourceDiscoveryTarget } from "./source-discovery-orchestrator";
import type { SourceDiscoveryDbClient } from "./source-discovery-store";

const source = {
  id: "11111111-1111-4111-8111-111111111111",
  source_code: "MIC_INDUSTRIAL_CONTROL_LIST",
  authority_catalog: { authority_code: "MIC" },
  name: "Liste produits industriels contrôlés",
  source_family: "technical_control",
  official_url: "https://example.gov.ma/list.pdf",
  access_method: "direct_pdf",
  automation_status: "semi_automatic",
  priority: "P0" as const,
  update_frequency: "event_driven",
  data_domains: ["technical_control", "hs"],
  formats: ["pdf"],
  reuse_status: "review_required",
  reliability_level: "official",
  ingestion_strategy: "download_and_extract",
  active: true,
  notes: null,
};

const connector = {
  id: "22222222-2222-4222-8222-222222222222",
  source_catalog_id: source.id,
  connector_code: "mic_industrial_control_list_adapter",
  connector_type: "direct_pdf_fetcher",
  pipeline_component: "obligation-extractor",
  schedule_policy: "manual",
  status: "active",
};

function fakeDb() {
  const calls: Array<{ table: string; operation: string; values?: unknown; options?: unknown }> = [];
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
            return { eq: async () => ({ data: null, error: null }) };
          },
        };
      }
      return {
        upsert: async (values: unknown, options: { onConflict: string }) => {
          calls.push({ table, operation: "upsert", values, options });
          return { data: null, error: null };
        },
      };
    },
  };
  return { db, calls };
}

function response(body: string) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => ({ "content-type": "application/pdf", "content-length": String(bytes.length) }[name.toLowerCase()] ?? null) },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe("source discovery orchestrator", () => {
  it("maps Supabase source rows to generic source entries", () => {
    expect(mapSourceCatalogRow(source)).toMatchObject({
      sourceCode: "MIC_INDUSTRIAL_CONTROL_LIST",
      authorityCode: "MIC",
      accessMethod: "direct_pdf",
      automationStatus: "semi_automatic",
      reuseStatus: "review_required",
    });
  });

  it("maps connector configs without hard-coding Morocco", () => {
    expect(mapConnectorConfigRow(connector)).toMatchObject({
      connectorCode: "mic_industrial_control_list_adapter",
      connectorType: "direct_pdf_fetcher",
      pipelineComponent: "obligation-extractor",
      status: "active",
      requiresReviewBeforeActivation: false,
    });
  });

  it("builds a target plan from source and connector rows", () => {
    const target: SourceDiscoveryTarget = { source, connector };
    expect(buildDiscoveryTargetPlan(target).plan).toMatchObject({
      sourceCode: "MIC_INDUSTRIAL_CONTROL_LIST",
      connectorType: "direct_pdf_fetcher",
      status: "ready_to_activate",
      blockers: [],
    });
  });

  it("downloads and persists a direct asset for active simple connectors", async () => {
    const target: SourceDiscoveryTarget = { source, connector };
    const { db, calls } = fakeDb();
    const result = await runSourceDiscoveryTarget(db, target, { fetchImpl: async () => response("official bytes") });

    expect(result).toMatchObject({
      sourceCode: "MIC_INDUSTRIAL_CONTROL_LIST",
      connectorType: "direct_pdf_fetcher",
      networkExecuted: true,
      candidateCount: 1,
      runStatus: "completed",
    });
    expect(calls.find((call) => call.table === "source_assets" && call.operation === "upsert")).toBeDefined();
  });

  it("can plan complex connectors without network execution", async () => {
    const target: SourceDiscoveryTarget = {
      source: { ...source, source_code: "ADII_TARIF", source_family: "tariff", access_method: "portal", official_url: "https://www.douane.gov.ma/web/guest/tarif" },
      connector: { ...connector, connector_type: "portal_index_monitor", pipeline_component: "tariff-extractor" },
    };
    const { db } = fakeDb();
    const result = await runSourceDiscoveryTarget(db, target);

    expect(result).toMatchObject({
      connectorType: "portal_index_monitor",
      networkExecuted: false,
      candidateCount: 0,
      runStatus: "completed",
    });
  });
});
