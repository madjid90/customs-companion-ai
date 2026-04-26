// Shared module: builds public/signed URLs to legal documents with optional #page=N anchor.
// Used by chat post-processor and ingestion to surface clickable references.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

let cachedClient: ReturnType<typeof createClient> | null = null;
function getClient() {
  if (!cachedClient) {
    cachedClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
    });
  }
  return cachedClient;
}

export interface SourceLink {
  url: string; // ready-to-open URL (with #page anchor when applicable)
  title: string;
  pageNumber?: number;
  bucket: string;
  filePath: string;
  fileName?: string;
}

export interface BuildLinkOptions {
  // Either provide a documentId, or filePath+bucket directly.
  documentId?: string;
  bucket?: string; // defaults to 'pdf-documents'
  filePath?: string;
  pageNumber?: number;
  /**
   * If true, generate a signed URL (1 hour TTL). Otherwise public URL.
   * Required if the bucket is private.
   */
  signed?: boolean;
  signedTtlSeconds?: number;
}

const DEFAULT_BUCKET = "pdf-documents";

/**
 * Append #page=N anchor when supported (PDF.js, Chrome, most viewers).
 * Pages are 1-indexed.
 */
export function appendPageAnchor(url: string, pageNumber?: number): string {
  if (!pageNumber || pageNumber < 1) return url;
  // Strip any existing fragment
  const base = url.split("#")[0];
  return `${base}#page=${Math.floor(pageNumber)}`;
}

/**
 * Build a clickable URL for a legal document.
 * Returns null if the document cannot be resolved.
 */
export async function buildSourceLink(opts: BuildLinkOptions): Promise<SourceLink | null> {
  const client = getClient();

  let bucket = opts.bucket || DEFAULT_BUCKET;
  let filePath = opts.filePath || "";
  let title = "";
  let fileName = "";

  if (opts.documentId) {
    const { data, error } = await client
      .from("pdf_documents")
      .select("file_path, file_name, title, bucket")
      .eq("id", opts.documentId)
      .maybeSingle();
    if (error || !data) return null;
    filePath = (data.file_path as string) || filePath;
    fileName = (data.file_name as string) || "";
    title = (data.title as string) || fileName || "Document";
    bucket = (data.bucket as string) || bucket;
  } else if (filePath) {
    const segments = filePath.split("/");
    fileName = segments[segments.length - 1];
    title = decodeURIComponent(fileName.replace(/_/g, " ").replace(/\.pdf$/i, ""));
  } else {
    return null;
  }

  let url: string;
  if (opts.signed) {
    const ttl = opts.signedTtlSeconds ?? 3600;
    const { data, error } = await client.storage.from(bucket).createSignedUrl(filePath, ttl);
    if (error || !data?.signedUrl) return null;
    url = data.signedUrl;
  } else {
    const { data } = client.storage.from(bucket).getPublicUrl(filePath);
    url = data.publicUrl;
  }

  return {
    url: appendPageAnchor(url, opts.pageNumber),
    title,
    pageNumber: opts.pageNumber,
    bucket,
    filePath,
    fileName,
  };
}

/**
 * Inline citation marker grammar:  [LEGAL:<documentId>:<page?>]
 * Examples:
 *   [LEGAL:550e8400-e29b-41d4-a716-446655440000:42]
 *   [LEGAL:550e8400-e29b-41d4-a716-446655440000]
 */
const LEGAL_MARKER_RE =
  /\[LEGAL:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?::(\d+))?\]/gi;

export interface ParsedLegalMarker {
  raw: string;
  documentId: string;
  pageNumber?: number;
  start: number;
  end: number;
}

export function parseLegalMarkers(text: string): ParsedLegalMarker[] {
  const out: ParsedLegalMarker[] = [];
  if (!text) return out;
  for (const m of text.matchAll(LEGAL_MARKER_RE)) {
    out.push({
      raw: m[0],
      documentId: m[1],
      pageNumber: m[2] ? parseInt(m[2], 10) : undefined,
      start: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    });
  }
  return out;
}

export function makeLegalMarker(documentId: string, pageNumber?: number): string {
  return pageNumber
    ? `[LEGAL:${documentId}:${pageNumber}]`
    : `[LEGAL:${documentId}]`;
}
