// ============================================================================
// ANALYSE DE QUESTION ET DOCUMENTS (PDF/Images)
// ============================================================================

import { cleanHSCode } from "./hs-utils.ts";
import { 
  DUMData, 
  DUMAnalysisResult, 
  detectDUMDocument, 
  getDUMExtractionPrompt,
  parseDUMFromAIResponse,
  verifyDUMCompliance,
  formatDUMAnalysisForChat 
} from "./dum-analyzer.ts";

// ============================================================================
// TYPES
// ============================================================================

export interface QuestionAnalysis {
  detectedCodes: string[];
  intent: string;
  keywords: string[];
  country: string;
}

export interface ImageInput {
  type: "image";
  base64: string;
  mediaType: string;
}

export interface PdfInput {
  type: "pdf";
  base64: string;
  fileName: string;
}

export interface ImageAnalysisResult {
  productDescription: string;
  suggestedCodes: string[];
  questions: string[];
}

export interface PdfAnalysisResult {
  summary: string;
  extractedInfo: string;
  suggestedCodes: string[];
  fullContent: string;
  isDUM?: boolean;
  dumAnalysis?: DUMAnalysisResult;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const LOVABLE_AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const CLAUDE_PDF_API_URL = "https://api.anthropic.com/v1/messages";

// ============================================================================
// ANALYSE DE QUESTION
// ============================================================================

/**
 * Analyse une question pour extraire l'intention, les codes et les mots-clés
 */
export interface QuestionAnalysisV2 extends QuestionAnalysis {
  intents: string[]; // Multi-intent support
  primaryIntent: string;
}

/**
 * Analyse une question pour extraire l'intention, les codes et les mots-clés
 * V2: Support multi-intent + regex arabes
 */
export function analyzeQuestion(question: string): QuestionAnalysisV2 {
  const lowerQ = question.toLowerCase();
  
  // Detect HS codes (various formats)
  const hsPattern = /\b(\d{2}[\.\s]?\d{2}[\.\s]?\d{0,2}[\.\s]?\d{0,2})\b/g;
  const detectedCodes = [...question.matchAll(hsPattern)]
    .map(m => m[1].replace(/[\.\s]/g, ''))
    .filter(c => c.length >= 4);
  
  // Multi-intent detection (French + Arabic)
  const intents: string[] = [];
  
  // Classification intent (FR + AR)
  if (/class|code|position|nomenclature|sh\s/i.test(lowerQ) ||
      /(?:رمز|تصنيف|بند|موقع)\s*(?:جمركي|تعريف)/i.test(question)) {
    intents.push('classify');
  }
  
  // Calculate intent (FR + AR: رسوم = rusūm/duties, ضريبة = ḍarība/tax, مبلغ = mablaġ/amount)
  if (/droit|ddi|tva|tax|payer|combien|calcul|coût|prix/i.test(lowerQ) ||
      /(?:رسوم|ضريبة|مبلغ|كم|حساب|تكلفة|ثمن)/i.test(question)) {
    intents.push('calculate');
  }
  
  // Origin intent (FR + AR: منشأ = manšaʾ/origin, شهادة = šahāda/certificate)
  if (/origine|eur\.?1|préférentiel|accord|certificat/i.test(lowerQ) ||
      /(?:منشأ|شهادة|تفضيلي|اتفاقية)/i.test(question)) {
    intents.push('origin');
  }
  
  // Control intent (FR + AR: ممنوع = mamnūʿ/forbidden, رخصة = ruḫṣa/license)
  if (/contrôl|interdit|autoris|mcinet|onssa|anrt|permis|licence/i.test(lowerQ) ||
      /(?:ممنوع|مراقب|رخصة|ترخيص|محظور|مقيد)/i.test(question)) {
    intents.push('control');
  }
  
  // Procedure intent (FR + AR: إجراء = ʾijrāʾ/procedure, وثيقة = waṯīqa/document)
  if (/document|formalité|procédure|étape/i.test(lowerQ) ||
      /(?:إجراء|إجراءات|وثيقة|مستند|خطوة|كيف)/i.test(question)) {
    intents.push('procedure');
  }
  
  // Legal intent (FR + AR: مادة = mādda/article, قانون = qānūn/law)
  if (/article|loi|circulaire|réglementation|obligation|infraction|sanction/i.test(lowerQ) ||
      /(?:مادة|قانون|دورية|منشور|عقوبة|مخالفة)/i.test(question)) {
    intents.push('legal');
  }
  
  // Default to 'info' if no intent detected
  if (intents.length === 0) intents.push('info');
  
  // Primary intent is the first detected one (priority order above matters)
  const primaryIntent = intents[0];
  
  // Extract meaningful keywords (remove stop words - FR + AR)
  const stopWordsFR = ['le','la','les','un','une','des','pour','sur','est','sont','pas','plus','très',
    'que','quel','quels','quelle','quelles','comment','combien','dans','avec','sans','par','vers','chez',
    'être','avoir','faire','dit','dit','cette','ces','ses','son','qui','dont','aussi','même','tout',
    'peut','fait','été','entre','autre','autres','tous','comme','mais','bien','dois','doit',
    'douane','maroc','marocain','produit','marchandise',
    'code','tarif','droit','importation','classement','position','chapitre'];
  const stopWordsAR = ['هل','ما','من','في','على','إلى','هذا','هذه','ذلك','تلك','التي','الذي','أن','عن'];
  const allStopWords = [...stopWordsFR, ...stopWordsAR];
  
  const keywords = lowerQ
    .replace(/[^\w\sàâäéèêëïîôùûüçأ-ي]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !allStopWords.includes(w));
  
  // Detect country (default to Morocco) - FR + AR
  let country = 'MA';
  if (/sénégal|senegal|السنغال/i.test(question)) country = 'SN';
  else if (/côte d'ivoire|cote d'ivoire|ivoirien|ساحل العاج/i.test(question)) country = 'CI';
  else if (/cameroun|الكاميرون/i.test(question)) country = 'CM';
  
  return { 
    detectedCodes, 
    intent: primaryIntent, 
    keywords, 
    country,
    intents,
    primaryIntent,
  };
}

/**
 * Extrait le contexte de l'historique de conversation
 * Inclut les codes SH, les mots-clés produits et autres infos pertinentes
 */
export function extractHistoryContext(conversationHistory: Array<{ role: string; content: string }> | undefined): { 
  contextString: string; 
  detectedCodes: string[];
  keywords: string[];
} {
  const result = { contextString: "", detectedCodes: [] as string[], keywords: [] as string[] };
  
  if (!conversationHistory || !Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return result;
  }
  
  const recentHistory = conversationHistory.slice(-8);
  const keyPhrases: string[] = [];
  const hsCodes: string[] = [];
  
  for (const msg of recentHistory) {
    const content = msg.content || "";
    
    // Extract HS codes from ALL messages (user and assistant)
    const hsPattern = /\b(\d{2}[\.\s]?\d{2}[\.\s]?\d{0,2}[\.\s]?\d{0,2})\b/g;
    const codeMatches = [...content.matchAll(hsPattern)];
    for (const match of codeMatches) {
      const code = match[1].replace(/[\.\s]/g, '');
      if (code.length >= 4) {
        hsCodes.push(code);
      }
    }
    
    // Also look for formatted codes like "0702.00.00.00"
    const formattedPattern = /\b(\d{4}\.\d{2}\.\d{2}\.\d{2})\b/g;
    const formattedMatches = [...content.matchAll(formattedPattern)];
    for (const match of formattedMatches) {
      const code = match[1].replace(/\./g, '');
      hsCodes.push(code);
    }
    
    if (msg.role === "user") {
      // Extended product patterns including food items
      const productPatterns = [
        // Food items
        /tomate[s]?/gi, /légume[s]?/gi, /fruit[s]?/gi, /pomme[s]?/gi, /orange[s]?/gi,
        /viande[s]?/gi, /poisson[s]?/gi, /céréale[s]?/gi, /riz/gi, /blé/gi,
        /lait/gi, /fromage[s]?/gi, /œuf[s]?|oeuf[s]?/gi, /huile[s]?/gi, /sucre/gi,
        /café/gi, /thé/gi, /chocolat/gi, /biscuit[s]?/gi, /pain[s]?/gi,
        // Industrial products
        /serrure[s]?/gi, /cadenas/gi, /verrou[s]?/gi, /clé[s]?/gi, /fermoir[s]?/gi,
        /téléphone[s]?/gi, /smartphone[s]?/gi, /ordinateur[s]?/gi, /voiture[s]?/gi,
        /machine[s]?/gi, /équipement[s]?/gi, /appareil[s]?/gi,
        /meuble[s]?/gi, /porte[s]?/gi, /fenêtre[s]?/gi, /véhicule[s]?/gi,
        /métaux?\s*commun[s]?/gi, /acier/gi, /fer/gi, /cuivre/gi, /aluminium/gi,
        /électrique[s]?/gi, /électronique[s]?/gi, /mécanique[s]?/gi,
        // Textiles
        /vêtement[s]?/gi, /tissu[s]?/gi, /textile[s]?/gi, /coton/gi, /laine/gi,
        // Chemicals
        /chimique[s]?/gi, /médicament[s]?/gi, /cosmétique[s]?/gi,
      ];
      
      for (const pattern of productPatterns) {
        const matches = content.match(pattern);
        if (matches) {
          keyPhrases.push(...matches);
        }
      }
    }
  }
  
  // Deduplicate and store results
  result.detectedCodes = [...new Set(hsCodes)];
  result.keywords = [...new Set(keyPhrases.map(p => p.toLowerCase()))];
  
  const contextParts: string[] = [];
  if (result.detectedCodes.length > 0) {
    contextParts.push(`CODES SH MENTIONNÉS: ${result.detectedCodes.slice(0, 5).join(", ")}`);
  }
  if (result.keywords.length > 0) {
    contextParts.push(`PRODUITS: ${result.keywords.slice(0, 5).join(", ")}`);
  }
  
  if (contextParts.length > 0) {
    result.contextString = `[CONTEXTE DE CONVERSATION: ${contextParts.join(" | ")}] `;
    console.log("History context extracted:", result.contextString, "codes:", result.detectedCodes);
  }
  
  return result;
}

// ============================================================================
// ANALYSE PDF AVEC CLAUDE
// ============================================================================

/**
 * Analyse des PDFs avec Claude (support natif) - Détecte automatiquement les DUM
 */
export async function analyzePdfWithClaude(
  pdfDocuments: PdfInput[],
  question: string,
  apiKey: string,
  supabase?: any
): Promise<PdfAnalysisResult> {
  const contentBlocks: any[] = [];
  
  for (const pdf of pdfDocuments) {
    contentBlocks.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: pdf.base64,
      },
    });
  }
  
  // Première passe: extraction générale pour détecter le type de document
  const initialPrompt = `Tu es un expert en douane et commerce international. Analyse ce document PDF.

ÉTAPE 1: Identifie d'abord le TYPE de document parmi:
- DUM (Déclaration Unique de Marchandises)
- Facture commerciale
- Certificat d'origine
- Connaissement / BL
- Tarif douanier
- Circulaire / Note administrative
- Autre document

Si c'est une DUM, réponds avec:
{
  "documentType": "DUM",
  "isDUM": true
}

Sinon, extrais les informations avec:
{
  "documentType": "type identifié",
  "isDUM": false,
  "summary": "Résumé structuré du document",
  "fullContent": "EXTRACTION COMPLÈTE de toutes les informations",
  "extractedInfo": "Synthèse structurée des informations clés",
  "suggestedCodes": ["8517.12", "8517.13"]
}

Question de l'utilisateur: "${question}"`;

  contentBlocks.push({ type: "text", text: initialPrompt });

  const PDF_TIMEOUT_MS = 180000;
  const pdfController = new AbortController();
  const pdfTimeoutId = setTimeout(() => pdfController.abort(), PDF_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(CLAUDE_PDF_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 16384,
        messages: [{ role: "user", content: contentBlocks }],
      }),
      signal: pdfController.signal,
    });
  } catch (fetchError: any) {
    clearTimeout(pdfTimeoutId);
    if (fetchError.name === "AbortError") {
      console.error("PDF API timeout after", PDF_TIMEOUT_MS, "ms");
      throw new Error("PDF API timeout");
    }
    throw fetchError;
  }
  clearTimeout(pdfTimeoutId);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Claude PDF API error:", response.status, errorText);
    throw new Error(`Claude PDF API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "{}";
  
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Si c'est une DUM, faire une analyse spécialisée
      if (parsed.isDUM || parsed.documentType === "DUM") {
        console.log("DUM detected, running specialized analysis...");
        return await analyzeDUMDocument(pdfDocuments, question, apiKey, supabase);
      }
      
      return {
        summary: parsed.summary || "Document analysé",
        extractedInfo: parsed.extractedInfo || "",
        fullContent: parsed.fullContent || "",
        suggestedCodes: Array.isArray(parsed.suggestedCodes) ? parsed.suggestedCodes : [],
        isDUM: false,
      };
    }
  } catch (e) {
    console.error("Failed to parse PDF analysis response:", e);
  }

  return {
    summary: text.substring(0, 500),
    extractedInfo: text,
    fullContent: text,
    suggestedCodes: [],
    isDUM: false,
  };
}

/**
 * Analyse spécialisée des documents DUM
 */
async function analyzeDUMDocument(
  pdfDocuments: PdfInput[],
  question: string,
  apiKey: string,
  supabase?: any
): Promise<PdfAnalysisResult> {
  const contentBlocks: any[] = [];
  
  for (const pdf of pdfDocuments) {
    contentBlocks.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: pdf.base64,
      },
    });
  }
  
  // Utiliser le prompt spécialisé DUM
  contentBlocks.push({
    type: "text",
    text: getDUMExtractionPrompt(),
  });

  const PDF_TIMEOUT_MS = 180000;
  const pdfController = new AbortController();
  const pdfTimeoutId = setTimeout(() => pdfController.abort(), PDF_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(CLAUDE_PDF_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 16384,
        messages: [{ role: "user", content: contentBlocks }],
      }),
      signal: pdfController.signal,
    });
  } catch (fetchError: any) {
    clearTimeout(pdfTimeoutId);
    if (fetchError.name === "AbortError") {
      console.error("DUM PDF API timeout after", PDF_TIMEOUT_MS, "ms");
      throw new Error("DUM PDF API timeout");
    }
    throw fetchError;
  }
  clearTimeout(pdfTimeoutId);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Claude DUM API error:", response.status, errorText);
    throw new Error(`Claude DUM API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || "{}";
  
  // Parser les données DUM
  const dumData = parseDUMFromAIResponse(text);
  
  if (dumData && supabase) {
    // Vérifier la conformité
    const verification = await verifyDUMCompliance(supabase, dumData);
    
    const dumAnalysis: DUMAnalysisResult = {
      extracted: dumData,
      verification,
      summary: `DUM ${dumData.dumNumber || "N/A"} - ${dumData.goods.length} article(s) - ${dumData.totals.totalValueMAD.toLocaleString()} MAD`,
    };
    
    // Formater pour le chat
    const formattedResponse = formatDUMAnalysisForChat(dumAnalysis);
    
    return {
      summary: dumAnalysis.summary,
      extractedInfo: formattedResponse,
      fullContent: formattedResponse,
      suggestedCodes: dumData.goods.map(g => g.hsCode),
      isDUM: true,
      dumAnalysis,
    };
  }
  
  // Fallback si pas de données DUM parsées
  return {
    summary: "Document DUM analysé",
    extractedInfo: text,
    fullContent: text,
    suggestedCodes: [],
    isDUM: true,
  };
}

// ============================================================================
// ANALYSE D'IMAGE AVEC LOVABLE AI
// ============================================================================

/**
 * Analyse d'images avec Lovable AI (Gemini Vision)
 */
export async function analyzeImageWithLovableAI(
  images: ImageInput[],
  question: string,
  apiKey: string
): Promise<ImageAnalysisResult> {
  const imageContent = images.map(img => ({
    type: "image_url" as const,
    image_url: {
      url: `data:${img.mediaType};base64,${img.base64}`,
    },
  }));

  const VISION_TIMEOUT_MS = 45000;
  const visionController = new AbortController();
  const visionTimeoutId = setTimeout(() => visionController.abort(), VISION_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(LOVABLE_AI_GATEWAY, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              ...imageContent,
              {
                type: "text",
                text: `Tu es un expert en classification douanière. Analyse cette/ces image(s) pour identifier le produit.

Question de l'utilisateur: "${question}"

Réponds en JSON avec ce format:
{
  "productDescription": "Description détaillée du produit visible",
  "suggestedCodes": ["8517.12", "8517.13"],
  "questions": ["Question pour clarifier si nécessaire"]
}`,
              },
            ],
          },
        ],
      }),
      signal: visionController.signal,
    });
  } catch (fetchError: any) {
    clearTimeout(visionTimeoutId);
    if (fetchError.name === 'AbortError') {
      console.error("Vision API timeout after", VISION_TIMEOUT_MS, "ms");
      throw new Error("Vision API timeout");
    }
    throw fetchError;
  }
  clearTimeout(visionTimeoutId);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Vision API error:", response.status, errorText);
    throw new Error(`Vision API error: ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "{}";
  
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    console.error("Failed to parse vision response:", e);
  }

  return {
    productDescription: text,
    suggestedCodes: [],
    questions: [],
  };
}
