// ============================================================================
// VALIDATION DES REQUÊTES API - VERSION SÉCURISÉE
// ============================================================================

export interface ChatRequest {
  question?: string;
  sessionId: string;
  images?: Array<{
    type: "image";
    base64: string;
    mediaType: string;
  }>;
  pdfDocuments?: Array<{
    type: "pdf";
    base64: string;
    fileName: string;
  }>;
  conversationHistory?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

export interface AnalyzePdfRequest {
  pdfId: string;
  filePath?: string;
  previewOnly?: boolean;
  maxLines?: number;
}

export interface GenerateEmbeddingsRequest {
  table?: "hs_codes" | "knowledge_documents" | "pdf_extractions" | "tariff_notes" | "legal_chunks";
  limit?: number;
  forceUpdate?: boolean;
}

// ============================================================================
// CONSTANTES DE VALIDATION
// ============================================================================

const MAX_PDF_SIZE_BASE64 = 13_333_333; // ~10 MB réel
const MAX_PDF_SIZE_MB = 10;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/jpg"];

// ============================================================================
// VALIDATION POUR /chat
// ============================================================================

export function validateChatRequest(body: unknown): { valid: boolean; data?: ChatRequest; error?: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Le body doit être un objet JSON" };
  }
  
  const b = body as Record<string, unknown>;
  
  // sessionId est requis
  if (!b.sessionId || typeof b.sessionId !== "string") {
    return { valid: false, error: "sessionId est requis et doit être une chaîne" };
  }
  
  // Valider le format UUID du sessionId
  if (!UUID_REGEX.test(b.sessionId)) {
    return { valid: false, error: "sessionId doit être un UUID valide" };
  }
  
  // question est optionnelle mais doit être string si présente
  if (b.question !== undefined && typeof b.question !== "string") {
    return { valid: false, error: "question doit être une chaîne" };
  }
  
  // Limiter la longueur de la question
  if (b.question && (b.question as string).length > 10000) {
    return { valid: false, error: "question ne peut pas dépasser 10000 caractères" };
  }
  
  // Validation des images
  if (b.images !== undefined) {
    if (!Array.isArray(b.images)) {
      return { valid: false, error: "images doit être un tableau" };
    }
    
    if (b.images.length > 5) {
      return { valid: false, error: "Maximum 5 images par requête" };
    }
    
    for (let i = 0; i < b.images.length; i++) {
      const img = b.images[i] as Record<string, unknown>;
      if (!img.base64 || typeof img.base64 !== "string") {
        return { valid: false, error: `Image ${i}: base64 manquant ou invalide` };
      }
      if (!img.mediaType || typeof img.mediaType !== "string") {
        return { valid: false, error: `Image ${i}: mediaType manquant ou invalide` };
      }
      if (!VALID_IMAGE_TYPES.includes(img.mediaType)) {
        return { valid: false, error: `Image ${i}: mediaType non supporté (${img.mediaType})` };
      }
      if (img.base64.length > 6_666_666) {
        return { valid: false, error: `Image ${i}: fichier trop volumineux (max 5 MB)` };
      }
    }
  }
  
  // Validation des PDFs
  if (b.pdfDocuments !== undefined) {
    if (!Array.isArray(b.pdfDocuments)) {
      return { valid: false, error: "pdfDocuments doit être un tableau" };
    }
    
    if (b.pdfDocuments.length > 3) {
      return { valid: false, error: "Maximum 3 PDFs par requête" };
    }
    
    for (let i = 0; i < b.pdfDocuments.length; i++) {
      const pdf = b.pdfDocuments[i] as Record<string, unknown>;
      if (!pdf.base64 || typeof pdf.base64 !== "string") {
        return { valid: false, error: `PDF ${i}: base64 manquant ou invalide` };
      }
      if (!pdf.fileName || typeof pdf.fileName !== "string") {
        return { valid: false, error: `PDF ${i}: fileName manquant ou invalide` };
      }
      
      if (!pdf.fileName.toLowerCase().endsWith('.pdf')) {
        return { valid: false, error: `PDF ${i}: le fichier doit avoir l'extension .pdf` };
      }
      
      if (pdf.base64.length > MAX_PDF_SIZE_BASE64) {
        const actualSizeMB = Math.round((pdf.base64.length * 3 / 4) / 1_000_000);
        return { 
          valid: false, 
          error: `PDF ${i} (${pdf.fileName}): fichier trop volumineux (${actualSizeMB} MB, max ${MAX_PDF_SIZE_MB} MB)` 
        };
      }
    }
  }
  
  // Validation de l'historique
  if (b.conversationHistory !== undefined) {
    if (!Array.isArray(b.conversationHistory)) {
      return { valid: false, error: "conversationHistory doit être un tableau" };
    }
    
    if (b.conversationHistory.length > 50) {
      return { valid: false, error: "conversationHistory ne peut pas dépasser 50 messages" };
    }
    
    for (let i = 0; i < b.conversationHistory.length; i++) {
      const msg = b.conversationHistory[i] as Record<string, unknown>;
      if (!msg.role || !["user", "assistant"].includes(msg.role as string)) {
        return { valid: false, error: `Message ${i}: role invalide` };
      }
      if (typeof msg.content !== "string") {
        return { valid: false, error: `Message ${i}: content doit être une chaîne` };
      }
    }
  }
  
  return { valid: true, data: b as unknown as ChatRequest };
}

// ============================================================================
// VALIDATION POUR /analyze-pdf
// ============================================================================

export function validateAnalyzePdfRequest(body: unknown): { valid: boolean; data?: AnalyzePdfRequest; error?: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Le body doit être un objet JSON" };
  }
  
  const b = body as Record<string, unknown>;
  
  if (!b.pdfId || typeof b.pdfId !== "string") {
    return { valid: false, error: "pdfId est requis" };
  }
  
  if (!UUID_REGEX.test(b.pdfId)) {
    return { valid: false, error: "pdfId doit être un UUID valide" };
  }
  
  if (b.maxLines !== undefined) {
    if (typeof b.maxLines !== "number" || b.maxLines < 1 || b.maxLines > 1000) {
      return { valid: false, error: "maxLines doit être entre 1 et 1000" };
    }
  }
  
  if (b.previewOnly !== undefined && typeof b.previewOnly !== "boolean") {
    return { valid: false, error: "previewOnly doit être un booléen" };
  }
  
  return { valid: true, data: b as unknown as AnalyzePdfRequest };
}

// ============================================================================
// VALIDATION POUR /generate-embeddings
// ============================================================================

export function validateGenerateEmbeddingsRequest(body: unknown): { valid: boolean; data?: GenerateEmbeddingsRequest; error?: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Le body doit être un objet JSON" };
  }
  
  const b = body as Record<string, unknown>;
  
  const validTables = ["hs_codes", "knowledge_documents", "pdf_extractions", "tariff_notes", "legal_chunks"];
  if (b.table !== undefined && !validTables.includes(b.table as string)) {
    return { valid: false, error: `table doit être: ${validTables.join(", ")}` };
  }
  
  if (b.limit !== undefined) {
    if (typeof b.limit !== "number" || b.limit < 1 || b.limit > 500) {
      return { valid: false, error: "limit doit être entre 1 et 500" };
    }
  }
  
  return { valid: true, data: b as GenerateEmbeddingsRequest };
}
