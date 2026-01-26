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

// Parse WCO Trade Tools page to extract decisions
function parseDecisions(html: string, baseUrl: string): WCODecision[] {
  const decisions: WCODecision[] = [];
  
  // Look for table rows or list items containing decision data
  // WCO Trade Tools typically uses tables for decisions
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const rowContent = rowMatch[1];
    const cells: string[] = [];
    
    let cellMatch;
    const cellRegexLocal = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    while ((cellMatch = cellRegexLocal.exec(rowContent)) !== null) {
      // Strip HTML tags and decode entities
      let cellText = cellMatch[1]
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
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
    
    // If we have enough cells that look like decision data
    if (cells.length >= 3) {
      // Try to identify HS code pattern (4-10 digits with possible dots)
      const hsCodePattern = /\b(\d{4}(?:\.\d{2})?(?:\.\d{2})?)\b/;
      let hsCode = '';
      for (const cell of cells) {
        const match = hsCodePattern.exec(cell);
        if (match) {
          hsCode = match[1].replace(/\./g, '');
          break;
        }
      }
      
      // Try to identify date pattern
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

    // Step 1: Get login page to find CSRF token or session cookie
    const loginPageUrl = "https://www.wcotradetools.org/en/user/login";
    const loginPageResponse = await fetch(loginPageUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!loginPageResponse.ok) {
      throw new Error(`Failed to load login page: ${loginPageResponse.status}`);
    }

    // Get cookies from login page
    const cookies = loginPageResponse.headers.get("set-cookie") || "";
    const loginPageHtml = await loginPageResponse.text();

    // Extract CSRF token (Drupal typically uses form_build_id and form_token)
    const formBuildIdMatch = loginPageHtml.match(/name="form_build_id"\s+value="([^"]+)"/);
    const formTokenMatch = loginPageHtml.match(/name="form_token"\s+value="([^"]+)"/);
    const formIdMatch = loginPageHtml.match(/name="form_id"\s+value="([^"]+)"/);

    const formBuildId = formBuildIdMatch?.[1] || "";
    const formToken = formTokenMatch?.[1] || "";
    const formId = formIdMatch?.[1] || "user_login_form";

    console.log("Found form tokens, attempting login...");

    // Step 2: Submit login form
    const loginFormData = new URLSearchParams();
    loginFormData.append("name", WCO_USERNAME);
    loginFormData.append("pass", WCO_PASSWORD);
    loginFormData.append("form_build_id", formBuildId);
    if (formToken) loginFormData.append("form_token", formToken);
    loginFormData.append("form_id", formId);
    loginFormData.append("op", "Log in");

    const loginResponse = await fetch(loginPageUrl, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Cookie": cookies,
        "Referer": loginPageUrl,
      },
      body: loginFormData.toString(),
      redirect: "manual",
    });

    // Collect all cookies from login response
    const loginCookies = loginResponse.headers.get("set-cookie") || "";
    const allCookies = [cookies, loginCookies].filter(Boolean).join("; ");

    // Check if login was successful (usually redirects to user page or home)
    const loginSuccess = loginResponse.status === 302 || loginResponse.status === 303;
    
    if (!loginSuccess && loginResponse.status !== 200) {
      console.error("Login failed with status:", loginResponse.status);
      return new Response(
        JSON.stringify({ 
          error: "Login failed", 
          status: loginResponse.status,
          message: "Check your WCO credentials"
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Login successful, fetching decisions page...");

    // Step 3: Fetch the target page with authenticated session
    const decisionsResponse = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Cookie": allCookies,
        "Referer": "https://www.wcotradetools.org/",
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
      // Check if already exists
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
