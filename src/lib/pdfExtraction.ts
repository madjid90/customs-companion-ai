// ============================================================================
// FICHIER: src/lib/pdfExtraction.ts
// Utilitaires pour l'extraction et la sauvegarde de PDFs tarifaires
// Utilise l'Edge Function analyze-pdf (sécurisée côté serveur)
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { cleanHSCode, formatHSCode, getHSLevel } from "./hsCodeInheritance";

// ============================================================================
// TYPES
// ============================================================================

export interface ExtractedHSCode {
  code: string;
  code_clean: string;
  description: string;
  level: string;
  duty_rate?: number | null;
  unit?: string | null;
}

export interface TariffLine {
  national_code: string;
  hs_code_6: string;
  description: string;
  duty_rate: number;
  unit?: string;
}

export interface PDFExtractionResult {
  success: boolean;
  summary: string;
  key_points: string[];
  hs_codes: ExtractedHSCode[];
  tariff_lines: TariffLine[];
  chapter_info?: { number: number; title: string };
  error?: string;
}

export interface UploadResult {
  success: boolean;
  pdfId?: string;
  filePath?: string;
  error?: string;
}

export interface AnalysisResult {
  success: boolean;
  pdfId: string;
  extraction?: PDFExtractionResult;
  stats?: {
    hs_codes_count: number;
    tariff_lines_count: number;
  };
  error?: string;
}

// ============================================================================
// UTILITAIRES
// ============================================================================

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
  });
};

export const detectCategoryFromFilename = (filename: string): string => {
  const lower = filename.toLowerCase();
  if (lower.includes("chapitre") || lower.includes("chapter")) return "tarif";
  if (lower.includes("circulaire")) return "circulaire";
  if (lower.includes("note")) return "note";
  if (lower.includes("instruction")) return "instruction";
  if (lower.includes("reglement") || lower.includes("règlement")) return "reglement";
  if (lower.includes("accord")) return "accord";
  if (lower.includes("convention")) return "convention";
  return "tarif";
};

// ============================================================================
// UPLOAD PDF VERS STORAGE
// ============================================================================

export const uploadPDFToStorage = async (
  file: File,
  category: string,
  countryCode: string = "MA"
): Promise<UploadResult> => {
  try {
    // Générer un chemin unique
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const filePath = `${countryCode}/${category}/${timestamp}_${safeName}`;

    // Upload vers Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("pdf-documents")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return { success: false, error: `Erreur upload: ${uploadError.message}` };
    }

    // Créer l'entrée dans pdf_documents
    const { data: pdfDoc, error: insertError } = await supabase
      .from("pdf_documents")
      .insert({
        title: file.name.replace(".pdf", ""),
        description: "En attente d'analyse",
        file_name: file.name,
        file_path: filePath,
        file_size_bytes: file.size,
        category: category,
        country_code: countryCode,
        mime_type: "application/pdf",
        is_active: true,
        is_verified: false,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      // Cleanup: supprimer le fichier uploadé
      await supabase.storage.from("pdf-documents").remove([filePath]);
      return { success: false, error: `Erreur base de données: ${insertError.message}` };
    }

    return {
      success: true,
      pdfId: pdfDoc.id,
      filePath: filePath,
    };
  } catch (error) {
    console.error("Upload error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erreur inconnue",
    };
  }
};

// ============================================================================
// ANALYSE PDF VIA EDGE FUNCTION
// ============================================================================

export const analyzePDFWithEdgeFunction = async (
  pdfId: string,
  filePath: string
): Promise<PDFExtractionResult> => {
  const defaultResult: PDFExtractionResult = {
    success: false,
    summary: "",
    key_points: [],
    hs_codes: [],
    tariff_lines: [],
  };

  try {
    // Appeler l'Edge Function analyze-pdf
    const { data, error } = await supabase.functions.invoke("analyze-pdf", {
      body: { pdfId, filePath },
    });

    if (error) {
      console.error("Edge function error:", error);
      return { ...defaultResult, error: error.message };
    }

    if (!data) {
      return { ...defaultResult, error: "Pas de réponse de l'Edge Function" };
    }

    // Transformer la réponse
    const hs_codes: ExtractedHSCode[] = (data.hs_codes || []).map((h: any) => ({
      code: h.code,
      code_clean: h.code_clean || cleanHSCode(h.code),
      description: h.description,
      level: h.level || getHSLevel(h.code_clean || cleanHSCode(h.code)),
    }));

    const tariff_lines: TariffLine[] = (data.tariff_lines || []).map((t: any) => ({
      national_code: t.national_code,
      hs_code_6: t.hs_code_6,
      description: t.description,
      duty_rate: t.duty_rate,
      unit: t.unit,
    }));

    return {
      success: true,
      summary: data.summary || "",
      key_points: data.key_points || [],
      hs_codes,
      tariff_lines,
      chapter_info: data.chapter_info,
    };
  } catch (error) {
    console.error("Analyze error:", error);
    return {
      ...defaultResult,
      error: error instanceof Error ? error.message : "Erreur d'analyse",
    };
  }
};

// ============================================================================
// FONCTION PRINCIPALE: UPLOAD + ANALYSE
// ============================================================================

export const processAndStorePDF = async (
  file: File,
  category?: string,
  countryCode: string = "MA"
): Promise<AnalysisResult> => {
  console.log(`📄 Processing: ${file.name}`);

  // Détecter la catégorie si non fournie
  const finalCategory = category || detectCategoryFromFilename(file.name);

  // 1. Upload vers Storage et créer l'entrée en BDD
  console.log("📤 Uploading to storage...");
  const uploadResult = await uploadPDFToStorage(file, finalCategory, countryCode);

  if (!uploadResult.success || !uploadResult.pdfId || !uploadResult.filePath) {
    return {
      success: false,
      pdfId: "",
      error: uploadResult.error || "Erreur upload",
    };
  }

  console.log(`✅ Uploaded: ${uploadResult.pdfId}`);

  // 2. Analyser avec l'Edge Function
  console.log("🤖 Analyzing with Claude via Edge Function...");
  const extraction = await analyzePDFWithEdgeFunction(
    uploadResult.pdfId,
    uploadResult.filePath
  );

  if (!extraction.success) {
    return {
      success: false,
      pdfId: uploadResult.pdfId,
      extraction,
      error: extraction.error,
    };
  }

  console.log(
    `✅ Extracted: ${extraction.hs_codes.length} codes, ${extraction.tariff_lines.length} tariff lines`
  );

  return {
    success: true,
    pdfId: uploadResult.pdfId,
    extraction,
    stats: {
      hs_codes_count: extraction.hs_codes.length,
      tariff_lines_count: extraction.tariff_lines.length,
    },
  };
};

// ============================================================================
// FONCTIONS UTILITAIRES POUR L'AFFICHAGE
// ============================================================================

export const formatExtractionForDisplay = (extraction: PDFExtractionResult) => {
  return {
    summary: extraction.summary,
    keyPointsCount: extraction.key_points.length,
    hsCodesCount: extraction.hs_codes.length,
    tariffLinesCount: extraction.tariff_lines.length,
    chapter: extraction.chapter_info?.number || null,
    chapterTitle: extraction.chapter_info?.title || null,
    // Preview des premiers codes
    previewHSCodes: extraction.hs_codes.slice(0, 5).map((h) => ({
      code: formatHSCode(h.code_clean),
      description: h.description.substring(0, 60) + (h.description.length > 60 ? "..." : ""),
      level: h.level,
    })),
    // Preview des premières lignes tarifaires
    previewTariffs: extraction.tariff_lines.slice(0, 5).map((t) => ({
      code: formatHSCode(t.national_code),
      description: t.description.substring(0, 50) + (t.description.length > 50 ? "..." : ""),
      duty: `${t.duty_rate}%`,
    })),
  };
};

// ============================================================================
// RECHERCHE DE CODES DANS LES EXTRACTIONS
// ============================================================================

export const searchExtractedCodes = async (
  searchTerm: string,
  limit: number = 20
): Promise<ExtractedHSCode[]> => {
  try {
    // Chercher dans pdf_extractions.mentioned_hs_codes
    const { data: extractions } = await supabase
      .from("pdf_extractions")
      .select("mentioned_hs_codes, detected_tariff_changes")
      .limit(50);

    if (!extractions) return [];

    const results: ExtractedHSCode[] = [];
    const cleanSearch = cleanHSCode(searchTerm);

    for (const ext of extractions) {
      // Chercher dans les codes mentionnés
      const codes = ext.mentioned_hs_codes as string[] | null;
      if (codes) {
        for (const code of codes) {
          if (code.includes(cleanSearch) || cleanSearch.includes(code)) {
            results.push({
              code: formatHSCode(code),
              code_clean: code,
              description: "",
              level: getHSLevel(code),
            });
          }
        }
      }

      // Chercher dans les lignes tarifaires
      const tariffs = ext.detected_tariff_changes as unknown as TariffLine[] | null;
      if (tariffs && Array.isArray(tariffs)) {
        for (const t of tariffs) {
          if (
            t.national_code?.includes(cleanSearch) ||
            t.hs_code_6?.includes(cleanSearch) ||
            t.description?.toLowerCase().includes(searchTerm.toLowerCase())
          ) {
            results.push({
              code: formatHSCode(t.national_code),
              code_clean: t.national_code,
              description: t.description,
              level: "tariff_line",
              duty_rate: t.duty_rate,
              unit: t.unit,
            });
          }
        }
      }
    }

    // Dédupliquer et limiter
    const unique = [...new Map(results.map((r) => [r.code_clean, r])).values()];
    return unique.slice(0, limit);
  } catch (error) {
    console.error("Search error:", error);
    return [];
  }
};

export default {
  fileToBase64,
  detectCategoryFromFilename,
  uploadPDFToStorage,
  analyzePDFWithEdgeFunction,
  processAndStorePDF,
  formatExtractionForDisplay,
  searchExtractedCodes,
};
