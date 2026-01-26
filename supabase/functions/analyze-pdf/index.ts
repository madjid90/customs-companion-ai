import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// =============================================================================
// INTERFACES
// =============================================================================

interface RawTarifLine {
  // Colonnes brutes extraites par Claude
  col1: string;      // Position/Sous-position ou "1" pour héritage
  col2: string;      // Extension 2 chiffres
  col3: string;      // Extension 2 chiffres  
  col4: string;      // Extension 2 chiffres
  col5: string;      // Extension 2 chiffres
  description: string;
  duty_rate: string | number | null;
  unit: string | null;
}

interface TariffLine {
  national_code: string;   // 10 chiffres
  hs_code_6: string;       // 6 premiers chiffres
  description: string;
  duty_rate: number;
  duty_note: string | null;
  unit: string | null;
  is_inherited: boolean;
}

interface HSCodeEntry {
  code: string;           // Format "XXXX.XX"
  code_clean: string;     // 6 chiffres sans points
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
  notes?: {
    legal: string[];
    subposition: string[];
    complementary: string[];
  };
  footnotes?: Record<string, string>;
  authorities?: string[];
  trade_agreements?: TradeAgreementMention[];
  preferential_rates?: PreferentialRate[];
  raw_lines?: RawTarifLine[];  // Pour debug
}

// =============================================================================
// PROMPT CLAUDE OPTIMISÉ V2
// =============================================================================

const getAnalysisPrompt = (title: string, category: string, maxLines: number) => `Tu es un expert en tarifs douaniers marocains. Analyse ce document PDF avec EXTRÊME PRÉCISION.

Document : ${title}
Catégorie : ${category}

=== STRUCTURE EXACTE DU TABLEAU TARIFAIRE MAROCAIN ===

Le tableau possède 5 colonnes de CODIFICATION qui doivent être lues SÉPARÉMENT :

┌─────────────────────────────────────────────────────────────────────────────────────┐
│        CODIFICATION (5 colonnes)       │ Désignation  │ Droit │ Unité QN │ UC     │
├──────────┬──────┬──────┬──────┬────────┼──────────────┼───────┼──────────┼────────┤
│  Col1    │ Col2 │ Col3 │ Col4 │ Col5   │              │       │          │        │
├──────────┼──────┼──────┼──────┼────────┼──────────────┼───────┼──────────┼────────┤
│ 10.01    │      │      │      │        │ Froment...   │       │          │        │
│ 1001.11  │ 00   │      │      │        │ – – De sem   │       │ kg       │ –      │
│ 1        │ 10   │      │      │        │ – – – préb   │ 2,5   │ kg       │ –      │
│ 1        │ 90   │      │      │        │ – – – autr   │ 2,5   │ kg       │ –      │
│ 1001.19  │ 00   │      │      │        │ – – Autres   │       │          │        │
│ 1        │ 10   │      │      │        │ – – – du 1   │170(b) │ kg       │ –      │
│ 1        │ 90   │      │      │        │ – – – du 1   │ 2,5   │ kg       │ –      │
└──────────┴──────┴──────┴──────┴────────┴──────────────┴───────┴──────────┴────────┘

=== RÈGLE CRITIQUE : LE CHIFFRE "1" EN COL1 ===

Quand Col1 contient UNIQUEMENT le chiffre "1" :
→ C'est un MARQUEUR D'HÉRITAGE (pas un code!)
→ Les 6 premiers chiffres viennent de la DERNIÈRE ligne avec un code complet en Col1
→ Col2, Col3, Col4, Col5 complètent pour former le code à 10 chiffres

EXEMPLE DE RECONSTRUCTION :
Ligne: "1001.11 | 00 |  |  |" → Code de base: 100111
Ligne: "1 | 10 |  |  |" → HÉRITAGE 100111 + "10" + "00" = 1001110010
Ligne: "1 | 90 |  |  |" → HÉRITAGE 100111 + "90" + "00" = 1001119000

=== EXTRACTION DEMANDÉE ===

1. NOTES DU CHAPITRE - Extraire intégralement :
   - Notes légales (après "Notes.")
   - Notes de sous-position  
   - Notes complémentaires
   - Notes de bas de page : (a), (b), (c), (f) avec leur texte

2. LIGNES BRUTES - Pour CHAQUE ligne du tableau, extraire :
   - col1: valeur exacte de la colonne 1 (position ou "1")
   - col2: valeur colonne 2 (ou "" si vide)
   - col3: valeur colonne 3 (ou "" si vide)
   - col4: valeur colonne 4 (ou "" si vide)
   - col5: valeur colonne 5 (ou "" si vide)
   - description: texte complet avec les tirets
   - duty_rate: taux ou null (garder les notes comme "170(b)")
   - unit: unité (kg, L, U, etc.)

3. HS_CODES (6 chiffres) :
   - Extraire chaque sous-position unique
   - Format "XXXX.XX" et code_clean "XXXXXX"

4. ACCORDS COMMERCIAUX ET TAUX PRÉFÉRENTIELS

=== FORMAT JSON DE SORTIE ===

{
  "summary": "Résumé du chapitre",
  "key_points": ["Note importante 1", "Note 2"],
  "chapter_info": {"number": 10, "title": "CEREALES"},
  "notes": {
    "legal": ["1. A) Les produits...", "1. B) Le présent..."],
    "subposition": ["1. On considère comme..."],
    "complementary": ["1) comme riz en paille..."]
  },
  "footnotes": {
    "a": "Aux conditions fixées par la réglementation en vigueur.",
    "b": "Ce taux est appliqué à la tranche ≤ 1000 DH/tonne, au-delà = 2,5%",
    "f": "Ce taux est appliqué à la tranche ≤ 1000 DH/tonne, au-delà = 2,5%"
  },
  "raw_lines": [
    {"col1": "10.01", "col2": "", "col3": "", "col4": "", "col5": "", "description": "Froment (blé) et méteil.", "duty_rate": null, "unit": null},
    {"col1": "1001.11", "col2": "00", "col3": "", "col4": "", "col5": "", "description": "– – De semence", "duty_rate": null, "unit": "kg"},
    {"col1": "1", "col2": "10", "col3": "", "col4": "", "col5": "", "description": "– – – prébase et base (a)", "duty_rate": "2,5", "unit": "kg"},
    {"col1": "1", "col2": "90", "col3": "", "col4": "", "col5": "", "description": "– – – autres (a)", "duty_rate": "2,5", "unit": "kg"},
    {"col1": "1001.19", "col2": "00", "col3": "", "col4": "", "col5": "", "description": "– – Autres", "duty_rate": null, "unit": null},
    {"col1": "1", "col2": "10", "col3": "", "col4": "", "col5": "", "description": "– – – du 1er Juin au 31 Juillet", "duty_rate": "170(b)", "unit": "kg"}
  ],
  "hs_codes": [
    {"code": "1001.11", "code_clean": "100111", "description": "De semence", "level": "subheading"},
    {"code": "1001.19", "code_clean": "100119", "description": "Autres", "level": "subheading"}
  ],
  "trade_agreements": [],
  "preferential_rates": []
}

=== RÈGLES STRICTES ===
✓ Extraire TOUTES les lignes, même celles sans taux
✓ Le "1" en col1 est un MARQUEUR, pas un chiffre du code
✓ Préserver les notes (a), (b) etc. dans duty_rate
✓ Maximum ${maxLines} raw_lines avec taux
✓ Les tirets "–" dans description indiquent le niveau hiérarchique

RÉPONDS UNIQUEMENT AVEC LE JSON, RIEN D'AUTRE.`;

// =============================================================================
// FONCTIONS DE TRAITEMENT
// =============================================================================

/**
 * Nettoie un code SH (supprime points, espaces, tirets)
 */
function cleanCode(code: string): string {
  return (code || "").replace(/[.\-\s]/g, "").replace(/^0+(?=\d)/, "");
}

/**
 * Parse le taux de droit et extrait la note
 */
function parseDutyRate(dutyStr: string | number | null): { rate: number | null; note: string | null } {
  if (dutyStr === null || dutyStr === undefined) {
    return { rate: null, note: null };
  }
  
  if (typeof dutyStr === "number") {
    return { rate: dutyStr, note: null };
  }
  
  const str = String(dutyStr).trim();
  if (str === "" || str === "–" || str === "-") {
    return { rate: null, note: null };
  }
  
  // Extraire note entre parenthèses
  const noteMatch = str.match(/\(([a-z])\)/i);
  const note = noteMatch ? noteMatch[1].toLowerCase() : null;
  
  // Extraire le nombre
  const numStr = str.replace(/\([a-z]\)/gi, "").replace(",", ".").trim();
  const rate = parseFloat(numStr);
  
  return {
    rate: isNaN(rate) ? null : rate,
    note,
  };
}

/**
 * Reconstruit les codes SH à partir des lignes brutes avec gestion de l'héritage
 */
function processRawLines(rawLines: RawTarifLine[]): TariffLine[] {
  const results: TariffLine[] = [];
  
  // État de l'héritage - mémorise le dernier code complet à chaque niveau
  let lastPosition: string = "";     // 4 chiffres (position SH, ex: "1001")
  let lastSubheading: string = "";   // 2 chiffres supplémentaires (sous-position, ex: "11" → total "100111")
  let lastCol2: string = "";         // Extension colonne 2
  let lastCol3: string = "";         // Extension colonne 3
  let lastCol4: string = "";         // Extension colonne 4
  let lastCol5: string = "";         // Extension colonne 5
  
  for (const line of rawLines) {
    const col1Raw = (line.col1 || "").trim();
    const col2 = (line.col2 || "").trim();
    const col3 = (line.col3 || "").trim();
    const col4 = (line.col4 || "").trim();
    const col5 = (line.col5 || "").trim();
    
    let nationalCode: string;
    let isInherited = false;
    
    // Nettoyer col1 des points et espaces
    const col1Clean = cleanCode(col1Raw);
    
    // CAS 1: Col1 contient un point → c'est un code SH complet ou partiel
    if (col1Raw.includes(".")) {
      const parts = col1Raw.split(".");
      
      if (parts[0].length === 2 && parts[1]?.length === 2) {
        // Format "XX.XX" → Position à 4 chiffres (chapitre.position)
        lastPosition = cleanCode(col1Raw);
        lastSubheading = "";
        lastCol2 = "";
        lastCol3 = "";
        lastCol4 = "";
        lastCol5 = "";
        
        // Pas de ligne tarifaire pour les positions sans taux
        if (!line.duty_rate) continue;
        
        nationalCode = lastPosition.padEnd(10, "0");
        
      } else if (col1Clean.length >= 6) {
        // Format "XXXX.XX" ou plus → Sous-position à 6+ chiffres
        lastPosition = col1Clean.slice(0, 4);
        lastSubheading = col1Clean.slice(4, 6).padEnd(2, "0");
        
        // Mettre à jour les colonnes d'extension
        lastCol2 = (col2 && /^\d+$/.test(col2)) ? col2.padStart(2, "0") : "";
        lastCol3 = (col3 && /^\d+$/.test(col3)) ? col3.padStart(2, "0") : "";
        lastCol4 = (col4 && /^\d+$/.test(col4)) ? col4.padStart(2, "0") : "";
        lastCol5 = (col5 && /^\d+$/.test(col5)) ? col5.padStart(2, "0") : "";
        
        // Construire le code national
        let code = lastPosition + lastSubheading;
        code += lastCol2 || "00";
        code += lastCol3 || "00";
        nationalCode = code.slice(0, 10);
        
      } else {
        // Autre format avec point - traiter comme position
        lastPosition = col1Clean.padEnd(4, "0").slice(0, 4);
        lastSubheading = "";
        if (!line.duty_rate) continue;
        nationalCode = lastPosition.padEnd(10, "0");
      }
      
    // CAS 2: Col1 = "1" ou col1 est vide/tiret → HÉRITAGE du niveau précédent
    } else if (col1Clean === "1" || col1Clean === "" || col1Raw === "–" || col1Raw === "-") {
      isInherited = true;
      
      // La base est toujours position + sous-position (6 chiffres)
      let baseCode = lastPosition + (lastSubheading || "00");
      
      // Appliquer les colonnes de la ligne courante, sinon hériter
      // IMPORTANT: col2 de cette ligne REMPLACE lastCol2 si présent
      if (col2 && /^\d+$/.test(col2)) {
        lastCol2 = col2.padStart(2, "0");
      }
      if (col3 && /^\d+$/.test(col3)) {
        lastCol3 = col3.padStart(2, "0");
      }
      if (col4 && /^\d+$/.test(col4)) {
        lastCol4 = col4.padStart(2, "0");
      }
      if (col5 && /^\d+$/.test(col5)) {
        lastCol5 = col5.padStart(2, "0");
      }
      
      // Construire le code: base + col2 + col3 (10 chiffres au total)
      let code = baseCode;
      code += lastCol2 || "00";
      code += lastCol3 || "00";
      nationalCode = code.slice(0, 10);
      
    // CAS 3: Col1 contient uniquement des chiffres (6 ou plus) → Code complet sans point
    } else if (/^\d{4,}$/.test(col1Clean)) {
      // Ex: "100111" au lieu de "1001.11"
      lastPosition = col1Clean.slice(0, 4);
      lastSubheading = col1Clean.length >= 6 ? col1Clean.slice(4, 6) : "";
      
      lastCol2 = (col2 && /^\d+$/.test(col2)) ? col2.padStart(2, "0") : "";
      lastCol3 = (col3 && /^\d+$/.test(col3)) ? col3.padStart(2, "0") : "";
      lastCol4 = (col4 && /^\d+$/.test(col4)) ? col4.padStart(2, "0") : "";
      lastCol5 = (col5 && /^\d+$/.test(col5)) ? col5.padStart(2, "0") : "";
      
      let code = lastPosition + (lastSubheading || "00");
      code += lastCol2 || "00";
      code += lastCol3 || "00";
      nationalCode = code.slice(0, 10);
      
    // CAS 4: Autre valeur non reconnue → ignorer
    } else {
      console.log(`Ignoring unrecognized col1 format: "${col1Raw}"`);
      continue;
    }
    
    // Parser le taux
    const { rate, note } = parseDutyRate(line.duty_rate);
    
    // Ne garder que les lignes avec un taux valide
    if (rate === null) continue;
    
    // Validation: le code doit avoir exactement 10 chiffres
    const cleanNationalCode = cleanCode(nationalCode).padEnd(10, "0");
    if (cleanNationalCode.length !== 10 || !/^\d{10}$/.test(cleanNationalCode)) {
      console.warn(`Invalid national code: ${nationalCode} (cleaned: ${cleanNationalCode}) from col1="${col1Raw}"`);
      continue;
    }
    
    results.push({
      national_code: cleanNationalCode,
      hs_code_6: cleanNationalCode.slice(0, 6),
      description: (line.description || "").replace(/^[–\-\s]+/, "").trim(),
      duty_rate: rate,
      duty_note: note,
      unit: line.unit || null,
      is_inherited: isInherited,
    });
  }
  
  return results;
}

/**
 * Extrait les codes HS à 6 chiffres uniques
 */
function extractHSCodes(tariffLines: TariffLine[], rawLines: RawTarifLine[]): HSCodeEntry[] {
  const seen = new Set<string>();
  const results: HSCodeEntry[] = [];
  
  // D'abord depuis les lignes tarifaires
  for (const line of tariffLines) {
    const code6 = line.hs_code_6;
    if (code6 && code6.length === 6 && !seen.has(code6)) {
      seen.add(code6);
      results.push({
        code: `${code6.slice(0, 4)}.${code6.slice(4, 6)}`,
        code_clean: code6,
        description: line.description,
        level: "subheading",
      });
    }
  }
  
  // Ensuite depuis les lignes brutes (pour capter les codes sans taux)
  let lastCode6 = "";
  for (const line of rawLines) {
    const col1 = (line.col1 || "").trim();
    
    if (col1.includes(".") && col1 !== "1") {
      const clean = cleanCode(col1);
      if (clean.length >= 6) {
        const code6 = clean.slice(0, 6);
        if (!seen.has(code6)) {
          seen.add(code6);
          results.push({
            code: `${code6.slice(0, 4)}.${code6.slice(4, 6)}`,
            code_clean: code6,
            description: (line.description || "").replace(/^[–\-\s]+/, "").trim(),
            level: "subheading",
          });
        }
        lastCode6 = code6;
      } else if (clean.length === 4) {
        // C'est un heading (position à 4 chiffres)
        lastCode6 = clean.padEnd(6, "0");
      }
    }
  }
  
  return results;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// =============================================================================
// APPEL CLAUDE API
// =============================================================================

async function analyzeWithClaude(
  base64Pdf: string,
  title: string,
  category: string,
  apiKey: string,
  maxLines: number,
  retryCount = 0
): Promise<{ result: AnalysisResult | null; truncated: boolean; rateLimited: boolean }> {
  
  const MAX_RETRIES = 5;
  const BASE_DELAY = 10000;
  
  const prompt = getAnalysisPrompt(title, category, maxLines);

  const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 32000,  // Augmenté pour avoir plus de marge
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
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

  // Handle rate limiting
  if (aiResponse.status === 429) {
    if (retryCount < MAX_RETRIES) {
      const delayMs = BASE_DELAY * Math.pow(2, retryCount);
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
  
  // Parse JSON
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
  
  // Extract JSON object
  if (!cleanedResponse.startsWith("{")) {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanedResponse = jsonMatch[0];
    }
  }
  
  // Parse with repair for truncated JSON
  const parseJsonWithRepair = (text: string): any | null => {
    try {
      return JSON.parse(text);
    } catch (e) {
      let repaired = text;
      const openBraces = (text.match(/\{/g) || []).length;
      const closeBraces = (text.match(/\}/g) || []).length;
      const openBrackets = (text.match(/\[/g) || []).length;
      const closeBrackets = (text.match(/\]/g) || []).length;
      
      for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += "]";
      for (let i = 0; i < openBraces - closeBraces; i++) repaired += "}";
      
      try {
        return JSON.parse(repaired);
      } catch {
        return null;
      }
    }
  };
  
  const parsed = parseJsonWithRepair(cleanedResponse);
  
  if (!parsed) {
    console.error("Failed to parse Claude response");
    console.error("Raw response (first 1000):", responseText.substring(0, 1000));
    return { 
      result: {
        summary: "Analyse échouée - Impossible de parser la réponse",
        key_points: [],
        hs_codes: [],
        tariff_lines: [],
      }, 
      truncated, 
      rateLimited: false 
    };
  }
  
  // POST-TRAITEMENT: Reconstruire les codes à partir des raw_lines
  let tariffLines: TariffLine[] = [];
  let hsCodeEntries: HSCodeEntry[] = [];
  
  if (parsed.raw_lines && Array.isArray(parsed.raw_lines)) {
    console.log(`Processing ${parsed.raw_lines.length} raw lines with inheritance...`);
    
    // Reconstruire avec l'héritage
    tariffLines = processRawLines(parsed.raw_lines);
    hsCodeEntries = extractHSCodes(tariffLines, parsed.raw_lines);
    
    console.log(`Reconstructed ${tariffLines.length} tariff lines and ${hsCodeEntries.length} HS codes`);
  } else if (parsed.tariff_lines) {
    // Fallback: utiliser tariff_lines si raw_lines n'est pas présent
    tariffLines = (parsed.tariff_lines as any[])
      .map(line => {
        const { rate, note } = parseDutyRate(line.duty_rate);
        let code = cleanCode(line.national_code || "");
        if (code.length > 0 && code.length < 10) {
          code = code.padEnd(10, "0");
        }
        return {
          national_code: code,
          hs_code_6: code.slice(0, 6),
          description: line.description || "",
          duty_rate: rate || 0,
          duty_note: note,
          unit: line.unit || null,
          is_inherited: false,
        };
      })
      .filter(line => line.national_code.length === 10 && line.duty_rate > 0);
    
    hsCodeEntries = parsed.hs_codes || [];
  }
  
  const result: AnalysisResult = {
    summary: parsed.summary || "",
    key_points: parsed.key_points || [],
    chapter_info: parsed.chapter_info,
    notes: parsed.notes,
    footnotes: parsed.footnotes,
    hs_codes: hsCodeEntries,
    tariff_lines: tariffLines,
    trade_agreements: parsed.trade_agreements || [],
    preferential_rates: parsed.preferential_rates || [],
    raw_lines: parsed.raw_lines,  // Garder pour debug
  };
  
  console.log("Final result:", 
    "tariff_lines:", result.tariff_lines.length,
    "hs_codes:", result.hs_codes.length,
    "inherited:", result.tariff_lines.filter(l => l.is_inherited).length
  );
  
  return { result, truncated, rateLimited: false };
}

// =============================================================================
// HANDLER PRINCIPAL
// =============================================================================

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

    // Check file size
    const { data: fileList } = await supabase.storage
      .from("pdf-documents")
      .list(filePath.split('/').slice(0, -1).join('/') || '', {
        search: filePath.split('/').pop()
      });
    
    const fileInfo = fileList?.find(f => filePath.endsWith(f.name));
    const fileSizeMB = fileInfo?.metadata?.size ? fileInfo.metadata.size / (1024 * 1024) : 0;
    
    const MAX_FILE_SIZE_MB = 25;
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      return new Response(
        JSON.stringify({ 
          error: `Le PDF est trop volumineux (${fileSizeMB.toFixed(1)}MB). Limite: ${MAX_FILE_SIZE_MB}MB.`,
          fileSizeMB: fileSizeMB.toFixed(2)
        }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Download PDF
    const { data: pdfData, error: downloadError } = await supabase.storage
      .from("pdf-documents")
      .download(filePath);

    if (downloadError) {
      throw new Error(`Failed to download PDF: ${downloadError.message}`);
    }

    // Convert to base64
    const arrayBuffer = await pdfData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    
    let binaryString = '';
    const CHUNK_SIZE = 8192;
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const chunk = bytes.slice(i, Math.min(i + CHUNK_SIZE, bytes.length));
      binaryString += String.fromCharCode(...chunk);
    }
    const base64Pdf = btoa(binaryString);

    console.log("PDF converted to base64, size:", base64Pdf.length, "chars");

    // Get PDF metadata
    const { data: pdfDoc } = await supabase
      .from("pdf_documents")
      .select("title, category, country_code")
      .eq("id", pdfId)
      .single();

    const title = pdfDoc?.title || "Tarif douanier";
    const category = pdfDoc?.category || "tarif";
    const countryCode = pdfDoc?.country_code || "MA";

    // Analyze with Claude
    const maxLinesToTry = [100, 50, 30];
    let analysisResult: AnalysisResult | null = null;
    
    for (const maxLines of maxLinesToTry) {
      console.log(`Attempting analysis with max ${maxLines} lines...`);
      
      const { result, truncated, rateLimited } = await analyzeWithClaude(
        base64Pdf, title, category, ANTHROPIC_API_KEY, maxLines
      );
      
      if (rateLimited) {
        return new Response(
          JSON.stringify({ error: "Rate limited. Please wait before retrying.", rateLimited: true }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      
      if (result && !truncated) {
        analysisResult = result;
        break;
      } else if (result) {
        analysisResult = result;
      }
    }
    
    if (!analysisResult) {
      analysisResult = {
        summary: "Analyse en attente de traitement manuel",
        key_points: [],
        hs_codes: [],
        tariff_lines: [],
      };
    }

    console.log("Analysis complete:", 
      "HS codes:", analysisResult.hs_codes?.length || 0,
      "Tariff lines:", analysisResult.tariff_lines?.length || 0,
      "Preview only:", previewOnly
    );

    // Preview mode
    if (previewOnly) {
      return new Response(
        JSON.stringify({
          ...analysisResult,
          pdfId,
          pdfTitle: title,
          countryCode,
          previewOnly: true,
          statistics: {
            total_lines: analysisResult.tariff_lines?.length || 0,
            inherited_lines: analysisResult.tariff_lines?.filter(l => l.is_inherited).length || 0,
            hs_codes_count: analysisResult.hs_codes?.length || 0,
            has_footnotes: Object.keys(analysisResult.footnotes || {}).length > 0,
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // === INSERTION EN BASE ===
    
    // 1. Save extraction
    await supabase.from("pdf_extractions").insert({
      pdf_id: pdfId,
      summary: analysisResult.summary,
      key_points: analysisResult.key_points || [],
      mentioned_hs_codes: analysisResult.hs_codes?.map(h => h.code_clean) || [],
      detected_tariff_changes: analysisResult.tariff_lines || [],
      extracted_data: {
        chapter_info: analysisResult.chapter_info || null,
        notes: analysisResult.notes || null,
        footnotes: analysisResult.footnotes || null,
        tariff_lines_count: analysisResult.tariff_lines?.length || 0,
        inherited_lines_count: analysisResult.tariff_lines?.filter(l => l.is_inherited).length || 0,
      },
      extraction_model: "claude-sonnet-4-20250514",
      extraction_confidence: 0.92,
    });

    // 2. Insert tariff lines
    if (analysisResult.tariff_lines && analysisResult.tariff_lines.length > 0) {
      const tariffRows = analysisResult.tariff_lines.map(line => ({
        country_code: countryCode,
        hs_code_6: line.hs_code_6,
        national_code: line.national_code,
        description_local: line.description,
        duty_rate: line.duty_rate,
        duty_note: line.duty_note,
        vat_rate: 20,
        unit_code: line.unit || null,
        is_active: true,
        is_inherited: line.is_inherited,
        source: `PDF: ${title}`,
      }));

      const { error: tariffError } = await supabase
        .from("country_tariffs")
        .upsert(tariffRows, { onConflict: "country_code,national_code" });

      if (tariffError) {
        console.error("Tariff insert error:", tariffError);
      } else {
        console.log(`Inserted ${tariffRows.length} tariff lines`);
      }
    }

    // 3. Insert HS codes
    if (analysisResult.hs_codes && analysisResult.hs_codes.length > 0) {
      const hsRows = analysisResult.hs_codes.map(hsCode => ({
        code: hsCode.code,
        code_clean: hsCode.code_clean,
        description_fr: hsCode.description,
        chapter_number: analysisResult.chapter_info?.number || parseInt(hsCode.code_clean?.slice(0, 2) || "0"),
        chapter_title_fr: analysisResult.chapter_info?.title,
        is_active: true,
        level: hsCode.level || "subheading",
        parent_code: hsCode.code_clean?.slice(0, 4),
      }));

      const { error: hsError } = await supabase
        .from("hs_codes")
        .upsert(hsRows, { onConflict: "code" });

      if (hsError) {
        console.error("HS codes insert error:", hsError);
      } else {
        console.log(`Inserted ${hsRows.length} HS codes`);
      }
    }

    // 4. Update PDF document
    await supabase.from("pdf_documents").update({
      is_verified: true,
      verified_at: new Date().toISOString(),
      related_hs_codes: analysisResult.hs_codes?.map(h => h.code_clean) || [],
      keywords: analysisResult.chapter_info?.number ? `Chapitre ${analysisResult.chapter_info.number}` : null,
    }).eq("id", pdfId);

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
