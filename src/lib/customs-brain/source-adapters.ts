import { z } from "zod";
import {
  buildSourceConnectorPlan,
  sourceReadinessBlockers,
  type SourceCatalogEntry,
  type SourceConnectorPlan,
} from "./source-registry";

export const discoveryActionSchema = z.object({
  actionType: z.enum([
    "fetch_direct_document",
    "extract_pdf_links",
    "crawl_html_page",
    "capture_portal_snapshot",
    "blocked_pending_license",
  ]),
  url: z.string().url().nullable(),
  expectedFormats: z.array(z.string().min(1)),
  pipelineComponent: z.string().min(1),
  produces: z.enum(["source_asset", "source_index", "blocked_notice"]),
  requiresNetwork: z.boolean(),
  requiresBrowser: z.boolean(),
  writesCanonicalFacts: z.literal(false),
  notes: z.string().min(1),
});

export const sourceAdapterPlanSchema = z.object({
  sourceCode: z.string().min(2),
  connectorCode: z.string().min(2),
  connectorType: z.string().min(2),
  pipelineComponent: z.string().min(2),
  status: z.enum(["ready_to_activate", "draft", "blocked"]),
  blockers: z.array(z.string().min(1)),
  actions: z.array(discoveryActionSchema).min(1),
});

export type DiscoveryAction = z.infer<typeof discoveryActionSchema>;
export type SourceAdapterPlan = z.infer<typeof sourceAdapterPlanSchema>;

export function buildSourceAdapterPlan(
  source: SourceCatalogEntry,
  connector: SourceConnectorPlan = buildSourceConnectorPlan(source),
): SourceAdapterPlan {
  const blockers = sourceReadinessBlockers(source, connector).filter((blocker) => blocker !== "connector_not_activated");

  if (connector.status === "blocked") {
    return sourceAdapterPlanSchema.parse({
      sourceCode: source.sourceCode,
      connectorCode: connector.connectorCode,
      connectorType: connector.connectorType,
      pipelineComponent: connector.pipelineComponent,
      status: "blocked",
      blockers,
      actions: [{
        actionType: "blocked_pending_license",
        url: source.officialUrl,
        expectedFormats: source.formats,
        pipelineComponent: connector.pipelineComponent,
        produces: "blocked_notice",
        requiresNetwork: false,
        requiresBrowser: false,
        writesCanonicalFacts: false,
        notes: "Accès ou licence requis avant toute ingestion automatisée.",
      }],
    });
  }

  const actionByConnector: Record<string, DiscoveryAction> = {
    direct_pdf_fetcher: {
      actionType: "fetch_direct_document",
      url: source.officialUrl,
      expectedFormats: source.formats,
      pipelineComponent: connector.pipelineComponent,
      produces: "source_asset",
      requiresNetwork: true,
      requiresBrowser: false,
      writesCanonicalFacts: false,
      notes: "Télécharge le document officiel, calcule SHA-256, versionne l'asset et déclenche l'extraction candidate.",
    },
    pdf_link_extractor: {
      actionType: "extract_pdf_links",
      url: source.officialUrl,
      expectedFormats: source.formats,
      pipelineComponent: connector.pipelineComponent,
      produces: "source_index",
      requiresNetwork: true,
      requiresBrowser: false,
      writesCanonicalFacts: false,
      notes: "Lit une page ou un index officiel, extrait uniquement les liens PDF et crée des assets à télécharger.",
    },
    html_crawler: {
      actionType: "crawl_html_page",
      url: source.officialUrl,
      expectedFormats: source.formats,
      pipelineComponent: connector.pipelineComponent,
      produces: "source_index",
      requiresNetwork: true,
      requiresBrowser: false,
      writesCanonicalFacts: false,
      notes: "Capture le HTML officiel, détecte les changements et extrait les liens/documents candidats.",
    },
    portal_index_monitor: {
      actionType: "capture_portal_snapshot",
      url: source.officialUrl,
      expectedFormats: source.formats,
      pipelineComponent: connector.pipelineComponent,
      produces: "source_index",
      requiresNetwork: true,
      requiresBrowser: true,
      writesCanonicalFacts: false,
      notes: "Utilise un navigateur contrôlé pour capturer un portail et produire un snapshot auditable avant extraction.",
    },
    manual_upload: {
      actionType: "fetch_direct_document",
      url: source.officialUrl,
      expectedFormats: source.formats,
      pipelineComponent: connector.pipelineComponent,
      produces: "source_asset",
      requiresNetwork: false,
      requiresBrowser: false,
      writesCanonicalFacts: false,
      notes: "Attend un fichier déposé manuellement puis le traite comme asset versionné.",
    },
    blocked: {
      actionType: "blocked_pending_license",
      url: source.officialUrl,
      expectedFormats: source.formats,
      pipelineComponent: connector.pipelineComponent,
      produces: "blocked_notice",
      requiresNetwork: false,
      requiresBrowser: false,
      writesCanonicalFacts: false,
      notes: "Source bloquée avant activation.",
    },
  };

  const action = actionByConnector[connector.connectorType];
  if (!action) throw new Error(`unsupported_connector_type:${connector.connectorType}`);

  return sourceAdapterPlanSchema.parse({
    sourceCode: source.sourceCode,
    connectorCode: connector.connectorCode,
    connectorType: connector.connectorType,
    pipelineComponent: connector.pipelineComponent,
    status: blockers.length ? "draft" : "ready_to_activate",
    blockers,
    actions: [action],
  });
}

export function buildSourceAdapterPlans(sources: SourceCatalogEntry[]): SourceAdapterPlan[] {
  return sources.map((source) => buildSourceAdapterPlan(source));
}

export function summarizeAdapterPlans(plans: SourceAdapterPlan[]) {
  return plans.reduce((summary, plan) => {
    summary.total += 1;
    summary.byStatus[plan.status] = (summary.byStatus[plan.status] ?? 0) + 1;
    summary.byConnectorType[plan.connectorType] = (summary.byConnectorType[plan.connectorType] ?? 0) + 1;
    summary.byPipelineComponent[plan.pipelineComponent] = (summary.byPipelineComponent[plan.pipelineComponent] ?? 0) + 1;
    return summary;
  }, {
    total: 0,
    byStatus: {} as Record<string, number>,
    byConnectorType: {} as Record<string, number>,
    byPipelineComponent: {} as Record<string, number>,
  });
}
