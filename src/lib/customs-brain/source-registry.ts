import { z } from "zod";

export const jurisdictionScopeSchema = z.enum(["national", "regional", "international", "private", "country"]);
export const packStatusSchema = z.enum(["draft", "active", "deprecated", "archived"]);
export const sourcePrioritySchema = z.enum(["P0", "P1", "P2", "P3"]);
export const sourceAutomationStatusSchema = z.enum([
  "manual",
  "semi_automatic",
  "automatic_candidate",
  "license_required",
  "blocked",
]);
export const sourceReuseStatusSchema = z.enum([
  "official",
  "license_required",
  "review_required",
  "blocked",
  "unknown",
]);
export const sourceReliabilityLevelSchema = z.enum([
  "official",
  "partner",
  "manual_upload",
  "unknown",
]);
export const connectorStatusSchema = z.enum(["draft", "active", "paused", "blocked", "deprecated"]);

const nonEmptyCode = z.string().trim().min(2).regex(/^[A-Z0-9_]+$/, "Code normalisé attendu");
const url = z.string().trim().url();

export const jurisdictionPackSchema = z.object({
  jurisdictionCode: nonEmptyCode,
  packCode: z.string().trim().min(2),
  displayName: z.string().trim().min(2),
  scope: jurisdictionScopeSchema,
  status: packStatusSchema,
  versionLabel: z.string().trim().min(1),
  coverageNotes: z.string().trim().nullable(),
});

export const authorityCatalogSchema = z.object({
  authorityCode: nonEmptyCode,
  name: z.string().trim().min(2),
  authorityType: z.string().trim().min(2),
  officialUrl: url.nullable(),
  dataDomains: z.array(z.string().trim().min(1)).min(1),
  priority: sourcePrioritySchema,
  active: z.boolean(),
});

export const sourceCatalogSchema = z.object({
  sourceCode: nonEmptyCode,
  authorityCode: nonEmptyCode,
  name: z.string().trim().min(2),
  sourceFamily: z.string().trim().min(2),
  officialUrl: url,
  accessMethod: z.string().trim().min(2),
  automationStatus: sourceAutomationStatusSchema,
  priority: sourcePrioritySchema,
  updateFrequency: z.string().trim().min(2),
  dataDomains: z.array(z.string().trim().min(1)).min(1),
  formats: z.array(z.string().trim().min(1)).min(1),
  reuseStatus: sourceReuseStatusSchema,
  reliabilityLevel: sourceReliabilityLevelSchema,
  ingestionStrategy: z.string().trim().min(2),
  active: z.boolean(),
  notes: z.string().trim().nullable(),
}).superRefine((value, context) => {
  if (value.automationStatus === "license_required" && value.reuseStatus !== "license_required") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reuseStatus"],
      message: "Une source sous licence doit avoir reuseStatus=license_required",
    });
  }
  if (value.ingestionStrategy === "blocked_pending_access" && value.automationStatus !== "license_required") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["automationStatus"],
      message: "Une stratégie bloquée par accès doit porter automationStatus=license_required",
    });
  }
});

export const sourceConnectorPlanSchema = z.object({
  connectorCode: z.string().trim().min(2),
  connectorType: z.enum(["direct_pdf_fetcher", "pdf_link_extractor", "portal_index_monitor", "html_crawler", "spreadsheet_importer", "manual_upload", "blocked"]),
  pipelineComponent: z.enum([
    "document-ingestion-worker",
    "legal-structure-extractor",
    "obligation-extractor",
    "tariff-extractor",
    "spreadsheet-parser",
    "manual-upload-worker",
  ]),
  schedulePolicy: z.enum(["manual", "manual_until_validated", "event_driven", "daily", "weekly", "monthly", "annual"]),
  status: connectorStatusSchema,
  requiresReviewBeforeActivation: z.boolean(),
});

export type JurisdictionPack = z.infer<typeof jurisdictionPackSchema>;
export type AuthorityCatalogEntry = z.infer<typeof authorityCatalogSchema>;
export type SourceCatalogEntry = z.infer<typeof sourceCatalogSchema>;
export type SourceConnectorPlan = z.infer<typeof sourceConnectorPlanSchema>;

export type SourceRegistry = {
  pack: JurisdictionPack;
  authorities: AuthorityCatalogEntry[];
  sources: SourceCatalogEntry[];
};

export type RegistryIssue = {
  code: string;
  sourceCode?: string;
  authorityCode?: string;
  message: string;
};

export function validateSourceRegistry(registry: SourceRegistry): RegistryIssue[] {
  const issues: RegistryIssue[] = [];
  const pack = jurisdictionPackSchema.safeParse(registry.pack);
  if (!pack.success) issues.push({ code: "invalid_pack", message: pack.error.issues[0]?.message ?? "Pack invalide" });

  const authorityCodes = new Set<string>();
  for (const authority of registry.authorities) {
    const parsed = authorityCatalogSchema.safeParse(authority);
    if (!parsed.success) {
      issues.push({
        code: "invalid_authority",
        authorityCode: authority.authorityCode,
        message: parsed.error.issues[0]?.message ?? "Autorité invalide",
      });
      continue;
    }
    if (authorityCodes.has(authority.authorityCode)) {
      issues.push({ code: "duplicate_authority", authorityCode: authority.authorityCode, message: "Autorité déclarée plusieurs fois" });
    }
    authorityCodes.add(authority.authorityCode);
  }

  const sourceCodes = new Set<string>();
  for (const source of registry.sources) {
    const parsed = sourceCatalogSchema.safeParse(source);
    if (!parsed.success) {
      issues.push({
        code: "invalid_source",
        sourceCode: source.sourceCode,
        authorityCode: source.authorityCode,
        message: parsed.error.issues[0]?.message ?? "Source invalide",
      });
      continue;
    }
    if (sourceCodes.has(source.sourceCode)) {
      issues.push({ code: "duplicate_source", sourceCode: source.sourceCode, message: "Source déclarée plusieurs fois" });
    }
    sourceCodes.add(source.sourceCode);
    if (!authorityCodes.has(source.authorityCode)) {
      issues.push({
        code: "unknown_authority",
        sourceCode: source.sourceCode,
        authorityCode: source.authorityCode,
        message: "La source référence une autorité absente du pack",
      });
    }
    if (source.priority === "P0" && source.reliabilityLevel !== "official") {
      issues.push({
        code: "p0_not_official",
        sourceCode: source.sourceCode,
        message: "Une source P0 doit être officielle ou explicitement reclassée",
      });
    }
  }

  return issues;
}

export function buildSourceConnectorPlan(source: SourceCatalogEntry): SourceConnectorPlan {
  if (source.ingestionStrategy === "blocked_pending_access" || source.automationStatus === "license_required") {
    return sourceConnectorPlanSchema.parse({
      connectorCode: `${source.sourceCode.toLowerCase()}_connector`,
      connectorType: "blocked",
      pipelineComponent: "document-ingestion-worker",
      schedulePolicy: "manual",
      status: "blocked",
      requiresReviewBeforeActivation: true,
    });
  }

  const connectorType = source.accessMethod === "direct_pdf"
    ? "direct_pdf_fetcher"
    : source.accessMethod === "pdf_index"
      ? "pdf_link_extractor"
      : source.accessMethod === "portal"
        ? "portal_index_monitor"
        : source.accessMethod === "spreadsheet"
          ? "spreadsheet_importer"
          : "html_crawler";
  const pipelineComponent = source.accessMethod === "spreadsheet"
    ? "spreadsheet-parser"
    : source.sourceFamily === "tariff"
      ? "tariff-extractor"
    : ["legal", "circular"].includes(source.sourceFamily)
      ? "legal-structure-extractor"
      : source.ingestionStrategy === "download_and_extract"
        ? "obligation-extractor"
        : "obligation-extractor";
  return sourceConnectorPlanSchema.parse({
    connectorCode: `${source.sourceCode.toLowerCase()}_connector`,
    connectorType,
    pipelineComponent,
    schedulePolicy: source.updateFrequency === "annual" ? "manual" : "manual",
    status: "draft",
    requiresReviewBeforeActivation: true,
  });
}

export function sourceReadinessBlockers(source: SourceCatalogEntry, plan = buildSourceConnectorPlan(source)): string[] {
  const blockers: string[] = [];
  if (!source.active) blockers.push("inactive_source");
  if (source.reuseStatus === "blocked") blockers.push("reuse_blocked");
  if (source.reuseStatus === "license_required") blockers.push("license_required");
  if (source.automationStatus === "blocked") blockers.push("automation_blocked");
  if (plan.status === "blocked") blockers.push("connector_blocked");
  if (plan.requiresReviewBeforeActivation && plan.status !== "active") blockers.push("connector_not_activated");
  if (source.priority === "P0" && source.formats.length === 0) blockers.push("missing_formats");
  return [...new Set(blockers)];
}
