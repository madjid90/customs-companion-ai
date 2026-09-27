import { describe, expect, it } from "vitest";
import { buildSourceConnectorPlan, sourceReadinessBlockers, validateSourceRegistry } from "../source-registry";
import { moroccoV1SourceRegistry } from "./morocco-v1";

describe("morocco V1 country pack", () => {
  it("declares the audited P0 source coverage", () => {
    expect(validateSourceRegistry(moroccoV1SourceRegistry)).toEqual([]);
    expect(moroccoV1SourceRegistry.authorities).toHaveLength(12);
    expect(moroccoV1SourceRegistry.sources).toHaveLength(17);
    expect(moroccoV1SourceRegistry.sources.filter((source) => source.priority === "P0")).toHaveLength(16);
  });

  it("derives connector plans from data, not country-specific code", () => {
    const plans = moroccoV1SourceRegistry.sources.map(buildSourceConnectorPlan);
    expect(plans.filter((plan) => plan.connectorType === "portal_index_monitor").map((plan) => plan.connectorCode)).toEqual([
      "adii_tarif_connector",
      "anrt_equipment_approval_connector",
    ]);
    expect(plans.filter((plan) => plan.connectorType === "direct_pdf_fetcher").length).toBe(4);
    expect(plans.find((plan) => plan.connectorCode === "wco_hs_international_connector")).toMatchObject({
      connectorType: "blocked",
      status: "blocked",
    });
  });

  it("keeps all non-licensed P0 sources waiting for connector activation", () => {
    const readiness = moroccoV1SourceRegistry.sources.map((source) => ({
      code: source.sourceCode,
      blockers: sourceReadinessBlockers(source),
    }));
    expect(readiness.filter((item) => item.blockers.includes("connector_not_activated"))).toHaveLength(17);
    expect(readiness.find((item) => item.code === "WCO_HS_INTERNATIONAL")?.blockers).toContain("license_required");
    expect(readiness.filter((item) => item.code !== "WCO_HS_INTERNATIONAL" && item.blockers.includes("license_required"))).toEqual([]);
  });
});
