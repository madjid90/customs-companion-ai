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
    /legislation/i, /law/i, /code/i, /annonce/i, /announcement/i
  ],
  ARCHIVE_PATTERNS: [
    /archive/i, /release/i, /version/i, /revision/i, /historique/i,
    /past/i, /previous/i, /ancien/i
  ],
  // URL exclusion patterns (avoid scraping these)
  EXCLUDE_PATTERNS: [
    /\.(jpg|jpeg|png|gif|svg|ico|webp|mp4|mp3|wav|avi)$/i,
    /\.(css|js|woff|woff2|ttf|eot)$/i,
    /#.*/i, // Anchor links
    /mailto:/i, /tel:/i, /javascript:/i,
    /login|signin|signup|register|password|logout/i,
    /facebook\.com|twitter\.com|linkedin\.com|youtube\.com|instagram\.com/i
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
  return CONFIG.EXCLUDE_PATTERNS.some(pattern => pattern.test(url));
}

// Classify URL type
function classifyUrl(url: string): 'download' | 'archive' | 'content' | 'other' {
  if (CONFIG.DOWNLOAD_PATTERNS.some(p => p.test(url))) return 'download';
  if (CONFIG.ARCHIVE_PATTERNS.some(p => p.test(url))) return 'archive';
  if (CONFIG.CONTENT_PATTERNS.some(p => p.test(url))) return 'content';
  return 'other';
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
  options: { formats?: string[], onlyMainContent?: boolean } = {}
): Promise<{ markdown?: string, links?: string[], metadata?: any } | null> {
  await firecrawlLimiter.wait();
  
  return withRetry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.SCRAPE_TIMEOUT_MS);
    
    try {
      const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          formats: options.formats || ["markdown", "links"],
          onlyMainContent: options.onlyMainContent ?? true,
        }),
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
  
  if (isDownload && content.length < 200) {
    const fileName = pageUrl.split('/').pop() || 'Document';
    return `Ce lien pointe vers un fichier téléchargeable: ${pageUrl}
Nom: ${fileName}
Site: ${site.name}

Crée une entrée basée sur ce lien. JSON uniquement:
{"documents":[{"title":"Titre descriptif","summary":"Description probable","date":null,"category":"tarif|regulation|publication|other","importance":"haute|moyenne|basse","hs_codes":[],"tariff_changes":[],"content":"Téléchargement: ${pageUrl}","url":"${pageUrl}","confidence":0.7}]}`;
  }
  
  if (isArchive) {
    return `Page d'archives du site ${site.name}.
URL: ${pageUrl}

Contenu:
${content.substring(0, CONFIG.MAX_CONTENT_LENGTH)}

Extrait TOUS les documents/fichiers disponibles. JSON:
{"documents":[{"title":"Nom","summary":"Description","date":"YYYY-MM-DD ou null","category":"tarif|regulation|publication|archive|other","importance":"haute|moyenne|basse","hs_codes":[],"tariff_changes":[],"content":"Description","url":"URL si dispo","confidence":0.8}]}`;
  }
  
  return `Analyse ce contenu web d'un site douanier officiel (${site.name}).
URL: ${pageUrl}

Contenu:
${content.substring(0, CONFIG.MAX_CONTENT_LENGTH)}

Extrait les documents, circulaires, notes, réglementations importantes.
JSON uniquement:
{"documents":[{"title":"Titre","summary":"Résumé","date":"YYYY-MM-DD","category":"circulaire|note|tarif|regulation|other","importance":"haute|moyenne|basse","hs_codes":["8501"],"tariff_changes":[{"hs_code":"8501","description":"changement"}],"content":"Extrait pertinent","url":"URL si dispo","confidence":0.85}]}

Si aucun document pertinent: {"documents":[]}`;
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

async function discoverSiteUrls(firecrawlKey: string, site: VeilleSite): Promise<string[]> {
  console.log(`[${site.name}] Discovering URLs...`);
  
  const urls = new Set<string>([site.url]);
  
  // Step 1: MAP API discovery
  const mappedUrls = await firecrawlMap(firecrawlKey, site.url, CONFIG.MAX_URLS_PER_SITE);
  console.log(`[${site.name}] MAP discovered ${mappedUrls.length} URLs`);
  
  // Step 2: Scrape main page for additional links
  const mainPage = await firecrawlScrape(firecrawlKey, site.url, { 
    formats: ["links", "markdown"],
    onlyMainContent: false 
  });
  
  const directLinks = mainPage?.links || [];
  console.log(`[${site.name}] Main page has ${directLinks.length} links`);
  
  // Combine and filter URLs
  const allDiscovered = [...mappedUrls, ...directLinks];
  
  for (const url of allDiscovered) {
    if (typeof url !== 'string') continue;
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
  console.log(`[${site.name}] Will scrape ${finalUrls.length} URLs`);
  
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
    
    const content = scrapeData.markdown || "";
    
    // Skip if no content and not a download link
    if (content.length < 100 && urlType !== 'download') {
      return { found: 0, new: 0 };
    }
    
    // Analyze with Claude
    const analysisResult = await analyzeContent(claudeKey, content, site, url);
    
    if (!analysisResult?.documents?.length) {
      return { found: 0, new: 0 };
    }
    
    for (const doc of analysisResult.documents) {
      const docUrl = doc.url || url;
      const docTitle = doc.title || url.split('/').pop() || 'Document';
      
      found++;
      
      // Check for duplicates
      const isDup = await checkDuplicate(supabase, docUrl, docTitle, site.name);
      if (isDup) {
        console.log(`[${site.name}] Duplicate: ${docTitle.substring(0, 50)}`);
        continue;
      }
      
      // Insert new document
      const { error: insertError } = await supabase
        .from("veille_documents")
        .insert({
          title: docTitle,
          source_name: site.name,
          source_url: docUrl,
          category: doc.category || site.categories?.[0],
          country_code: site.country_code,
          publication_date: doc.date || null,
          importance: doc.importance || "moyenne",
          summary: doc.summary,
          content: doc.content?.substring(0, 10000),
          mentioned_hs_codes: doc.hs_codes || [],
          detected_tariff_changes: doc.tariff_changes || [],
          confidence_score: doc.confidence || 0.8,
          collected_by: "automatic",
        });
      
      if (!insertError) {
        newDocs++;
        console.log(`[${site.name}] NEW: ${docTitle.substring(0, 60)}`);
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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { mode = "full", siteId, keywordId } = await req.json().catch(() => ({}));

    const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY not configured");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Create log entry
    const { data: logData } = await supabase
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

    const logId = logData?.id;
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
        async (site) => scrapeSite(FIRECRAWL_API_KEY, ANTHROPIC_API_KEY, supabase, site),
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
        const result = await searchKeyword(FIRECRAWL_API_KEY, ANTHROPIC_API_KEY, supabase, keyword);
        totalFound += result.found;
        totalNew += result.new;
        keywordCount++;
      }
    }

    // Finalize log
    const endTime = new Date();
    const startTime = new Date(logData?.cycle_started_at || endTime);
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

    return new Response(
      JSON.stringify({
        success: true,
        sites_scraped: siteCount,
        keywords_searched: keywordCount,
        documents_found: totalFound,
        documents_new: totalNew,
        duration_seconds: duration,
        errors: allErrors.length > 0 ? allErrors : undefined,
      }),
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
