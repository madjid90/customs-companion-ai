// ============================================================================
// SCORING ET EXTRACTION DE PASSAGES PERTINENTS
// ============================================================================

export interface ScoredPassage {
  text: string;
  score: number;
  matchedCodes: string[];
  matchedKeywords: string[];
}

/**
 * Découpe un texte en paragraphes exploitables
 */
export function splitIntoParagraphs(text: string): string[] {
  if (!text) return [];
  
  // Split by double newlines, bullet points, or numbered lists
  const rawParagraphs = text
    .split(/\n{2,}|(?=^\s*[-•●]\s)|(?=^\s*\d+[\.\)]\s)/m)
    .map(p => p.trim())
    .filter(p => p.length > 30); // Ignore very short fragments
  
  // Merge very short consecutive paragraphs
  const merged: string[] = [];
  let buffer = "";
  
  for (const para of rawParagraphs) {
    if (buffer.length + para.length < 300) {
      buffer += (buffer ? "\n" : "") + para;
    } else {
      if (buffer) merged.push(buffer);
      buffer = para;
    }
  }
  if (buffer) merged.push(buffer);
  
  return merged;
}

/**
 * Score un passage selon sa pertinence aux codes SH et mots-clés
 */
export function scorePassage(
  passage: string,
  targetCodes: string[],
  keywords: string[]
): ScoredPassage {
  const passageLower = passage.toLowerCase();
  const passageClean = passage.replace(/[\s\.\-]/g, "");
  
  let score = 0;
  const matchedCodes: string[] = [];
  const matchedKeywords: string[] = [];
  
  // Score HS codes (high weight)
  for (const code of targetCodes) {
    const codeClean = code.replace(/[\s\.\-]/g, "");
    const codePrefix = codeClean.slice(0, 4);
    
    // Exact code match = +10
    if (passageClean.includes(codeClean)) {
      score += 10;
      matchedCodes.push(code);
    }
    // Prefix match (4 digits) = +5
    else if (passageClean.includes(codePrefix)) {
      score += 5;
      matchedCodes.push(code + " (prefix)");
    }
    // Chapter match (2 digits) = +2
    else if (passageClean.includes(codeClean.slice(0, 2))) {
      score += 2;
    }
  }
  
  // Score keywords (medium weight)
  for (const keyword of keywords) {
    const kwLower = keyword.toLowerCase();
    if (passageLower.includes(kwLower)) {
      score += 3;
      matchedKeywords.push(keyword);
      
      // Bonus for keyword appearing multiple times
      const matches = passageLower.split(kwLower).length - 1;
      if (matches > 1) score += Math.min(matches - 1, 3);
    }
  }
  
  // Bonus for regulatory terms
  const regulatoryTerms = [
    "droit", "taux", "taxe", "tva", "importation", "exportation",
    "licence", "certificat", "contrôle", "prohibition", "restriction",
    "note", "position", "sous-position", "chapitre", "section"
  ];
  
  for (const term of regulatoryTerms) {
    if (passageLower.includes(term)) {
      score += 1;
    }
  }
  
  // Penalty for very long passages (prefer concise)
  if (passage.length > 800) {
    score -= Math.floor((passage.length - 800) / 200);
  }
  
  return {
    text: passage,
    score: Math.max(0, score),
    matchedCodes,
    matchedKeywords
  };
}

/**
 * Extrait les N passages les plus pertinents d'un texte
 */
export function extractTopPassages(
  fullText: string,
  targetCodes: string[],
  keywords: string[],
  maxPassages: number = 5,
  maxTotalChars: number = 2000
): ScoredPassage[] {
  if (!fullText) return [];
  
  // Split into paragraphs
  const paragraphs = splitIntoParagraphs(fullText);
  
  // Score each paragraph
  const scored = paragraphs
    .map(p => scorePassage(p, targetCodes, keywords))
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score);
  
  // Select top passages within char limit
  const selected: ScoredPassage[] = [];
  let totalChars = 0;
  
  for (const passage of scored) {
    if (selected.length >= maxPassages) break;
    if (totalChars + passage.text.length > maxTotalChars) {
      // Try to fit a truncated version if it's very relevant
      if (passage.score >= 8 && totalChars < maxTotalChars - 200) {
        const remaining = maxTotalChars - totalChars - 50;
        selected.push({
          ...passage,
          text: passage.text.substring(0, remaining) + "..."
        });
        break;
      }
      continue;
    }
    
    selected.push(passage);
    totalChars += passage.text.length;
  }
  
  return selected;
}

/**
 * Formate les passages scorés pour le prompt
 */
export function formatPassagesForPrompt(
  passages: ScoredPassage[],
  documentTitle: string
): string {
  if (passages.length === 0) return "";
  
  let output = `**EXTRAITS PERTINENTS de "${documentTitle}":**\n`;
  
  passages.forEach((p, idx) => {
    output += `\n[Extrait ${idx + 1}] (score: ${p.score})`;
    if (p.matchedCodes.length > 0) {
      output += ` [codes: ${p.matchedCodes.slice(0, 3).join(", ")}]`;
    }
    output += `\n> ${p.text}\n`;
  });
  
  return output;
}

// ============================================================================
// EXTENDED SCORING - Score ALL result types (HS codes, legal chunks, knowledge)
// ============================================================================

export interface UnifiedScoredResult {
  text: string;
  score: number;
  type: 'hs_code' | 'legal_chunk' | 'knowledge_doc' | 'tariff_note' | 'pdf_extraction' | 'controlled_product';
  matchedCodes: string[];
  matchedKeywords: string[];
  metadata?: any;
}

/**
 * Score a unified result (any type) against question context.
 * Extends the passage scorer to ALL result types, not just PDFs.
 */
export function scoreUnifiedResult(
  text: string,
  type: UnifiedScoredResult['type'],
  targetCodes: string[],
  keywords: string[],
  metadata?: any
): UnifiedScoredResult {
  // Use base passage scoring
  const baseScore = scorePassage(text, targetCodes, keywords);
  let score = baseScore.score;
  
  // Type-specific bonuses
  switch (type) {
    case 'legal_chunk':
      // Bonus for article references
      if (/\bart(?:icle)?\.?\s*\d+/i.test(text) || /(?:المادة|الفصل)\s*\d+/.test(text)) {
        score += 3;
      }
      // Bonus for circulaire references
      if (/circulaire|دورية|منشور/i.test(text)) {
        score += 2;
      }
      // Bonus for section_title or hierarchy_path in metadata
      if (metadata?.hierarchy_path) score += 1;
      if (metadata?.article_number) score += 2;
      break;
      
    case 'hs_code':
      // Bonus for exact chapter match
      if (metadata?.chapter_number && targetCodes.some(c => c.startsWith(String(metadata.chapter_number).padStart(2, '0')))) {
        score += 5;
      }
      // Bonus for having legal notes
      if (metadata?.legal_notes) score += 2;
      break;
      
    case 'tariff_note':
      // Bonus for definitions and chapter notes
      if (metadata?.note_type === 'definition') score += 3;
      if (metadata?.note_type === 'chapter_note') score += 2;
      if (metadata?.note_type === 'exclusion') score += 2;
      break;
      
    case 'knowledge_doc':
      // Bonus for category relevance
      if (metadata?.category) score += 1;
      if (metadata?.reference) score += 1;
      break;
      
    case 'controlled_product':
      // Bonus for control type specificity
      if (metadata?.control_type === 'prohibition') score += 3;
      if (metadata?.control_type === 'restriction') score += 2;
      if (metadata?.control_authority) score += 1;
      break;
  }
  
  return {
    text,
    score: Math.max(0, score),
    type,
    matchedCodes: baseScore.matchedCodes,
    matchedKeywords: baseScore.matchedKeywords,
    metadata,
  };
}

/**
 * Score and rank ALL retrieved results from different sources.
 * Returns top N results sorted by relevance.
 */
export function scoreAndRankAllResults(
  results: Array<{ text: string; type: UnifiedScoredResult['type']; metadata?: any }>,
  targetCodes: string[],
  keywords: string[],
  maxResults: number = 15,
  maxTotalChars: number = 4000
): UnifiedScoredResult[] {
  if (!results || results.length === 0) return [];
  
  // Score all results
  const scored = results
    .map(r => scoreUnifiedResult(r.text, r.type, targetCodes, keywords, r.metadata))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
  
  // Select top results within char limit
  const selected: UnifiedScoredResult[] = [];
  let totalChars = 0;
  
  for (const result of scored) {
    if (selected.length >= maxResults) break;
    if (totalChars + result.text.length > maxTotalChars) {
      if (result.score >= 8 && totalChars < maxTotalChars - 200) {
        const remaining = maxTotalChars - totalChars - 50;
        selected.push({
          ...result,
          text: result.text.substring(0, remaining) + "...",
        });
        break;
      }
      continue;
    }
    selected.push(result);
    totalChars += result.text.length;
  }
  
  return selected;
}
