import { describe, expect, it } from "vitest";
import { createAssetPayload, createLegalExtractionJob, createObligationExtractionJob, createRunPayload, discoverPdfIndexCandidates, downloadCandidate, extractPdfLinksFromHtml, parseWorkerArgs, processTarget, shouldEnqueueLegalExtraction, shouldEnqueueObligationExtraction, shouldProcessTarget } from "./source-discovery-worker.mjs";

const target = {
  source: {
    id: "11111111-1111-4111-8111-111111111111",
    source_code: "ADII_CIRCULAR_PDFS",
    official_url: "https://example.gov.ma/5740.PDF",
    formats: ["pdf"],
    active: true,
  },
  connector: {
    id: "22222222-2222-4222-8222-222222222222",
    connector_code: "adii_circular_pdfs_adapter",
    connector_type: "direct_pdf_fetcher",
    pipeline_component: "legal-structure-extractor",
    status: "active",
  },
};

function response(body, headers = {}) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe("source discovery worker core", () => {
  it("parses safe dry-run defaults", () => {
    expect(parseWorkerArgs(["--limit", "5"])).toMatchObject({ dryRun: true, execute: false, limit: 5, includeDraft: false });
    expect(parseWorkerArgs(["--execute", "--include-draft", "--source-code", "ADII_CIRCULAR_PDFS"])).toMatchObject({ dryRun: false, execute: true, includeDraft: true, sourceCode: "ADII_CIRCULAR_PDFS" });
  });

  it("skips draft connectors unless explicitly included", () => {
    const draftTarget = { ...target, connector: { ...target.connector, status: "draft" } };
    expect(shouldProcessTarget(draftTarget, {})).toEqual({ ok: false, reason: "connector_not_active" });
    expect(shouldProcessTarget(draftTarget, { includeDraft: true })).toMatchObject({ ok: true, mode: "download" });
  });

  it("captures official HTML pages as versioned source snapshots", async () => {
    const htmlTarget = {
      ...target,
      source: { ...target.source, official_url: "https://example.gov.ma/import/procedure", source_code: "ONSSA_IMPORT_EXPORT_CONTROL" },
      connector: { ...target.connector, connector_type: "html_crawler", pipeline_component: "obligation-extractor", status: "active" },
    };
    expect(shouldProcessTarget(htmlTarget, {})).toMatchObject({ ok: true, mode: "html_snapshot" });
    const candidate = await downloadCandidate(htmlTarget, { fetchImpl: async () => response("<html>official</html>", { "content-type": "text/html; charset=utf-8" }) });
    expect(candidate).toMatchObject({ filename: "procedure.html", mime_type: "text/html", detected_document_type: "technical_control" });
    expect(candidate.metadata).toMatchObject({ canonical_fact_write: false });
  });

  it("extracts and downloads PDF links from official index pages", async () => {
    const indexTarget = {
      ...target,
      source: { ...target.source, official_url: "https://example.gov.ma/adil/PDF/" },
      connector: { ...target.connector, connector_type: "pdf_link_extractor", status: "active" },
    };
    expect(shouldProcessTarget(indexTarget, {})).toMatchObject({ ok: true, mode: "pdf_index" });
    const links = extractPdfLinksFromHtml(
      `<a href="5740.PDF">Circulaire</a><a href="/dms/loadDocument?documentId=6636&amp;application=tarif">Document</a><a href="mailto:test@example.com">mail</a>`,
      "https://example.gov.ma/adil/PDF/",
    );
    expect(links.map((link) => link.url)).toEqual([
      "https://example.gov.ma/adil/PDF/5740.PDF",
      "https://example.gov.ma/dms/loadDocument?documentId=6636&application=tarif",
    ]);
    const candidates = await discoverPdfIndexCandidates(indexTarget, {
      fetchImpl: async (url) => String(url).endsWith("/PDF/")
        ? { ...response(`<a href="5740.PDF">Circulaire</a><a href="/dms/loadDocument?documentId=6636&amp;application=tarif">Document</a>`, { "content-type": "text/html" }), text: async () => `<a href="5740.PDF">Circulaire</a><a href="/dms/loadDocument?documentId=6636&amp;application=tarif">Document</a>` }
        : response("%PDF official", { "content-type": "application/pdf" }),
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ filename: "5740.PDF", metadata: { index_connector: "pdf_link_extractor" } });
    expect(candidates[1]).toMatchObject({ filename: "document-6636.pdf" });
  });

  it("creates run payloads without canonical writes", () => {
    expect(createRunPayload(target, "download")).toMatchObject({
      source_catalog_id: target.source.id,
      connector_type: "direct_pdf_fetcher",
      run_mode: "download",
      status: "planned",
      plan: { canonical_fact_write: false },
    });
  });

  it("downloads candidates with SHA-256 and creates source asset payloads", async () => {
    const candidate = await downloadCandidate(target, { fetchImpl: async () => response("%PDF official", { "content-type": "application/pdf", "content-disposition": "attachment; filename=5740.PDF" }) });
    expect(candidate).toMatchObject({ filename: "5740.PDF", mime_type: "application/pdf", detected_document_type: "circular" });
    expect(candidate.content_sha256).toMatch(/^[a-f0-9]{64}$/);
    const asset = createAssetPayload(target, candidate, "33333333-3333-4333-8333-333333333333");
    expect(asset).toMatchObject({ provider: "official_web", discovery_status: "queued", relative_path: "ADII_CIRCULAR_PDFS/5740.PDF" });
    expect(asset.metadata).toMatchObject({ canonical_fact_write: false });
  });

  it("plans only in dry-run mode", async () => {
    const result = await processTarget({} , target, { dryRun: true });
    expect(result).toEqual({ source_code: "ADII_CIRCULAR_PDFS", connector_type: "direct_pdf_fetcher", mode: "download", dry_run: true, status: "planned" });
  });

  it("queues obligation extraction only for obligation HTML snapshots with enough text", () => {
    const htmlPage = { source_page_id: "66666666-6666-4666-8666-666666666666", text_length: 180, quality_score: 80 };
    const htmlCandidate = {
      url: "https://example.gov.ma/onssa",
      filename: "onssa.html",
      mime_type: "text/html",
      content_sha256: "b".repeat(64),
      detected_document_type: "technical_control",
    };
    const obligationTarget = {
      ...target,
      source: { ...target.source, source_code: "ONSSA_IMPORT_EXPORT_CONTROL" },
      connector: { ...target.connector, connector_type: "html_crawler", pipeline_component: "obligation-extractor" },
    };
    const legalTarget = { ...obligationTarget, connector: { ...obligationTarget.connector, pipeline_component: "legal-structure-extractor" } };

    expect(shouldEnqueueObligationExtraction(obligationTarget, htmlCandidate, htmlPage)).toBe(true);
    expect(shouldEnqueueObligationExtraction(legalTarget, htmlCandidate, htmlPage)).toBe(false);
    expect(shouldEnqueueObligationExtraction(obligationTarget, htmlCandidate, { ...htmlPage, text_length: 12 })).toBe(false);
    expect(createObligationExtractionJob(obligationTarget, htmlCandidate, "77777777-7777-4777-8777-777777777777", htmlPage)).toMatchObject({
      job_type: "extract_obligation",
      pipeline_version_id: "obligation-extractor-v1",
      priority: 70,
      payload: { source_code: "ONSSA_IMPORT_EXPORT_CONTROL", extraction_input: "html_snapshot", canonical_fact_write: false },
    });
  });

  it("queues legal extraction only for legal HTML snapshots with enough text", () => {
    const htmlPage = { source_page_id: "44444444-4444-4444-8444-444444444444", text_length: 240, quality_score: 80 };
    const legalHtmlCandidate = {
      url: "https://example.gov.ma/legal",
      filename: "legal.html",
      mime_type: "text/html",
      content_sha256: "a".repeat(64),
      detected_document_type: "circular",
    };
    const htmlLegalTarget = {
      ...target,
      source: { ...target.source, source_code: "ADII_LEGAL_BASES" },
      connector: { ...target.connector, connector_type: "html_crawler", pipeline_component: "legal-structure-extractor" },
    };
    const obligationTarget = {
      ...htmlLegalTarget,
      source: { ...htmlLegalTarget.source, source_code: "ONSSA_IMPORT_EXPORT_CONTROL" },
      connector: { ...htmlLegalTarget.connector, pipeline_component: "obligation-extractor" },
    };

    expect(shouldEnqueueLegalExtraction(htmlLegalTarget, legalHtmlCandidate, htmlPage)).toBe(true);
    expect(shouldEnqueueLegalExtraction(obligationTarget, legalHtmlCandidate, htmlPage)).toBe(false);
    expect(shouldEnqueueLegalExtraction(htmlLegalTarget, legalHtmlCandidate, { ...htmlPage, text_length: 12 })).toBe(false);

    expect(createLegalExtractionJob(htmlLegalTarget, legalHtmlCandidate, "55555555-5555-4555-8555-555555555555", htmlPage)).toMatchObject({
      job_type: "extract_legal",
      pipeline_version_id: "legal-structure-extractor-v1",
      source_page_id: htmlPage.source_page_id,
      idempotency_key: `extract_legal:55555555-5555-4555-8555-555555555555:legal-structure-extractor-v1:${"a".repeat(64)}`,
      payload: {
        source_code: "ADII_LEGAL_BASES",
        extraction_input: "html_snapshot",
        canonical_fact_write: false,
      },
      priority: 80,
    });
  });
});

import { createSourceDocumentInsert, storagePathForCandidate } from "./source-discovery-worker.mjs";

describe("source document materialization payloads", () => {
  it("builds V1 source_document rows from source catalog assets", () => {
    const candidate = {
      url: "https://example.gov.ma/5740.PDF",
      filename: "5740.PDF",
      mime_type: "application/pdf",
      byte_size: 12,
      content_sha256: "e".repeat(64),
      detected_document_type: "circular",
    };
    const path = storagePathForCandidate(target, candidate);
    expect(path).toBe(`official/ADII_CIRCULAR_PDFS/${"e".repeat(64)}/5740.PDF`);
    expect(createSourceDocumentInsert(target, candidate, "legal-source-pdfs", path)).toMatchObject({
      source_catalog_id: target.source.id,
      title: "5740",
      document_type: "circular",
      storage_bucket: "legal-source-pdfs",
      storage_path: path,
      sha256: "e".repeat(64),
      lifecycle_status: "draft",
      metadata: { canonical_fact_write: false },
    });
  });
});
