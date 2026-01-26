import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WCODecision {
  title: string;
  reference: string;
  date: string;
  hs_code: string;
  description: string;
  url: string;
}

// Realistic browser headers to avoid bot detection
const browserHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9,fr;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

// Parse WCO Trade Tools page to extract decisions
function parseDecisions(html: string, baseUrl: string): WCODecision[] {
  const decisions: WCODecision[] = [];
  
  // Look for table rows or list items containing decision data
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowContent = rowMatch[1];
    const cells: string[] = [];
    
    const cellRegexLocal = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegexLocal.exec(rowContent)) !== null) {
      let cellText = cellMatch[1]
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#\d+;/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      cells.push(cellText);
    }
    
    // Extract links from the row
    let url = '';
    const linkMatch = linkRegex.exec(rowContent);
    if (linkMatch) {
      url = linkMatch[1];
      if (url.startsWith('/')) {
        url = new URL(url, baseUrl).href;
      }
    }
    
    if (cells.length >= 3) {
      const hsCodePattern = /\b(\d{4}(?:\.\d{2})?(?:\.\d{2})?)\b/;
      let hsCode = '';
      for (const cell of cells) {
        const match = hsCodePattern.exec(cell);
        if (match) {
          hsCode = match[1].replace(/\./g, '');
          break;
        }
      }
      
      const datePattern = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})|(\d{4}[\/\-]\d{2}[\/\-]\d{2})/;
      let date = '';
      for (const cell of cells) {
        const match = datePattern.exec(cell);
        if (match) {
          date = match[0];
          break;
        }
      }
      
      if (cells[0] && cells[0].length > 5) {
        decisions.push({
          title: cells[0].substring(0, 200),
          reference: cells[1] || '',
          date: date,
          hs_code: hsCode,
          description: cells.slice(2).join(' ').substring(0, 500),
          url: url
        });
      }
    }
  }
  
  return decisions;
}

// Extract cookies from Set-Cookie headers properly
function extractCookies(setCookieHeader: string | null): string {
  if (!setCookieHeader) return "";
  
  // Handle multiple Set-Cookie headers joined by comma or separate
  const cookies = setCookieHeader
    .split(/,(?=[^;]*=)/)
    .map(cookie => {
      const parts = cookie.split(";")[0].trim();
      return parts;
    })
    .filter(Boolean)
    .join("; ");
  
  return cookies;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url = "https://www.wcotradetools.org/en/valuation/decisions" } = await req.json().catch(() => ({}));

    const WCO_USERNAME = Deno.env.get("WCO_USERNAME");
    const WCO_PASSWORD = Deno.env.get("WCO_PASSWORD");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!WCO_USERNAME || !WCO_PASSWORD) {
      return new Response(
        JSON.stringify({ error: "WCO credentials not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    console.log("Attempting to authenticate with WCO Trade Tools...");

    // Step 1: First visit the home page to get initial session
    const homePageUrl = "https://www.wcotradetools.org/";
    const homeResponse = await fetch(homePageUrl, {
      method: "GET",
      headers: browserHeaders,
    });

    if (!homeResponse.ok) {
      console.log(`Home page returned ${homeResponse.status}, trying login page directly...`);
    }

    const homeCookies = extractCookies(homeResponse.headers.get("set-cookie"));
    console.log("Got initial cookies from home page");

    // Add small delay to appear more human-like
    await new Promise(resolve => setTimeout(resolve, 500));

    // Step 2: Get login page to find CSRF token
    const loginPageUrl = "https://www.wcotradetools.org/en/user/login";
    const loginPageResponse = await fetch(loginPageUrl, {
      method: "GET",
      headers: {
        ...browserHeaders,
        "Cookie": homeCookies,
        "Referer": homePageUrl,
        "Sec-Fetch-Site": "same-origin",
      },
    });

    if (!loginPageResponse.ok) {
      // Try alternative login URL
      console.log(`Login page returned ${loginPageResponse.status}, trying alternative...`);
      
      const altLoginUrl = "https://www.wcotradetools.org/user/login";
      const altResponse = await fetch(altLoginUrl, {
        method: "GET",
        headers: {
          ...browserHeaders,
          "Cookie": homeCookies,
          "Referer": homePageUrl,
        },
      });
      
      if (!altResponse.ok) {
        throw new Error(`Cannot access login page: ${altResponse.status}. The site may be blocking automated requests.`);
      }
    }

    const loginCookiesRaw = loginPageResponse.headers.get("set-cookie");
    const loginCookies = extractCookies(loginCookiesRaw);
    const allCookies = [homeCookies, loginCookies].filter(Boolean).join("; ");
    
    const loginPageHtml = await loginPageResponse.text();
    console.log(`Login page loaded: ${loginPageHtml.length} chars`);

    // Extract CSRF tokens (Drupal form tokens)
    const formBuildIdMatch = loginPageHtml.match(/name="form_build_id"\s+value="([^"]+)"/);
    const formTokenMatch = loginPageHtml.match(/name="form_token"\s+value="([^"]+)"/);
    const formIdMatch = loginPageHtml.match(/name="form_id"\s+value="([^"]+)"/);

    const formBuildId = formBuildIdMatch?.[1] || "";
    const formToken = formTokenMatch?.[1] || "";
    const formId = formIdMatch?.[1] || "user_login_form";

    if (!formBuildId) {
      console.log("Warning: No form_build_id found, login may fail");
      console.log("Page snippet:", loginPageHtml.substring(0, 1000));
    }

    console.log("Found form tokens, attempting login...");

    // Small delay before login
    await new Promise(resolve => setTimeout(resolve, 300));

    // Step 3: Submit login form
    const loginFormData = new URLSearchParams();
    loginFormData.append("name", WCO_USERNAME);
    loginFormData.append("pass", WCO_PASSWORD);
    if (formBuildId) loginFormData.append("form_build_id", formBuildId);
    if (formToken) loginFormData.append("form_token", formToken);
    loginFormData.append("form_id", formId);
    loginFormData.append("op", "Log in");

    const loginResponse = await fetch(loginPageUrl, {
      method: "POST",
      headers: {
        ...browserHeaders,
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": allCookies,
        "Referer": loginPageUrl,
        "Origin": "https://www.wcotradetools.org",
        "Sec-Fetch-Site": "same-origin",
      },
      body: loginFormData.toString(),
      redirect: "manual",
    });

    const postLoginCookies = extractCookies(loginResponse.headers.get("set-cookie"));
    const finalCookies = [allCookies, postLoginCookies].filter(Boolean).join("; ");

    const loginSuccess = loginResponse.status === 302 || loginResponse.status === 303 || loginResponse.status === 200;
    
    if (!loginSuccess) {
      console.error("Login failed with status:", loginResponse.status);
      return new Response(
        JSON.stringify({ 
          error: "Login failed", 
          status: loginResponse.status,
          message: "Check your WCO credentials or the site may be blocking automated access"
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Login successful, fetching decisions page...");

    // Small delay after login
    await new Promise(resolve => setTimeout(resolve, 500));

    // Step 4: Fetch the target page with authenticated session
    const decisionsResponse = await fetch(url, {
      method: "GET",
      headers: {
        ...browserHeaders,
        "Cookie": finalCookies,
        "Referer": "https://www.wcotradetools.org/",
        "Sec-Fetch-Site": "same-origin",
      },
    });

    if (!decisionsResponse.ok) {
      throw new Error(`Failed to fetch decisions page: ${decisionsResponse.status}`);
    }

    const html = await decisionsResponse.text();
    console.log(`Fetched ${html.length} characters of content`);

    // Parse the decisions from the HTML
    const decisions = parseDecisions(html, "https://www.wcotradetools.org");
    console.log(`Parsed ${decisions.length} decisions`);

    // Store decisions in veille_documents
    let newDocuments = 0;
    for (const decision of decisions) {
      const { data: existing } = await supabase
        .from("veille_documents")
        .select("id")
        .eq("title", decision.title)
        .eq("source_name", "WCO Trade Tools")
        .maybeSingle();

      if (!existing) {
        const { error: insertError } = await supabase
          .from("veille_documents")
          .insert({
            title: decision.title,
            source_name: "WCO Trade Tools",
            source_url: decision.url || url,
            category: "valuation_decision",
            publication_date: decision.date || null,
            importance: "haute",
            summary: decision.description,
            content: `Reference: ${decision.reference}\nHS Code: ${decision.hs_code}\n\n${decision.description}`,
            mentioned_hs_codes: decision.hs_code ? [decision.hs_code] : [],
            confidence_score: 0.9,
            collected_by: "wco_authenticated",
          });

        if (!insertError) {
          newDocuments++;
        }
      }
    }

    console.log(`Stored ${newDocuments} new WCO decisions`);

    return new Response(
      JSON.stringify({
        success: true,
        decisions_found: decisions.length,
        new_documents: newDocuments,
        sample: decisions.slice(0, 3),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("WCO scraper error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
