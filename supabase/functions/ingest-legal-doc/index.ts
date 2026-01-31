// ============================================================================
// EDGE FUNCTION: INGEST LEGAL DOCUMENT
// ============================================================================
// Ingests regulatory documents (circulars, notes, decisions) with source tracking
// Extracts text, chunks for RAG, and detects HS code mentions
// ============================================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ============================================================================
// CORS & CONFIG
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Chunking config
const CHUNK_SIZE_TARGET = 1000;
const CHUNK_OVERLAP = 150;
const MIN_CHUNK_SIZE = 400;

// ============================================================================
// TYPES
// ============================================================================

interface IngestRequest {
  // Source identification
  source_type: string; // "circular" | "note" | "decision" | "law" | "decree"
  source_ref: string; // Reference number
  issuer?: string; // ADII, ASMEX, etc.
  source_date?: string; // ISO date
  title?: string;
  source_url?: string;
  
  // Document content (one of these)
  pdf_base64?: string; // Base64 encoded PDF
  pdf_url?: string; // URL to fetch PDF
  raw_text?: string; // Already extracted text
  
  // Options
  country_code?: string;
  generate_embeddings?: boolean;
  detect_hs_codes?: boolean;
}

interface ExtractedPage {
  page_number: number;
  text: string;
}

interface TextChunk {
  chunk_index: number;
  text: string;
  page_number: number | null;
  char_start: number;
  char_end: number;
}

interface DetectedCode {
  code: string;
  code_normalized: string;
  context: string;
  page_number: number | null;
}

interface IngestResponse {
  success: boolean;
  source_id: number | null;
  pages_processed: number;
  chunks_created: number;
  detected_codes_count: number;
  evidence_created: number;
  error?: string;
}

// ============================================================================
// PDF TEXT EXTRACTION (via Claude)
// ============================================================================

async function extractTextFromPDF(pdfBase64: string): Promise<ExtractedPage[]> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  console.log("[ingest-legal-doc] Extracting text via Claude...");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 16000,
      system: `Tu es un extracteur de texte. Extrais le texte intégral du document PDF page par page.
Retourne un JSON strict:
{
  "pages": [
    {"page_number": 1, "text": "...contenu page 1..."},
    {"page_number": 2, "text": "...contenu page 2..."}
  ]
}
Préserve la structure, les numéros d'articles, les références. Ne résume pas, extrais tout.`,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: pdfBase64,
              },
            },
            {
              type: "text",
              text: "Extrais le texte intégral de ce document PDF, page par page. JSON strict uniquement.",
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text || "";

  // Parse JSON response
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ||
                    content.match(/\{[\s\S]*"pages"[\s\S]*\}/);

  if (!jsonMatch) {
    // Fallback: treat entire response as single page
    return [{ page_number: 1, text: content }];
  }

  try {
    const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    return (parsed.pages || []).map((p: any) => ({
      page_number: p.page_number || 1,
      text: p.text || "",
    }));
  } catch (e) {
    console.warn("[ingest-legal-doc] JSON parse failed, using raw text");
    return [{ page_number: 1, text: content }];
  }
}

// ============================================================================
// CHUNKING
// ============================================================================

function createChunks(pages: ExtractedPage[]): TextChunk[] {
  const chunks: TextChunk[] = [];
  let chunkIndex = 0;

  for (const page of pages) {
    const text = page.text.trim();
    if (!text) continue;

    // Split into paragraphs first
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = "";
    let charStart = 0;

    for (const para of paragraphs) {
      const trimmedPara = para.trim();
      if (!trimmedPara) continue;

      // If adding this paragraph exceeds target, save current chunk
      if (currentChunk && (currentChunk.length + trimmedPara.length) > CHUNK_SIZE_TARGET) {
        if (currentChunk.length >= MIN_CHUNK_SIZE) {
          chunks.push({
            chunk_index: chunkIndex++,
            text: currentChunk.trim(),
            page_number: page.page_number,
            char_start: charStart,
            char_end: charStart + currentChunk.length,
          });
        }

        // Start new chunk with overlap
        const overlapStart = Math.max(0, currentChunk.length - CHUNK_OVERLAP);
        currentChunk = currentChunk.slice(overlapStart) + "\n\n" + trimmedPara;
        charStart = charStart + overlapStart;
      } else {
        currentChunk += (currentChunk ? "\n\n" : "") + trimmedPara;
      }
    }

    // Save remaining chunk
    if (currentChunk.length >= MIN_CHUNK_SIZE) {
      chunks.push({
        chunk_index: chunkIndex++,
        text: currentChunk.trim(),
        page_number: page.page_number,
        char_start: charStart,
        char_end: charStart + currentChunk.length,
      });
    }
  }

  return chunks;
}

// ============================================================================
// HS CODE DETECTION
// ============================================================================

function detectHSCodes(pages: ExtractedPage[]): DetectedCode[] {
  const detected: DetectedCode[] = [];
  const seenCodes = new Set<string>();

  // Patterns for HS codes
  const patterns = [
    // 10 digits: 8903110000
    /\b(\d{10})\b/g,
    // Formatted: 8903.11.00.00 or 89.03.11.00.00
    /\b(\d{2}[.\s]\d{2}[.\s]\d{2}[.\s]?\d{2}[.\s]?\d{2})\b/g,
    // 6 digits with dots: 8903.11 or 89.03.11
    /\b(\d{2}[.\s]\d{2}[.\s]\d{2})\b/g,
    // 4 digits position: 8903
    /\b(\d{4})\b(?=\s*[-–:.]|\s+[A-Za-zÀ-ÿ])/g,
  ];

  for (const page of pages) {
    const text = page.text;

    for (const pattern of patterns) {
      let match;
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      
      while ((match = pattern.exec(text)) !== null) {
        const raw = match[1];
        const normalized = raw.replace(/[\s.]/g, "");

        // Skip if too short or already seen
        if (normalized.length < 4 || seenCodes.has(normalized)) continue;

        // Skip numbers that are clearly not HS codes (years, page numbers, etc.)
        if (/^(19|20)\d{2}$/.test(normalized)) continue; // Years
        if (parseInt(normalized) < 100) continue; // Too small

        // Extract context (50 chars before and after)
        const start = Math.max(0, match.index - 50);
        const end = Math.min(text.length, match.index + match[0].length + 50);
        const context = text.slice(start, end).replace(/\s+/g, " ").trim();

        detected.push({
          code: raw,
          code_normalized: normalized.padEnd(10, "0").slice(0, 10),
          context,
          page_number: page.page_number,
        });

        seenCodes.add(normalized);
      }
    }
  }

  return detected;
}

// ============================================================================
// EMBEDDING GENERATION
// ============================================================================

async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY) return null;

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000), // Limit input
      }),
    });

    if (!response.ok) {
      console.warn("[ingest-legal-doc] Embedding generation failed:", response.status);
      return null;
    }

    const data = await response.json();
    return data.data?.[0]?.embedding || null;
  } catch (e) {
    console.warn("[ingest-legal-doc] Embedding error:", e);
    return null;
  }
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function upsertLegalSource(
  supabase: any,
  request: IngestRequest,
  fullText: string
): Promise<number> {
  const { data, error } = await supabase
    .from("legal_sources")
    .upsert(
      {
        country_code: request.country_code || "MA",
        source_type: request.source_type,
        source_ref: request.source_ref,
        title: request.title,
        issuer: request.issuer,
        source_date: request.source_date,
        source_url: request.source_url,
        full_text: fullText,
        excerpt: fullText.slice(0, 500),
      },
      {
        onConflict: "country_code,source_type,source_ref",
      }
    )
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to upsert legal_source: ${error.message}`);
  }

  return data.id;
}

async function insertChunks(
  supabase: any,
  sourceId: number,
  chunks: TextChunk[],
  generateEmbeddings: boolean
): Promise<number> {
  // Delete existing chunks for this source
  await supabase.from("legal_chunks").delete().eq("source_id", sourceId);

  let inserted = 0;

  // Insert in batches of 10
  for (let i = 0; i < chunks.length; i += 10) {
    const batch = chunks.slice(i, i + 10);
    
    const rows = await Promise.all(
      batch.map(async (chunk) => {
        let embedding = null;
        if (generateEmbeddings) {
          const embeddingArray = await generateEmbedding(chunk.text);
          if (embeddingArray) {
            embedding = JSON.stringify(embeddingArray);
          }
        }

        return {
          source_id: sourceId,
          chunk_index: chunk.chunk_index,
          chunk_text: chunk.text,
          page_number: chunk.page_number,
          char_start: chunk.char_start,
          char_end: chunk.char_end,
          embedding,
        };
      })
    );

    const { error } = await supabase.from("legal_chunks").insert(rows);

    if (error) {
      console.error("[ingest-legal-doc] Chunk insert error:", error);
    } else {
      inserted += rows.length;
    }
  }

  return inserted;
}

async function insertHSEvidence(
  supabase: any,
  sourceId: number,
  detectedCodes: DetectedCode[],
  countryCode: string
): Promise<number> {
  if (detectedCodes.length === 0) return 0;

  // Deduplicate by normalized code
  const uniqueCodes = new Map<string, DetectedCode>();
  for (const code of detectedCodes) {
    const key = code.code_normalized;
    if (!uniqueCodes.has(key) || (code.context.length > (uniqueCodes.get(key)?.context.length || 0))) {
      uniqueCodes.set(key, code);
    }
  }

  const rows = Array.from(uniqueCodes.values()).map((code) => ({
    country_code: countryCode,
    national_code: code.code_normalized,
    hs_code_6: code.code_normalized.slice(0, 6),
    source_id: sourceId,
    page_number: code.page_number,
    evidence_text: code.context,
    confidence: "auto_detected",
  }));

  const { error, data } = await supabase
    .from("hs_evidence")
    .insert(rows)
    .select("id");

  if (error) {
    console.error("[ingest-legal-doc] HS evidence insert error:", error);
    return 0;
  }

  return data?.length || 0;
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body: IngestRequest = await req.json();

    // Validate required fields
    if (!body.source_type || !body.source_ref) {
      return new Response(
        JSON.stringify({ success: false, error: "source_type et source_ref sont requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!body.pdf_base64 && !body.pdf_url && !body.raw_text) {
      return new Response(
        JSON.stringify({ success: false, error: "pdf_base64, pdf_url ou raw_text est requis" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[ingest-legal-doc] Ingesting ${body.source_type} ${body.source_ref}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Get text content
    let pages: ExtractedPage[] = [];

    if (body.raw_text) {
      // Raw text provided directly
      pages = [{ page_number: 1, text: body.raw_text }];
    } else if (body.pdf_base64) {
      // Extract from base64 PDF
      pages = await extractTextFromPDF(body.pdf_base64);
    } else if (body.pdf_url) {
      // Fetch PDF from URL
      console.log(`[ingest-legal-doc] Fetching PDF from ${body.pdf_url}`);
      const pdfResponse = await fetch(body.pdf_url);
      if (!pdfResponse.ok) {
        throw new Error(`Failed to fetch PDF: ${pdfResponse.status}`);
      }
      const pdfBuffer = await pdfResponse.arrayBuffer();
      const pdfBase64 = btoa(
        new Uint8Array(pdfBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
      pages = await extractTextFromPDF(pdfBase64);
    }

    console.log(`[ingest-legal-doc] Extracted ${pages.length} pages`);

    // 2. Combine full text
    const fullText = pages.map((p) => p.text).join("\n\n---PAGE---\n\n");

    // 3. Create chunks
    const chunks = createChunks(pages);
    console.log(`[ingest-legal-doc] Created ${chunks.length} chunks`);

    // 4. Detect HS codes
    const detectedCodes = body.detect_hs_codes !== false ? detectHSCodes(pages) : [];
    console.log(`[ingest-legal-doc] Detected ${detectedCodes.length} HS codes`);

    // 5. Upsert legal_source
    const sourceId = await upsertLegalSource(supabase, body, fullText);
    console.log(`[ingest-legal-doc] Created/updated source ID: ${sourceId}`);

    // 6. Insert chunks
    const chunksCreated = await insertChunks(
      supabase,
      sourceId,
      chunks,
      body.generate_embeddings !== false
    );

    // 7. Insert HS evidence
    const evidenceCreated = await insertHSEvidence(
      supabase,
      sourceId,
      detectedCodes,
      body.country_code || "MA"
    );

    const duration = Date.now() - startTime;
    console.log(`[ingest-legal-doc] Completed in ${duration}ms`);

    const response: IngestResponse = {
      success: true,
      source_id: sourceId,
      pages_processed: pages.length,
      chunks_created: chunksCreated,
      detected_codes_count: detectedCodes.length,
      evidence_created: evidenceCreated,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[ingest-legal-doc] Error:", error);
    
    const response: IngestResponse = {
      success: false,
      source_id: null,
      pages_processed: 0,
      chunks_created: 0,
      detected_codes_count: 0,
      evidence_created: 0,
      error: error instanceof Error ? error.message : "Erreur interne",
    };

    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
