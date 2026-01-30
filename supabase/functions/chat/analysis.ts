// ============================================================================
// ANALYSE DE QUESTION ET DOCUMENTS (PDF/Images)
// ============================================================================

import { cleanHSCode } from "./hs-utils.ts";

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
export function analyzeQuestion(question: string): QuestionAnalysis {
  const lowerQ = question.toLowerCase();
  
  // Detect HS codes (various formats)
  const hsPattern = /\b(\d{2}[\.\s]?\d{2}[\.\s]?\d{0,2}[\.\s]?\d{0,2})\b/g;
  const detectedCodes = [...question.matchAll(hsPattern)]
    .map(m => m[1].replace(/[\.\s]/g, ''))
    .filter(c => c.length >= 4);
  
  // Detect intent
  let intent = 'info';
  if (/class|code|position|nomenclature|sh\s/i.test(lowerQ)) intent = 'classify';
  else if (/droit|ddi|tva|tax|payer|combien|calcul|coût|prix/i.test(lowerQ)) intent = 'calculate';
  else if (/origine|eur\.?1|préférentiel|accord|certificat/i.test(lowerQ)) intent = 'origin';
  else if (/contrôl|interdit|autoris|mcinet|onssa|anrt|permis|licence/i.test(lowerQ)) intent = 'control';
  else if (/document|formalité|procédure|étape/i.test(lowerQ)) intent = 'procedure';
  
  // Extract meaningful keywords (remove stop words)
  const stopWords = ['le','la','les','un','une','des','pour','sur','est','que','quel','quels','quelle',
    'quelles','comment','combien','dans','avec','sans','par','vers','chez','être','avoir','faire',
    'douane','maroc','marocain','produit','marchandise'];
  const keywords = lowerQ
    .replace(/[^\w\sàâäéèêëïîôùûüç]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.includes(w));
  
  // Detect country (default to Morocco)
  let country = 'MA';
  if (/sénégal|senegal/i.test(lowerQ)) country = 'SN';
  else if (/côte d'ivoire|cote d'ivoire|ivoirien/i.test(lowerQ)) country = 'CI';
  else if (/cameroun/i.test(lowerQ)) country = 'CM';
  
  return { detectedCodes, intent, keywords, country };
}

/**
 * Extrait le contexte de l'historique de conversation
 */
export function extractHistoryContext(conversationHistory: Array<{ role: string; content: string }> | undefined): string {
  if (!conversationHistory || !Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return "";
  }
  
  const recentHistory = conversationHistory.slice(-6);
  const keyPhrases: string[] = [];
  
  for (const msg of recentHistory) {
    if (msg.role === "user" && msg.content) {
      const productPatterns = [
        /serrure[s]?/gi, /cadenas/gi, /verrou[s]?/gi, /clé[s]?/gi, /fermoir[s]?/gi,
        /téléphone[s]?/gi, /smartphone[s]?/gi, /ordinateur[s]?/gi, /voiture[s]?/gi,
        /machine[s]?/gi, /équipement[s]?/gi, /appareil[s]?/gi, /produit[s]?/gi,
        /meuble[s]?/gi, /porte[s]?/gi, /fenêtre[s]?/gi, /véhicule[s]?/gi,
        /métaux?\s*commun[s]?/gi, /acier/gi, /fer/gi, /cuivre/gi, /aluminium/gi,
        /électrique[s]?/gi, /électronique[s]?/gi, /mécanique[s]?/gi,
      ];
      
      for (const pattern of productPatterns) {
        const matches = msg.content.match(pattern);
        if (matches) {
          keyPhrases.push(...matches);
        }
      }
    }
  }
  
  if (keyPhrases.length > 0) {
    const uniquePhrases = [...new Set(keyPhrases.map(p => p.toLowerCase()))];
    console.log("History context extracted:", uniquePhrases.join(", "));
    return `[CONTEXTE DE CONVERSATION: ${uniquePhrases.join(", ")}] `;
  }
  
  return "";
}

// ============================================================================
// ANALYSE PDF AVEC CLAUDE
// ============================================================================

/**
 * Analyse des PDFs avec Claude (support natif)
 */
export async function analyzePdfWithClaude(
  pdfDocuments: PdfInput[],
  question: string,
  apiKey: string
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
  
  contentBlocks.push({
    type: "text",
    text: `Tu es un expert en douane et commerce international. Analyse ce(s) document(s) PDF en EXTRAYANT TOUTES LES INFORMATIONS DISPONIBLES.

Question de l'utilisateur: "${question}"

INSTRUCTION CRITIQUE: Tu dois extraire 100% du contenu pertinent du document, pas un résumé. Je veux TOUTES les données.

Réponds en JSON avec ce format:
{
  "summary": "Résumé structuré du document",
  "fullContent": "EXTRACTION COMPLÈTE de toutes les informations",
  "extractedInfo": "Synthèse structurée des informations clés",
  "suggestedCodes": ["8517.12", "8517.13"]
}

RÈGLES IMPÉRATIVES:
1. EXHAUSTIVITÉ: Extrais CHAQUE produit, CHAQUE ligne, CHAQUE montant du document
2. PRÉCISION: Conserve les valeurs exactes (chiffres, unités, devises)
3. STRUCTURE: Si tableau, reproduis les données tabulaires en texte structuré
4. AUCUNE TRONCATURE: Le champ fullContent peut être très long, c'est voulu`,
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
      return {
        summary: parsed.summary || "Document analysé",
        extractedInfo: parsed.extractedInfo || "",
        fullContent: parsed.fullContent || "",
        suggestedCodes: Array.isArray(parsed.suggestedCodes) ? parsed.suggestedCodes : [],
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
