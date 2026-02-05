// ============================================================================
// SOURCE VALIDATION MODULE - DB-ONLY EVIDENCE
// ============================================================================
// Validates that sources cited by AI are actually backed by database evidence
// ============================================================================

import { cleanHSCode } from "./hs-utils.ts";

// =============================================================================
// ARTICLE EXTRACTION (for legal documents like Code des Douanes)
// =============================================================================

/**
 * Extract legal article references from AI response (e.g., "Art. 15 bis", "Article 42-2")
 * This is SEPARATE from HS code extraction to avoid interference
 */
export function extractArticlesFromResponse(responseText: string): string[] {
  const articles: string[] = [];
  
  const articlePatterns = [
    // "Article 15 bis", "article 42-2", "Art. 74-3"
    /\b(?:Article|Art\.?)\s*(\d+(?:\s*(?:bis|ter|quater))?(?:\s*-\s*\d+)?)/gi,
    // "l'article 285", "articles 15 et 16"
    /\bl['']article\s+(\d+(?:\s*(?:bis|ter|quater))?)/gi,
    // Arabic article patterns
    /المادة\s+(\d+)/g,
    /الفصل\s+(\d+)/g,
  ];
  
  for (const pattern of articlePatterns) {
    const matches = responseText.matchAll(pattern);
    for (const match of matches) {
      const articleNum = match[1]?.trim();
      if (articleNum && articleNum.length <= 10) {
        // Normalize: remove extra spaces, keep "bis", "ter" etc.
        const normalized = articleNum.replace(/\s+/g, " ").trim();
        articles.push(normalized);
      }
    }
  }
  
  return [...new Set(articles)];
}

// =============================================================================
// TYPES
// =============================================================================

export interface ValidatedSource {
  id: string;
  type: "tariff" | "note" | "legal" | "evidence" | "pdf";
  title: string;
  reference?: string;
  download_url: string | null;
  chapter?: string;
  evidence_text?: string;
  matched_by: "hs_code" | "keyword" | "chapter" | "direct";
  confidence: "high" | "medium" | "low";
}

export interface ArticleSource {
  id: string;
  type: "legal";
  title: string;
  reference: string;
  download_url: string | null;
  article_number: string;
  evidence_text?: string;
  matched_by: "article";
  confidence: "high" | "medium";
}

export interface SourceValidationResult {
  sources_validated: ValidatedSource[];
  sources_rejected: Array<{ id: string; reason: string }>;
  has_evidence: boolean;
  message?: string;
}

export interface DBEvidence {
  tariffs: any[];
  notes: any[];
  evidence: any[];
  pdfSummaries: any[];
  legalRefs: any[];
  legalChunks: any[];
}

// =============================================================================
// LEGAL ARTICLE VALIDATION (separate from HS code validation)
// =============================================================================

/**
 * Validate legal articles against legal_chunks in DB
 * This runs INDEPENDENTLY of HS code validation
 */
export async function validateArticleSources(
  supabase: any,
  detectedArticles: string[],
  dbEvidence: DBEvidence,
  supabaseUrl: string
): Promise<ValidatedSource[]> {
  const validated: ValidatedSource[] = [];
  
  if (detectedArticles.length === 0) {
    return [];
  }
  
  // Normalize article numbers for matching
  const normalizedArticles = detectedArticles.map(a => 
    a.toLowerCase().replace(/\s+/g, "").replace(/-/g, "")
  );
  
  // Check legal chunks for matching articles
  for (const chunk of dbEvidence.legalChunks || []) {
    const chunkArticle = chunk.article_number;
    if (!chunkArticle) continue;
    
    const normalizedChunkArticle = chunkArticle
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/-/g, "");
    
    // Check for match
    const isMatch = normalizedArticles.some(a => 
      normalizedChunkArticle.includes(a) || a.includes(normalizedChunkArticle)
    );
    
    if (isMatch) {
      // Get source info for download URL
      let downloadUrl: string | null = null;
      let sourceTitle = "";
      let sourceRef = "";
      
      if (chunk.source_id) {
        // Try to get PDF info from legal_sources -> pdf_documents
        const { data: sourceData } = await supabase
          .from('legal_sources')
          .select('id, source_ref, title, source_url')
          .eq('id', chunk.source_id)
          .single();
        
        if (sourceData) {
          sourceRef = sourceData.source_ref || sourceData.title || "";
          sourceTitle = sourceData.title || sourceRef;
          
          // Try to find the PDF document
          const { data: pdfDoc } = await supabase
            .from('pdf_documents')
            .select('id, file_path, title')
            .or(`title.ilike.%${sourceRef}%,document_reference.ilike.%${sourceRef}%`)
            .eq('is_active', true)
            .limit(1)
            .single();
          
          if (pdfDoc?.file_path) {
            downloadUrl = `${supabaseUrl}/storage/v1/object/public/pdf-documents/${pdfDoc.file_path}`;
          } else if (sourceData.source_url) {
            downloadUrl = sourceData.source_url;
          }
        }
      }
      
      // Fallback: search for Code des Douanes PDF directly
      if (!downloadUrl) {
        const { data: cdiiPdf } = await supabase
          .from('pdf_documents')
          .select('id, file_path, title')
          .or(`title.ilike.%Code des Douanes%,title.ilike.%CDII%,file_name.ilike.%CodeDesDouanes%`)
          .eq('is_active', true)
          .limit(1)
          .single();
        
        if (cdiiPdf?.file_path) {
          downloadUrl = `${supabaseUrl}/storage/v1/object/public/pdf-documents/${cdiiPdf.file_path}`;
          sourceTitle = sourceTitle || cdiiPdf.title || "Code des Douanes";
        }
      }
      
      validated.push({
        id: `article:${chunk.source_id || 'unknown'}:${chunkArticle}`,
        type: "legal",
        title: `Article ${chunkArticle}${chunk.section_title ? ` - ${chunk.section_title}` : ""}`,
        reference: sourceRef ? `${sourceRef} - Art. ${chunkArticle}` : `Art. ${chunkArticle}`,
        download_url: downloadUrl,
        evidence_text: chunk.chunk_text?.substring(0, 300),
        matched_by: "direct",
        confidence: "high",
      });
    }
  }
  
  // Deduplicate
  return validated.filter(
    (v, i, arr) => arr.findIndex(x => x.id === v.id) === i
  );
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Extract HS codes mentioned in AI response - PRIORITIZE codes in the ANSWER section
 * This extracts codes that the AI actually recommended, not all codes in context
 */
export function extractCodesFromResponse(responseText: string): string[] {
  const codes: string[] = [];
  
  // Look for patterns that indicate the AI's actual recommendation
  // Supports both 4-digit headings (07.02) and full codes (0702.10.00)
  const recommendedPatterns = [
    // Full codes: **2815.20** or **0702.10.00**
    /\*\*(\d{4}\.\d{2}(?:\.\d{2})?(?:\.\d{2})?)\*\*/g,
    // Short chapter.position format: **07.02** (common in French responses)
    /\*\*(\d{2}\.\d{2})\*\*/g,
    // Code SH: patterns
    /Code\s+(?:SH\s*)?:?\s*\*?\*?(\d{2,4}\.?\d{0,6})/gi,
    // "correspond au code" patterns  
    /correspond(?:re)?.*?(\d{2,4}\.\d{2})/gi,
    // "position tarifaire" patterns
    /position\s+(?:tarifaire\s+)?(\d{2,4}\.\d{2})/gi,
  ];
  
  for (const pattern of recommendedPatterns) {
    const matches = responseText.matchAll(pattern);
    for (const match of matches) {
      const codeRaw = match[1] || match[0];
      const code = codeRaw.replace(/[^0-9]/g, "");
      // Validate it looks like a real HS code (chapters 01-99)
      // Accept codes with 4+ digits (heading level minimum)
      if (code.length >= 4) {
        const chapter = parseInt(code.substring(0, 2));
        if (chapter >= 1 && chapter <= 99) {
          codes.push(code);
        }
      }
    }
  }
  
  // If no strongly recommended codes found, fall back to any codes in text
  if (codes.length === 0) {
    const fallbackPatterns = [
      /\b(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})\b/g,  // 8301.30.00.00
      /\b(\d{4})\.(\d{2})\.(\d{2})\b/g,           // 8301.30.00
      /\b(\d{4})\.(\d{2})\b/g,                     // 8301.30
      /\b(\d{2})\.(\d{2})\b/g,                     // 07.02 (chapter.position)
    ];
    
    for (const pattern of fallbackPatterns) {
      const matches = responseText.matchAll(pattern);
      for (const match of matches) {
        let code = match[0].replace(/\./g, "");
        
        // For short format (XX.XX), expand to XXXX format
        if (code.length === 4 && match[0].match(/^\d{2}\.\d{2}$/)) {
          // This is chapter.position format like "07.02" -> "0702"
          // Validate chapter range
          const chapter = parseInt(code.substring(0, 2));
          if (chapter >= 1 && chapter <= 99) {
            codes.push(code);
          }
        } else if (code.length >= 4) {
          const chapter = parseInt(code.substring(0, 2));
          if (chapter >= 1 && chapter <= 99) {
            codes.push(code);
          }
        }
      }
    }
  }
  
  return [...new Set(codes)];
}

/**
 * Extract product keywords from question for matching
 */
export function extractProductKeywords(question: string): string[] {
  // Remove common question words and keep product-related terms
  const stopWords = new Set([
    "quel", "quelle", "quels", "quelles", "est", "sont", "le", "la", "les", "un", "une", "des",
    "pour", "sur", "dans", "par", "avec", "sans", "que", "qui", "quoi", "comment", "pourquoi",
    "code", "sh", "tarif", "droit", "douane", "importation", "exportation", "taux", "taxe",
    "maroc", "marocain", "marocaine", "import", "export", "importer", "exporter",
  ]);
  
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));
  
  return words;
}

// =============================================================================
// COMBINED VALIDATION (HS codes + Articles)
// =============================================================================

/**
 * Combined validation: HS codes AND legal articles
 * Runs both validations independently and merges results
 */
export async function validateAllSources(
  supabase: any,
  responseText: string,
  question: string,
  dbEvidence: DBEvidence,
  supabaseUrl: string
): Promise<SourceValidationResult> {
  // Extract both HS codes and articles from response
  const detectedCodes = extractCodesFromResponse(responseText);
  const detectedArticles = extractArticlesFromResponse(responseText);
  const keywords = extractProductKeywords(question);
  
  console.log("Source validation - detected articles:", detectedArticles);
  console.log("Source validation - legalChunks count:", dbEvidence.legalChunks?.length || 0);
  
  // Run both validations in parallel
  const [hsResult, articleSources] = await Promise.all([
    validateSourcesForCodes(supabase, detectedCodes, keywords, dbEvidence, supabaseUrl),
    validateArticleSources(supabase, detectedArticles, dbEvidence, supabaseUrl),
  ]);
  
  console.log("Source validation - article sources found:", articleSources.length);
  
  // Merge results, avoiding duplicates
  const allSources = [...hsResult.sources_validated];
  for (const article of articleSources) {
    if (!allSources.some(s => s.id === article.id)) {
      allSources.push(article);
    }
  }
  
  // Sort by confidence
  allSources.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.confidence] - order[b.confidence];
  });
  
  return {
    sources_validated: allSources.slice(0, 10),
    sources_rejected: hsResult.sources_rejected,
    has_evidence: allSources.length > 0,
    message: allSources.length > 0 
      ? undefined 
      : "Aucune source interne ne prouve ce code. Considérez lancer une ingestion de documents.",
  };
}

/**
 * Validates HS code sources against DB evidence (UNCHANGED LOGIC)
 * Returns only sources that have actual DB backing for the detected codes
 */
async function validateSourcesForCodes(
  supabase: any,
  detectedCodes: string[],
  keywords: string[],
  dbEvidence: DBEvidence,
  supabaseUrl: string
): Promise<SourceValidationResult> {
  const validated: ValidatedSource[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];
  
  if (detectedCodes.length === 0 && keywords.length === 0) {
    return {
      sources_validated: [],
      sources_rejected: [],
      has_evidence: false,
      message: "Aucun code SH détecté dans la réponse.",
    };
  }

  // Extract chapters from detected codes
  const detectedChapters = new Set<string>();
  for (const code of detectedCodes) {
    const clean = cleanHSCode(code);
    if (clean.length >= 2) {
      detectedChapters.add(clean.substring(0, 2).padStart(2, "0"));
    }
  }
  
  const keywordsLower = keywords.map(k => k.toLowerCase());

  // 1. Validate tariffs - must match detected codes OR keywords (when no codes detected)
  // IMPORTANT: Tariffs are valid sources even without source_pdf
  for (const tariff of dbEvidence.tariffs) {
    const tariffCode = cleanHSCode(tariff.national_code || tariff.hs_code_6 || "");
    const tariffChapter = tariffCode.substring(0, 2).padStart(2, "0");
    
    // Check if tariff matches any detected code
    let matched = false;
    let matchedBy: "hs_code" | "chapter" | "keyword" = "chapter";
    
    for (const code of detectedCodes) {
      const cleanCode = cleanHSCode(code);
      if (tariffCode.startsWith(cleanCode) || cleanCode.startsWith(tariffCode.substring(0, 6))) {
        matched = true;
        matchedBy = "hs_code";
        break;
      }
    }
    
    // Also accept if chapter matches AND keywords match description
    if (!matched && detectedChapters.has(tariffChapter)) {
      const desc = (tariff.description_local || "").toLowerCase();
      if (keywordsLower.some(kw => desc.includes(kw))) {
        matched = true;
        matchedBy = "keyword";
      }
    }
    
    // FALLBACK: If NO codes were detected at all, match purely by keywords in description
    // This handles cases where AI asks for clarification without citing codes
    if (!matched && detectedCodes.length === 0 && keywordsLower.length > 0) {
      const desc = (tariff.description_local || "").toLowerCase();
      if (keywordsLower.some(kw => kw.length >= 4 && desc.includes(kw))) {
        matched = true;
        matchedBy = "keyword";
        // Also add this chapter to detected chapters for PDF lookup
        detectedChapters.add(tariffChapter);
      }
    }
    
    if (matched) {
      validated.push({
        id: `tariff:${tariff.country_code || "MA"}:${tariff.national_code}`,
        type: "tariff",
        title: tariff.description_local || `Code ${tariff.national_code}`,
        reference: tariff.national_code,
        download_url: tariff.source_pdf 
          ? `${supabaseUrl}/storage/v1/object/public/pdf-documents/${tariff.source_pdf}`
          : null,
        chapter: tariffChapter,
        evidence_text: tariff.source_evidence,
        matched_by: matchedBy,
        confidence: matchedBy === "hs_code" ? "high" : "medium",
      });
    }
  }

  // 1b. NEW: If we have matching tariffs but no PDF link, try to find chapter PDF directly
  if (validated.length > 0 && detectedChapters.size > 0) {
    for (const ch of detectedChapters) {
      const chNum = parseInt(ch, 10);
      
      // Build search patterns - handle various naming conventions
      const searchPatterns = [
        `Chapitre${chNum}`,       // "Chapitre7" (no space)
        `Chapitre ${chNum}`,      // "Chapitre 7"
        `Chapitre${ch}`,          // "Chapitre07"
        `SH CODE ${chNum}`,       // "SH CODE 7"
        `SH CODE ${ch}`,          // "SH CODE 07" 
        `SH_CODE_${chNum}`,
        `SH_CODE_${ch}`,
      ];
      
      let foundPdf = false;
      
      for (const pattern of searchPatterns) {
        if (foundPdf) break;
        
        const { data: chapterPdfs } = await supabase
          .from('pdf_documents')
          .select('id, title, file_path, category')
          .eq('category', 'tarif')
          .eq('is_active', true)
          .or(`title.ilike.%${pattern}%,file_name.ilike.%${pattern}%`)
          .limit(1);
        
        if (chapterPdfs && chapterPdfs.length > 0) {
          const pdf = chapterPdfs[0];
          const downloadUrl = pdf.file_path 
            ? `${supabaseUrl}/storage/v1/object/public/pdf-documents/${pdf.file_path}`
            : null;
          
          // Extract chapter number from title
          const chapterMatch = pdf.title.match(/(\d+)/);
          const pdfChapter = chapterMatch ? chapterMatch[1].padStart(2, "0") : null;
          
          if (pdfChapter && detectedChapters.has(pdfChapter)) {
            foundPdf = true;
            
            // Check if we already have this PDF
            const existingPdf = validated.find(v => v.id === pdf.id || v.id === `pdf:${pdfChapter}`);
            if (!existingPdf) {
              validated.push({
                id: pdf.id,
                type: "pdf",
                title: pdf.title || `Chapitre ${parseInt(pdfChapter)}`,
                reference: `Chapitre ${parseInt(pdfChapter)}`,
                download_url: downloadUrl,
                chapter: pdfChapter,
                matched_by: "chapter",
                confidence: "medium",
              });
            }
            
            // Also update tariff sources that don't have download_url
            for (const source of validated) {
              if (source.type === "tariff" && source.chapter === pdfChapter && !source.download_url) {
                source.download_url = downloadUrl;
              }
            }
          }
        }
      }
    }
  }

  // 2. Validate PDF sources - must contain detected chapter codes
  for (const pdf of dbEvidence.pdfSummaries) {
    const pdfChapter = String(pdf.chapter_number || "").padStart(2, "0");
    const mentionedCodes: string[] = Array.isArray(pdf.mentioned_codes) 
      ? pdf.mentioned_codes 
      : [];
    
    // Check if PDF chapter matches any detected chapter
    let matched = false;
    let matchedBy: "hs_code" | "chapter" | "keyword" = "chapter";
    
    // Direct chapter match
    if (detectedChapters.has(pdfChapter)) {
      matched = true;
      matchedBy = "chapter";
    }
    
    // Check if PDF mentions any of our detected codes
    if (!matched) {
      for (const code of detectedCodes) {
        const cleanCode = cleanHSCode(code);
        if (mentionedCodes.some(m => cleanHSCode(m).startsWith(cleanCode.substring(0, 4)))) {
          matched = true;
          matchedBy = "hs_code";
          break;
        }
      }
    }
    
    // Check keywords in PDF content/summary
    if (!matched) {
      const pdfText = ((pdf.summary || "") + " " + (pdf.full_text || "")).toLowerCase();
      if (keywordsLower.some(kw => pdfText.includes(kw))) {
        // Only accept if also has chapter match
        if (detectedChapters.has(pdfChapter)) {
          matched = true;
          matchedBy = "keyword";
        }
      }
    }
    
    if (matched) {
      validated.push({
        id: pdf.pdf_id || pdf.id || `pdf:${pdfChapter}`,
        type: "pdf",
        title: pdf.title || `Chapitre ${parseInt(pdfChapter)}`,
        reference: `Chapitre ${parseInt(pdfChapter)}`,
        download_url: pdf.download_url || null,
        chapter: pdfChapter,
        matched_by: matchedBy,
        confidence: matchedBy === "hs_code" ? "high" : matchedBy === "chapter" ? "medium" : "low",
      });
    } else if (pdf.title) {
      rejected.push({
        id: pdf.pdf_id || pdf.id || pdf.title,
        reason: `Chapitre ${pdfChapter} ne correspond pas aux codes détectés (${Array.from(detectedChapters).join(", ")})`,
      });
    }
  }

  // 3. Validate legal references - must be related to detected codes/chapters
  for (const ref of dbEvidence.legalRefs) {
    const context = (ref.context || "").toLowerCase();
    const title = (ref.title || "").toLowerCase();
    
    let matched = false;
    let matchedBy: "hs_code" | "keyword" | "direct" = "keyword";
    
    // Check if reference mentions any detected code
    for (const code of detectedCodes) {
      const cleanCode = cleanHSCode(code);
      if (context.includes(cleanCode) || context.includes(cleanCode.substring(0, 4))) {
        matched = true;
        matchedBy = "hs_code";
        break;
      }
    }
    
    // Check keywords
    if (!matched && keywordsLower.some(kw => context.includes(kw) || title.includes(kw))) {
      matched = true;
      matchedBy = "keyword";
    }
    
    if (matched && ref.reference_number) {
      validated.push({
        id: ref.id,
        type: "legal",
        title: ref.title || `${ref.reference_type} ${ref.reference_number}`,
        reference: ref.reference_number,
        download_url: ref.download_url || null,
        matched_by: matchedBy,
        confidence: matchedBy === "hs_code" ? "high" : "medium",
      });
    }
  }

  // 4. Validate HS evidence
  for (const ev of dbEvidence.evidence) {
    const evCode = cleanHSCode(ev.national_code || "");
    
    let matched = false;
    for (const code of detectedCodes) {
      const cleanCode = cleanHSCode(code);
      if (evCode.startsWith(cleanCode.substring(0, 6)) || cleanCode.startsWith(evCode.substring(0, 6))) {
        matched = true;
        break;
      }
    }
    
    if (matched) {
      validated.push({
        id: `evidence:${ev.id}`,
        type: "evidence",
        title: `Preuve pour ${ev.national_code}`,
        reference: ev.national_code,
        download_url: null,
        evidence_text: ev.evidence_text,
        matched_by: "hs_code",
        confidence: ev.confidence === "auto_detected_10" ? "high" : "medium",
      });
    }
  }

  // 5. Validate legal chunks (articles extracted from documents)
  if (dbEvidence.legalChunks && dbEvidence.legalChunks.length > 0) {
    for (const chunk of dbEvidence.legalChunks) {
      const articleNum = chunk.article_number;
      const sectionTitle = chunk.section_title || "";
      const sourceRef = chunk.source_ref || chunk.source_title || "";
      
      // Match by keywords or article reference
      let matched = false;
      let matchedBy: "keyword" | "direct" = "keyword";
      
      // Check if chunk text mentions any keywords
      const chunkText = (chunk.chunk_text || "").toLowerCase();
      if (keywordsLower.some(kw => kw.length >= 4 && chunkText.includes(kw))) {
        matched = true;
        matchedBy = "keyword";
      }
      
      // Also match if high similarity score from semantic search
      if (!matched && chunk.similarity && chunk.similarity >= 0.65) {
        matched = true;
        matchedBy = "direct";
      }
      
      if (matched && articleNum) {
        // Build download URL if we have a source
        let downloadUrl: string | null = null;
        if (chunk.source_pdf_path) {
          downloadUrl = `${supabaseUrl}/storage/v1/object/public/pdf-documents/${chunk.source_pdf_path}`;
        } else if (chunk.source_url) {
          downloadUrl = chunk.source_url;
        }
        
        validated.push({
          id: `article:${chunk.id || chunk.source_id}:${articleNum}`,
          type: "legal",
          title: `Article ${articleNum}${sectionTitle ? ` - ${sectionTitle}` : ""}`,
          reference: `${sourceRef} - Art. ${articleNum}`,
          download_url: downloadUrl,
          evidence_text: chunk.chunk_text?.substring(0, 300),
          matched_by: matchedBy,
          confidence: matchedBy === "direct" ? "high" : "medium",
        });
      }
    }
  }

  // Deduplicate by ID
  const uniqueValidated = validated.filter(
    (v, i, arr) => arr.findIndex(x => x.id === v.id) === i
  );

  // Sort by confidence
  uniqueValidated.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.confidence] - order[b.confidence];
  });

  const hasEvidence = uniqueValidated.length > 0;
  
  return {
    sources_validated: uniqueValidated.slice(0, 10),
    sources_rejected: rejected,
    has_evidence: hasEvidence,
    message: hasEvidence 
      ? undefined 
      : "Aucune source interne ne prouve ce code. Considérez lancer une ingestion de documents.",
  };
}

/**
 * Filters cited circulars to only those with DB evidence for the codes
 */
export function filterCitedCirculars(
  citedCirculars: any[],
  validatedSources: ValidatedSource[],
  detectedCodes: string[]
): any[] {
  if (detectedCodes.length === 0) {
    return [];
  }

  // Get chapters from detected codes
  const validChapters = new Set<string>();
  for (const code of detectedCodes) {
    const clean = cleanHSCode(code);
    if (clean.length >= 2) {
      validChapters.add(clean.substring(0, 2).padStart(2, "0"));
    }
  }

  // Get validated source IDs and chapters
  const validatedIds = new Set(validatedSources.map(s => s.id));
  const validatedChapters = new Set(validatedSources.map(s => s.chapter).filter(Boolean));

  return citedCirculars.filter(circ => {
    // Direct ID match
    if (validatedIds.has(circ.id)) {
      return true;
    }

    // For tariffs, check chapter
    if (circ.reference_type === "Tarif") {
      const chapterMatch = circ.reference_number?.match(/Chapitre\s*(\d+)/i);
      if (chapterMatch) {
        const chapter = chapterMatch[1].padStart(2, "0");
        return validChapters.has(chapter) || validatedChapters.has(chapter);
      }
    }

    // For legal refs, must have been validated
    return validatedIds.has(`legal:${circ.id}`) || validatedIds.has(circ.id);
  });
}
