// ============================================================================
// VALIDATION DES REQUÊTES API
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
  table?: "hs_codes" | "knowledge_documents" | "pdf_extractions" | "veille_documents";
  limit?: number;
  forceUpdate?: boolean;
}

// Validation pour /chat
export function validateChatRequest(body: unknown): { valid: boolean; data?: ChatRequest; error?: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Le body doit être un objet JSON" };
  }
  
  const b = body as Record<string, unknown>;
  
  // sessionId est requis
  if (!b.sessionId || typeof b.sessionId !== "string") {
    return { valid: false, error: "sessionId est requis et doit être une chaîne" };
  }
  
  // question est optionnelle mais doit être string si présente
  if (b.question !== undefined && typeof b.question !== "string") {
    return { valid: false, error: "question doit être une chaîne" };
  }
  
  // Validation des images
  if (b.images !== undefined) {
    if (!Array.isArray(b.images)) {
      return { valid: false, error: "images doit être un tableau" };
    }
    for (let i = 0; i < b.images.length; i++) {
      const img = b.images[i] as Record<string, unknown>;
      if (!img.base64 || typeof img.base64 !== "string") {
        return { valid: false, error: `Image ${i}: base64 manquant ou invalide` };
      }
      if (!img.mediaType || typeof img.mediaType !== "string") {
        return { valid: false, error: `Image ${i}: mediaType manquant ou invalide` };
      }
      const validTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/jpg"];
      if (!validTypes.includes(img.mediaType)) {
        return { valid: false, error: `Image ${i}: mediaType non supporté (${img.mediaType})` };
      }
    }
  }
  
  // Validation des PDFs
  if (b.pdfDocuments !== undefined) {
    if (!Array.isArray(b.pdfDocuments)) {
      return { valid: false, error: "pdfDocuments doit être un tableau" };
    }
    for (let i = 0; i < b.pdfDocuments.length; i++) {
      const pdf = b.pdfDocuments[i] as Record<string, unknown>;
      if (!pdf.base64 || typeof pdf.base64 !== "string") {
        return { valid: false, error: `PDF ${i}: base64 manquant ou invalide` };
      }
      if (!pdf.fileName || typeof pdf.fileName !== "string") {
        return { valid: false, error: `PDF ${i}: fileName manquant ou invalide` };
      }
      // Limite de taille: 10 MB en base64 (environ 7.5 MB fichier réel)
      if (pdf.base64.length > 14_000_000) {
        return { valid: false, error: `PDF ${i}: fichier trop volumineux (max 10 MB)` };
      }
    }
  }
  
  // Validation de l'historique
  if (b.conversationHistory !== undefined) {
    if (!Array.isArray(b.conversationHistory)) {
      return { valid: false, error: "conversationHistory doit être un tableau" };
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

// Validation pour /analyze-pdf
export function validateAnalyzePdfRequest(body: unknown): { valid: boolean; data?: AnalyzePdfRequest; error?: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Le body doit être un objet JSON" };
  }
  
  const b = body as Record<string, unknown>;
  
  // pdfId est requis
  if (!b.pdfId || typeof b.pdfId !== "string") {
    return { valid: false, error: "pdfId est requis" };
  }
  
  // Valider format UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(b.pdfId)) {
    return { valid: false, error: "pdfId doit être un UUID valide" };
  }
  
  // maxLines optionnel
  if (b.maxLines !== undefined) {
    if (typeof b.maxLines !== "number" || b.maxLines < 1 || b.maxLines > 1000) {
      return { valid: false, error: "maxLines doit être entre 1 et 1000" };
    }
  }
  
  // previewOnly optionnel
  if (b.previewOnly !== undefined && typeof b.previewOnly !== "boolean") {
    return { valid: false, error: "previewOnly doit être un booléen" };
  }
  
  return { valid: true, data: b as unknown as AnalyzePdfRequest };
}

// Validation pour /generate-embeddings
export function validateGenerateEmbeddingsRequest(body: unknown): { valid: boolean; data?: GenerateEmbeddingsRequest; error?: string } {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Le body doit être un objet JSON" };
  }
  
  const b = body as Record<string, unknown>;
  
  // table optionnel mais doit être valide
  const validTables = ["hs_codes", "knowledge_documents", "pdf_extractions", "veille_documents"];
  if (b.table !== undefined && !validTables.includes(b.table as string)) {
    return { valid: false, error: `table doit être: ${validTables.join(", ")}` };
  }
  
  // limit optionnel
  if (b.limit !== undefined) {
    if (typeof b.limit !== "number" || b.limit < 1 || b.limit > 500) {
      return { valid: false, error: "limit doit être entre 1 et 500" };
    }
  }
  
  return { valid: true, data: b as GenerateEmbeddingsRequest };
}
