import { z } from "zod";

const isoDate = z.string().date();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, "Empreinte SHA-256 invalide");
const percentage = z.number().min(0).max(100);

export const sourceDocumentSchema = z.object({
  sourceId: z.string().uuid(),
  officialReference: z.string().trim().min(1).nullable(),
  title: z.string().trim().min(3),
  documentType: z.enum([
    "customs_code", "law", "decree", "order", "circular", "instruction",
    "tariff", "hs_nomenclature", "section_note", "chapter_note",
    "classification_opinion", "agreement", "origin_rule", "procedure",
    "authorization", "technical_control", "tax_rule", "guide", "other",
  ]),
  languageCode: z.enum(["fr", "ar", "en"]),
  publicationDate: isoDate.nullable(),
  effectiveFrom: isoDate.nullable(),
  effectiveTo: isoDate.nullable(),
  sourceUrl: z.string().url().nullable(),
  storageBucket: z.string().trim().min(1),
  storagePath: z.string().trim().min(1),
  mimeType: z.string().trim().min(1),
  sha256,
}).superRefine((value, context) => {
  if (value.effectiveFrom && value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["effectiveTo"],
      message: "La fin d'application précède le début d'application",
    });
  }
  if (["circular", "law", "decree", "order", "instruction"].includes(value.documentType)
    && !value.officialReference) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["officialReference"],
      message: "Une référence officielle est obligatoire pour ce type de texte",
    });
  }
});

export const ingestionAssessmentSchema = z.object({
  totalPages: z.number().int().positive(),
  processedPages: z.number().int().nonnegative(),
  failedPages: z.number().int().nonnegative(),
  blockingIssues: z.number().int().nonnegative(),
  unresolvedConflicts: z.number().int().nonnegative(),
  qualityScore: percentage,
  extractionHash: sha256,
  sourceVerified: z.boolean(),
  reuseAuthorized: z.boolean(),
  legalApplicabilityReviewed: z.boolean(),
  approvedExtractionHash: sha256.nullable(),
  reviewerId: z.string().uuid().nullable(),
});

export type IngestionAssessment = z.infer<typeof ingestionAssessmentSchema>;

export function ingestionPublicationBlockers(input: IngestionAssessment): string[] {
  const parsed = ingestionAssessmentSchema.safeParse(input);
  if (!parsed.success) return ["invalid_assessment"];

  const assessment = parsed.data;
  const blockers: string[] = [];
  if (!assessment.sourceVerified) blockers.push("unverified_source");
  if (!assessment.reuseAuthorized) blockers.push("reuse_not_authorized");
  if (assessment.processedPages !== assessment.totalPages || assessment.failedPages > 0) {
    blockers.push("incomplete_extraction");
  }
  if (assessment.blockingIssues > 0) blockers.push("blocking_quality_issues");
  if (assessment.unresolvedConflicts > 0) blockers.push("unresolved_conflicts");
  if (assessment.qualityScore < 85) blockers.push("quality_score_below_threshold");
  if (!assessment.legalApplicabilityReviewed) blockers.push("applicability_not_reviewed");
  if (!assessment.reviewerId || assessment.approvedExtractionHash !== assessment.extractionHash) {
    blockers.push("missing_or_stale_approval");
  }
  return blockers;
}

export const legalRelationshipSchema = z.object({
  sourceInstrumentId: z.string().uuid(),
  sourceProvisionId: z.string().uuid().nullable(),
  targetInstrumentId: z.string().uuid(),
  targetProvisionId: z.string().uuid().nullable(),
  relationshipType: z.enum([
    "amends", "repeals", "replaces", "implements", "interprets", "complements",
    "corrects", "suspends", "extends", "references", "creates_exception",
  ]),
  effectiveFrom: isoDate.nullable(),
  effectiveTo: isoDate.nullable(),
  evidenceText: z.string().trim().min(10),
  evidenceProvisionId: z.string().uuid(),
  confidence: percentage,
  validationStatus: z.enum(["proposed", "validated", "rejected"]),
  validatedBy: z.string().uuid().nullable(),
}).superRefine((value, context) => {
  const sameInstrument = value.sourceInstrumentId === value.targetInstrumentId;
  const sameProvision = value.sourceProvisionId === value.targetProvisionId;
  if (sameInstrument && sameProvision) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Une relation ne peut pas se cibler elle-même" });
  }
  if (value.validationStatus === "validated" && !value.validatedBy) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["validatedBy"],
      message: "Une relation validée doit identifier son validateur",
    });
  }
});

export const classificationDecisionSchema = z.object({
  caseItemId: z.string().uuid(),
  hsNodeId: z.string().uuid(),
  confidence: percentage,
  rationale: z.string().trim().min(30),
  assumptions: z.array(z.string().trim().min(1)),
  missingInformation: z.array(z.string().trim().min(1)),
  engineVersion: z.string().trim().min(1),
  status: z.enum(["proposed", "needs_information", "expert_review", "validated", "rejected", "superseded"]),
  decidedBy: z.string().uuid().nullable(),
}).superRefine((value, context) => {
  if (value.status === "validated" && (!value.decidedBy || value.missingInformation.length > 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Une classification validée exige un validateur et aucune information manquante",
    });
  }
  if (value.confidence < 80 && value.status === "validated") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confidence"],
      message: "Une décision sous 80 % doit rester en revue experte",
    });
  }
});

export type SourceDocumentInput = z.infer<typeof sourceDocumentSchema>;
export type LegalRelationshipInput = z.infer<typeof legalRelationshipSchema>;
export type ClassificationDecisionInput = z.infer<typeof classificationDecisionSchema>;
