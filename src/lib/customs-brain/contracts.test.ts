import { describe, expect, it } from "vitest";
import {
  classificationDecisionSchema,
  ingestionPublicationBlockers,
  legalRelationshipSchema,
  sourceDocumentSchema,
  type IngestionAssessment,
} from "./contracts";

const uuid = "11111111-1111-4111-8111-111111111111";
const hash = "a".repeat(64);

describe("customs brain contracts", () => {
  it("requires an official reference for a circular", () => {
    const result = sourceDocumentSchema.safeParse({
      sourceId: uuid,
      officialReference: null,
      title: "Circulaire tarifaire",
      documentType: "circular",
      languageCode: "fr",
      publicationDate: "2026-01-01",
      effectiveFrom: "2026-01-02",
      effectiveTo: null,
      sourceUrl: "https://www.douane.gov.ma/document.pdf",
      storageBucket: "pdf-documents",
      storagePath: "manual/circulaire.pdf",
      mimeType: "application/pdf",
      sha256: hash,
    });
    expect(result.success).toBe(false);
  });

  it("blocks publication when one page failed or approval is stale", () => {
    const assessment: IngestionAssessment = {
      totalPages: 20,
      processedPages: 19,
      failedPages: 1,
      blockingIssues: 0,
      unresolvedConflicts: 0,
      qualityScore: 93,
      extractionHash: hash,
      sourceVerified: true,
      reuseAuthorized: true,
      legalApplicabilityReviewed: true,
      approvedExtractionHash: "b".repeat(64),
      reviewerId: uuid,
    };
    expect(ingestionPublicationBlockers(assessment)).toEqual([
      "incomplete_extraction",
      "missing_or_stale_approval",
    ]);
  });

  it("accepts a complete reviewed ingestion revision", () => {
    expect(ingestionPublicationBlockers({
      totalPages: 20,
      processedPages: 20,
      failedPages: 0,
      blockingIssues: 0,
      unresolvedConflicts: 0,
      qualityScore: 93,
      extractionHash: hash,
      sourceVerified: true,
      reuseAuthorized: true,
      legalApplicabilityReviewed: true,
      approvedExtractionHash: hash,
      reviewerId: uuid,
    })).toEqual([]);
  });

  it("rejects a validated legal relationship without reviewer", () => {
    const result = legalRelationshipSchema.safeParse({
      sourceInstrumentId: uuid,
      sourceProvisionId: null,
      targetInstrumentId: "22222222-2222-4222-8222-222222222222",
      targetProvisionId: null,
      relationshipType: "amends",
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      evidenceText: "La présente circulaire modifie le tarif indiqué.",
      evidenceProvisionId: "33333333-3333-4333-8333-333333333333",
      confidence: 95,
      validationStatus: "validated",
      validatedBy: null,
    });
    expect(result.success).toBe(false);
  });

  it("keeps low-confidence classification out of validated state", () => {
    const result = classificationDecisionSchema.safeParse({
      caseItemId: uuid,
      hsNodeId: "22222222-2222-4222-8222-222222222222",
      confidence: 65,
      rationale: "Le produit correspond au libellé, sous réserve de sa composition exacte.",
      assumptions: [],
      missingInformation: [],
      engineVersion: "brain-v1",
      status: "validated",
      decidedBy: "33333333-3333-4333-8333-333333333333",
    });
    expect(result.success).toBe(false);
  });
});
