import { describe, expect, it } from "vitest";
import { moroccoV1SourceRegistry } from "./country-packs/morocco-v1";
import { buildSourceAdapterPlan, buildSourceAdapterPlans, summarizeAdapterPlans } from "./source-adapters";

describe("source adapters", () => {
  it("plans every Morocco V1 source without writing canonical facts", () => {
    const plans = buildSourceAdapterPlans(moroccoV1SourceRegistry.sources);
    expect(plans).toHaveLength(17);
    expect(plans.flatMap((plan) => plan.actions).every((action) => action.writesCanonicalFacts === false)).toBe(true);
  });

  it("routes direct PDFs, PDF indexes, portals and HTML pages to distinct adapters", () => {
    const summary = summarizeAdapterPlans(buildSourceAdapterPlans(moroccoV1SourceRegistry.sources));
    expect(summary.byConnectorType).toMatchObject({
      direct_pdf_fetcher: 4,
      pdf_link_extractor: 1,
      portal_index_monitor: 2,
      html_crawler: 9,
      blocked: 1,
    });
    expect(summary.byPipelineComponent).toMatchObject({
      "tariff-extractor": 1,
      "legal-structure-extractor": 2,
      "obligation-extractor": 13,
      "document-ingestion-worker": 1,
    });
  });

  it("uses browser snapshots for complex portals", () => {
    const source = moroccoV1SourceRegistry.sources.find((item) => item.sourceCode === "ADII_TARIF");
    expect(source).toBeDefined();
    const plan = buildSourceAdapterPlan(source!);
    expect(plan.actions[0]).toMatchObject({
      actionType: "capture_portal_snapshot",
      requiresBrowser: true,
      produces: "source_index",
      writesCanonicalFacts: false,
    });
  });

  it("treats official Excel and CSV files as auditable source assets", () => {
    const source = {
      ...moroccoV1SourceRegistry.sources[0],
      sourceCode: "MIC_TECHNICAL_PRODUCTS_SPREADSHEET",
      name: "Liste officielle produits soumis à contrôle",
      sourceFamily: "technical_control",
      officialUrl: "https://example.gov.ma/produits-controles.xlsx",
      accessMethod: "spreadsheet",
      dataDomains: ["technical_control", "license", "products"],
      formats: ["xlsx", "csv"],
      ingestionStrategy: "download_and_extract",
    };

    const plan = buildSourceAdapterPlan(source);

    expect(plan).toMatchObject({
      connectorType: "spreadsheet_importer",
      pipelineComponent: "spreadsheet-parser",
    });
    expect(plan.actions[0]).toMatchObject({
      actionType: "import_spreadsheet",
      produces: "source_asset",
      requiresBrowser: false,
      writesCanonicalFacts: false,
    });
  });

  it("keeps licensed WCO data blocked", () => {
    const source = moroccoV1SourceRegistry.sources.find((item) => item.sourceCode === "WCO_HS_INTERNATIONAL");
    expect(source).toBeDefined();
    const plan = buildSourceAdapterPlan(source!);
    expect(plan).toMatchObject({ status: "blocked", connectorType: "blocked" });
    expect(plan.blockers).toEqual(["license_required", "connector_blocked"]);
    expect(plan.actions[0]).toMatchObject({ actionType: "blocked_pending_license", requiresNetwork: false });
  });
});
