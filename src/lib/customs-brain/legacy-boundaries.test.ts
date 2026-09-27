import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const legacyTokens = [
  "country_tariffs",
  "legal_chunks",
  "controlled_products",
  "tariff_notes",
  "knowledge_documents",
  "pdf_extractions",
  "regulatory_sources",
];

const allowedLegacyFiles = new Set([
  "docs/architecture/CODEBASE_AUDIT_AND_V1_BACKLOG.md",
  "docs/architecture/CURRENT_STATE.md",
  "docs/architecture/LEGACY_QUARANTINE.md",
  "supabase/config.toml",
  "supabase/functions/analyze-dum/index.ts",
  "supabase/functions/analyze-pdf/index.ts",
  "supabase/functions/analyze-product-image/index.ts",
  "supabase/functions/chat/context-builder.ts",
  "supabase/functions/chat/dum-analyzer.ts",
  "supabase/functions/chat/post-processor.ts",
  "supabase/functions/chat/post-processor_test.ts",
  "supabase/functions/chat/semantic-search.ts",
  "supabase/functions/chat/source-validator.ts",
  "supabase/functions/consultation-report/index.ts",
  "supabase/functions/generate-embeddings/index.ts",
  "supabase/functions/import-local-corpus/index.ts",
  "supabase/functions/ingest-legal-doc/index.ts",
  "supabase/functions/poll-regulatory-feeds/index.ts",
  "supabase/functions/populate-references/index.ts",
  "src/components/admin/EmbeddingPanel.tsx",
  "src/components/admin/MissingChunksPanel.tsx",
  "src/components/admin/ReingestionPanel.tsx",
  "src/components/consultation/ConsultationWizard.tsx",
  "src/lib/hsCodeInheritance.ts",
  "src/pages/admin/AdminDocuments.tsx",
  "src/pages/admin/AdminReferences.tsx",
  "src/pages/admin/AdminUpload.tsx",

  "src/components/admin/ExtractionPreviewDialog.tsx",
  "src/integrations/supabase/types.ts",
  "src/lib/customs-brain/legacy-boundaries.test.ts",
  "src/pages/admin/AdminBulkImport.tsx",
  "src/pages/admin/AdminCorpus.tsx",
  "src/pages/admin/AdminHSCodes.tsx",
  "supabase/functions/_shared/validation.ts",
  "supabase/functions/chat/hierarchical-ranker.ts",
  "supabase/functions/chat/index.ts",
  "supabase/functions/chat/prompt-builder.ts",
  "supabase/functions/classify/index.ts",
]);

const scannedRoots = ["src", "supabase/functions", "docs/architecture"];
const scannedExtensions = [".ts", ".tsx", ".md", ".toml"];

function listFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) return listFiles(path);
    return [path];
  });
}

describe("legacy data boundaries", () => {
  it("keeps legacy table references inside the documented quarantine", () => {
    const offenders: string[] = [];
    for (const root of scannedRoots) {
      for (const file of listFiles(root)) {
        if (!scannedExtensions.some((extension) => file.endsWith(extension))) continue;
        const relativePath = relative(process.cwd(), file);
        const content = readFileSync(file, "utf8");
        const matches = legacyTokens.filter((token) => content.includes(token));
        if (matches.length > 0 && !allowedLegacyFiles.has(relativePath)) {
          offenders.push(`${relativePath}: ${matches.join(", ")}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
