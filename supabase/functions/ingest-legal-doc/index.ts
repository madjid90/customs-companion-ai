// ============================================================================
// EDGE FUNCTION: INGEST LEGAL DOCUMENT
// ============================================================================
// Ingests regulatory documents (circulars, notes, decisions) with source tracking
// Extracts text, chunks for RAG, and detects HS code mentions
// ============================================================================

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { 
  normalize10Strict, 
  normalize6Strict, 
  extractHS6,
  digitsOnly,
  parseDetectedCode,
  type ParsedHSCode
} from "../_shared/hs-code-utils.ts";
import { callAnthropicWithRetry } from "../_shared/retry.ts";

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
  
  // Batch processing (for large PDFs - client-orchestrated)
  start_page?: number; // 1-indexed start page (for batch mode)
  end_page?: number; // 1-indexed end page (for batch mode)
  batch_mode?: boolean; // If true, only process specified page range
  source_id?: number; // Existing source ID for append mode
  
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
const CLAUDE_TIMEOUT_MS = 55000; // 55 second timeout - must be < Edge Function limit (~60s)

// Split a PDF into a subset of pages using pdf-lib
async function splitPdfPages(
  pdfBase64: string,
  startPage: number,
  endPage: number
): Promise<string> {
  const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
  const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
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
  
  const newPdfBytes = await newDoc.save();
  
  // Verify the new PDF has correct page count
  const verifyDoc = await PDFDocument.load(newPdfBytes);
  const newPageCount = verifyDoc.getPageCount();
  console.log(`[ingest-legal-doc] Split PDF has ${newPageCount} pages (expected ${pageIndices.length})`);
  
  if (newPageCount !== pageIndices.length) {
    throw new Error(`Split verification failed: expected ${pageIndices.length} pages, got ${newPageCount}`);
  }
  
  // Convert to base64
  let binary = '';
  const bytes = new Uint8Array(newPdfBytes);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  
  const result = btoa(binary);
  console.log(`[ingest-legal-doc] Split PDF base64 size: ${(result.length / 1024).toFixed(1)}KB`);
  
  return result;
}

// Get actual page count from PDF
async function getPdfPageCount(pdfBase64: string): Promise<number> {
  const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
  const srcDoc = await PDFDocument.load(pdfBytes);
  return srcDoc.getPageCount();
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
    max_tokens: 4000, // Reduced for single page
    system: `Tu es un extracteur de texte multilingue (français, arabe, anglais). 
Extrais le texte intégral de chaque page du document PDF.

أنت مستخرج نصوص متعدد اللغات. استخرج النص الكامل من كل صفحة في وثيقة PDF.

Retourne un JSON strict / أرجع JSON صارم:
{
  "pages": [
    {"page_number": 1, "text": "...contenu page 1 / محتوى الصفحة 1..."},
    {"page_number": 2, "text": "...contenu page 2 / محتوى الصفحة 2..."}
  ]
}
Préserve la structure, les numéros d'articles, les références. Ne résume pas, extrais tout le texte.
حافظ على البنية وأرقام المواد والمراجع. لا تلخص، استخرج كل النص.`,
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
            text: `Extrais le texte intégral de toutes les pages de ce document PDF (français ou arabe). JSON strict uniquement.
استخرج النص الكامل من جميع صفحات وثيقة PDF (فرنسية أو عربية). JSON صارم فقط.`,
          },
        ],
      },
    ],
  };

  // Use callAnthropicWithRetry for automatic retry on 500/503/529 errors
  const response = await callAnthropicWithRetry(
    ANTHROPIC_API_KEY,
    requestBody,
    CLAUDE_TIMEOUT_MS
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
    // Adjust page numbers to absolute values
    return (parsed.pages || []).map((p: any, idx: number) => ({
      page_number: startPage + idx,
      text: p.text || "",
    }));
  } catch (e) {
    console.warn("[ingest-legal-doc] JSON parse failed, using raw text");
    return [{ page_number: startPage, text: content }];
  }
}

async function extractTextFromPDF(pdfBase64: string): Promise<ExtractedPage[]> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }

  // Get actual page count using pdf-lib
  const totalPages = await getPdfPageCount(pdfBase64);
  console.log(`[ingest-legal-doc] PDF has ${totalPages} pages`);

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
    // استيراد (istīrād = import), تصدير (taṣdīr = export), عبور (ʿubūr = transit)
    /(استيراد|تصدير|عبور|إدخال مؤقت|تخليص جمركي|نظام جمركي)/g,
    // شهادة المنشأ (šahādat al-manšaʾ = certificate of origin)
    /(شهادة المنشأ|التصريح الجمركي|وثيقة الاستيراد)/g,
    // إعفاء (ʾiʿfāʾ = exemption), تعليق (taʿlīq = suspension)
    /(إعفاء|تعليق|امتياز جمركي)/g,
    // مراقبة (murāqaba = control), تفتيش (taftīš = inspection)
    /(مراقبة|تفتيش|فحص|معاينة)/g,
    // القيمة الجمركية (al-qīma al-jumrukiyya = customs value)
    /(القيمة الجمركية|قيمة المعاملة)/g,
    // المنشأ التفضيلي (al-manšaʾ al-tafḍīlī = preferential origin)
    /(المنشأ التفضيلي|المنشأ غير التفضيلي|التراكم)/g,
    // حصة (ḥiṣṣa = quota), رخصة استيراد (ruḫṣat istīrād = import license)
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

// Build hierarchy path based on context
function buildHierarchyPath(sectionTitle: string | null, articleNumber: string | null): string | null {
  const parts: string[] = [];
  if (sectionTitle) parts.push(sectionTitle.substring(0, 50));
  if (articleNumber) parts.push(`Art. ${articleNumber}`);
  return parts.length > 0 ? parts.join(" > ") : null;
}

function createChunks(pages: ExtractedPage[]): TextChunk[] {
  const chunks: TextChunk[] = [];
  let chunkIndex = 0;
  let currentSection: string | null = null;
  let parentSection: string | null = null;

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

      // Track section changes
      const sectionMatch = extractSectionTitle(trimmedPara);
      if (sectionMatch) {
        parentSection = currentSection;
        currentSection = sectionMatch;
      }

      // If adding this paragraph exceeds target, save current chunk
      if (currentChunk && (currentChunk.length + trimmedPara.length) > CHUNK_SIZE_TARGET) {
        if (currentChunk.length >= MIN_CHUNK_SIZE) {
          const chunkText = currentChunk.trim();
          const articleNumber = extractArticleNumber(chunkText);
          const sectionTitle = extractSectionTitle(chunkText) || currentSection;
          
          chunks.push({
            chunk_index: chunkIndex++,
            text: chunkText,
            page_number: page.page_number,
            char_start: charStart,
            char_end: charStart + currentChunk.length,
            article_number: articleNumber,
            section_title: sectionTitle,
            parent_section: parentSection,
            chunk_type: detectChunkType(chunkText),
            hierarchy_path: buildHierarchyPath(sectionTitle, articleNumber),
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
      const sectionTitle = extractSectionTitle(chunkText) || currentSection;
      
      chunks.push({
        chunk_index: chunkIndex++,
        text: chunkText,
        page_number: page.page_number,
        char_start: charStart,
        char_end: charStart + currentChunk.length,
        article_number: articleNumber,
        section_title: sectionTitle,
        parent_section: parentSection,
        chunk_type: detectChunkType(chunkText),
        hierarchy_path: buildHierarchyPath(sectionTitle, articleNumber),
        keywords: extractKeywords(chunkText),
        mentioned_hs_codes: extractMentionedHSCodes(chunkText),
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

/**
 * Extract the actual document reference from the text content
 * This handles cases where the file name doesn't match the real reference
 * (e.g., file named "circulaire_24320.pdf" but contains "Circulaire n° 4601/311")
 */
function extractDocumentReference(fullText: string, sourceType: string): { ref: string | null; title: string | null } {
  const textStart = fullText.slice(0, 3000); // Check first ~3000 chars for reference
  
  // Patterns for different document types (French + Arabic)
  const patterns: { type: string; patterns: RegExp[] }[] = [
    {
      type: "circular",
      patterns: [
        // French: "Circulaire n° 4601/311", "Circulaire N°4601-311"
        /[Cc]irculaire\s*[Nn°°.:\s]+(\d{2,5}[\s/-]?\d{0,4})/,
        // Arabic: منشور رقم (manšūr raqm = circular number)
        /(?:منشور|تعميم)\s*(?:رقم|عدد)?\s*[:.]?\s*(\d{2,5}[\s/-]?\d{0,4})/,
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

  let extractedRef: string | null = null;
  let extractedTitle: string | null = null;

  // Try to find reference based on source type first
  const typePatterns = patterns.find(p => p.type === sourceType)?.patterns || [];
  for (const pattern of typePatterns) {
    const match = textStart.match(pattern);
    if (match) {
      extractedRef = match[1].trim();
      break;
    }
  }

  // If not found, try all patterns
  if (!extractedRef) {
    for (const group of patterns) {
      for (const pattern of group.patterns) {
        const match = textStart.match(pattern);
        if (match) {
          extractedRef = match[1].trim();
          break;
        }
      }
      if (extractedRef) break;
    }
  }

  // Extract title: look for "OBJET :" or "موضوع" (mawḍūʿ = subject)
  const titlePatterns = [
    /OBJET\s*:\s*(.{10,150}?)(?:\.|$|\n)/i,
    /Objet\s*:\s*(.{10,150}?)(?:\.|$|\n)/,
    /(?:موضوع|الموضوع)\s*[:.\s]\s*(.{10,150}?)(?:\.|$|\n)/,
  ];

  for (const pattern of titlePatterns) {
    const match = textStart.match(pattern);
    if (match) {
      extractedTitle = match[1].trim();
      break;
    }
  }

  console.log(`[ingest-legal-doc] Extracted reference: "${extractedRef}", title: "${extractedTitle?.slice(0, 50)}..."`);

  return { ref: extractedRef, title: extractedTitle };
}

async function upsertLegalSource(
  supabase: any,
  request: IngestRequest,
  fullText: string
): Promise<number> {
  // Try to extract the actual reference from the document content
  const extracted = extractDocumentReference(fullText, request.source_type);
  
  // Use extracted reference if available, otherwise fall back to provided source_ref
  const actualRef = extracted.ref || request.source_ref;
  const actualTitle = request.title || extracted.title;
  
  if (extracted.ref && extracted.ref !== request.source_ref) {
    console.log(`[ingest-legal-doc] Using extracted reference "${extracted.ref}" instead of provided "${request.source_ref}"`);
  }

  const { data, error } = await supabase
    .from("legal_sources")
    .upsert(
      {
        country_code: request.country_code || "MA",
        source_type: request.source_type,
        source_ref: actualRef,
        title: actualTitle,
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
        
        console.log(`[ingest-legal-doc] Batch mode: extracting pages ${startPage}-${endPage}`);
        
        // Split PDF to just the pages we need
        const chunkBase64 = await splitPdfPages(pdfBase64, startPage, endPage);
        pages = await extractTextFromPDFChunk(chunkBase64, startPage);
        
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

    // 6. Insert chunks (append mode - don't delete existing for batch)
    let chunksCreated = 0;
    if (isBatchMode && body.source_id) {
      // Append chunks without deleting existing ones
      chunksCreated = await insertChunksAppend(
        supabase,
        sourceId,
        chunks,
        body.generate_embeddings !== false
      );
    } else {
      chunksCreated = await insertChunks(
        supabase,
        sourceId,
        chunks,
        body.generate_embeddings !== false
      );
    }

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
