import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TariffLine {
  national_code: string;
  hs_code_6: string;
  description: string;
  duty_rate: number;
  unit?: string;
}

interface HSCodeEntry {
  code: string;
  code_clean: string;
  description: string;
  level: string;
}

interface PreferentialRate {
  agreement_code: string;
  agreement_name: string;
  hs_code: string;
  preferential_rate: number;
  conditions?: string;
  origin_countries?: string[];
}

interface TradeAgreementMention {
  code: string;
  name: string;
  type: string;
  countries: string[];
  mentioned_benefits?: string[];
}

interface AnalysisResult {
  summary: string;
  key_points: string[];
  hs_codes: HSCodeEntry[];
  tariff_lines: TariffLine[];
  chapter_info?: { number: number; title: string };
  authorities?: string[];
  trade_agreements?: TradeAgreementMention[];
  preferential_rates?: PreferentialRate[];
}

// Helper function to delay execution
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function analyzeWithClaude(
  base64Pdf: string,
  title: string,
  category: string,
  apiKey: string,
  maxLines: number,
  retryCount = 0
): Promise<{ result: AnalysisResult | null; truncated: boolean; rateLimited: boolean }> {
  
  const MAX_RETRIES = 5;
  const BASE_DELAY = 10000; // 10 seconds base delay for more patience
  
  const analysisPrompt = `Tu es un expert en tarifs douaniers marocains. Analyse ce document PDF avec PRÉCISION.

Document : ${title}
Catégorie : ${category}

=== STRUCTURE EXACTE DU TABLEAU MAROCAIN ===

La colonne CODIFICATION contient jusqu'à 5 sous-colonnes de chiffres :
- Colonnes 1-2 : Position SH (format "XX.XX", ex: "04.01")
- Colonne 3 : Sous-position (2 chiffres, ex: "10")  
- Colonnes 4-5 : Code national (4 chiffres, souvent "XX 00" ou "XX XX")

Autres colonnes :
- DÉSIGNATION DES PRODUITS : Description du produit
- DROIT D'IMPORTATION : Taux DDI en % 
- UNITÉ DE QUANTITÉ NORMALISÉE : Unité (KG, L, U, etc.)

=== RÈGLE CRITIQUE : HÉRITAGE COLONNE PAR COLONNE ===

CHAQUE LIGNE hérite les chiffres des colonnes VIDES de la ligne précédente.
Tu dois MÉMORISER l'état de chaque colonne et le PROPAGER.

EXEMPLE RÉEL DU TARIF :
| Col1-2  | Col3 | Col4 | Col5 | Description                           | DDI | Unité |
|---------|------|------|------|---------------------------------------|-----|-------|
| 04.01   |      |      |      | Lait et crème de lait...              |     |       |
|         | 10   | 00   |      | - Teneur matières grasses ≤1%         |     |       |
|         |      | 11   | 00   | --- lait écrémé                       | 100 | KG    |
|         |      | 19   | 00   | --- autres                            | 100 | KG    |
|         |      | 20   | 00   | --- conservés en boîtes...            | 100 | KG    |
|         | 20   | 00   |      | - Teneur matières grasses 1%-6%       |     |       |
|         |      | 11   | 00   | --- lait complet                      | 100 | KG    |

RECONSTRUCTION ÉTAPE PAR ÉTAPE :
1. "04.01" → Mémorise: Col1-2="0401"
2. "10 00" → Mémorise: Col3="10", Col4="00" → Préfixe="040110"  
3. "11 00" sous description → Col4="11", Col5="00" → Code="0401101100"
4. "19 00" sous description → Col4="19", Col5="00" → Code="0401101900"
5. "20 00" sous parent → Col3="20", Col4="00" → Nouveau préfixe="040120"
6. "11 00" sous ce parent → Col4="11", Col5="00" → Code="0401201100"

=== EXTRACTION HS_CODES (6 chiffres) ===
Chaque sous-position visible (quand Col3 change) :
- code: format "XXXX.XX" (ex: "0401.10")
- code_clean: 6 chiffres SANS points (ex: "040110")
- description: texte SANS tirets de début
- level: "subheading"

=== EXTRACTION TARIFF_LINES (10 chiffres) ===
Chaque ligne AVEC taux DDI :
- national_code: 10 chiffres par héritage (Col1-2 + Col3 + Col4 + Col5)
- hs_code_6: 6 premiers chiffres du national_code
- description: texte de Désignation des Produits
- duty_rate: nombre (ex: 100, 50, 2.5)
- unit: unité normalisée (ex: "KG")

=== EXTRACTION ACCORDS COMMERCIAUX ===
Identifier TOUS les accords commerciaux mentionnés :
- Accord Maroc-UE (ALE), AELE, AGADIR, USA-Maroc, Turquie, etc.
- Zones de libre-échange (ZLECA, CEDEAO, etc.)
- Accords bilatéraux ou multilatéraux

Pour chaque accord trouvé, extraire :
- code: code court (ex: "MA-EU", "AGADIR", "MA-US")
- name: nom complet de l'accord
- type: "bilateral" | "multilateral" | "regional"  
- countries: liste des pays concernés
- mentioned_benefits: avantages mentionnés (ex: "exonération totale", "réduction 50%")

=== EXTRACTION TAUX PRÉFÉRENTIELS ===
Si le document mentionne des taux préférentiels (différents du DDI normal) :
- agreement_code: code de l'accord (ex: "MA-EU")
- agreement_name: nom de l'accord
- hs_code: code SH concerné (6 ou 10 chiffres)
- preferential_rate: taux préférentiel en %
- conditions: conditions d'application (règles d'origine, contingent, etc.)
- origin_countries: pays d'origine éligibles

=== VALIDATION STRICTE ===
✓ national_code = EXACTEMENT 10 chiffres numériques
✓ hs_code_6 = 6 premiers chiffres du national_code  
✓ Ignorer lignes SANS taux DDI
✓ Maximum ${maxLines} tariff_lines
✓ Extraire TOUTES les hs_codes à 6 chiffres
✓ Extraire TOUS les accords commerciaux mentionnés

Réponds UNIQUEMENT avec ce JSON valide :
{
  "summary": "Résumé du chapitre",
  "key_points": ["Note 1", "Note 2"],
  "hs_codes": [
    {"code": "0401.10", "code_clean": "040110", "description": "Teneur matières grasses ≤1%", "level": "subheading"}
  ],
  "tariff_lines": [
    {"national_code": "0401101100", "hs_code_6": "040110", "description": "lait écrémé", "duty_rate": 100, "unit": "KG"}
  ],
  "chapter_info": {"number": 4, "title": "Lait et produits de la laiterie..."},
  "trade_agreements": [
    {"code": "MA-EU", "name": "Accord d'association Maroc-UE", "type": "bilateral", "countries": ["Maroc", "Union Européenne"], "mentioned_benefits": ["exonération droits de douane"]}
  ],
  "preferential_rates": [
    {"agreement_code": "MA-EU", "agreement_name": "Accord Maroc-UE", "hs_code": "040110", "preferential_rate": 0, "conditions": "Origine UE avec EUR.1", "origin_countries": ["France", "Allemagne", "Espagne"]}
  ]
}`;

  // Call Claude API (Anthropic)
  const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: analysisPrompt },
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64Pdf,
              }
            }
          ]
        }
      ],
    }),
  });

  // Handle rate limiting with retry
  if (aiResponse.status === 429) {
    if (retryCount < MAX_RETRIES) {
      const delayMs = BASE_DELAY * Math.pow(2, retryCount); // Exponential backoff
      console.log(`Rate limited (429). Retry ${retryCount + 1}/${MAX_RETRIES} after ${delayMs}ms...`);
      await delay(delayMs);
      return analyzeWithClaude(base64Pdf, title, category, apiKey, maxLines, retryCount + 1);
    } else {
      console.error("Max retries reached for rate limiting");
      return { result: null, truncated: false, rateLimited: true };
    }
  }

  if (!aiResponse.ok) {
    const errorText = await aiResponse.text();
    console.error("Claude API error:", aiResponse.status, errorText);
    throw new Error(`Claude API error: ${aiResponse.status}`);
  }

  const aiData = await aiResponse.json();
  const stopReason = aiData.stop_reason;
  const truncated = stopReason === "max_tokens";
  
  console.log("Claude response - stop_reason:", stopReason, "truncated:", truncated);
  
  const responseText = aiData.content?.[0]?.text || "{}";
  
  // Parse AI response - extract JSON from anywhere in the response
  let cleanedResponse = responseText.trim();
  
  // Remove markdown code blocks
  if (cleanedResponse.includes("```json")) {
    const jsonStart = cleanedResponse.indexOf("```json") + 7;
    const jsonEnd = cleanedResponse.indexOf("```", jsonStart);
    if (jsonEnd > jsonStart) {
      cleanedResponse = cleanedResponse.slice(jsonStart, jsonEnd).trim();
    }
  } else if (cleanedResponse.includes("```")) {
    const jsonStart = cleanedResponse.indexOf("```") + 3;
    const jsonEnd = cleanedResponse.indexOf("```", jsonStart);
    if (jsonEnd > jsonStart) {
      cleanedResponse = cleanedResponse.slice(jsonStart, jsonEnd).trim();
    }
  }
  
  // If still not valid JSON, try to extract JSON object from the text
  if (!cleanedResponse.startsWith("{")) {
    const jsonMatch = responseText.match(/\{[\s\S]*"summary"[\s\S]*\}/);
    if (jsonMatch) {
      cleanedResponse = jsonMatch[0];
    }
  }
  
  // Try to parse, with fallback repair for truncated JSON
  const parseJsonWithRepair = (text: string): AnalysisResult | null => {
    try {
      return JSON.parse(text) as AnalysisResult;
    } catch (e) {
      // Try to repair truncated JSON by closing brackets
      let repaired = text;
      const openBraces = (text.match(/\{/g) || []).length;
      const closeBraces = (text.match(/\}/g) || []).length;
      const openBrackets = (text.match(/\[/g) || []).length;
      const closeBrackets = (text.match(/\]/g) || []).length;
      
      // Close unclosed brackets and braces
      for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += "]";
      for (let i = 0; i < openBraces - closeBraces; i++) repaired += "}";
      
      try {
        return JSON.parse(repaired) as AnalysisResult;
      } catch {
        return null;
      }
    }
  };
  
  const result = parseJsonWithRepair(cleanedResponse);
  
  if (result) {
    // Validate and fix national codes
    if (result.tariff_lines) {
      result.tariff_lines = result.tariff_lines
        .map(line => {
          // Remove all non-digit characters
          let code = (line.national_code || "").replace(/\D/g, "");
          // Pad to 10 digits if needed
          if (code.length > 0 && code.length < 10) {
            code = code.padEnd(10, "0");
          }
          return {
            ...line,
            national_code: code,
            hs_code_6: code.substring(0, 6),
          };
        })
        .filter(line => line.national_code.length === 10 && line.duty_rate !== undefined);
    }
    
    console.log("Parsed result:", result.tariff_lines?.length || 0, "tariff lines");
    return { result, truncated, rateLimited: false };
  } else {
    console.error("Failed to parse Claude response");
    console.error("Raw response (first 500):", responseText.substring(0, 500));
    
    // Return a minimal valid result instead of null
    return { 
      result: {
        summary: "Analyse partielle - Le document ne contient pas de données tarifaires structurées",
        key_points: ["Document analysé mais format non-tarifaire détecté"],
        hs_codes: [],
        tariff_lines: [],
      }, 
      truncated, 
      rateLimited: false 
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pdfId, filePath, previewOnly = true } = await req.json();

    if (!pdfId || !filePath) {
      return new Response(
        JSON.stringify({ error: "pdfId and filePath are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Check file size first to prevent memory issues
    const { data: fileList, error: listError } = await supabase.storage
      .from("pdf-documents")
      .list(filePath.split('/').slice(0, -1).join('/') || '', {
        search: filePath.split('/').pop()
      });
    
    const fileInfo = fileList?.find(f => filePath.endsWith(f.name));
    const fileSizeMB = fileInfo?.metadata?.size ? fileInfo.metadata.size / (1024 * 1024) : 0;
    
    // Limit to 25MB - using chunked base64 conversion to manage memory
    const MAX_FILE_SIZE_MB = 25;
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      console.error(`PDF too large: ${fileSizeMB.toFixed(2)}MB (max: ${MAX_FILE_SIZE_MB}MB)`);
      return new Response(
        JSON.stringify({ 
          error: `Le PDF est trop volumineux (${fileSizeMB.toFixed(1)}MB). Limite: ${MAX_FILE_SIZE_MB}MB. Divisez le PDF en sections plus petites.`,
          fileSizeMB: fileSizeMB.toFixed(2)
        }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Download the PDF file
    const { data: pdfData, error: downloadError } = await supabase.storage
      .from("pdf-documents")
      .download(filePath);

    if (downloadError) {
      console.error("Download error:", downloadError);
      throw new Error(`Failed to download PDF: ${downloadError.message}`);
    }

    // Convert PDF to base64 using streaming to reduce memory pressure
    const arrayBuffer = await pdfData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    // Check actual byte size
    const actualSizeMB = bytes.length / (1024 * 1024);
    console.log(`PDF actual size: ${actualSizeMB.toFixed(2)}MB`);
    
    if (actualSizeMB > MAX_FILE_SIZE_MB) {
      return new Response(
        JSON.stringify({ 
          error: `Le PDF est trop volumineux (${actualSizeMB.toFixed(1)}MB). Limite: ${MAX_FILE_SIZE_MB}MB.`,
          fileSizeMB: actualSizeMB.toFixed(2)
        }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Convert to base64 - build binary string first, then encode
    // (Chunking base64 directly creates invalid data due to 3-byte boundary issues)
    let binaryString = '';
    const CHUNK_SIZE = 8192; // 8KB chunks for string building
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const chunk = bytes.slice(i, Math.min(i + CHUNK_SIZE, bytes.length));
      binaryString += String.fromCharCode(...chunk);
    }
    const base64Pdf = btoa(binaryString);

    console.log("PDF converted to base64, size:", base64Pdf.length, "chars");

    // Get PDF document metadata
    const { data: pdfDoc } = await supabase
      .from("pdf_documents")
      .select("title, category, country_code")
      .eq("id", pdfId)
      .single();

    const title = pdfDoc?.title || "Tarif douanier";
    const category = pdfDoc?.category || "tarif";
    const countryCode = pdfDoc?.country_code || "MA";

    // Try with progressively fewer lines if truncated
    const maxLinesToTry = [50, 30, 15];
    let analysisResult: AnalysisResult | null = null;
    
    for (const maxLines of maxLinesToTry) {
      console.log(`Attempting analysis with max ${maxLines} tariff lines...`);
      
      const { result, truncated, rateLimited } = await analyzeWithClaude(
        base64Pdf,
        title,
        category,
        ANTHROPIC_API_KEY,
        maxLines
      );
      
      // If rate limited after all retries, return error to client
      if (rateLimited) {
        return new Response(
          JSON.stringify({ 
            error: "Rate limited by AI service. Please wait a few minutes before retrying.",
            rateLimited: true 
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (result && !truncated) {
        analysisResult = result;
        console.log("Analysis successful with", maxLines, "max lines");
        break;
      } else if (result && truncated) {
        console.log("Response truncated, retrying with fewer lines...");
        // Keep the result in case all attempts fail
        analysisResult = result;
      }
    }
    
    if (!analysisResult) {
      analysisResult = {
        summary: "Analyse en attente de traitement manuel",
        key_points: [],
        hs_codes: [],
        tariff_lines: [],
        authorities: [],
        trade_agreements: [],
        preferential_rates: [],
      };
    }

    console.log("Analysis complete for PDF:", pdfId, 
      "HS codes:", analysisResult.hs_codes?.length || 0,
      "Tariff lines:", analysisResult.tariff_lines?.length || 0,
      "Trade agreements:", analysisResult.trade_agreements?.length || 0,
      "Preferential rates:", analysisResult.preferential_rates?.length || 0,
      "Preview only:", previewOnly
    );

    // In preview mode, just return the data without inserting
    if (previewOnly) {
      return new Response(
        JSON.stringify({
          ...analysisResult,
          pdfId,
          pdfTitle: title,
          countryCode,
          previewOnly: true
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // LEGACY: Direct insertion mode (when previewOnly is false)
    // Save extraction to database
    const { error: insertError } = await supabase
      .from("pdf_extractions")
      .insert({
        pdf_id: pdfId,
        summary: analysisResult.summary,
        key_points: analysisResult.key_points || [],
        mentioned_hs_codes: analysisResult.hs_codes?.map(h => h.code_clean) || [],
        detected_tariff_changes: analysisResult.tariff_lines || [],
        extracted_data: {
          chapter_info: analysisResult.chapter_info || null,
          authorities: analysisResult.authorities || [],
          tariff_lines_count: analysisResult.tariff_lines?.length || 0,
        },
        extraction_model: "claude-sonnet-4-20250514",
        extraction_confidence: 0.90,
      });

    if (insertError) {
      console.error("Insert extraction error:", insertError);
    }

    // INSERT TARIFF LINES INTO country_tariffs TABLE
    if (analysisResult.tariff_lines && analysisResult.tariff_lines.length > 0) {
      const tariffRows = analysisResult.tariff_lines.map(line => ({
        country_code: countryCode,
        hs_code_6: line.hs_code_6,
        national_code: line.national_code,
        description_local: line.description,
        duty_rate: line.duty_rate,
        vat_rate: 20, // Default Morocco VAT
        unit_code: line.unit || null,
        is_active: true,
        source: `PDF: ${title}`,
      }));

      // Upsert to avoid duplicates (update if exists)
      const { error: tariffError } = await supabase
        .from("country_tariffs")
        .upsert(tariffRows, { 
          onConflict: "country_code,national_code",
          ignoreDuplicates: false 
        });

      if (tariffError) {
        console.error("Tariff insert error:", tariffError);
      } else {
        console.log(`Inserted/updated ${tariffRows.length} tariff lines into country_tariffs`);
      }
    }

    // INSERT HS CODES INTO hs_codes TABLE with proper descriptions
    if (analysisResult.hs_codes && analysisResult.hs_codes.length > 0) {
      const chapterNumber = analysisResult.chapter_info?.number || null;
      const chapterTitle = analysisResult.chapter_info?.title || null;
      
      const hsRows = analysisResult.hs_codes.map(hsCode => ({
        code: hsCode.code,
        code_clean: hsCode.code_clean,
        description_fr: hsCode.description,
        chapter_number: chapterNumber || (hsCode.code_clean ? parseInt(hsCode.code_clean.slice(0, 2)) : null),
        chapter_title_fr: chapterTitle,
        is_active: true,
        level: hsCode.level || (hsCode.code_clean?.length === 6 ? "subheading" : "heading"),
        parent_code: hsCode.code_clean?.length === 6 ? hsCode.code_clean.slice(0, 4) : null,
      }));

      const { error: hsError } = await supabase
        .from("hs_codes")
        .upsert(hsRows, { 
          onConflict: "code",
          ignoreDuplicates: false // Update existing records with new descriptions
        });

      if (hsError) {
        console.error("HS codes insert error:", hsError);
      } else {
        console.log(`Inserted/updated ${hsRows.length} HS codes with descriptions into hs_codes table`);
      }
    }

    // Update PDF document with chapter info
    const updateData: Record<string, unknown> = {
      is_verified: true,
      verified_at: new Date().toISOString(),
      related_hs_codes: analysisResult.hs_codes?.map(h => h.code_clean) || [],
    };
    
    if (analysisResult.chapter_info?.number) {
      updateData.keywords = `Chapitre ${analysisResult.chapter_info.number}`;
    }

    await supabase
      .from("pdf_documents")
      .update(updateData)
      .eq("id", pdfId);

    return new Response(
      JSON.stringify(analysisResult),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Analyze PDF error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur d'analyse" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
