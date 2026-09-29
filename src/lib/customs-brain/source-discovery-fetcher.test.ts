import { describe, expect, it } from "vitest";
import { buildSourceAdapterPlan } from "./source-adapters";
import { moroccoV1SourceRegistry } from "./country-packs/morocco-v1";
import { downloadOfficialAssetCandidate, sha256Hex } from "./source-discovery-fetcher";

function response(body: string, headers: Record<string, string> = {}, status = 200) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe("source discovery fetcher", () => {
  it("downloads a direct official PDF and computes a SHA-256 candidate", async () => {
    const source = moroccoV1SourceRegistry.sources.find((item) => item.sourceCode === "ADII_CIRCULAR_PDFS")!;
    const plan = buildSourceAdapterPlan(source);
    const body = "%PDF-1.7 official circular";
    const expectedHash = await sha256Hex(new TextEncoder().encode(body).buffer);

    const candidate = await downloadOfficialAssetCandidate(plan, {
      fetchImpl: async () => response(body, {
        "content-type": "application/pdf",
        "content-length": String(body.length),
        "content-disposition": "attachment; filename=5740.PDF",
        "last-modified": "Mon, 28 Sep 2026 10:00:00 GMT",
        "etag": '"rev-1"',
      }),
    });

    expect(candidate).toMatchObject({
      filename: "5740.PDF",
      mimeType: "application/pdf",
      byteSize: body.length,
      contentSha256: expectedHash,
      providerModifiedAt: "2026-09-28T10:00:00.000Z",
      providerRevision: "rev-1",
      detectedDocumentType: "circular",
    });
    expect(candidate.metadata).toMatchObject({ canonical_fact_write: false });
  });

  it("supports direct spreadsheet imports", async () => {
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

    const candidate = await downloadOfficialAssetCandidate(plan, {
      fetchImpl: async () => response("xlsx bytes", {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    });

    expect(candidate).toMatchObject({
      filename: "products.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      detectedDocumentType: "technical_control",
    });
  });

  it("refuses unsupported portal and html connectors", async () => {
    const source = moroccoV1SourceRegistry.sources.find((item) => item.sourceCode === "ADII_TARIF")!;
    const plan = buildSourceAdapterPlan(source);
    await expect(downloadOfficialAssetCandidate(plan, { fetchImpl: async () => response("") })).rejects.toThrow("unsupported_download_connector:portal_index_monitor");
  });

  it("rejects oversized downloads before reading the body when content-length is known", async () => {
    const source = moroccoV1SourceRegistry.sources.find((item) => item.sourceCode === "ADII_CIRCULAR_PDFS")!;
    const plan = buildSourceAdapterPlan(source);
    await expect(downloadOfficialAssetCandidate(plan, {
      maxBytes: 10,
      fetchImpl: async () => response("large", { "content-length": "11" }),
    })).rejects.toThrow("download_too_large:11");
  });
});
