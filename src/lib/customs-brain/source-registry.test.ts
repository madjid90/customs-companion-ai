import { describe, expect, it } from "vitest";
import {
  buildSourceConnectorPlan,
  sourceReadinessBlockers,
  validateSourceRegistry,
  type AuthorityCatalogEntry,
  type JurisdictionPack,
  type SourceCatalogEntry,
} from "./source-registry";

const pack: JurisdictionPack = {
  jurisdictionCode: "MA",
  packCode: "ma_v1",
  displayName: "Maroc V1",
  scope: "country",
  status: "draft",
  versionLabel: "v1",
  coverageNotes: null,
};

const authorities: AuthorityCatalogEntry[] = [{
  authorityCode: "ADII",
  name: "Administration des Douanes et Impôts Indirects",
  authorityType: "customs_administration",
  officialUrl: "https://www.douane.gov.ma",
  dataDomains: ["tariff", "legal"],
  priority: "P0",
  active: true,
}];

const adiiTariff: SourceCatalogEntry = {
  sourceCode: "ADII_TARIF",
  authorityCode: "ADII",
  name: "Tarif intégré ADII",
  sourceFamily: "tariff",
  officialUrl: "https://www.douane.gov.ma/web/guest/tarif",
  accessMethod: "portal",
  automationStatus: "semi_automatic",
  priority: "P0",
  updateFrequency: "event_driven",
  dataDomains: ["hs", "tariff"],
  formats: ["html", "pdf"],
  reuseStatus: "review_required",
  reliabilityLevel: "official",
  ingestionStrategy: "crawl_and_extract",
  active: true,
  notes: null,
};

describe("source registry", () => {
  it("validates a country pack without hard-coding Morocco logic", () => {
    expect(validateSourceRegistry({ pack, authorities, sources: [adiiTariff] })).toEqual([]);
  });

  it("detects a source linked to a missing authority", () => {
    expect(validateSourceRegistry({ pack, authorities: [], sources: [adiiTariff] })).toContainEqual({
      code: "unknown_authority",
      sourceCode: "ADII_TARIF",
      authorityCode: "ADII",
      message: "La source référence une autorité absente du pack",
    });
  });

  it("plans a portal source as a browser snapshot connector until validation", () => {
    expect(buildSourceConnectorPlan(adiiTariff)).toMatchObject({
      connectorCode: "adii_tarif_connector",
      connectorType: "browser_snapshot",
      pipelineComponent: "source_discovery_worker",
      schedulePolicy: "manual_until_validated",
      status: "draft",
    });
    expect(sourceReadinessBlockers(adiiTariff)).toEqual(["connector_not_activated"]);
  });

  it("blocks licensed international data until access is cleared", () => {
    const wco: SourceCatalogEntry = {
      ...adiiTariff,
      sourceCode: "WCO_HS_INTERNATIONAL",
      authorityCode: "WCO",
      name: "OMD/WCO Harmonized System international",
      sourceFamily: "international_hs",
      officialUrl: "https://www.wcoomd.org/en/topics/nomenclature/instrument-and-tools/hs-nomenclature-2022-edition",
      accessMethod: "html",
      automationStatus: "license_required",
      priority: "P1",
      updateFrequency: "annual",
      dataDomains: ["hs", "international"],
      formats: ["html", "licensed_data"],
      reuseStatus: "license_required",
      ingestionStrategy: "blocked_pending_access",
    };

    expect(buildSourceConnectorPlan(wco)).toMatchObject({
      connectorType: "licensed_manual",
      pipelineComponent: "manual_license_gate",
      status: "blocked",
    });
    expect(sourceReadinessBlockers(wco)).toEqual([
      "license_required",
      "connector_blocked",
      "connector_not_activated",
    ]);
  });
});
