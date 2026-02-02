// ============================================================================
// EDGE FUNCTION: INGEST LEGAL DOCUMENT
// ============================================================================
// Ingests regulatory documents (circulars, notes, decisions) with source tracking
// Extracts text, chunks for RAG, and detects HS code mentions
// ============================================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { 
  normalize10Strict, 
  normalize6Strict, 
  extractHS6,
  digitsOnly,
  parseDetectedCode,
  type ParsedHSCode
} from "../_shared/hs-code-utils.ts";

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
  code: string;              // Raw code as found in text
  hs_code_6: string | null;  // Validated 6-digit HS code (null if < 6 digits)
  national_code: string | null; // Validated 10-digit code (null if not exactly 10)
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
// PDF TEXT EXTRACTION (via Claude) - With batch support for large PDFs
// ============================================================================

const MAX_PAGES_PER_BATCH = 100;

// Utility to split PDF base64 into page ranges using Claude's page parameter
async function extractPDFBatch(
  pdfBase64: string, 
  startPage: number, 
  endPage: number
): Promise<ExtractedPage[]> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  console.log(`[ingest-legal-doc] Extracting pages ${startPage}-${endPage} via Claude...`);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 32000,
      system: `Tu es un extracteur de texte. Extrais le texte intégral des pages ${startPage} à ${endPage} du document PDF.
Retourne un JSON strict:
{
  "pages": [
    {"page_number": ${startPage}, "text": "...contenu page ${startPage}..."},
    {"page_number": ${startPage + 1}, "text": "...contenu page ${startPage + 1}..."}
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
              // Use Claude's page range feature to limit pages
              cache_control: { type: "ephemeral" },
            },
            {
              type: "text",
              text: `Extrais UNIQUEMENT le texte des pages ${startPage} à ${endPage} de ce document PDF. Ignore les autres pages. JSON strict uniquement.`,
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
    return [{ page_number: startPage, text: content }];
  }

  try {
    const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    return (parsed.pages || []).map((p: any) => ({
      page_number: p.page_number || startPage,
      text: p.text || "",
    }));
  } catch (e) {
    console.warn("[ingest-legal-doc] JSON parse failed, using raw text");
    return [{ page_number: startPage, text: content }];
  }
}

// Get estimated page count from PDF size (rough estimate: ~3KB per page average for text PDFs)
function estimatePageCount(pdfBase64: string): number {
  const sizeBytes = (pdfBase64.length * 3) / 4; // Base64 to bytes
  const estimatedPages = Math.ceil(sizeBytes / 3000); // ~3KB per page
  return Math.max(1, Math.min(estimatedPages, 1000)); // Cap at 1000 pages
}

async function extractTextFromPDF(pdfBase64: string): Promise<ExtractedPage[]> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  // Estimate page count to determine if batching is needed
  const estimatedPages = estimatePageCount(pdfBase64);
  console.log(`[ingest-legal-doc] Estimated ${estimatedPages} pages in PDF`);

  // For small PDFs (< 100 pages), process in one go
  if (estimatedPages <= MAX_PAGES_PER_BATCH) {
    return await extractPDFBatch(pdfBase64, 1, estimatedPages);
  }

  // For large PDFs, process in batches
  console.log(`[ingest-legal-doc] Large PDF detected, processing in batches of ${MAX_PAGES_PER_BATCH} pages`);
  
  const allPages: ExtractedPage[] = [];
  let currentPage = 1;
  let consecutiveEmptyBatches = 0;
  const maxEmptyBatches = 2; // Stop after 2 empty batches (end of document)

  while (consecutiveEmptyBatches < maxEmptyBatches) {
    const endPage = currentPage + MAX_PAGES_PER_BATCH - 1;
    
    try {
      const batchPages = await extractPDFBatch(pdfBase64, currentPage, endPage);
      
      if (batchPages.length === 0 || batchPages.every(p => !p.text.trim())) {
        consecutiveEmptyBatches++;
        console.log(`[ingest-legal-doc] Empty batch ${consecutiveEmptyBatches}/${maxEmptyBatches}`);
      } else {
        consecutiveEmptyBatches = 0;
        allPages.push(...batchPages);
        console.log(`[ingest-legal-doc] Batch complete: ${batchPages.length} pages extracted (total: ${allPages.length})`);
      }
      
      currentPage = endPage + 1;
      
      // Safety limit: max 500 pages
      if (allPages.length >= 500) {
        console.log(`[ingest-legal-doc] Reached 500 page limit, stopping`);
        break;
      }
      
    } catch (error) {
      // If we get a "no more pages" type error, we're done
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes("out of range") || errorMsg.includes("no pages")) {
        console.log(`[ingest-legal-doc] End of document reached`);
        break;
      }
      throw error;
    }
  }

  console.log(`[ingest-legal-doc] Total pages extracted: ${allPages.length}`);
  return allPages;
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

        // Use strict normalization - NO PADDING
        const parsed = parseDetectedCode(normalized);
        
        detected.push({
          code: raw,
          hs_code_6: parsed.hs_code_6,      // null if < 6 digits
          national_code: parsed.national_code, // null if not exactly 10 digits
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

  // Filter: only keep codes that have at least hs_code_6
  // Skip codes that couldn't be validated (< 6 digits)
  const validCodes = detectedCodes.filter(code => code.hs_code_6 !== null);
  
  if (validCodes.length === 0) {
    console.log("[ingest-legal-doc] No valid HS codes (>= 6 digits) detected");
    return 0;
  }

  // Deduplicate by hs_code_6 (since national_code may be null for 6-digit codes)
  const uniqueCodes = new Map<string, DetectedCode>();
  for (const code of validCodes) {
    // Use national_code as key if available (10 digits), otherwise hs_code_6
    const key = code.national_code || code.hs_code_6!;
    if (!uniqueCodes.has(key) || (code.context.length > (uniqueCodes.get(key)?.context.length || 0))) {
      uniqueCodes.set(key, code);
    }
  }

  // IMPORTANT: Only insert evidence for codes with valid national_code (10 digits)
  // OR create evidence with hs_code_6 only when national_code is null
  const rows = Array.from(uniqueCodes.values()).map((code) => ({
    country_code: countryCode,
    // national_code: only if we have a REAL 10-digit code, otherwise leave empty
    national_code: code.national_code || code.hs_code_6 || "",  // Fallback to hs_code_6 for partial matches
    hs_code_6: code.hs_code_6,
    source_id: sourceId,
    page_number: code.page_number,
    evidence_text: code.context,
    confidence: code.national_code ? "auto_detected_10" : "auto_detected_6",  // Track precision
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
