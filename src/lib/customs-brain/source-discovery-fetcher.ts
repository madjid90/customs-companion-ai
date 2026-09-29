import type { SourceAdapterPlan } from "./source-adapters";
import { type DiscoveredAssetCandidate, discoveredAssetCandidateSchema } from "./source-discovery";

type FetchLike = (input: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type OfficialAssetDownloadOptions = {
  fetchImpl?: FetchLike;
  maxBytes?: number;
  userAgent?: string;
};

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

function actionUrl(plan: SourceAdapterPlan) {
  return plan.actions[0]?.url;
}

function isDownloadableConnector(plan: SourceAdapterPlan) {
  return plan.connectorType === "direct_pdf_fetcher" || plan.connectorType === "spreadsheet_importer";
}

function filenameFromContentDisposition(value: string | null) {
  if (!value) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (utf8) return decodeURIComponent(utf8.replaceAll('"', "")).trim();
  const ascii = /filename="?([^";]+)"?/i.exec(value)?.[1];
  return ascii?.trim() || null;
}

function filenameFromUrl(value: string) {
  const pathname = new URL(value).pathname;
  const last = pathname.split("/").filter(Boolean).at(-1);
  return last ? decodeURIComponent(last) : "official-source-document";
}

function mimeFromFilename(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  return "application/octet-stream";
}

function normalizeMime(value: string | null, filename: string) {
  const headerMime = value?.split(";")[0]?.trim().toLowerCase();
  return headerMime || mimeFromFilename(filename);
}

function normalizeLastModified(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("crypto_subtle_unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return bytesToHex(new Uint8Array(digest));
}

export async function downloadOfficialAssetCandidate(
  plan: SourceAdapterPlan,
  options: OfficialAssetDownloadOptions = {},
): Promise<DiscoveredAssetCandidate> {
  if (!isDownloadableConnector(plan)) throw new Error(`unsupported_download_connector:${plan.connectorType}`);
  const url = actionUrl(plan);
  if (!url) throw new Error("download_url_missing");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) throw new Error("fetch_unavailable");

  const response = await fetchImpl(url, {
    headers: { "user-agent": options.userAgent ?? "DouaneAI Source Discovery/1.0" },
  });
  if (!response.ok) throw new Error(`download_failed:${response.status}`);

  const lengthHeader = response.headers.get("content-length");
  const expectedLength = lengthHeader ? Number(lengthHeader) : null;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (expectedLength !== null && Number.isFinite(expectedLength) && expectedLength > maxBytes) {
    throw new Error(`download_too_large:${expectedLength}`);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new Error(`download_too_large:${buffer.byteLength}`);

  const filename = filenameFromContentDisposition(response.headers.get("content-disposition")) ?? filenameFromUrl(url);
  const contentSha256 = await sha256Hex(buffer);
  const candidate = {
    url,
    filename,
    mimeType: normalizeMime(response.headers.get("content-type"), filename),
    byteSize: buffer.byteLength,
    contentSha256,
    providerModifiedAt: normalizeLastModified(response.headers.get("last-modified")),
    providerRevision: response.headers.get("etag")?.replaceAll('"', "") || null,
    detectedDocumentType: plan.pipelineComponent === "tariff-extractor"
      ? "tariff"
      : plan.pipelineComponent === "spreadsheet-parser"
        ? "technical_control"
        : plan.pipelineComponent === "legal-structure-extractor"
          ? "circular"
          : plan.pipelineComponent === "obligation-extractor"
            ? "technical_control"
            : "other",
    metadata: {
      content_type_header: response.headers.get("content-type"),
      content_length_header: lengthHeader,
      downloaded_by: "source-discovery-fetcher-v1",
      canonical_fact_write: false,
    },
  };
  return discoveredAssetCandidateSchema.parse(candidate);
}
