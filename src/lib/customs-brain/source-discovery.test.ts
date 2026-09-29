import { describe, expect, it } from "vitest";
import { buildSourceAdapterPlan } from "./source-adapters";
import { moroccoV1SourceRegistry } from "./country-packs/morocco-v1";
import { createDiscoveryRunInsert, createSourceAssetUpsert, inferRunMode, summarizeDiscoveryPersistence } from "./source-discovery";

const context = {
  sourceCatalogId: "11111111-1111-4111-8111-111111111111",
  sourceConnectorConfigId: "22222222-2222-4222-8222-222222222222",
  sourceCode: "ADII_CIRCULAR_PDFS",
  connectorCode: "adii_circular_pdfs_connector",
  connectorType: "direct_pdf_fetcher",
  pipelineComponent: "legal-structure-extractor",
};

describe("source discovery persistence", () => {
  it("creates a planned discovery run that never writes canonical facts", () => {
    const source = moroccoV1SourceRegistry.sources.find((item) => item.sourceCode === "ADII_CIRCULAR_PDFS")!;
    const plan = buildSourceAdapterPlan(source);
    const run = createDiscoveryRunInsert(context, plan);

    expect(inferRunMode(plan)).toBe("download");
    expect(run).toMatchObject({
      source_catalog_id: context.sourceCatalogId,
      source_connector_config_id: context.sourceConnectorConfigId,
      connector_type: "direct_pdf_fetcher",
      pipeline_component: "legal-structure-extractor",
      run_mode: "download",
      status: "planned",
      blocked_reason: null,
    });
    expect(run.plan.writes_canonical_facts).toBe(false);
  });

  it("builds idempotent source asset payloads for official web files", () => {
    const source = moroccoV1SourceRegistry.sources.find((item) => item.sourceCode === "ADII_CIRCULAR_PDFS")!;
    const plan = buildSourceAdapterPlan(source);
    const asset = createSourceAssetUpsert(context, plan, {
      url: "https://www.douane.gov.ma/adil/PDF/5740.PDF",
      filename: "5740.PDF",
      mimeType: "application/pdf",
      byteSize: 123456,
      contentSha256: "a".repeat(64),
      detectedDocumentType: "circular",
      metadata: { title: "Circulaire 5740" },
    }, "33333333-3333-4333-8333-333333333333");

    expect(asset).toMatchObject({
      provider: "official_web",
      external_id: `ADII_CIRCULAR_PDFS:${"a".repeat(64)}`,
      relative_path: "ADII_CIRCULAR_PDFS/5740.PDF",
      discovery_status: "queued",
      source_catalog_id: context.sourceCatalogId,
      source_connector_config_id: context.sourceConnectorConfigId,
      discovery_run_id: "33333333-3333-4333-8333-333333333333",
    });
    expect(asset.metadata).toMatchObject({
      connector_type: "direct_pdf_fetcher",
      canonical_fact_write: false,
    });
  });

  it("keeps spreadsheet imports as source assets before extraction", () => {
    const source = {
      ...moroccoV1SourceRegistry.sources[0],
      sourceCode: "MIC_PRODUCTS_XLSX",
      name: "Liste MIC XLSX",
      sourceFamily: "technical_control",
      officialUrl: "https://example.gov.ma/products.xlsx",
      accessMethod: "spreadsheet",
      formats: ["xlsx"],
      dataDomains: ["technical_control"],
      ingestionStrategy: "download_and_extract",
    };
    const plan = buildSourceAdapterPlan(source);
    const spreadsheetContext = { ...context, sourceCode: "MIC_PRODUCTS_XLSX", connectorType: "spreadsheet_importer", pipelineComponent: "spreadsheet-parser" };
    const run = createDiscoveryRunInsert(spreadsheetContext, plan);
    const asset = createSourceAssetUpsert(spreadsheetContext, plan, {
      url: "https://example.gov.ma/products.xlsx",
      filename: "products.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      contentSha256: null,
      detectedDocumentType: "technical_control",
    });

    expect(run.run_mode).toBe("import");
    expect(asset.discovery_status).toBe("discovered");
    expect(asset.metadata).toMatchObject({
      connector_type: "spreadsheet_importer",
      pipeline_component: "spreadsheet-parser",
      canonical_fact_write: false,
    });
  });

  it("summarizes discovery persistence without claiming publication", () => {
    const source = moroccoV1SourceRegistry.sources.find((item) => item.sourceCode === "ADII_CIRCULAR_PDFS")!;
    const plan = buildSourceAdapterPlan(source);
    const run = createDiscoveryRunInsert(context, plan);
    const asset = createSourceAssetUpsert(context, plan, {
      url: "https://www.douane.gov.ma/adil/PDF/5740.PDF",
      filename: "5740.PDF",
      mimeType: "application/pdf",
      contentSha256: "b".repeat(64),
    });

    expect(summarizeDiscoveryPersistence(run, [asset])).toEqual({
      source_catalog_id: context.sourceCatalogId,
      connector_type: "direct_pdf_fetcher",
      run_mode: "download",
      status: "planned",
      discovered_count: 1,
      queued_asset_count: 1,
      writes_canonical_facts: false,
    });
  });
});
