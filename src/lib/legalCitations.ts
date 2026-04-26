// Client-side helpers to parse [LEGAL:id:page] markers in chat responses.
// Mirror of supabase/functions/_shared/source-link-builder.ts grammar.

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
  if (!text) return [];
  const out: ParsedLegalMarker[] = [];
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

/** Replace [LEGAL:...] markers with placeholder tokens that can be rendered as React nodes. */
export function splitOnLegalMarkers(
  text: string
): Array<{ type: "text"; value: string } | { type: "legal"; marker: ParsedLegalMarker }> {
  if (!text) return [];
  const markers = parseLegalMarkers(text);
  if (markers.length === 0) return [{ type: "text", value: text }];

  const parts: Array<{ type: "text"; value: string } | { type: "legal"; marker: ParsedLegalMarker }> = [];
  let cursor = 0;
  for (const m of markers) {
    if (m.start > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, m.start) });
    }
    parts.push({ type: "legal", marker: m });
    cursor = m.end;
  }
  if (cursor < text.length) {
    parts.push({ type: "text", value: text.slice(cursor) });
  }
  return parts;
}

/** Replace [LEGAL:id:page] markers with a short placeholder " [n]" used during plain text rendering. */
export function stripLegalMarkers(text: string): string {
  return text.replace(LEGAL_MARKER_RE, "");
}
