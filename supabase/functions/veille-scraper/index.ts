import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
}

// Calculate similarity between two strings (Jaccard similarity on words)
function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  
  const words1 = new Set(str1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(str2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

// Claude AI analysis function
async function analyzeWithClaude(apiKey: string, prompt: string, maxTokens: number = 4096) {
  try {
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
        messages: [
          { role: "user", content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Claude API error:", response.status, errorText);
      return null;
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || "{}";
    
    // Parse JSON from response
    let cleaned = text.trim();
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    
    return JSON.parse(cleaned.trim());
  } catch (e) {
    console.error("Claude analysis failed:", e);
    return null;
  }
}

async function analyzeContent(apiKey: string, content: string, site: VeilleSite) {
  const prompt = `Analyse ce contenu web d'un site douanier officiel (${site.name}).
Extrait les documents, circulaires, notes ou réglementations importantes.

Contenu:
${content.substring(0, 8000)}

Réponds en JSON avec cette structure:
{
  "documents": [
    {
      "title": "Titre du document",
      "summary": "Résumé court",
      "date": "2024-01-15",
      "category": "circulaire|note|tarif|regulation|other",
      "importance": "haute|moyenne|basse",
      "hs_codes": ["8501", "8502"],
      "tariff_changes": [{"hs_code": "8501", "old_rate": 10, "new_rate": 5}],
      "content": "Extrait du contenu pertinent",
      "url": "URL si disponible",
      "confidence": 0.85
    }
  ]
}

Si aucun document pertinent, retourne {"documents": []}`;

  return await analyzeWithClaude(apiKey, prompt, 4096);
}

async function analyzeDocument(apiKey: string, content: string, title: string) {
  const prompt = `Analyse ce document douanier: "${title}"

Contenu:
${content.substring(0, 4000)}

Réponds en JSON:
{
  "summary": "Résumé en 2-3 phrases",
  "importance": "haute|moyenne|basse",
  "hs_codes": ["codes SH mentionnés"],
  "tariff_changes": [{"hs_code": "", "description": "", "change": ""}],
  "confidence": 0.8
}`;

  return await analyzeWithClaude(apiKey, prompt, 1024);
}

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

    if (!FIRECRAWL_API_KEY) {
      throw new Error("FIRECRAWL_API_KEY is not configured");
    }

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Create log entry
    const logEntry = {
      cycle_started_at: new Date().toISOString(),
      status: "running",
      sites_scraped: 0,
      keywords_searched: 0,
      documents_found: 0,
      documents_new: 0,
      errors: [] as string[],
    };

    const { data: logData, error: logError } = await supabase
      .from("veille_logs")
      .insert(logEntry)
      .select()
      .single();

    if (logError) {
      console.error("Failed to create log entry:", logError);
    }

    const logId = logData?.id;
    let totalDocumentsFound = 0;
    let totalNewDocuments = 0;
    const errors: string[] = [];

    // Get active sites to scrape
    let sitesQuery = supabase.from("veille_sites").select("*").eq("is_active", true);
    if (siteId) {
      sitesQuery = sitesQuery.eq("id", siteId);
    }
    const { data: sites, error: sitesError } = await sitesQuery;

    if (sitesError) {
      throw new Error(`Failed to fetch sites: ${sitesError.message}`);
    }

    console.log(`Found ${sites?.length || 0} sites to scrape`);

    // Process each site
    for (const site of (sites as VeilleSite[]) || []) {
      try {
        console.log(`Scraping site: ${site.name} (${site.url})`);

        // Use Firecrawl to scrape the site
        const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: site.url,
            formats: ["markdown", "links"],
            onlyMainContent: true,
          }),
        });

        if (!scrapeResponse.ok) {
          const errorText = await scrapeResponse.text();
          console.error(`Firecrawl error for ${site.name}:`, errorText);
          errors.push(`${site.name}: ${errorText}`);
          
          await supabase
            .from("veille_sites")
            .update({ last_scrape_status: "error", last_scraped_at: new Date().toISOString() })
            .eq("id", site.id);
          
          continue;
        }

        const scrapeData = await scrapeResponse.json();
        const content = scrapeData.data?.markdown || "";
        const links = scrapeData.data?.links || [];

        console.log(`Got ${content.length} chars content and ${links.length} links from ${site.name}`);

        // Update site status
        await supabase
          .from("veille_sites")
          .update({
            last_scrape_status: "success",
            last_scraped_at: new Date().toISOString(),
          })
          .eq("id", site.id);

        // Analyze content with Claude AI
        if (content.length > 100) {
          const analysisResult = await analyzeContent(ANTHROPIC_API_KEY, content, site);
          
          if (analysisResult && analysisResult.documents?.length > 0) {
            for (const doc of analysisResult.documents) {
              // Enhanced duplicate detection - check by title, URL, and content similarity
              const docUrl = doc.url || site.url;
              const normalizedTitle = doc.title?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
              
              // Check for existing document by URL first (most reliable)
              const { data: existingByUrl } = await supabase
                .from("veille_documents")
                .select("id")
                .eq("source_url", docUrl)
                .maybeSingle();

              if (existingByUrl) {
                console.log(`Duplicate detected (URL): ${docUrl}`);
                totalDocumentsFound++;
                continue;
              }

              // Check by normalized title and source
              const { data: existingByTitle } = await supabase
                .from("veille_documents")
                .select("id, title")
                .eq("source_name", site.name)
                .ilike("title", `%${normalizedTitle.substring(0, 50)}%`)
                .limit(5);

              // Check for similar titles (fuzzy matching)
              const isDuplicate = existingByTitle?.some(existing => {
                const existingNormalized = existing.title?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
                // Calculate simple similarity score
                const similarity = calculateSimilarity(normalizedTitle, existingNormalized);
                return similarity > 0.85; // 85% similarity threshold
              });

              if (isDuplicate) {
                console.log(`Duplicate detected (Title similarity): ${doc.title}`);
                totalDocumentsFound++;
                continue;
              }

              // Insert new document
              const { error: insertError } = await supabase
                .from("veille_documents")
                .insert({
                  title: doc.title,
                  source_name: site.name,
                  source_url: docUrl,
                  category: doc.category || site.categories?.[0],
                  country_code: site.country_code,
                  publication_date: doc.date || null,
                  importance: doc.importance || "moyenne",
                  summary: doc.summary,
                  content: doc.content,
                  mentioned_hs_codes: doc.hs_codes || [],
                  detected_tariff_changes: doc.tariff_changes || [],
                  confidence_score: doc.confidence || 0.8,
                  collected_by: "automatic",
                });

              if (!insertError) {
                totalNewDocuments++;
                console.log(`New document inserted: ${doc.title}`);
              }
              totalDocumentsFound++;
            }
          }
        }

        logEntry.sites_scraped++;
      } catch (siteError) {
        console.error(`Error scraping site ${site.name}:`, siteError);
        errors.push(`${site.name}: ${siteError instanceof Error ? siteError.message : "Unknown error"}`);
      }
    }

    // Search with keywords
    let keywordsQuery = supabase.from("veille_keywords").select("*").eq("is_active", true);
    if (keywordId) {
      keywordsQuery = keywordsQuery.eq("id", keywordId);
    }
    const { data: keywords, error: keywordsError } = await keywordsQuery;

    if (keywordsError) {
      console.error("Failed to fetch keywords:", keywordsError);
    } else {
      console.log(`Processing ${keywords?.length || 0} keywords`);

      for (const keyword of (keywords as VeilleKeyword[]) || []) {
        try {
          console.log(`Searching for keyword: ${keyword.keyword}`);

          // Use Firecrawl search
          const searchResponse = await fetch("https://api.firecrawl.dev/v1/search", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: `${keyword.keyword} douane Maroc réglementation`,
              limit: 10,
              scrapeOptions: {
                formats: ["markdown"],
              },
            }),
          });

          if (!searchResponse.ok) {
            console.error(`Search error for ${keyword.keyword}:`, await searchResponse.text());
            continue;
          }

          const searchData = await searchResponse.json();
          const results = searchData.data || [];

          console.log(`Found ${results.length} results for "${keyword.keyword}"`);

          // Update keyword stats
          await supabase
            .from("veille_keywords")
            .update({
              last_searched_at: new Date().toISOString(),
              total_searches: (keyword as any).total_searches + 1,
              total_results: (keyword as any).total_results + results.length,
            })
            .eq("id", keyword.id);

          // Process search results
          for (const result of results) {
            const title = result.title || result.url;
            const normalizedTitle = title.toLowerCase().trim().replace(/\s+/g, ' ');
            
            // Check if already exists by URL
            const { data: existingByUrl } = await supabase
              .from("veille_documents")
              .select("id")
              .eq("source_url", result.url)
              .maybeSingle();

            if (existingByUrl) {
              console.log(`Duplicate detected (URL): ${result.url}`);
              continue;
            }

            // Check by similar title
            const { data: existingByTitle } = await supabase
              .from("veille_documents")
              .select("id, title")
              .ilike("title", `%${normalizedTitle.substring(0, 50)}%`)
              .limit(5);

            const isDuplicate = existingByTitle?.some(existing => {
              const existingNormalized = existing.title?.toLowerCase().trim().replace(/\s+/g, ' ') || '';
              return calculateSimilarity(normalizedTitle, existingNormalized) > 0.85;
            });

            if (isDuplicate) {
              console.log(`Duplicate detected (Title): ${title}`);
              continue;
            }

            if (result.markdown) {
              // Analyze with Claude AI
              const docAnalysis = await analyzeDocument(ANTHROPIC_API_KEY, result.markdown, title);

              const { error: insertError } = await supabase
                .from("veille_documents")
                .insert({
                  title: title,
                  source_name: new URL(result.url).hostname,
                  source_url: result.url,
                  category: keyword.category,
                  country_code: keyword.country_code,
                  search_keyword: keyword.keyword,
                  importance: docAnalysis?.importance || "moyenne",
                  summary: docAnalysis?.summary || result.description,
                  content: result.markdown?.substring(0, 10000),
                  mentioned_hs_codes: docAnalysis?.hs_codes || [],
                  detected_tariff_changes: docAnalysis?.tariff_changes || [],
                  confidence_score: docAnalysis?.confidence || 0.7,
                  collected_by: "automatic",
                });

              if (!insertError) {
                totalNewDocuments++;
                console.log(`New document inserted: ${title}`);
              }
              totalDocumentsFound++;
            }
          }

          logEntry.keywords_searched++;
        } catch (keywordError) {
          console.error(`Error processing keyword ${keyword.keyword}:`, keywordError);
          errors.push(`Keyword "${keyword.keyword}": ${keywordError instanceof Error ? keywordError.message : "Unknown error"}`);
        }
      }
    }

    // Update log entry
    const endTime = new Date();
    const startTime = new Date(logEntry.cycle_started_at);
    const durationSeconds = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

    if (logId) {
      await supabase
        .from("veille_logs")
        .update({
          status: errors.length > 0 ? "completed_with_errors" : "completed",
          cycle_ended_at: endTime.toISOString(),
          duration_seconds: durationSeconds,
          sites_scraped: logEntry.sites_scraped,
          keywords_searched: logEntry.keywords_searched,
          documents_found: totalDocumentsFound,
          documents_new: totalNewDocuments,
          errors: errors.length > 0 ? errors : null,
        })
        .eq("id", logId);
    }

    // Update config last run
    await supabase
      .from("veille_config")
      .update({ last_run_at: endTime.toISOString() })
      .limit(1);

    console.log(`Veille completed: ${logEntry.sites_scraped} sites, ${logEntry.keywords_searched} keywords, ${totalNewDocuments} new documents`);

    return new Response(
      JSON.stringify({
        success: true,
        sites_scraped: logEntry.sites_scraped,
        keywords_searched: logEntry.keywords_searched,
        documents_found: totalDocumentsFound,
        documents_new: totalNewDocuments,
        errors: errors.length > 0 ? errors : undefined,
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
