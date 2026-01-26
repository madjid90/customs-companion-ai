import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============= CONFIGURATION =============
const CONFIG = {
  // Parallelism
  MAX_CONCURRENT_SCRAPES: 5,        // Parallel scrapes per site
  MAX_CONCURRENT_SITES: 3,          // Parallel sites processing
  
  // Rate limiting & retries
  FIRECRAWL_RATE_LIMIT_MS: 200,     // Min delay between Firecrawl calls
  CLAUDE_RATE_LIMIT_MS: 500,        // Min delay between Claude calls
  MAX_RETRIES: 3,                   // Retry attempts for failed requests
  RETRY_BASE_DELAY_MS: 2000,        // Base delay for exponential backoff
  
  // Limits
  MAX_URLS_PER_SITE: 300,           // Max URLs to scrape per site
  MAX_CONTENT_LENGTH: 15000,        // Max content length for AI analysis
  SCRAPE_TIMEOUT_MS: 30000,         // Timeout per scrape request
  
  // Detection patterns
  DOWNLOAD_PATTERNS: [
    /\.pdf$/i, /\.xlsx?$/i, /\.docx?$/i, /\.csv$/i, /\.zip$/i, /\.rar$/i,
    /download/i, /telecharger/i, /telechargement/i,
    /attachment/i, /fichier/i, /file/i
  ],
  CONTENT_PATTERNS: [
    /circulaire/i, /note/i, /decision/i, /arrete/i, /decret/i, /loi/i,
    /tarif/i, /douane/i, /reglementation/i, /regulation/i,
    /actualite/i, /news/i, /communique/i, /bulletin/i,
    /document/i, /publication/i, /revision/i, /modification/i,
    /import/i, /export/i, /customs/i, /hts/i, /harmonized/i,
    /legislation/i, /law/i, /code/i, /annonce/i, /announcement/i,
    /accord/i, /convention/i, /traite/i, /protocole/i  // Trade agreements
  ],
  ARCHIVE_PATTERNS: [
    /archive/i, /release/i, /version/i, /revision/i, /historique/i,
    /past/i, /previous/i, /ancien/i
  ],
  // Circulaire reference patterns (to extract from page content)
  CIRCULAIRE_PATTERNS: [
    /Circulaire\s+n[°o]?\s*(\d+\/\d+)\s+du\s+(\d{2}\/\d{2}\/\d{4})/gi,
    /Note\s+n[°o]?\s*(\d+\/\d+)\s+du\s+(\d{2}\/\d{2}\/\d{4})/gi,
    /Décision\s+n[°o]?\s*(\d+\/\d+)/gi,
  ],
  // URL exclusion patterns (avoid scraping these)
  EXCLUDE_PATTERNS: [
    /\.(jpg|jpeg|png|gif|svg|ico|webp|mp4|mp3|wav|avi)$/i,
    /\.(css|js|woff|woff2|ttf|eot)$/i,
    // NOTE: No longer excluding all #fragments - we now extract JSF URLs from them
    /mailto:/i, /tel:/i, /javascript:/i,
    /login|signin|signup|register|password|logout/i,
    // Block social media entirely - they require authentication and block bots
    /facebook\.com|twitter\.com|linkedin\.com|youtube\.com|instagram\.com|x\.com/i,
    // Block common non-content pages
    /\/(share|like|follow|subscribe|comment)\/?$/i,
  ],
  // JSF and dynamic page patterns to extract from fragments
  JSF_PATTERNS: [
    /\.jsf/i, /\.xhtml/i, /\.faces/i,
    /accords/i, /conventions/i, /recherche/i, /circulaires/i
  ]
};

interface VeilleSite {
  id: string;
  name: string;
  url: string;
  scrape_type: string;
  scrape_selector: string | null;
  categories: string[] | null;
  country_code: string | null;
}

interface VeilleKeyword {
  id: string;
  keyword: string;
  category: string | null;
  country_code: string | null;
  total_searches?: number;
  total_results?: number;
}

interface ScrapedDocument {
  title: string;
  summary?: string;
  date?: string;
  category?: string;
  importance?: string;
  hs_codes?: string[];
  tariff_changes?: any[];
  content?: string;
  url?: string;
  confidence?: number;
  source_type?: 'document' | 'page_content' | 'table' | 'article' | 'announcement';
}

// ============= UTILITY FUNCTIONS =============

// Rate limiter for API calls
class RateLimiter {
  private lastCall: number = 0;
  private minInterval: number;
  
  constructor(minIntervalMs: number) {
    this.minInterval = minIntervalMs;
  }
  
  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCall;
    if (elapsed < this.minInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minInterval - elapsed));
    }
    this.lastCall = Date.now();
  }
}

const firecrawlLimiter = new RateLimiter(CONFIG.FIRECRAWL_RATE_LIMIT_MS);
const claudeLimiter = new RateLimiter(CONFIG.CLAUDE_RATE_LIMIT_MS);

// Retry with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = CONFIG.MAX_RETRIES,
  context: string = "operation"
): Promise<T | null> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRateLimit = error instanceof Error && 
        (error.message.includes("429") || error.message.includes("rate limit"));
      
      if (attempt === maxRetries) {
        console.error(`${context} failed after ${maxRetries + 1} attempts:`, error);
        return null;
      }
      
      const delay = CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, attempt) * (isRateLimit ? 2 : 1);
      console.log(`${context} attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
}

// Calculate similarity between two strings (Jaccard + Levenshtein hybrid)
function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  
  const normalize = (s: string) => s.toLowerCase().trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
  
  const s1 = normalize(str1);
  const s2 = normalize(str2);
  
  // Exact match
  if (s1 === s2) return 1;
  
  // Jaccard similarity on words
  const words1 = new Set(s1.split(' ').filter(w => w.length > 2));
  const words2 = new Set(s2.split(' ').filter(w => w.length > 2));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  const jaccard = intersection.size / union.size;
  
  // Containment check (one title contains the other)
  const containment = s1.includes(s2) || s2.includes(s1) ? 0.3 : 0;
  
  return Math.min(1, jaccard + containment);
}

// Normalize URL for deduplication
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove trailing slashes, lowercase, remove common tracking params
    let normalized = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`.toLowerCase();
    normalized = normalized.replace(/\/+$/, '');
    return normalized;
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

// Check if URL should be excluded
function shouldExcludeUrl(url: string): boolean {
  // Never exclude JSF URLs - they often contain important content
  if (CONFIG.JSF_PATTERNS.some(pattern => pattern.test(url))) {
    return false;
  }
  // Exclude simple anchor fragments (like #section) but not URL fragments (like #https://...)
  if (url.includes('#') && !url.includes('#http') && !url.includes('#/')) {
    const fragment = url.split('#')[1];
    // If fragment looks like a simple anchor, exclude
    if (fragment && !fragment.includes('/') && !fragment.includes('.')) {
      return true;
    }
  }
  return CONFIG.EXCLUDE_PATTERNS.some(pattern => pattern.test(url));
}

// Extract JSF/embedded URLs from fragments
function extractJsfUrls(url: string): string[] {
  const extracted: string[] = [];
  
  // Handle fragment URLs like "page#https://domain.com/path.jsf"
  if (url.includes('#http')) {
    const fragment = url.split('#')[1];
    if (fragment && fragment.startsWith('http')) {
      extracted.push(fragment);
    }
  }
  
  // Handle double-slash patterns like "accords//acceuilAccords.jsf"
  const doubleSlashMatch = url.match(/\/\/([^\/]+\.jsf)/i);
  if (doubleSlashMatch) {
    try {
      const baseUrl = new URL(url);
      const jsfPath = doubleSlashMatch[1];
      extracted.push(`${baseUrl.protocol}//${baseUrl.hostname}/${jsfPath}`);
      // Also try with /accords/ prefix
      extracted.push(`${baseUrl.protocol}//${baseUrl.hostname}/accords/${jsfPath}`);
    } catch {}
  }
  
  // Extract JSF patterns from the URL
  const jsfMatch = url.match(/\/([^\/]+\.jsf[^#]*)/i);
  if (jsfMatch) {
    try {
      const baseUrl = new URL(url);
      extracted.push(`${baseUrl.protocol}//${baseUrl.hostname}${jsfMatch[0]}`);
    } catch {}
  }
  
  return extracted.filter(u => u && u.startsWith('http'));
}

// Classify URL type
function classifyUrl(url: string): 'download' | 'archive' | 'content' | 'other' {
  // JSF pages are high-priority content
  if (CONFIG.JSF_PATTERNS.some(p => p.test(url))) return 'content';
  if (CONFIG.DOWNLOAD_PATTERNS.some(p => p.test(url))) return 'download';
  if (CONFIG.ARCHIVE_PATTERNS.some(p => p.test(url))) return 'archive';
  if (CONFIG.CONTENT_PATTERNS.some(p => p.test(url))) return 'content';
  return 'other';
}

// Extract circulaire references from content (for creating individual document entries)
function extractCirculaireReferences(content: string, baseUrl: string): ScrapedDocument[] {
  const documents: ScrapedDocument[] = [];
  
  // Pattern for "Circulaire n° XXXX/XXX du DD/MM/YYYY"
  const circulaireRegex = /Circulaire\s+n[°o]?\s*(\d+\/\d+)\s+du\s+(\d{2}\/\d{2}\/\d{4})/gi;
  let match;
  
  while ((match = circulaireRegex.exec(content)) !== null) {
    const reference = match[1];
    const dateStr = match[2];
    
    // Parse date DD/MM/YYYY to YYYY-MM-DD
    const dateParts = dateStr.split('/');
    const isoDate = dateParts.length === 3 
      ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}` 
      : null;
    
    documents.push({
      title: `Circulaire n° ${reference} du ${dateStr}`,
      summary: `Circulaire douanière marocaine référence ${reference}`,
      date: isoDate || undefined,
      category: 'circulaire',
      importance: 'moyenne',
      hs_codes: [],
      tariff_changes: [],
      content: `Référence: Circulaire n° ${reference}\nDate: ${dateStr}\nSource: ${baseUrl}`,
      url: baseUrl,
      confidence: 0.75,
      source_type: 'document'
    });
  }
  
  // Pattern for "Note n° XXXX/XXX du DD/MM/YYYY"
  const noteRegex = /Note\s+n[°o]?\s*(\d+\/\d+)\s+du\s+(\d{2}\/\d{2}\/\d{4})/gi;
  
  while ((match = noteRegex.exec(content)) !== null) {
    const reference = match[1];
    const dateStr = match[2];
    
    const dateParts = dateStr.split('/');
    const isoDate = dateParts.length === 3 
      ? `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}` 
      : null;
    
    documents.push({
      title: `Note n° ${reference} du ${dateStr}`,
      summary: `Note douanière marocaine référence ${reference}`,
      date: isoDate || undefined,
      category: 'note',
      importance: 'moyenne',
      hs_codes: [],
      tariff_changes: [],
      content: `Référence: Note n° ${reference}\nDate: ${dateStr}\nSource: ${baseUrl}`,
      url: baseUrl,
      confidence: 0.75,
      source_type: 'document'
    });
  }
  
  return documents;
}

// Extract trade agreement info from content
function extractAccordInfo(content: string, baseUrl: string): ScrapedDocument[] {
  const documents: ScrapedDocument[] = [];
  
  // Pattern for agreements with countries
  const accordRegex = /(Convention|Accord|Traité)\s+(commerciale?|de libre[- ]échange|tarifaire)?\s*(Maroc[o-])?(\w+)\s*/gi;
  let match;
  
  // Keep track of found agreements to avoid duplicates
  const found = new Set<string>();
  
  while ((match = accordRegex.exec(content)) !== null) {
    const type = match[1];
    const qualifier = match[2] || '';
    const country = match[4];
    
    if (country && country.length > 2 && !found.has(country.toLowerCase())) {
      found.add(country.toLowerCase());
      
      documents.push({
        title: `${type} ${qualifier} Maroc-${country}`.trim(),
        summary: `Accord commercial entre le Maroc et ${country}`,
        date: undefined,
        category: 'regulation',
        importance: 'haute',
        hs_codes: [],
        tariff_changes: [],
        content: `${type} ${qualifier} avec ${country}\nSource: ${baseUrl}`,
        url: baseUrl,
        confidence: 0.7,
        source_type: 'page_content'
      });
    }
  }
  
  return documents;
}

// Process URLs in parallel batches
async function processBatch<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  batchSize: number
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((item, idx) => processor(item, i + idx))
    );
    results.push(...batchResults);
  }
  return results;
}

// ============= FIRECRAWL API =============

async function firecrawlMap(apiKey: string, url: string, limit: number = 500): Promise<string[]> {
  await firecrawlLimiter.wait();
  
  const result = await withRetry(async () => {
    const response = await fetch("https://api.firecrawl.dev/v1/map", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        limit,
        includeSubdomains: false,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Map failed: ${response.status}`);
    }
    
    return response.json();
  }, CONFIG.MAX_RETRIES, `Map ${url}`);
  
  return result?.links || result?.data?.links || [];
}

async function firecrawlScrape(
  apiKey: string, 
  url: string, 
  options: { formats?: string[], onlyMainContent?: boolean, waitFor?: number, actions?: any[] } = {}
): Promise<{ markdown?: string, links?: string[], metadata?: any, html?: string } | null> {
  await firecrawlLimiter.wait();
  
  return withRetry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.SCRAPE_TIMEOUT_MS);
    
    try {
      const body: any = {
        url,
        formats: options.formats || ["markdown", "links"],
        onlyMainContent: options.onlyMainContent ?? true,
      };
      
      // Add waitFor for dynamic pages
      if (options.waitFor) {
        body.waitFor = options.waitFor;
      }
      
      // Add actions for form submission (click, type, etc.)
      if (options.actions && options.actions.length > 0) {
        body.actions = options.actions;
      }
      
      const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      
      if (!response.ok) {
        throw new Error(`Scrape failed: ${response.status}`);
      }
      
      const data = await response.json();
      return data.data || data;
    } finally {
      clearTimeout(timeout);
    }
  }, CONFIG.MAX_RETRIES, `Scrape ${url}`);
}

async function firecrawlSearch(
  apiKey: string,
  query: string,
  limit: number = 10
): Promise<any[]> {
  await firecrawlLimiter.wait();
  
  const result = await withRetry(async () => {
    const response = await fetch("https://api.firecrawl.dev/v1/search", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        limit,
        scrapeOptions: { formats: ["markdown"] },
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Search failed: ${response.status}`);
    }
    
    return response.json();
  }, CONFIG.MAX_RETRIES, `Search "${query}"`);
  
  return result?.data || [];
}

// ============= CLAUDE AI ANALYSIS =============

// Check if content looks like binary data (PDF, images, etc.)
function isBinaryContent(content: string): boolean {
  if (!content || content.length < 10) return false;
  
  // Check for PDF header
  if (content.startsWith('%PDF')) return true;
  
  // Check for high ratio of non-printable characters
  const nonPrintable = content.substring(0, 500).split('').filter(c => {
    const code = c.charCodeAt(0);
    return code < 32 && code !== 9 && code !== 10 && code !== 13;
  }).length;
  
  if (nonPrintable > 50) return true;
  
  // Check for common binary signatures
  const binaryPatterns = [
    /^\x00\x00\x00/, // Null bytes
    /^PK\x03\x04/, // ZIP/DOCX
    /^\x1f\x8b/, // GZIP
    /^Rar!/, // RAR
    /^\x89PNG/, // PNG
    /^\xff\xd8\xff/, // JPEG
  ];
  
  return binaryPatterns.some(p => p.test(content));
}

// Clean content for AI analysis
function cleanContentForAI(content: string): string {
  if (!content) return '';
  
  // Remove null bytes and other control characters
  let cleaned = content.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');
  
  // Collapse multiple whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Truncate to safe length
  return cleaned.substring(0, CONFIG.MAX_CONTENT_LENGTH);
}

async function analyzeWithClaude(
  apiKey: string, 
  prompt: string, 
  maxTokens: number = 4096
): Promise<any | null> {
  await claudeLimiter.wait();
  
  return withRetry(async () => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (response.status === 429) {
      throw new Error("429 rate limit");
    }
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`Claude API error ${response.status}: ${errorText.substring(0, 200)}`);
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "{}";
    
    return parseClaudeResponse(text);
  }, CONFIG.MAX_RETRIES, "Claude analysis");
}

function parseClaudeResponse(text: string): any {
  let jsonStr = text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');
  
  // Extract JSON object
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }
  
  try {
    return JSON.parse(jsonStr);
  } catch {
    // Auto-repair truncated JSON
    let fixed = jsonStr;
    const openBraces = (fixed.match(/\{/g) || []).length;
    const closeBraces = (fixed.match(/\}/g) || []).length;
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/\]/g) || []).length;
    
    for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += ']';
    for (let i = 0; i < openBraces - closeBraces; i++) fixed += '}';
    
    try {
      return JSON.parse(fixed);
    } catch {
      console.error("Could not parse Claude response");
      return { documents: [] };
    }
  }
}

function buildAnalysisPrompt(content: string, site: VeilleSite, pageUrl: string, urlType: string): string {
  const isDownload = urlType === 'download' || /\.(pdf|xlsx?|docx?|csv|zip)$/i.test(pageUrl);
  const isArchive = urlType === 'archive';
  const contentLength = content.length;
  
  // Prompt pour liens de téléchargement avec peu de contenu
  if (isDownload && contentLength < 200) {
    const fileName = pageUrl.split('/').pop() || 'Document';
    return `Ce lien pointe vers un fichier téléchargeable: ${pageUrl}
Nom: ${fileName}
Site: ${site.name}

Crée une entrée basée sur ce lien. JSON uniquement:
{"documents":[{"title":"Titre descriptif","summary":"Description probable","date":null,"category":"tarif|regulation|publication|other","importance":"haute|moyenne|basse","hs_codes":[],"tariff_changes":[],"content":"Téléchargement: ${pageUrl}","url":"${pageUrl}","confidence":0.7,"source_type":"document"}]}`;
  }
  
  // Prompt pour pages d'archives
  if (isArchive) {
    return `Page d'archives du site ${site.name}.
URL: ${pageUrl}

Contenu:
${content.substring(0, CONFIG.MAX_CONTENT_LENGTH)}

Extrait TOUS les documents/fichiers ET le contenu textuel pertinent (articles, réglementations, annonces). JSON:
{"documents":[{"title":"Nom","summary":"Description","date":"YYYY-MM-DD ou null","category":"tarif|regulation|publication|archive|article|annonce|other","importance":"haute|moyenne|basse","hs_codes":[],"tariff_changes":[],"content":"Contenu extrait ou description","url":"URL si dispo","confidence":0.8,"source_type":"document|page_content"}]}`;
  }
  
  // Prompt enrichi pour tout type de contenu web
  return `Tu es un expert en réglementation douanière. Analyse ce contenu web du site officiel "${site.name}".
URL: ${pageUrl}
Longueur: ${contentLength} caractères

Contenu:
${content.substring(0, CONFIG.MAX_CONTENT_LENGTH)}

=== INSTRUCTIONS ===
Tu dois extraire DEUX types d'informations:

1. **DOCUMENTS TÉLÉCHARGEABLES**: PDF, circulaires, notes officielles référencées sur la page
2. **CONTENU TEXTUEL DE LA PAGE**: Articles, actualités, réglementations, annonces, informations importantes qui sont DIRECTEMENT sur la page (pas dans un document externe)

Pour le contenu textuel, extrait:
- Les articles de presse/actualités douanières
- Les annonces officielles (changements de taux, nouvelles procédures)
- Les textes de loi/réglementation affichés in-page
- Les tableaux de tarifs/droits de douane
- Les guides/instructions affichés directement
- Les FAQ importantes

=== FORMAT JSON ===
{"documents":[{
  "title": "Titre clair et descriptif",
  "summary": "Résumé 2-3 phrases du contenu",
  "date": "YYYY-MM-DD ou null",
  "category": "circulaire|note|tarif|regulation|article|annonce|guide|faq|tableau|other",
  "importance": "haute|moyenne|basse",
  "hs_codes": ["codes SH mentionnés"],
  "tariff_changes": [{"hs_code":"","description":"","old_rate":"","new_rate":""}],
  "content": "EXTRAIT COMPLET du texte pertinent (max 5000 caractères) - pour le contenu in-page, copier le texte entier",
  "url": "URL du document ou de la page",
  "confidence": 0.85,
  "source_type": "document|page_content|table|article|announcement"
}]}

IMPORTANT:
- Pour le contenu de page (source_type: page_content/article/announcement), copie le texte complet dans "content"
- N'ignore pas les informations affichées directement sur la page même s'il n'y a pas de PDF
- Si la page contient un tableau de tarifs, extrait-le entièrement avec source_type: "table"
- Si aucun contenu pertinent: {"documents":[]}`;
}

async function analyzeContent(
  apiKey: string, 
  content: string, 
  site: VeilleSite, 
  pageUrl: string
): Promise<{ documents: ScrapedDocument[] } | null> {
  const urlType = classifyUrl(pageUrl);
  const prompt = buildAnalysisPrompt(content, site, pageUrl, urlType);
  return analyzeWithClaude(apiKey, prompt, 8192);
}

async function analyzeDocument(
  apiKey: string, 
  content: string, 
  title: string
): Promise<any | null> {
  const prompt = `Analyse ce document douanier: "${title}"

Contenu:
${content.substring(0, 4000)}

JSON uniquement:
{"summary":"Résumé 2-3 phrases","importance":"haute|moyenne|basse","hs_codes":["codes SH"],"tariff_changes":[{"hs_code":"","description":"","change":""}],"confidence":0.8}`;

  return analyzeWithClaude(apiKey, prompt, 1024);
}

// ============= MAIN SCRAPING LOGIC =============

// Generate additional URLs for JSF search pages (bypass form submission)
function generateJsfSearchUrls(baseUrl: string): string[] {
  const additionalUrls: string[] = [];
  
  try {
    const parsed = new URL(baseUrl);
    const hostname = parsed.hostname;
    
    // For douane.gov.ma - add known search result pages
    if (hostname.includes('douane.gov.ma')) {
      // Direct links to accords pages with different categories
      const accordsCategories = [
        'rechercheAccords.jsf',
        'rechercheAccords.jsf?typeAccord=bilateral',
        'rechercheAccords.jsf?typeAccord=multilateral', 
        'rechercheAccords.jsf?typeAccord=groupement',
        'rechercheAccords.jsf?typeAccord=international',
      ];
      
      for (const cat of accordsCategories) {
        additionalUrls.push(`https://www.douane.gov.ma/accords/${cat}`);
      }
      
      // === PAGINATED ACCORDS PAGES (Page 1 to 15 to capture all) ===
      // The accords table has pagination - we need to generate URLs for each page
      for (let page = 1; page <= 15; page++) {
        // JSF pagination format - common patterns
        additionalUrls.push(`https://www.douane.gov.ma/accords/rechercheAccords.jsf?page=${page}`);
        additionalUrls.push(`https://www.douane.gov.ma/accords/rechercheAccords.jsf?first=${(page - 1) * 10}`);
        additionalUrls.push(`https://www.douane.gov.ma/accords/rechercheAccords.jsf?start=${(page - 1) * 10}`);
      }
      
      // === CIRCULAIRES PAGES (paginated) ===
      // Circulaires database also has pagination
      for (let page = 1; page <= 20; page++) {
        additionalUrls.push(`https://www.douane.gov.ma/web/guest/circulaires?page=${page}`);
        additionalUrls.push(`https://www.douane.gov.ma/circulaires/rechercheCirculaires.jsf?page=${page}`);
        additionalUrls.push(`https://www.douane.gov.ma/circulaires/rechercheCirculaires.jsf?first=${(page - 1) * 20}`);
      }
      
      // === KNOWN CIRCULAIRE SEARCH PARAMETERS ===
      // Common search patterns for circulaires
      const circulaireYears = ['2025', '2024', '2023', '2022', '2021', '2020'];
      for (const year of circulaireYears) {
        additionalUrls.push(`https://www.douane.gov.ma/circulaires/rechercheCirculaires.jsf?annee=${year}`);
        additionalUrls.push(`https://www.douane.gov.ma/web/guest/circulaires?year=${year}`);
      }
      
      // === ACCORDS BY COUNTRY ===
      // Common country codes for bilateral agreements
      const countryCodes = ['DZ', 'EG', 'GN', 'IQ', 'JO', 'TN', 'TR', 'AE', 'SA', 'US', 'EU', 'FR', 'ES', 'SN', 'ML', 'MR'];
      for (const code of countryCodes) {
        additionalUrls.push(`https://www.douane.gov.ma/accords/rechercheAccords.jsf?pays=${code}`);
        additionalUrls.push(`https://www.douane.gov.ma/accords/detailAccord.jsf?pays=${code}`);
      }
      
      // === KNOWN SECTIONS WITH DOCUMENTS ===
      const sections = [
        '/web/guest/accords-et-conventions',
        '/web/guest/notre-institution-a-l-international',
        '/web/guest/circulaires',
        '/web/guest/nos-bases-legislatives-et-reglementaires',
        '/web/16/141', // Texts section
        '/web/16/76',  // Regulations
        '/web/16/74',  // Procedures
        '/web/16/200', // Services
        '/web/guest/tarif-douanier',
        '/web/guest/code-des-douanes',
        '/web/guest/reglementation',
      ];
      
      for (const section of sections) {
        additionalUrls.push(`https://www.douane.gov.ma${section}`);
      }
    }
  } catch {}
  
  return additionalUrls;
}

// Scrape JSF pages without using actions (which cause 500 errors)
async function scrapeJsfPage(
  firecrawlKey: string,
  url: string,
  siteName: string
): Promise<{ markdown?: string; links?: string[] } | null> {
  console.log(`[${siteName}] Scraping JSF page: ${url}`);
  
  // Simple scrape without actions - just wait for content
  const result = await firecrawlScrape(firecrawlKey, url, {
    formats: ["markdown", "links"],
    onlyMainContent: false,
    waitFor: 2000
  });
  
  if (result) {
    console.log(`[${siteName}] JSF page scraped, found ${result.links?.length || 0} links`);
  }
  
  return result;
}

async function discoverSiteUrls(firecrawlKey: string, site: VeilleSite): Promise<string[]> {
  console.log(`[${site.name}] Discovering URLs...`);
  
  const urls = new Set<string>();
  
  // Step 0: Extract JSF/embedded URLs from the site URL itself (handle fragment URLs)
  const jsfFromMain = extractJsfUrls(site.url);
  if (jsfFromMain.length > 0) {
    console.log(`[${site.name}] Extracted ${jsfFromMain.length} JSF URLs from main URL`);
    jsfFromMain.forEach(u => urls.add(u));
  }
  
  // Also add the main URL (without fragment)
  const cleanMainUrl = site.url.split('#')[0];
  urls.add(cleanMainUrl);
  
  // Step 1: MAP API discovery on the clean URL
  const mappedUrls = await firecrawlMap(firecrawlKey, cleanMainUrl, CONFIG.MAX_URLS_PER_SITE);
  console.log(`[${site.name}] MAP discovered ${mappedUrls.length} URLs`);
  
  // Step 2: Scrape main page for additional links
  const mainPage = await firecrawlScrape(firecrawlKey, cleanMainUrl, { 
    formats: ["links", "markdown"],
    onlyMainContent: false 
  });
  
  const directLinks = mainPage?.links || [];
  console.log(`[${site.name}] Main page has ${directLinks.length} links`);
  
  // Step 3: For each JSF URL discovered, try special JSF handling
  for (const jsfUrl of jsfFromMain) {
    if (jsfUrl !== cleanMainUrl) {
      // Try MAP first
      const jsfMapped = await firecrawlMap(firecrawlKey, jsfUrl, 100);
      console.log(`[${site.name}] JSF MAP (${jsfUrl}) discovered ${jsfMapped.length} URLs`);
      jsfMapped.forEach(u => typeof u === 'string' && urls.add(u));
      
      // Scrape JSF page for links (without actions that cause 500 errors)
      const jsfPageResult = await scrapeJsfPage(firecrawlKey, jsfUrl, site.name);
      if (jsfPageResult) {
        const jsfLinks = jsfPageResult.links || [];
        jsfLinks.forEach((u: any) => typeof u === 'string' && urls.add(u));
      }
    }
  }
  
  // Step 4: Add known search URLs for specific sites
  const additionalSearchUrls = generateJsfSearchUrls(cleanMainUrl);
  if (additionalSearchUrls.length > 0) {
    console.log(`[${site.name}] Adding ${additionalSearchUrls.length} known search URLs...`);
    for (const searchUrl of additionalSearchUrls) {
      urls.add(searchUrl);
      // Also scrape each search URL for more links
      const searchResult = await scrapeJsfPage(firecrawlKey, searchUrl, site.name);
      if (searchResult) {
        const searchLinks = searchResult.links || [];
        searchLinks.forEach((u: any) => typeof u === 'string' && urls.add(u));
      }
    }
  }
  
  // Combine and filter URLs
  const allDiscovered = [...mappedUrls, ...directLinks];
  
  for (const url of allDiscovered) {
    if (typeof url !== 'string') continue;
    
    // Extract JSF URLs from fragments in discovered links
    const jsfExtracted = extractJsfUrls(url);
    jsfExtracted.forEach(u => urls.add(u));
    
    if (shouldExcludeUrl(url)) continue;
    
    const urlType = classifyUrl(url);
    // Prioritize downloads and content pages
    if (urlType === 'download' || urlType === 'content' || urlType === 'archive') {
      urls.add(url);
    } else if (urls.size < CONFIG.MAX_URLS_PER_SITE / 2) {
      // Add "other" URLs only if we have room
      urls.add(url);
    }
  }
  
  // Sort: downloads first, then archives, then content, then others
  const sortedUrls = [...urls].sort((a, b) => {
    const priority = { download: 0, archive: 1, content: 2, other: 3 };
    return priority[classifyUrl(a)] - priority[classifyUrl(b)];
  });
  
  const finalUrls = sortedUrls.slice(0, CONFIG.MAX_URLS_PER_SITE);
  console.log(`[${site.name}] Will scrape ${finalUrls.length} URLs (including JSF)`);
  
  return finalUrls;
}

async function checkDuplicate(
  supabase: any,
  docUrl: string,
  title: string,
  siteName: string
): Promise<boolean> {
  const normalizedUrl = normalizeUrl(docUrl);
  
  // Check by URL
  const { data: existingByUrl } = await supabase
    .from("veille_documents")
    .select("id")
    .eq("source_url", docUrl)
    .maybeSingle();
    
  if (existingByUrl) return true;
  
  // Check by normalized URL
  const { data: existingByNormUrl } = await supabase
    .from("veille_documents")
    .select("id")
    .ilike("source_url", `%${normalizedUrl.split('/').pop()}%`)
    .eq("source_name", siteName)
    .maybeSingle();
    
  if (existingByNormUrl) return true;
  
  // Check by title similarity
  const normalizedTitle = title.toLowerCase().trim().replace(/\s+/g, ' ');
  const searchTerm = normalizedTitle.substring(0, 50);
  
  if (searchTerm.length < 10) return false;
  
  const { data: existingByTitle } = await supabase
    .from("veille_documents")
    .select("id, title")
    .eq("source_name", siteName)
    .ilike("title", `%${searchTerm}%`)
    .limit(10);
  
  return existingByTitle?.some((existing: any) => {
    const existingNorm = existing.title?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
    return calculateSimilarity(normalizedTitle, existingNorm) > 0.85;
  }) || false;
}

async function scrapeSingleUrl(
  firecrawlKey: string,
  claudeKey: string,
  supabase: any,
  site: VeilleSite,
  url: string,
  index: number,
  total: number
): Promise<{ found: number; new: number }> {
  let found = 0, newDocs = 0;
  
  try {
    console.log(`[${site.name}] Scraping ${index + 1}/${total}: ${url.substring(0, 80)}...`);
    
    const urlType = classifyUrl(url);
    const scrapeData = await firecrawlScrape(firecrawlKey, url);
    
    if (!scrapeData) return { found: 0, new: 0 };
    
    const rawContent = scrapeData.markdown || "";
    const contentLength = rawContent.length;
    
    // Skip only if really no content and not a download link
    if (contentLength < 50 && urlType !== 'download') {
      return { found: 0, new: 0 };
    }
    
    // Check for binary content and skip AI analysis if detected
    if (isBinaryContent(rawContent)) {
      console.log(`[${site.name}] Binary content detected, creating entry from URL: ${url.substring(0, 60)}`);
      
      // For binary files (PDFs, etc.), create a simple document entry without AI analysis
      const fileName = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'Document');
      const isDownload = /\.(pdf|xlsx?|docx?|csv|zip)$/i.test(url);
      
      if (isDownload) {
        const isDup = await checkDuplicate(supabase, url, fileName, site.name);
        if (!isDup) {
          const { error: insertError } = await supabase
            .from("veille_documents")
            .insert({
              title: fileName,
              source_name: site.name,
              source_url: url,
              category: site.categories?.[0] || 'document',
              country_code: site.country_code,
              importance: "moyenne",
              summary: `Fichier téléchargeable: ${fileName}`,
              content: `URL: ${url}`,
              confidence_score: 0.6,
              collected_by: "automatic",
              tags: ['document', 'download'],
            });
          
          if (!insertError) {
            console.log(`[${site.name}] NEW [binary]: ${fileName.substring(0, 50)}`);
            return { found: 1, new: 1 };
          }
        }
      }
      return { found: 0, new: 0 };
    }
    
    // Clean content for AI analysis
    const content = cleanContentForAI(rawContent);
    
    // For pages with substantial text content, we want to capture it
    const hasSubstantialContent = content.length > 500;
    
    // Analyze with Claude
    const analysisResult = await analyzeContent(claudeKey, content, site, url);
    
    // Also extract circulaire references directly from content (regex-based)
    const extractedCirculaires = extractCirculaireReferences(content, url);
    
    // Combine AI results with regex-extracted circulaires
    const allDocuments = [
      ...(analysisResult?.documents || []),
      ...extractedCirculaires
    ];
    
    if (!allDocuments.length) {
      return { found: 0, new: 0 };
    }
    
    for (const doc of allDocuments) {
      const docUrl = doc.url || url;
      const docTitle = doc.title || url.split('/').pop() || 'Document';
      
      found++;
      
      // Determine if this is page content vs document
      const sourceType = doc.source_type || 'document';
      const isPageContent = ['page_content', 'article', 'announcement', 'table'].includes(sourceType);
      
      // For page content, use the page URL; for documents, use the document URL
      const finalUrl = isPageContent ? url : docUrl;
      
      // Check for duplicates
      const isDup = await checkDuplicate(supabase, finalUrl, docTitle, site.name);
      if (isDup) {
        console.log(`[${site.name}] Duplicate: ${docTitle.substring(0, 50)}`);
        continue;
      }
      
      // Determine category based on source type
      let category = doc.category || site.categories?.[0];
      if (isPageContent && !doc.category) {
        category = sourceType === 'article' ? 'actualite' : 
                   sourceType === 'announcement' ? 'annonce' :
                   sourceType === 'table' ? 'tarif' : 'page_content';
      }
      
      // For page content, ensure we capture the full text
      const contentToStore = isPageContent 
        ? (doc.content || content)?.substring(0, 15000)  // More space for page content
        : doc.content?.substring(0, 10000);
      
      // Insert new document
      const { error: insertError } = await supabase
        .from("veille_documents")
        .insert({
          title: docTitle,
          source_name: site.name,
          source_url: finalUrl,
          category: category,
          subcategory: isPageContent ? sourceType : null,
          country_code: site.country_code,
          publication_date: doc.date || null,
          importance: doc.importance || (isPageContent ? "moyenne" : "moyenne"),
          summary: doc.summary,
          content: contentToStore,
          mentioned_hs_codes: doc.hs_codes || [],
          detected_tariff_changes: doc.tariff_changes || [],
          confidence_score: doc.confidence || (isPageContent ? 0.75 : 0.8),
          collected_by: "automatic",
          tags: isPageContent ? [sourceType, 'web_content'] : ['document'],
        });
      
      if (!insertError) {
        newDocs++;
        const typeLabel = isPageContent ? `[${sourceType}]` : '[doc]';
        console.log(`[${site.name}] NEW ${typeLabel}: ${docTitle.substring(0, 55)}`);
      } else {
        console.error(`[${site.name}] Insert error:`, insertError.message);
      }
    }
    
  } catch (error) {
    console.error(`[${site.name}] Error scraping ${url}:`, error);
  }
  
  return { found, new: newDocs };
}

async function scrapeSite(
  firecrawlKey: string,
  claudeKey: string,
  supabase: any,
  site: VeilleSite
): Promise<{ found: number; new: number; errors: string[] }> {
  const errors: string[] = [];
  let totalFound = 0, totalNew = 0;
  
  try {
    console.log(`\n========== Starting ${site.name} ==========`);
    
    // Update status
    await supabase
      .from("veille_sites")
      .update({ last_scrape_status: "crawling", last_scraped_at: new Date().toISOString() })
      .eq("id", site.id);
    
    // Discover URLs
    const urls = await discoverSiteUrls(firecrawlKey, site);
    
    // Scrape URLs in parallel batches
    const results = await processBatch(
      urls,
      (url, idx) => scrapeSingleUrl(firecrawlKey, claudeKey, supabase, site, url, idx, urls.length),
      CONFIG.MAX_CONCURRENT_SCRAPES
    );
    
    for (const result of results) {
      totalFound += result.found;
      totalNew += result.new;
    }
    
    // Update site status
    await supabase
      .from("veille_sites")
      .update({
        last_scrape_status: "success",
        last_scraped_at: new Date().toISOString(),
        total_documents_found: totalFound,
      })
      .eq("id", site.id);
    
    console.log(`[${site.name}] Completed: ${totalNew} new / ${totalFound} found from ${urls.length} URLs`);
    
  } catch (error) {
    const msg = `${site.name}: ${error instanceof Error ? error.message : "Unknown error"}`;
    errors.push(msg);
    console.error(`[${site.name}] Error:`, error);
    
    await supabase
      .from("veille_sites")
      .update({ last_scrape_status: "error", last_scraped_at: new Date().toISOString() })
      .eq("id", site.id);
  }
  
  return { found: totalFound, new: totalNew, errors };
}

async function searchKeyword(
  firecrawlKey: string,
  claudeKey: string,
  supabase: any,
  keyword: VeilleKeyword
): Promise<{ found: number; new: number }> {
  let found = 0, newDocs = 0;
  
  try {
    console.log(`[Search] "${keyword.keyword}"`);
    
    const results = await firecrawlSearch(
      firecrawlKey,
      `${keyword.keyword} douane réglementation customs regulation`,
      10
    );
    
    console.log(`[Search] "${keyword.keyword}" - ${results.length} results`);
    
    // Update keyword stats
    await supabase
      .from("veille_keywords")
      .update({
        last_searched_at: new Date().toISOString(),
        total_searches: (keyword.total_searches || 0) + 1,
        total_results: (keyword.total_results || 0) + results.length,
      })
      .eq("id", keyword.id);
    
    for (const result of results) {
      const title = result.title || result.url;
      
      // Check duplicate
      const isDup = await checkDuplicate(supabase, result.url, title, "Search");
      if (isDup) continue;
      
      found++;
      
      if (result.markdown) {
        const analysis = await analyzeDocument(claudeKey, result.markdown, title);
        
        const { error } = await supabase
          .from("veille_documents")
          .insert({
            title,
            source_name: new URL(result.url).hostname,
            source_url: result.url,
            category: keyword.category,
            country_code: keyword.country_code,
            search_keyword: keyword.keyword,
            importance: analysis?.importance || "moyenne",
            summary: analysis?.summary || result.description,
            content: result.markdown?.substring(0, 10000),
            mentioned_hs_codes: analysis?.hs_codes || [],
            detected_tariff_changes: analysis?.tariff_changes || [],
            confidence_score: analysis?.confidence || 0.7,
            collected_by: "automatic",
          });
        
        if (!error) {
          newDocs++;
          console.log(`[Search] NEW: ${title.substring(0, 50)}`);
        }
      }
    }
    
  } catch (error) {
    console.error(`[Search] Error for "${keyword.keyword}":`, error);
  }
  
  return { found, new: newDocs };
}

// ============= MAIN HANDLER =============

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Parse request body early to fail fast
  let params: { mode?: string; siteId?: string; keywordId?: string; async?: boolean } = {};
  try {
    params = await req.json().catch(() => ({}));
  } catch {
    params = {};
  }

  const { mode = "full", siteId, keywordId } = params;
  const isAsync = params.async !== false; // Default to async mode

  // Check required env vars immediately
  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!FIRECRAWL_API_KEY) {
    return new Response(
      JSON.stringify({ error: "FIRECRAWL_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  // Create log entry first
  const { data: logData, error: logError } = await supabase
    .from("veille_logs")
    .insert({
      cycle_started_at: new Date().toISOString(),
      status: "running",
      sites_scraped: 0,
      keywords_searched: 0,
      documents_found: 0,
      documents_new: 0,
      errors: [],
    })
    .select()
    .single();

  if (logError) {
    console.error("Failed to create log entry:", logError);
  }

  const logId = logData?.id;

  // For async mode, return immediately and process in background
  if (isAsync) {
    // Start background processing using queueMicrotask for Deno compatibility
    const backgroundTask = (async () => {
      try {
        await runScrapingCycle(FIRECRAWL_API_KEY, ANTHROPIC_API_KEY, supabase, logId, mode, siteId, keywordId);
      } catch (error) {
        console.error("Background scraping error:", error);
        if (logId) {
          await supabase
            .from("veille_logs")
            .update({
              status: "error",
              cycle_ended_at: new Date().toISOString(),
              errors: [error instanceof Error ? error.message : "Unknown error"],
            })
            .eq("id", logId);
        }
      }
    })();
    
    // Don't await - let it run in background
    backgroundTask.catch(e => console.error("Background task failed:", e));

    return new Response(
      JSON.stringify({
        success: true,
        message: "Scraping démarré en arrière-plan",
        log_id: logId,
        mode,
        async: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Synchronous mode (for testing or single items)
  try {
    const result = await runScrapingCycle(FIRECRAWL_API_KEY, ANTHROPIC_API_KEY, supabase, logId, mode, siteId, keywordId);
    return new Response(
      JSON.stringify({ success: true, ...result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Veille scraper error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Extracted main logic for reuse
async function runScrapingCycle(
  firecrawlKey: string,
  anthropicKey: string,
  supabase: any,
  logId: string | null,
  mode: string,
  siteId?: string,
  keywordId?: string
): Promise<{
  sites_scraped: number;
  keywords_searched: number;
  documents_found: number;
  documents_new: number;
  duration_seconds: number;
  errors?: string[];
}> {
  const startTime = new Date();
  let totalFound = 0, totalNew = 0, siteCount = 0, keywordCount = 0;
  const allErrors: string[] = [];

  // Fetch sites
  let sitesQuery = supabase.from("veille_sites").select("*").eq("is_active", true);
  if (siteId) sitesQuery = sitesQuery.eq("id", siteId);
  const { data: sites } = await sitesQuery;

  console.log(`\n====== VEILLE SCRAPER START ======`);
  console.log(`Mode: ${mode}, Sites: ${sites?.length || 0}`);

  // Process sites in parallel batches
  if (sites?.length) {
    const siteResults = await processBatch(
      sites as VeilleSite[],
      async (site) => scrapeSite(firecrawlKey, anthropicKey, supabase, site),
      CONFIG.MAX_CONCURRENT_SITES
    );
    
    for (const result of siteResults) {
      totalFound += result.found;
      totalNew += result.new;
      allErrors.push(...result.errors);
      siteCount++;
    }
  }

  // Fetch and process keywords
  let keywordsQuery = supabase.from("veille_keywords").select("*").eq("is_active", true);
  if (keywordId) keywordsQuery = keywordsQuery.eq("id", keywordId);
  const { data: keywords } = await keywordsQuery;

  if (keywords?.length) {
    for (const keyword of keywords as VeilleKeyword[]) {
      const result = await searchKeyword(firecrawlKey, anthropicKey, supabase, keyword);
      totalFound += result.found;
      totalNew += result.new;
      keywordCount++;
    }
  }

  // Finalize log
  const endTime = new Date();
  const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

  if (logId) {
    await supabase
      .from("veille_logs")
      .update({
        status: allErrors.length > 0 ? "completed_with_errors" : "completed",
        cycle_ended_at: endTime.toISOString(),
        duration_seconds: duration,
        sites_scraped: siteCount,
        keywords_searched: keywordCount,
        documents_found: totalFound,
        documents_new: totalNew,
        errors: allErrors.length > 0 ? allErrors : null,
      })
      .eq("id", logId);
  }

  await supabase.from("veille_config").update({ last_run_at: endTime.toISOString() }).limit(1);

  console.log(`\n====== VEILLE COMPLETE ======`);
  console.log(`Sites: ${siteCount}, Keywords: ${keywordCount}, New docs: ${totalNew}, Duration: ${duration}s`);

  return {
    sites_scraped: siteCount,
    keywords_searched: keywordCount,
    documents_found: totalFound,
    documents_new: totalNew,
    duration_seconds: duration,
    errors: allErrors.length > 0 ? allErrors : undefined,
  };
}
