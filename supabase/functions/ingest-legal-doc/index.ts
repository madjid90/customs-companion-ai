// ============================================================================
// EDGE FUNCTION: INGEST LEGAL DOCUMENT
// ============================================================================
// Ingests regulatory documents (circulars, notes, decisions) with source tracking
// Extracts text, chunks for RAG, and detects HS code mentions
// ============================================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { 
  normalize10Strict, 
  normalize6Strict, 
  extractHS6,
  digitsOnly,
  parseDetectedCode,
  type ParsedHSCode
} from "../_shared/hs-code-utils.ts";
import { callAnthropicWithRetry } from "../_shared/retry.ts";

import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth-check.ts";

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
  
  // File info (for storage)
  file_name?: string; // Original file name for storage
  
  // Batch processing (for large PDFs - client-orchestrated)
  start_page?: number; // 1-indexed start page (for batch mode)
  end_page?: number; // 1-indexed end page (for batch mode)
  batch_mode?: boolean; // If true, only process specified page range
  source_id?: number; // Existing source ID for append mode
  
  // Options
  country_code?: string;
  generate_embeddings?: boolean;
  detect_hs_codes?: boolean;
  store_pdf?: boolean; // If true, store PDF in Supabase Storage and create pdf_documents entry
}

interface ExtractedTable {
  table_index: number;
  markdown: string;           // Table in Markdown format
  description: string;        // Brief description of table content
  has_rates: boolean;         // Contains duty rates or percentages
  has_hs_codes: boolean;      // Contains HS codes
}

interface ExtractedImage {
  image_index: number;
  description: string;        // AI-generated description of image content
  image_type: "form" | "diagram" | "stamp" | "logo" | "photo" | "other";
  extracted_text?: string;    // Any text visible in the image
}

interface ExtractedPage {
  page_number: number;
  text: string;
  tables?: ExtractedTable[];
  images?: ExtractedImage[];
  has_form?: boolean;         // Page contains a form/template
}

interface TextChunk {
  chunk_index: number;
  text: string;
  page_number: number | null;
  char_start: number;
  char_end: number;
  // Enriched metadata
  article_number: string | null;
  section_title: string | null;
  parent_section: string | null;
  chunk_type: string | null;
  hierarchy_path: string | null;
  keywords: string[];
  mentioned_hs_codes: string[];
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
  pdf_id?: string | null; // ID of created pdf_documents entry
  pages_processed: number;
  chunks_created: number;
  detected_codes_count: number;
  evidence_created: number;
  error?: string;
  // Batch mode additional fields
  total_pages?: number;
  batch_start?: number;
  batch_end?: number;
}

// ============================================================================
// PDF TEXT EXTRACTION (via Claude) - With batch support for large PDFs
// ============================================================================

const MAX_PAGES_PER_BATCH = 1; // Single page per request for very dense legal docs
const CLAUDE_TIMEOUT_MS = 55000; // 55 second timeout for single pages
const CLAUDE_TIMEOUT_FULL_PDF_MS = 120000; // 120 seconds for full PDF when split fails

// Memory-efficient base64 to Uint8Array conversion (avoid intermediate strings)
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Memory-efficient Uint8Array to base64 conversion (chunk-based to avoid stack overflow)
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 32768; // Process in 32KB chunks
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

// Maximum PDF size in bytes for edge function processing (15MB raw)
const MAX_PDF_SIZE_BYTES = 15 * 1024 * 1024;

// Split a PDF into a subset of pages using pdf-lib (memory-optimized)
async function splitPdfPages(
  pdfBase64: string,
  startPage: number,
  endPage: number
): Promise<string> {
  // Check size before decoding
  const estimatedSize = Math.floor(pdfBase64.length * 3 / 4);
  if (estimatedSize > MAX_PDF_SIZE_BYTES) {
    throw new Error(`PDF trop volumineux (${(estimatedSize / 1024 / 1024).toFixed(1)}MB). Max: ${MAX_PDF_SIZE_BYTES / 1024 / 1024}MB`);
  }
  
  const pdfBytes = base64ToUint8Array(pdfBase64);
  const srcDoc = await PDFDocument.load(pdfBytes, { 
    ignoreEncryption: true,
    updateMetadata: false, // Skip metadata parsing to save memory
  });
  const totalPages = srcDoc.getPageCount();
  
  // Adjust bounds (1-indexed to 0-indexed)
  const actualStart = Math.max(0, startPage - 1);
  const actualEnd = Math.min(totalPages - 1, endPage - 1);
  
  if (actualStart > actualEnd || actualStart >= totalPages) {
    throw new Error(`Page range ${startPage}-${endPage} out of bounds (total: ${totalPages})`);
  }
  
  console.log(`[ingest-legal-doc] Splitting pages ${actualStart + 1}-${actualEnd + 1} from ${totalPages} total`);
  
  // Create new PDF with only the requested pages
  const newDoc = await PDFDocument.create();
  const pageIndices: number[] = [];
  for (let i = actualStart; i <= actualEnd; i++) {
    pageIndices.push(i);
  }
  
  const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
  copiedPages.forEach(page => newDoc.addPage(page));
  
  // Save with compression to reduce memory footprint
  const newPdfBytes = await newDoc.save({ 
    useObjectStreams: false, // Simpler output = less memory
  });
  
  console.log(`[ingest-legal-doc] Split PDF has ${pageIndices.length} pages`);
  
  // Convert to base64 efficiently
  const result = uint8ArrayToBase64(newPdfBytes);
  console.log(`[ingest-legal-doc] Split PDF base64 size: ${(result.length / 1024).toFixed(1)}KB`);
  
  return result;
}

// Estimate page count from raw PDF bytes using regex (fallback when pdf-lib fails)
function estimatePageCountFromBytes(pdfBase64: string): number {
  try {
    const raw = atob(pdfBase64);
    // Count "/Type /Page" or "/Type/Page" occurrences (NOT "/Type /Pages")
    const pagePattern = /\/Type\s*\/Page(?!s)/g;
    let count = 0;
    let match;
    while ((match = pagePattern.exec(raw)) !== null) {
      count++;
    }
    if (count > 0) {
      console.log(`[ingest-legal-doc] Regex-estimated page count: ${count}`);
      return count;
    }
  } catch (e) {
    console.warn(`[ingest-legal-doc] Regex page estimation failed: ${e}`);
  }
  // Last resort: estimate from file size (~30KB per page for text-heavy legal docs)
  const estimatedSize = Math.floor(pdfBase64.length * 3 / 4);
  const estimated = Math.max(1, Math.ceil(estimatedSize / 30000));
  console.log(`[ingest-legal-doc] Size-estimated page count: ${estimated} (from ${(estimatedSize / 1024).toFixed(0)}KB)`);
  return estimated;
}

// Flag to track if pdf-lib parsing works for this PDF
let pdfLibWorks = true;

// Get actual page count from PDF (memory-optimized, with fallback)
async function getPdfPageCount(pdfBase64: string): Promise<number> {
  const estimatedSize = Math.floor(pdfBase64.length * 3 / 4);
  if (estimatedSize > MAX_PDF_SIZE_BYTES) {
    throw new Error(`PDF trop volumineux (${(estimatedSize / 1024 / 1024).toFixed(1)}MB). Max: ${MAX_PDF_SIZE_BYTES / 1024 / 1024}MB`);
  }
  
  try {
    const pdfBytes = base64ToUint8Array(pdfBase64);
    const srcDoc = await PDFDocument.load(pdfBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    pdfLibWorks = true;
    return srcDoc.getPageCount();
  } catch (error) {
    console.warn(`[ingest-legal-doc] pdf-lib failed to parse PDF: ${error instanceof Error ? error.message : String(error)}`);
    pdfLibWorks = false;
    // Use regex/size-based estimation instead of defaulting to 1
    return estimatePageCountFromBytes(pdfBase64);
  }
}

// Extract text from a small PDF chunk via Claude - WITH RETRY for transient 500 errors
async function extractTextFromPDFChunk(chunkBase64: string, startPage: number): Promise<ExtractedPage[]> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  // Verify chunk size is reasonable (< 5MB base64 = ~3.75MB file)
  const chunkSizeKB = chunkBase64.length / 1024;
  console.log(`[ingest-legal-doc] Sending chunk to Claude: ${chunkSizeKB.toFixed(1)}KB base64, starting at page ${startPage}`);
  
  if (chunkSizeKB > 15000) {
    throw new Error(`Chunk too large (${chunkSizeKB.toFixed(0)}KB) - likely split failed`);
  }

  const requestBody = {
    model: "claude-sonnet-4-20250514", // Supports PDF input
    max_tokens: 8000, // Increased for tables and image descriptions
    system: `Tu es un extracteur de documents réglementaires multilingue (français, arabe, anglais).
أنت مستخرج وثائق تنظيمية متعدد اللغات.

MISSION: Extraire EXHAUSTIVEMENT le contenu de chaque page:
1. **TEXTE**: Tout le texte, articles, paragraphes (préserver structure)
2. **TABLEAUX**: Convertir en Markdown avec | colonnes | - OBLIGATOIRE si présents
3. **IMAGES**: Décrire le contenu (formulaires, diagrammes, tampons, logos)

المهمة: استخراج شامل لمحتوى كل صفحة:
1. النص: كل النص والمواد والفقرات
2. الجداول: تحويل إلى Markdown
3. الصور: وصف المحتوى

FORMAT JSON STRICT:
{
  "pages": [
    {
      "page_number": 1,
      "text": "Contenu textuel de la page...",
      "tables": [
        {
          "table_index": 0,
          "markdown": "| Col1 | Col2 |\\n|---|---|\\n| val1 | val2 |",
          "description": "Tableau des taux de droits",
          "has_rates": true,
          "has_hs_codes": false
        }
      ],
      "images": [
        {
          "image_index": 0,
          "description": "Formulaire d'engagement sur l'honneur ANRT",
          "image_type": "form",
          "extracted_text": "Nom: ___ Prénom: ___"
        }
      ],
      "has_form": true
    }
  ]
}

RÈGLES CRITIQUES:
- Tableaux: TOUJOURS convertir en Markdown avec entêtes
- Images de formulaires: Extraire tous les champs visibles
- Ne jamais résumer, extraire TOUT
- Codes SH (6-10 chiffres): les repérer dans tableaux et texte`,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: chunkBase64,
            },
          },
          {
            type: "text",
            text: `Analyse cette page PDF et extrais:
1. Tout le texte (articles, paragraphes)
2. Tous les tableaux en format Markdown
3. Description de toutes les images/formulaires

Réponds en JSON strict uniquement.`,
          },
        ],
      },
    ],
  };

  // Use adaptive timeout: longer for full PDFs, shorter for single pages
  const isLargeChunk = chunkBase64.length > 200 * 1024; // > 200KB base64
  const timeout = isLargeChunk ? CLAUDE_TIMEOUT_FULL_PDF_MS : CLAUDE_TIMEOUT_MS;
  console.log(`[ingest-legal-doc] Using timeout: ${timeout / 1000}s (chunk ${isLargeChunk ? 'large' : 'small'})`);
  
  // Use callAnthropicWithRetry for automatic retry on 500/503/529 errors
  const response = await callAnthropicWithRetry(
    ANTHROPIC_API_KEY,
    requestBody,
    timeout,
    { "anthropic-beta": "pdfs-2024-09-25" }
  );

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
    // Adjust page numbers to absolute values and preserve all extracted data
    return (parsed.pages || []).map((p: any, idx: number) => {
      const page: ExtractedPage = {
        page_number: startPage + idx,
        text: p.text || "",
        tables: Array.isArray(p.tables) ? p.tables.map((t: any, tIdx: number) => ({
          table_index: t.table_index ?? tIdx,
          markdown: t.markdown || "",
          description: t.description || "",
          has_rates: Boolean(t.has_rates),
          has_hs_codes: Boolean(t.has_hs_codes),
        })) : undefined,
        images: Array.isArray(p.images) ? p.images.map((img: any, imgIdx: number) => ({
          image_index: img.image_index ?? imgIdx,
          description: img.description || "",
          image_type: img.image_type || "other",
          extracted_text: img.extracted_text,
        })) : undefined,
        has_form: Boolean(p.has_form),
      };
      
      // Log extracted structured content
      if (page.tables?.length) {
        console.log(`[ingest-legal-doc] Page ${page.page_number}: ${page.tables.length} table(s) extracted`);
      }
      if (page.images?.length) {
        console.log(`[ingest-legal-doc] Page ${page.page_number}: ${page.images.length} image(s) described`);
      }
      if (page.has_form) {
        console.log(`[ingest-legal-doc] Page ${page.page_number}: Form detected`);
      }
      
      return page;
    });
  } catch (e) {
    console.warn("[ingest-legal-doc] JSON parse failed, using raw text");
    return [{ page_number: startPage, text: content }];
  }
}

async function extractTextFromPDF(pdfBase64: string): Promise<ExtractedPage[]> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  // Get actual page count using pdf-lib (returns 1 as fallback if PDF can't be parsed)
  const totalPages = await getPdfPageCount(pdfBase64);
  console.log(`[ingest-legal-doc] PDF has ${totalPages} pages`);

  // If pdf-lib can't parse this PDF, we can't split it
  if (!pdfLibWorks) {
    console.log(`[ingest-legal-doc] pdf-lib unavailable for this PDF - sending entire document to Claude (${totalPages} estimated pages)`);
    console.warn(`[ingest-legal-doc] Large malformed PDF: processing as single chunk with extended timeout`);
    return await extractTextFromPDFChunk(pdfBase64, 1);
  }

  // For small PDFs (< MAX_PAGES_PER_BATCH), process in one go
  if (totalPages <= MAX_PAGES_PER_BATCH) {
    console.log(`[ingest-legal-doc] Small PDF, processing directly`);
    return await extractTextFromPDFChunk(pdfBase64, 1);
  }

  // For large PDFs, split and process in batches
  console.log(`[ingest-legal-doc] Large PDF detected (${totalPages} pages), processing in batches of ${MAX_PAGES_PER_BATCH}`);
  
  const allPages: ExtractedPage[] = [];
  let currentPage = 1;

  while (currentPage <= totalPages) {
    const endPage = Math.min(currentPage + MAX_PAGES_PER_BATCH - 1, totalPages);
    
    console.log(`[ingest-legal-doc] Extracting pages ${currentPage}-${endPage}...`);
    
    try {
      // Split PDF to get only the pages we need
      const chunkBase64 = await splitPdfPages(pdfBase64, currentPage, endPage);
      
      // Extract text from this chunk
      const batchPages = await extractTextFromPDFChunk(chunkBase64, currentPage);
      
      if (batchPages.length > 0) {
        allPages.push(...batchPages);
        console.log(`[ingest-legal-doc] Batch complete: ${batchPages.length} pages extracted (total: ${allPages.length})`);
      }
      
      currentPage = endPage + 1;
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ingest-legal-doc] Batch error: ${errorMsg}`);
      
      // If it's a page range error, we're done
      if (errorMsg.includes("out of bounds")) {
        break;
      }
      
      // If pdf-lib splitting failed (malformed PDF), fall back to sending entire PDF
      if (errorMsg.includes("PDFDict") || errorMsg.includes("undefined") || errorMsg.includes("Expected instance")) {
        console.warn(`[ingest-legal-doc] pdf-lib split failed mid-processing, sending remaining PDF to Claude`);
        pdfLibWorks = false;
        // Only if we haven't already extracted some pages
        if (allPages.length === 0) {
          return await extractTextFromPDFChunk(pdfBase64, 1);
        }
        // If we have some pages already, stop here and return what we have
        console.log(`[ingest-legal-doc] Returning ${allPages.length} already-extracted pages`);
        break;
      }
      
      throw error;
    }
  }

  console.log(`[ingest-legal-doc] Total pages extracted: ${allPages.length}`);
  return allPages;
}

// ============================================================================
// CHUNKING WITH METADATA EXTRACTION
// ============================================================================

// Extract article number from text (e.g., "Article 123", "Art. 45 bis", "المادة 123")
function extractArticleNumber(text: string): string | null {
  const patterns = [
    // French patterns
    /\bArt(?:icle)?\.?\s*(\d+(?:\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?(?:\s*[-–]\s*\d+)?)/i,
    /\b§\s*(\d+(?:\.\d+)*)/,
    // Arabic patterns: المادة (al-mādda = article), الفصل (al-faṣl = chapter/article)
    /(?:المادة|الفصل|البند)\s*[:.]?\s*(\d+(?:\s*[-–]\s*\d+)?)/,
    // Arabic ordinal numbers written out
    /(?:المادة|الفصل)\s+(الأول[ى]?|الثاني[ة]?|الثالث[ة]?|الرابع[ة]?|الخامس[ة]?)/,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

// Extract section/chapter title from text (French + Arabic)
function extractSectionTitle(text: string): string | null {
  const patterns = [
    // French patterns
    /^((?:CHAPITRE|TITRE|SECTION|SOUS-SECTION|PARTIE)\s+[IVXLCDM\d]+(?:\s*[-–:]\s*.{5,80})?)/im,
    /^((?:Chapitre|Titre|Section|Sous-section|Partie)\s+[IVXLCDM\d]+(?:\s*[-–:]\s*.{5,80})?)/m,
    // Arabic patterns: الباب (al-bāb = part/title), الفصل (al-faṣl = chapter), القسم (al-qism = section)
    /^((?:الباب|الفصل|القسم|الجزء|العنوان)\s+(?:[IVXLCDM\d]+|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)(?:\s*[-–:]\s*.{5,80})?)/m,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1].trim().substring(0, 200);
  }
  return null;
}

// ============================================================================
// HIERARCHY TRACKER — maintains a full path: Titre > Chapitre > Section > Art.
// ============================================================================

// Hierarchy levels ordered from broadest to most specific
const HIERARCHY_LEVELS: { level: number; patterns: RegExp[] }[] = [
  {
    level: 0, // PARTIE / LIVRE / الجزء
    patterns: [
      /^(?:PARTIE|LIVRE)\s+([IVXLCDM\d]+)/i,
      /^(?:الجزء)\s+([IVXLCDM\d]+|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)/,
    ],
  },
  {
    level: 1, // TITRE / العنوان / الباب
    patterns: [
      /^TITRE\s+([IVXLCDM\d]+)/i,
      /^(?:Titre)\s+([IVXLCDM\d]+)/,
      /^(?:الباب|العنوان)\s+([IVXLCDM\d]+|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)/,
    ],
  },
  {
    level: 2, // CHAPITRE / الفصل
    patterns: [
      /^CHAPITRE\s+([IVXLCDM\d]+)/i,
      /^(?:Chapitre)\s+([IVXLCDM\d]+)/,
      /^(?:الفصل)\s+([IVXLCDM\d]+|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)/,
    ],
  },
  {
    level: 3, // SECTION / القسم
    patterns: [
      /^SECTION\s+([IVXLCDM\d]+)/i,
      /^(?:Section)\s+([IVXLCDM\d]+)/,
      /^(?:القسم)\s+([IVXLCDM\d]+|الأول|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر)/,
    ],
  },
  {
    level: 4, // SOUS-SECTION
    patterns: [
      /^SOUS-SECTION\s+([IVXLCDM\d]+)/i,
      /^(?:Sous-section)\s+([IVXLCDM\d]+)/,
    ],
  },
];

interface HierarchyEntry {
  level: number;
  label: string; // e.g. "TITRE II", "CHAPITRE IV", "Section I"
}

/**
 * Maintains a stack of hierarchy entries.
 * When a new entry is detected at level N, all entries at level >= N are replaced.
 */
class HierarchyTracker {
  private stack: HierarchyEntry[] = [];

  /** Try to detect a hierarchy heading in the given text. Returns true if detected. */
  update(text: string): boolean {
    const trimmed = text.trim();

    for (const { level, patterns } of HIERARCHY_LEVELS) {
      for (const pattern of patterns) {
        const m = trimmed.match(pattern);
        if (m) {
          // Extract the full heading line (e.g. "TITRE II - Des droits de douane")
          const fullLine = trimmed.split(/\n/)[0].substring(0, 80);
          // Remove everything at this level or deeper
          this.stack = this.stack.filter(e => e.level < level);
          this.stack.push({ level, label: fullLine });
          return true;
        }
      }
    }
    return false;
  }

  /** Build a full hierarchy path like "TITRE II > CHAPITRE IV > Section I" */
  getPath(articleNumber: string | null): string | null {
    const parts = this.stack.map(e => e.label);
    if (articleNumber) parts.push(`Art. ${articleNumber}`);
    return parts.length > 0 ? parts.join(" > ") : null;
  }

  /** Get the current section title (deepest non-article level) */
  getCurrentSection(): string | null {
    if (this.stack.length === 0) return null;
    return this.stack[this.stack.length - 1].label;
  }

  /** Get the parent section (one level above current) */
  getParentSection(): string | null {
    if (this.stack.length < 2) return null;
    return this.stack[this.stack.length - 2].label;
  }
}

// Determine chunk type based on content (French + Arabic)
function detectChunkType(text: string): string {
  const textLower = text.toLowerCase();
  
  // Definition patterns (French + Arabic: تعريف = taʿrīf, يقصد ب = yuqṣad bi)
  if (/\b(définition|définit|entend par|au sens du présent)/i.test(text)) return "definition";
  if (/(?:تعريف|يقصد ب|يراد ب|المقصود ب)/.test(text)) return "definition";
  
  // Header patterns
  if (/^(CHAPITRE|TITRE|SECTION)/i.test(text.trim())) return "header";
  if (/^(?:الباب|الفصل|القسم|الجزء)/.test(text.trim())) return "header";
  
  // Article patterns
  if (/\bart(?:icle)?\.?\s*\d+/i.test(text)) return "article";
  if (/(?:المادة|الفصل|البند)\s*\d+/.test(text)) return "article";
  
  // Note patterns (Arabic: ملاحظة = mulāḥaẓa)
  if (/\b(note|nota|n\.b\.)/i.test(textLower)) return "note";
  if (/(?:ملاحظة|ملحوظة|تنبيه)/.test(text)) return "note";
  
  // Exclusion patterns (Arabic: استثناء = istiṯnāʾ, لا يشمل = lā yašmal)
  if (/\b(exception|exclut|ne comprend pas|à l'exclusion)/i.test(textLower)) return "exclusion";
  if (/(?:استثناء|لا يشمل|باستثناء|يستثنى)/.test(text)) return "exclusion";
  
  // Procedure patterns (Arabic: إجراء = ʾijrāʾ)
  if (/\b(procédure|formalité|déclaration|document)/i.test(textLower)) return "procedure";
  if (/(?:إجراء|إجراءات|تصريح|وثيقة|مستند)/.test(text)) return "procedure";
  
  // Sanction patterns (Arabic: عقوبة = ʿuqūba, غرامة = ġarāma)
  if (/\b(pénalité|sanction|amende|infraction)/i.test(textLower)) return "sanction";
  if (/(?:عقوبة|غرامة|جزاء|مخالفة)/.test(text)) return "sanction";
  
  // Tariff patterns (Arabic: رسم = rasm, ضريبة = ḍarība)
  if (/\b(taux|droit|taxe|%)/i.test(textLower)) return "tariff";
  if (/(?:رسم|ضريبة|تعريفة|نسبة)/.test(text)) return "tariff";
  
  return "general";
}

// Extract keywords from text (French + Arabic)
function extractKeywords(text: string): string[] {
  const keywords: Set<string> = new Set();
  
  // French legal/customs keywords
  const frenchPatterns = [
    /\b(importation|exportation|transit|admission temporaire|dédouanement|régime douanier)\b/gi,
    /\b(certificat d'origine|EUR\.?\s*1|déclaration en douane|DUM)\b/gi,
    /\b(franchise|exonération|suspension|drawback)\b/gi,
    /\b(contrôle|visite|vérification|inspection)\b/gi,
    /\b(valeur en douane|valeur transactionnelle|CIF|FOB)\b/gi,
    /\b(origine préférentielle|origine non préférentielle|cumul)\b/gi,
    /\b(contingent|quota|licence d'importation)\b/gi,
  ];
  
  // Arabic legal/customs keywords
  const arabicPatterns = [
    /(استيراد|تصدير|عبور|إدخال مؤقت|تخليص جمركي|نظام جمركي)/g,
    /(شهادة المنشأ|التصريح الجمركي|وثيقة الاستيراد)/g,
    /(إعفاء|تعليق|امتياز جمركي)/g,
    /(مراقبة|تفتيش|فحص|معاينة)/g,
    /(القيمة الجمركية|قيمة المعاملة)/g,
    /(المنشأ التفضيلي|المنشأ غير التفضيلي|التراكم)/g,
    /(حصة|رخصة استيراد|ترخيص)/g,
  ];
  
  for (const pattern of frenchPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      keywords.add(match[1].toLowerCase().trim());
    }
  }
  
  for (const pattern of arabicPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      keywords.add(match[1].trim());
    }
  }
  
  return Array.from(keywords).slice(0, 15);
}

// Extract HS codes mentioned in chunk
function extractMentionedHSCodes(text: string): string[] {
  const codes: Set<string> = new Set();
  
  // 10-digit codes
  const pattern10 = /\b(\d{10})\b/g;
  let match;
  while ((match = pattern10.exec(text)) !== null) {
    codes.add(match[1]);
  }
  
  // Formatted codes like 84.71.30.00.10
  const patternFormatted = /\b(\d{2}[.\s]\d{2}[.\s]\d{2}(?:[.\s]\d{2}){0,2})\b/g;
  while ((match = patternFormatted.exec(text)) !== null) {
    const normalized = match[1].replace(/[\s.]/g, "");
    if (normalized.length >= 6) codes.add(normalized);
  }
  
  return Array.from(codes).slice(0, 20);
}

function createChunks(pages: ExtractedPage[]): TextChunk[] {
  const chunks: TextChunk[] = [];
  let chunkIndex = 0;
  const hierarchy = new HierarchyTracker();

  for (const page of pages) {
    // 1. FIRST: Process tables as separate chunks (they have high semantic value)
    if (page.tables && page.tables.length > 0) {
      for (const table of page.tables) {
        if (table.markdown && table.markdown.length >= 50) {
          // Create a chunk for each table with full context
          const tableText = `[TABLEAU: ${table.description}]\n\n${table.markdown}`;
          const tableHsCodes = table.has_hs_codes ? extractMentionedHSCodes(table.markdown) : [];
          
          chunks.push({
            chunk_index: chunkIndex++,
            text: tableText,
            page_number: page.page_number,
            char_start: 0,
            char_end: tableText.length,
            article_number: null,
            section_title: table.description || hierarchy.getCurrentSection(),
            parent_section: hierarchy.getParentSection(),
            chunk_type: "table",
            hierarchy_path: hierarchy.getPath(null),
            keywords: table.has_rates ? ["taux", "droit", "pourcentage"] : extractKeywords(table.markdown),
            mentioned_hs_codes: tableHsCodes,
          });
          
          console.log(`[ingest-legal-doc] Created table chunk: "${table.description}" (${table.markdown.length} chars)`);
        }
      }
    }

    // 2. SECOND: Process images/forms as metadata chunks
    if (page.images && page.images.length > 0) {
      for (const img of page.images) {
        if (img.description && img.description.length >= 20) {
          // Create a chunk for form/image descriptions
          const imgText = `[${img.image_type.toUpperCase()}: ${img.description}]${img.extracted_text ? `\n\nContenu:\n${img.extracted_text}` : ''}`;
          
          if (imgText.length >= MIN_CHUNK_SIZE) {
            chunks.push({
              chunk_index: chunkIndex++,
              text: imgText,
              page_number: page.page_number,
              char_start: 0,
              char_end: imgText.length,
              article_number: null,
              section_title: img.description.substring(0, 100),
              parent_section: hierarchy.getParentSection(),
              chunk_type: img.image_type === "form" ? "form" : "image",
              hierarchy_path: hierarchy.getPath(null),
              keywords: img.image_type === "form" ? ["formulaire", "modèle", "template"] : [],
              mentioned_hs_codes: img.extracted_text ? extractMentionedHSCodes(img.extracted_text) : [],
            });
            
            console.log(`[ingest-legal-doc] Created ${img.image_type} chunk: "${img.description.substring(0, 50)}..."`);
          }
        }
      }
    }

    // 3. THIRD: Process regular text content
    const text = page.text.trim();
    if (!text) continue;

    // Split into paragraphs first
    const paragraphs = text.split(/\n\n+/);
    let currentChunk = "";
    let charStart = 0;

    for (const para of paragraphs) {
      const trimmedPara = para.trim();
      if (!trimmedPara) continue;

      // Track hierarchy changes (Titre > Chapitre > Section)
      hierarchy.update(trimmedPara);

      // ARTICLE-AWARE CHUNKING: Force split on article boundaries
      const isArticleBoundary = /^(?:Article|Art\.?)\s*\d+/i.test(trimmedPara) || 
                                 /^(?:المادة|الفصل|البند)\s*\d+/.test(trimmedPara);
      
      const shouldSplit = currentChunk && (
        (currentChunk.length + trimmedPara.length) > CHUNK_SIZE_TARGET ||
        (isArticleBoundary && currentChunk.length >= MIN_CHUNK_SIZE)
      );

      if (shouldSplit) {
        if (currentChunk.length >= MIN_CHUNK_SIZE) {
          const chunkText = currentChunk.trim();
          const articleNumber = extractArticleNumber(chunkText);
          const sectionTitle = extractSectionTitle(chunkText) || hierarchy.getCurrentSection();
          const hierarchyPath = hierarchy.getPath(articleNumber);
          
          // CONTEXTUAL CHUNKING: Prepend hierarchy_path to text for better embeddings
          const contextualText = hierarchyPath 
            ? `[${hierarchyPath}]\n${chunkText}` 
            : chunkText;
          
          chunks.push({
            chunk_index: chunkIndex++,
            text: contextualText,
            page_number: page.page_number,
            char_start: charStart,
            char_end: charStart + currentChunk.length,
            article_number: articleNumber,
            section_title: sectionTitle,
            parent_section: hierarchy.getParentSection(),
            chunk_type: detectChunkType(chunkText),
            hierarchy_path: hierarchyPath,
            keywords: extractKeywords(chunkText),
            mentioned_hs_codes: extractMentionedHSCodes(chunkText),
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
      const chunkText = currentChunk.trim();
      const articleNumber = extractArticleNumber(chunkText);
      const sectionTitle = extractSectionTitle(chunkText) || hierarchy.getCurrentSection();
      const hierarchyPath = hierarchy.getPath(articleNumber);
      
      // CONTEXTUAL CHUNKING: Prepend hierarchy_path
      const contextualText = hierarchyPath 
        ? `[${hierarchyPath}]\n${chunkText}` 
        : chunkText;
      
      chunks.push({
        chunk_index: chunkIndex++,
        text: contextualText,
        page_number: page.page_number,
        char_start: charStart,
        char_end: charStart + currentChunk.length,
        article_number: articleNumber,
        section_title: sectionTitle,
        parent_section: hierarchy.getParentSection(),
        chunk_type: detectChunkType(chunkText),
        hierarchy_path: hierarchyPath,
        keywords: extractKeywords(chunkText),
        mentioned_hs_codes: extractMentionedHSCodes(chunkText),
      });
    }
  }

  // Log summary
  const tableChunks = chunks.filter(c => c.chunk_type === "table").length;
  const formChunks = chunks.filter(c => c.chunk_type === "form").length;
  const imageChunks = chunks.filter(c => c.chunk_type === "image").length;
  const withHierarchy = chunks.filter(c => c.hierarchy_path && c.hierarchy_path.includes(" > ")).length;
  console.log(`[ingest-legal-doc] Chunks created: ${chunks.length} total (${tableChunks} tables, ${formChunks} forms, ${imageChunks} images, ${withHierarchy} with multi-level hierarchy)`);

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

interface ExtractedDocumentMetadata {
  ref: string | null;
  title: string | null;
  date: string | null;       // ISO date extracted from document
  issuer: string | null;     // Issuing authority
}

/**
 * Extract the actual document reference, title, date and issuer from the text content
 * This handles cases where the file name doesn't match the real reference
 * (e.g., file named "circulaire_24320.pdf" but contains "Circulaire n° 4601/311")
 */
function extractDocumentReference(fullText: string, sourceType: string): ExtractedDocumentMetadata {
  const textStart = fullText.slice(0, 4000); // Check first ~4000 chars for reference/metadata
  
  // PRIORITY 1: Try to extract the EXACT reference immediately following "CIRCULAIRE N°" or "دورية رقم"
  // This is the most reliable pattern for Moroccan administrative circulars (French + Arabic)
  const priorityCircularPatterns = [
    // French patterns
    // "CIRCULAIRE N° 4591/312" or "CIRCULAIRE N° 4591 /312" (with space before slash)
    /CIRCULAIRE\s*N[°o]?\s*(\d{3,5}\s*[/\-]\s*\d{1,4})/i,
    // "Circulaire n° 4591-312"
    /[Cc]irculaire\s+[Nn][°o]?\s*(\d{3,5}\s*[-]\s*\d{1,4})/,
    // Standalone number format: "CIRCULAIRE N° 4591"
    /CIRCULAIRE\s*N[°o]?\s*(\d{4,5})\b/i,
    
    // Arabic patterns - دورية (dawriyya = circular)
    // "دورية رقم 4608/223" or "دورية رقم 4608 / 223"
    /دورية\s*(?:رقم|عدد)?\s*[:.]?\s*(\d{3,5}\s*[/\-]\s*\d{1,4})/,
    // "دورية رقم 4608-223"
    /دورية\s*(?:رقم|عدد)?\s*[:.]?\s*(\d{3,5}\s*[-]\s*\d{1,4})/,
    // Standalone: "دورية رقم 4608"
    /دورية\s*(?:رقم|عدد)?\s*[:.]?\s*(\d{4,5})\b/,
    
    // منشور (manšūr = circular/memo) - alternative Arabic term
    /منشور\s*(?:رقم|عدد)?\s*[:.]?\s*(\d{3,5}\s*[/\-]\s*\d{1,4})/,
    /منشور\s*(?:رقم|عدد)?\s*[:.]?\s*(\d{4,5})\b/,
  ];
  
  let extractedRef: string | null = null;
  let extractedTitle: string | null = null;
  
  // Try priority circular patterns first (for source_type "circular")
  if (sourceType === "circular") {
    for (const pattern of priorityCircularPatterns) {
      const match = textStart.match(pattern);
      if (match) {
        // Clean up the reference (remove extra spaces around separators)
        extractedRef = match[1].replace(/\s*([/\-])\s*/g, '$1').trim();
        console.log(`[ingest-legal-doc] Found priority circular reference: "${extractedRef}"`);
        break;
      }
    }
  }
  
  // If priority patterns didn't match, fall back to general patterns
  if (!extractedRef) {
    // Patterns for different document types (French + Arabic)
    const patterns: { type: string; patterns: RegExp[] }[] = [
      {
        type: "circular",
        patterns: [
          // French: "Circulaire n° 4601/311", "Circulaire N°4601-311"  
          /[Cc]irculaire\s*[Nn°°.:\s]+(\d{3,5}[\s]*[/\-][\s]*\d{1,4})/,
          // Simple numeric reference
          /[Cc]irculaire\s*[Nn°°.:\s]+(\d{4,5})\b/,
          // Arabic: منشور رقم (manšūr raqm = circular number)
          /(?:منشور|تعميم)\s*(?:رقم|عدد)?\s*[:.]?\s*(\d{3,5}[\s]*[/\-]?[\s]*\d{0,4})/,
        ],
      },
      {
        type: "note",
        patterns: [
          /[Nn]ote\s*[Nn°°.:\s]+(\d{2,5}[\s/-]?\d{0,4})/,
          /(?:مذكرة|ملاحظة)\s*(?:رقم|عدد)?\s*[:.]?\s*(\d{2,5}[\s/-]?\d{0,4})/,
        ],
      },
      {
        type: "decision",
        patterns: [
          /[Dd]écision\s*[Nn°°.:\s]+(\d{2,5}[\s/-]?\d{0,4})/,
          /(?:قرار|مقرر)\s*(?:رقم|عدد)?\s*[:.]?\s*(\d{2,5}[\s/-]?\d{0,4})/,
        ],
      },
      {
        type: "decree",
        patterns: [
          /[Dd]écret\s*[Nn°°.:\s]+(\d[\d.-]+\d)/,
          /(?:مرسوم|ظهير)\s*(?:رقم|عدد)?\s*[:.]?\s*([\d.-]+)/,
        ],
      },
      {
        type: "law",
        patterns: [
          /[Ll]oi\s*[Nn°°.:\s]+(\d[\d.-]+)/,
          /(?:قانون)\s*(?:رقم|عدد)?\s*[:.]?\s*([\d.-]+)/,
        ],
      },
      {
        type: "arrêté",
        patterns: [
          /[Aa]rrêté\s*[Nn°°.:\s]+(\d[\d.-]+\d)/,
          /(?:قرار وزاري)\s*(?:رقم|عدد)?\s*[:.]?\s*([\d.-]+)/,
        ],
      },
    ];

    // Try to find reference based on source type first
    const typePatterns = patterns.find(p => p.type === sourceType)?.patterns || [];
    for (const pattern of typePatterns) {
      const match = textStart.match(pattern);
      if (match) {
        extractedRef = match[1].replace(/\s+/g, '').trim(); // Remove internal spaces
        break;
      }
    }

    // If not found, try all patterns
    if (!extractedRef) {
      for (const group of patterns) {
        for (const pattern of group.patterns) {
          const match = textStart.match(pattern);
          if (match) {
            extractedRef = match[1].replace(/\s+/g, '').trim();
            break;
          }
        }
        if (extractedRef) break;
      }
    }
  }

  // Extract title: look for "OBJET :" or "موضوع" (mawḍūʿ = subject)
  // Handle OCR variations like "OB.JET", "OBJET", "O B J E T"
  const titlePatterns = [
    // French patterns - handle OCR noise (dots, spaces between letters)
    /O\.?B\.?J\.?E\.?T\s*[:.\s]\s*(.{10,200}?)(?:\n|$)/i,
    /OBJET\s*:\s*(.{10,200}?)(?:\n|$)/i,
    /Objet\s*:\s*(.{10,200}?)(?:\n|$)/,
    // Alternative French patterns
    /Réf[ée]rence\s*:\s*(.{10,200}?)(?:\n|$)/i,
    /Concernant\s*:\s*(.{10,200}?)(?:\n|$)/i,
    // Arabic patterns - موضوع (mawḍūʿ = subject)
    /(?:موضوع|الموضوع)\s*[:.\s]\s*(.{10,200}?)(?:\n|$)/,
    // عنوان ('unwān = title)
    /(?:عنوان|العنوان)\s*[:.\s]\s*(.{10,200}?)(?:\n|$)/,
  ];

  for (const pattern of titlePatterns) {
    const match = textStart.match(pattern);
    if (match) {
      // Clean up the title: remove trailing punctuation, extra whitespace
      extractedTitle = match[1]
        .replace(/[\r\n]+/g, ' ')  // Replace newlines with spaces
        .replace(/\s+/g, ' ')       // Collapse multiple spaces
        .replace(/[.,:;]+$/, '')    // Remove trailing punctuation
        .trim();
      console.log(`[ingest-legal-doc] Extracted title via pattern: "${extractedTitle}"`);
      break;
    }
  }

  // =========================================================================
  // DATE EXTRACTION
  // =========================================================================
  let extractedDate: string | null = null;
  
  const datePatterns = [
    // French: "Rabat, le 15 janvier 2024" or "Le 15/01/2024"
    /(?:le|en date du|du)\s+(\d{1,2})\s*(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s*(\d{4})/i,
    // French: "15/01/2024" or "15-01-2024"
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/,
    // Arabic date: في 15 يناير 2024
    /في\s+(\d{1,2})\s+(يناير|فبراير|مارس|أبريل|ماي|يونيو|يوليوز|غشت|شتنبر|أكتوبر|نونبر|دجنبر)\s*(\d{4})/,
    // Hijri date marker (just extract Gregorian if nearby)
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/, // ISO format: 2024-01-15
  ];
  
  const frenchMonths: Record<string, number> = {
    janvier: 1, février: 2, mars: 3, avril: 4, mai: 5, juin: 6,
    juillet: 7, août: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12
  };
  
  const arabicMonths: Record<string, number> = {
    يناير: 1, فبراير: 2, مارس: 3, أبريل: 4, ماي: 5, يونيو: 6,
    يوليوز: 7, غشت: 8, شتنبر: 9, أكتوبر: 10, نونبر: 11, دجنبر: 12
  };
  
  for (const pattern of datePatterns) {
    const match = textStart.match(pattern);
    if (match) {
      try {
        let year: number, month: number, day: number;
        
        if (match[2] && frenchMonths[match[2].toLowerCase()]) {
          // French month name format
          day = parseInt(match[1]);
          month = frenchMonths[match[2].toLowerCase()];
          year = parseInt(match[3]);
        } else if (match[2] && arabicMonths[match[2]]) {
          // Arabic month name format
          day = parseInt(match[1]);
          month = arabicMonths[match[2]];
          year = parseInt(match[3]);
        } else if (match[0].includes('-') && match[1].length === 4) {
          // ISO format: YYYY-MM-DD
          year = parseInt(match[1]);
          month = parseInt(match[2]);
          day = parseInt(match[3]);
        } else {
          // DD/MM/YYYY format
          day = parseInt(match[1]);
          month = parseInt(match[2]);
          year = parseInt(match[3]);
        }
        
        // Validate reasonable date range (2000-2030)
        if (year >= 2000 && year <= 2030 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          extractedDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          console.log(`[ingest-legal-doc] Extracted date: "${extractedDate}"`);
          break;
        }
      } catch (e) {
        // Continue to next pattern
      }
    }
  }

  // =========================================================================
  // ISSUER EXTRACTION
  // =========================================================================
  let extractedIssuer: string | null = null;
  
  const issuerPatterns = [
    // French patterns
    /(?:ADMINISTRATION|Direction)\s+(?:des\s+)?(?:DOUANES|Douanes)\s+(?:et\s+)?(?:IMPÔTS\s+INDIRECTS|Impôts\s+Indirects)?/i,
    /(?:LE\s+)?DIRECTEUR\s+(?:GÉNÉRAL|Général)\s+(?:de\s+l[''])?(?:ADMINISTRATION|Administration)\s+(?:des\s+)?(?:DOUANES|Douanes)/i,
    /MINISTÈRE\s+(?:de\s+l[''])?(?:ÉCONOMIE|Économie|FINANCES|Finances)/i,
    /OFFICE\s+(?:des\s+)?(?:CHANGES|Changes)/i,
    /(?:AGENCE|Agence)\s+(?:NATIONALE|Nationale)\s+(?:de\s+)?(?:RÉGLEMENTATION|Réglementation)\s+(?:des\s+)?(?:TÉLÉCOMMUNICATIONS|Télécommunications)/i,
    // Arabic patterns
    /إدارة\s*الجمارك\s*و?الضرائب\s*غير\s*المباشرة/,
    /المديرية?\s*العامة?\s*للجمارك/,
    /مكتب\s*الصرف/,
    /وزارة\s*(?:الاقتصاد|المالية)/,
  ];
  
  for (const pattern of issuerPatterns) {
    const match = textStart.match(pattern);
    if (match) {
      // Normalize issuer name
      const rawIssuer = match[0].trim();
      
      if (/douanes/i.test(rawIssuer) || /جمارك/.test(rawIssuer)) {
        extractedIssuer = "Administration des Douanes et Impôts Indirects (ADII)";
      } else if (/changes/i.test(rawIssuer) || /صرف/.test(rawIssuer)) {
        extractedIssuer = "Office des Changes";
      } else if (/ministère/i.test(rawIssuer) || /وزارة/.test(rawIssuer)) {
        extractedIssuer = "Ministère de l'Économie et des Finances";
      } else if (/télécommunications/i.test(rawIssuer)) {
        extractedIssuer = "Agence Nationale de Réglementation des Télécommunications (ANRT)";
      } else {
        extractedIssuer = rawIssuer;
      }
      
      console.log(`[ingest-legal-doc] Extracted issuer: "${extractedIssuer}"`);
      break;
    }
  }

  console.log(`[ingest-legal-doc] Extracted metadata: ref="${extractedRef}", title="${extractedTitle?.slice(0, 50)}...", date="${extractedDate}", issuer="${extractedIssuer}"`);

  return { ref: extractedRef, title: extractedTitle, date: extractedDate, issuer: extractedIssuer };
}

// ============================================================================
// PDF STORAGE & pdf_documents CREATION
// ============================================================================

/**
 * Stores the PDF in Supabase Storage and creates a pdf_documents entry
 * Returns the pdf_documents.id and file_path for linking
 */
async function storePdfAndCreateDocument(
  supabase: any,
  pdfBase64: string,
  request: IngestRequest,
  totalPages: number,
  extractedMetadata: ExtractedDocumentMetadata
): Promise<{ pdfId: string; filePath: string } | null> {
  try {
    const extractedRef = extractedMetadata.ref || request.source_ref;
    const extractedTitle = extractedMetadata.title;
    const extractedDate = extractedMetadata.date || request.source_date;
    const extractedIssuer = extractedMetadata.issuer || request.issuer;
    
    // Generate file path: circulaires/YYYY/reference.pdf
    const year = extractedDate 
      ? new Date(extractedDate).getFullYear() 
      : new Date().getFullYear();
    
    // Clean reference for file name
    const safeRef = (extractedRef || request.source_ref)
      .replace(/[/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, '_');
    
    const fileName = request.file_name || `${request.source_type}_${safeRef}.pdf`;
    const filePath = `circulaires/${year}/${fileName}`;
    
    console.log(`[ingest-legal-doc] Storing PDF at: ${filePath}`);
    
    // Convert base64 to Uint8Array for upload (use efficient chunked converter)
    const pdfBytes = base64ToUint8Array(pdfBase64);
    
    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('pdf-documents')
      .upload(filePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true
      });
    
    if (uploadError) {
      console.error(`[ingest-legal-doc] Storage upload error:`, uploadError);
      return null;
    }
    
    console.log(`[ingest-legal-doc] PDF uploaded successfully`);
    
    // Map source_type to category
    const categoryMap: Record<string, string> = {
      circular: 'Circulaire',
      note: 'Réglementation',
      decision: 'Réglementation',
      law: 'Réglementation/Code',
      decree: 'Réglementation',
      arrêté: 'Réglementation',
    };
    
    const category = categoryMap[request.source_type] || 'Réglementation';
    const title = extractedTitle || request.title || `${request.source_type} ${extractedRef}`;
    
    // Create pdf_documents entry (simple insert - file_path is unique per upload timestamp)
    const { data: pdfDoc, error: docError } = await supabase
      .from('pdf_documents')
      .insert({
        title: title,
        file_name: fileName,
        file_path: filePath,
        category: category,
        document_type: request.source_type,
        document_reference: extractedRef || request.source_ref,
        country_code: request.country_code || 'MA',
        issuing_authority: extractedIssuer, // Use extracted issuer
        publication_date: extractedDate,    // Use extracted date
        page_count: totalPages,
        file_size_bytes: pdfBytes.length,
        mime_type: 'application/pdf',
        is_active: true,
        is_verified: false,
      })
      .select('id')
      .single();
    
    if (docError) {
      console.error(`[ingest-legal-doc] pdf_documents insert error:`, docError);
      return null;
    }
    
    console.log(`[ingest-legal-doc] Created pdf_documents entry: ${pdfDoc.id}`);
    
    return { pdfId: pdfDoc.id, filePath: filePath };
    
  } catch (error) {
    console.error(`[ingest-legal-doc] PDF storage error:`, error);
    return null;
  }
}

async function upsertLegalSource(
  supabase: any,
  request: IngestRequest,
  fullText: string
): Promise<number> {
  // Try to extract the actual reference from the document content
  const extracted = extractDocumentReference(fullText, request.source_type);
  
  // Use extracted values if available, otherwise fall back to provided request values
  const actualRef = extracted.ref || request.source_ref;
  const actualTitle = request.title || extracted.title;
  const actualDate = request.source_date || extracted.date;
  const actualIssuer = request.issuer || extracted.issuer;
  
  if (extracted.ref && extracted.ref !== request.source_ref) {
    console.log(`[ingest-legal-doc] Using extracted reference "${extracted.ref}" instead of provided "${request.source_ref}"`);
  }
  if (extracted.date && !request.source_date) {
    console.log(`[ingest-legal-doc] Using extracted date "${extracted.date}"`);
  }
  if (extracted.issuer && !request.issuer) {
    console.log(`[ingest-legal-doc] Using extracted issuer "${extracted.issuer}"`);
  }

  const { data, error } = await supabase
    .from("legal_sources")
    .upsert(
      {
        country_code: request.country_code || "MA",
        source_type: request.source_type,
        source_ref: actualRef,
        title: actualTitle,
        issuer: actualIssuer,
        source_date: actualDate,
        effective_date: actualDate, // Also set effective_date to same value if not provided
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
          // Enriched metadata
          article_number: chunk.article_number,
          section_title: chunk.section_title,
          parent_section: chunk.parent_section,
          chunk_type: chunk.chunk_type,
          hierarchy_path: chunk.hierarchy_path,
          keywords: chunk.keywords.length > 0 ? chunk.keywords : null,
          mentioned_hs_codes: chunk.mentioned_hs_codes.length > 0 ? chunk.mentioned_hs_codes : null,
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

// Append chunks without deleting existing ones (for batch mode)
async function insertChunksAppend(
  supabase: any,
  sourceId: number,
  chunks: TextChunk[],
  generateEmbeddings: boolean
): Promise<number> {
  // Get current max chunk_index for this source
  const { data: maxData } = await supabase
    .from("legal_chunks")
    .select("chunk_index")
    .eq("source_id", sourceId)
    .order("chunk_index", { ascending: false })
    .limit(1);
  
  const startIndex = (maxData && maxData.length > 0) ? maxData[0].chunk_index + 1 : 0;
  
  let inserted = 0;

  // Insert in batches of 10
  for (let i = 0; i < chunks.length; i += 10) {
    const batch = chunks.slice(i, i + 10);
    
    const rows = await Promise.all(
      batch.map(async (chunk, batchIdx) => {
        let embedding = null;
        if (generateEmbeddings) {
          const embeddingArray = await generateEmbedding(chunk.text);
          if (embeddingArray) {
            embedding = JSON.stringify(embeddingArray);
          }
        }

        return {
          source_id: sourceId,
          chunk_index: startIndex + i + batchIdx,
          chunk_text: chunk.text,
          page_number: chunk.page_number,
          char_start: chunk.char_start,
          char_end: chunk.char_end,
          embedding,
          // Enriched metadata
          article_number: chunk.article_number,
          section_title: chunk.section_title,
          parent_section: chunk.parent_section,
          chunk_type: chunk.chunk_type,
          hierarchy_path: chunk.hierarchy_path,
          keywords: chunk.keywords.length > 0 ? chunk.keywords : null,
          mentioned_hs_codes: chunk.mentioned_hs_codes.length > 0 ? chunk.mentioned_hs_codes : null,
        };
      })
    );

    const { error } = await supabase.from("legal_chunks").insert(rows);

    if (error) {
      console.error("[ingest-legal-doc] Chunk append error:", error);
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
    return handleCorsPreFlight(req);
  }

  const corsHeaders = getCorsHeaders(req);

  // Require admin authentication
  const { error: authError } = await requireAuth(req, corsHeaders, true);
  if (authError) return authError;

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

    const isBatchMode = body.batch_mode === true && body.start_page && body.end_page;
    console.log(`[ingest-legal-doc] Ingesting ${body.source_type} ${body.source_ref}${isBatchMode ? ` (batch: pages ${body.start_page}-${body.end_page})` : ''}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Get PDF and determine total pages
    let pdfBase64 = body.pdf_base64;
    
    if (!pdfBase64 && body.pdf_url) {
      console.log(`[ingest-legal-doc] Fetching PDF from ${body.pdf_url}`);
      const pdfResponse = await fetch(body.pdf_url);
      if (!pdfResponse.ok) {
        throw new Error(`Failed to fetch PDF: ${pdfResponse.status}`);
      }
      const pdfBuffer = await pdfResponse.arrayBuffer();
      pdfBase64 = btoa(
        new Uint8Array(pdfBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );
    }

    let pages: ExtractedPage[] = [];
    let totalPages = 0;

    if (body.raw_text) {
      // Raw text provided directly
      pages = [{ page_number: 1, text: body.raw_text }];
      totalPages = 1;
    } else if (pdfBase64) {
      // Get total page count first
      totalPages = await getPdfPageCount(pdfBase64);
      console.log(`[ingest-legal-doc] PDF has ${totalPages} pages total`);

      if (isBatchMode) {
        // BATCH MODE: Only extract specified page range
        const startPage = Math.max(1, body.start_page!);
        const endPage = Math.min(totalPages, body.end_page!);
        
        // Guard: if start_page > totalPages, document is already fully processed
        if (startPage > totalPages) {
          console.log(`[ingest-legal-doc] start_page ${startPage} > totalPages ${totalPages} — already complete`);
          return new Response(JSON.stringify({
            success: true,
            source_id: body.source_id || null,
            total_pages: totalPages,
            pages_processed: 0,
            chunks_created: 0,
            detected_codes_count: 0,
            evidence_created: 0,
            already_complete: true,
          }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        
        console.log(`[ingest-legal-doc] Batch mode: extracting pages ${startPage}-${endPage}`);
        
        try {
          // Split PDF to just the pages we need
          const chunkBase64 = await splitPdfPages(pdfBase64, startPage, endPage);
          pages = await extractTextFromPDFChunk(chunkBase64, startPage);
        } catch (splitError) {
          const splitMsg = splitError instanceof Error ? splitError.message : String(splitError);
          if (splitMsg.includes("PDFDict") || splitMsg.includes("Expected instance") || splitMsg.includes("undefined")) {
            console.warn(`[ingest-legal-doc] pdf-lib split failed in batch mode, sending entire PDF to Claude`);
            pages = await extractTextFromPDFChunk(pdfBase64, startPage);
          } else {
            throw splitError;
          }
        }
        
      } else {
        // FULL MODE: Extract all pages using batching
        pages = await extractTextFromPDF(pdfBase64);
      }
    }

    console.log(`[ingest-legal-doc] Extracted ${pages.length} pages`);

    // 2. Combine full text for this batch
    const fullText = pages.map((p) => p.text).join("\n\n---PAGE---\n\n");

    // 3. Create chunks
    const chunks = createChunks(pages);
    console.log(`[ingest-legal-doc] Created ${chunks.length} chunks`);

    // 4. Detect HS codes
    const detectedCodes = body.detect_hs_codes !== false ? detectHSCodes(pages) : [];
    console.log(`[ingest-legal-doc] Detected ${detectedCodes.length} HS codes`);

    // 5. Handle source record
    let sourceId: number;
    
    if (isBatchMode && body.source_id) {
      // Append mode: use existing source
      sourceId = body.source_id;
      console.log(`[ingest-legal-doc] Appending to existing source ID: ${sourceId}`);
      
      // Append to full_text
      const { data: existingSource } = await supabase
        .from("legal_sources")
        .select("full_text")
        .eq("id", sourceId)
        .single();
      
      if (existingSource) {
        const combinedText = (existingSource.full_text || "") + "\n\n---BATCH---\n\n" + fullText;
        await supabase
          .from("legal_sources")
          .update({ full_text: combinedText })
          .eq("id", sourceId);
      }
    } else {
      // Create new source
      sourceId = await upsertLegalSource(supabase, body, fullText);
      console.log(`[ingest-legal-doc] Created/updated source ID: ${sourceId}`);
    }

    // 5b. Store PDF and create pdf_documents entry if requested
    // For batch mode, only do this on the FIRST batch (start_page == 1)
    let pdfId: string | null = null;
    const isFirstBatch = !isBatchMode || body.start_page === 1;
    
    if (body.store_pdf !== false && pdfBase64 && isFirstBatch) {
      // Extract metadata for file naming and database
      const extracted = extractDocumentReference(fullText, body.source_type);
      const actualRef = extracted.ref || body.source_ref;
      const actualTitle = body.title || extracted.title;
      const actualDate = extracted.date || body.source_date;
      const actualIssuer = extracted.issuer || body.issuer;
      
      const storageResult = await storePdfAndCreateDocument(
        supabase,
        pdfBase64,
        body,
        totalPages,
        extracted // Pass full extracted metadata object
      );
      
      if (storageResult) {
        pdfId = storageResult.pdfId;
        
        // Create legal_references entry to link pdf_documents to this source
        const { error: refError } = await supabase
          .from('legal_references')
          .upsert({
            pdf_id: storageResult.pdfId,
            reference_type: body.source_type === 'circular' ? 'Circulaire' : 
                           body.source_type === 'law' ? 'Loi' :
                           body.source_type === 'decree' ? 'Décret' :
                           body.source_type === 'note' ? 'Note' : 'Document',
            reference_number: actualRef,
            title: actualTitle,
            reference_date: actualDate,  // Use extracted date
            country_code: body.country_code || 'MA',
            context: fullText.slice(0, 300),
            is_active: true,
          }, {
            onConflict: 'reference_number,reference_type'
          });
        
        if (refError) {
          console.error(`[ingest-legal-doc] legal_references insert error:`, refError);
        } else {
          console.log(`[ingest-legal-doc] Created legal_references entry linking to pdf_id: ${pdfId} with date: ${actualDate}`);
        }
      }
    }

    // 6. Insert chunks (append mode - don't delete existing for batch)
    // IMPORTANT: Skip inline embedding generation to save CPU time
    // The trigger `queue_for_embedding` on legal_chunks automatically queues
    // new chunks for async embedding via the `refresh-embeddings` function.
    // This avoids OpenAI API calls inside the edge function, preventing CPU exhaustion.
    const shouldGenerateEmbeddings = false;
    
    let chunksCreated = 0;
    if (isBatchMode && body.source_id) {
      // Append chunks without deleting existing ones
      chunksCreated = await insertChunksAppend(
        supabase,
        sourceId,
        chunks,
        shouldGenerateEmbeddings
      );
    } else {
      chunksCreated = await insertChunks(
        supabase,
        sourceId,
        chunks,
        shouldGenerateEmbeddings
      );
    }

    // 7. Insert HS evidence
    const evidenceCreated = await insertHSEvidence(
      supabase,
      sourceId,
      detectedCodes,
      body.country_code || "MA"
    );

    // 8. Update total_chunks counter on legal_sources
    try {
      const { count: actualChunkCount } = await supabase
        .from("legal_chunks")
        .select("id", { count: "exact", head: true })
        .eq("source_id", sourceId);
      
      await supabase
        .from("legal_sources")
        .update({ total_chunks: actualChunkCount || chunksCreated })
        .eq("id", sourceId);
      
      console.log(`[ingest-legal-doc] Updated total_chunks to ${actualChunkCount || chunksCreated} for source ${sourceId}`);
    } catch (updateErr) {
      console.warn(`[ingest-legal-doc] Failed to update total_chunks: ${updateErr}`);
    }

    // 9. Sync metadata to pdf_documents entries
    // a) Enrich the document created by THIS pipeline run (description from excerpt)
    // b) Also enrich old uploads (via analyze-pdf) that match by title/ref
    try {
      const { data: sourceData } = await supabase
        .from("legal_sources")
        .select("source_ref, title, source_date, effective_date, issuer, excerpt")
        .eq("id", sourceId)
        .single();
      
      if (sourceData && sourceData.excerpt) {
        const updatePayload = {
          description: (sourceData.excerpt || "").slice(0, 500),
          publication_date: sourceData.source_date,
          effective_date: sourceData.effective_date,
          issuing_authority: sourceData.issuer,
          document_reference: sourceData.source_ref,
          document_type: "regulatory",
          updated_at: new Date().toISOString(),
        };

        // a) Update the document created in this pipeline run (by pdfId if available)
        if (pdfId) {
          const { error: selfSyncError } = await supabase
            .from("pdf_documents")
            .update(updatePayload)
            .eq("id", pdfId);
          
          if (!selfSyncError) {
            console.log(`[ingest-legal-doc] Enriched own pdf_documents ${pdfId} with description`);
          }
        }

        // b) Find and enrich other matching pdf_documents missing description
        const { data: matchingPdfs } = await supabase
          .from("pdf_documents")
          .select("id, title")
          .or(`title.eq.${sourceData.title},document_reference.eq.${sourceData.source_ref}`)
          .is("description", null)
          .in("category", ["circulaire", "reglementation", "note", "instruction", "Circulaire", "Réglementation"]);
        
        if (matchingPdfs && matchingPdfs.length > 0) {
          for (const pdf of matchingPdfs) {
            if (pdf.id === pdfId) continue; // Already updated above
            const { error: syncError } = await supabase
              .from("pdf_documents")
              .update(updatePayload)
              .eq("id", pdf.id);
            
            if (!syncError) {
              console.log(`[ingest-legal-doc] Synced metadata to pdf_documents ${pdf.id} (${pdf.title})`);
            }
          }
        }
      }
    } catch (syncErr) {
      console.warn(`[ingest-legal-doc] pdf_documents sync failed (non-critical): ${syncErr}`);
    }

    const duration = Date.now() - startTime;
    console.log(`[ingest-legal-doc] Completed in ${duration}ms`);

    const response: IngestResponse = {
      success: true,
      source_id: sourceId,
      pdf_id: pdfId,
      pages_processed: pages.length,
      chunks_created: chunksCreated,
      detected_codes_count: detectedCodes.length,
      evidence_created: evidenceCreated,
      total_pages: totalPages,
      batch_start: isBatchMode ? body.start_page : undefined,
      batch_end: isBatchMode ? body.end_page : undefined,
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
