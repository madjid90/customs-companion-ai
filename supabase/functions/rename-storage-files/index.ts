// Edge Function to rename files in storage to match their actual chapter content
// Utilise les mentioned_hs_codes des extractions pour déterminer le vrai chapitre
import { createClient } from "npm:@supabase/supabase-js@2";

import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { requireAuth } from "../_shared/auth-check.ts";

interface PDFWithExtraction {
  id: string;
  title: string;
  file_name: string;
  file_path: string;
  category: string;
  pdf_extractions: {
    mentioned_hs_codes: string[] | null;
  }[] | null;
}

// Déterminer le chapitre à partir des codes HS mentionnés
function detectChapterFromHSCodes(hsCodes: string[] | null): number | null {
  if (!hsCodes || hsCodes.length === 0) return null;
  
  // Compter les occurrences de chaque préfixe de 2 chiffres
  const chapterCounts: Record<string, number> = {};
  
  for (const code of hsCodes) {
    // Nettoyer le code: enlever points, espaces, garder que les chiffres
    const cleanCode = code.replace(/[^0-9]/g, "");
    if (cleanCode.length >= 2) {
      const prefix = cleanCode.substring(0, 2);
      const chapter = parseInt(prefix, 10);
      if (chapter >= 1 && chapter <= 99) {
        const key = String(chapter);
        chapterCounts[key] = (chapterCounts[key] || 0) + 1;
      }
    }
  }
  
  // Trouver le chapitre le plus fréquent
  let maxCount = 0;
  let dominantChapter: number | null = null;
  
  for (const [chapter, count] of Object.entries(chapterCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantChapter = parseInt(chapter, 10);
    }
  }
  
  // Exiger au moins 3 codes du même chapitre pour être sûr
  return maxCount >= 3 ? dominantChapter : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }

  const corsHeaders = getCorsHeaders(req);

  // Require admin authentication
  const { error: authError } = await requireAuth(req, corsHeaders, true);
  if (authError) return authError;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { dryRun = true } = await req.json().catch(() => ({ dryRun: true }));

    console.log(`Starting file rename operation (dryRun: ${dryRun})`);

    // Récupérer tous les PDFs tarifaires avec leurs extractions
    const { data: pdfs, error: fetchError } = await supabase
      .from("pdf_documents")
      .select(`
        id, 
        title, 
        file_name, 
        file_path, 
        category,
        pdf_extractions (
          mentioned_hs_codes
        )
      `)
      .eq("is_active", true)
      .eq("category", "tarif")
      .order("created_at", { ascending: false }) as { data: PDFWithExtraction[] | null; error: any };

    if (fetchError) throw fetchError;

    const results: { 
      id: string; 
      title: string; 
      oldPath: string; 
      newPath: string; 
      detectedChapter: number | null;
      hsCodesCount: number;
      status: string;
    }[] = [];
    
    const processedChapters = new Set<number>();

    for (const pdf of pdfs || []) {
      // Récupérer les codes HS de l'extraction
      const extraction = pdf.pdf_extractions?.[0];
      const hsCodes = extraction?.mentioned_hs_codes || [];
      
      // Détecter le chapitre à partir des codes HS réels
      const chapterNum = detectChapterFromHSCodes(hsCodes);
      
      if (!chapterNum) {
        // Fallback: essayer d'extraire du titre
        const titleMatch = pdf.title.match(/(?:Chapitre\s+)?SH\s*(?:CODE\s+)?(\d+)/i);
        const fallbackChapter = titleMatch ? parseInt(titleMatch[1], 10) : null;
        
        if (!fallbackChapter) {
          results.push({
            id: pdf.id,
            title: pdf.title,
            oldPath: pdf.file_path,
            newPath: "",
            detectedChapter: null,
            hsCodesCount: hsCodes.length,
            status: "skipped - impossible de détecter le chapitre",
          });
          continue;
        }
      }
      
      const finalChapter = chapterNum || parseInt(pdf.title.match(/(\d+)/)?.[1] || "0", 10);
      
      if (!finalChapter || finalChapter < 1 || finalChapter > 99) {
        results.push({
          id: pdf.id,
          title: pdf.title,
          oldPath: pdf.file_path,
          newPath: "",
          detectedChapter: null,
          hsCodesCount: hsCodes.length,
          status: "skipped - numéro de chapitre invalide",
        });
        continue;
      }
      
      // Skip si on a déjà traité ce chapitre (garder le plus récent)
      if (processedChapters.has(finalChapter)) {
        results.push({
          id: pdf.id,
          title: pdf.title,
          oldPath: pdf.file_path,
          newPath: "",
          detectedChapter: finalChapter,
          hsCodesCount: hsCodes.length,
          status: "skipped - doublon (version plus récente existe)",
        });
        continue;
      }
      processedChapters.add(finalChapter);

      const paddedChapter = String(finalChapter).padStart(2, "0");
      const expectedFileName = `SH_CODE_${paddedChapter}.pdf`;
      const newPath = `tarifs/${expectedFileName}`;
      
      // Vérifier si le fichier a déjà le bon chemin
      if (pdf.file_path === newPath) {
        results.push({
          id: pdf.id,
          title: pdf.title,
          oldPath: pdf.file_path,
          newPath: newPath,
          detectedChapter: finalChapter,
          hsCodesCount: hsCodes.length,
          status: "already correct",
        });
        continue;
      }

      if (dryRun) {
        results.push({
          id: pdf.id,
          title: pdf.title,
          oldPath: pdf.file_path,
          newPath: newPath,
          detectedChapter: finalChapter,
          hsCodesCount: hsCodes.length,
          status: "would rename",
        });
      } else {
        try {
          // 1. Télécharger le fichier source
          const { data: fileData, error: downloadError } = await supabase.storage
            .from("pdf-documents")
            .download(pdf.file_path);

          if (downloadError) {
            console.error(`Download error for ${pdf.file_path}:`, downloadError);
            results.push({
              id: pdf.id,
              title: pdf.title,
              oldPath: pdf.file_path,
              newPath: newPath,
              detectedChapter: finalChapter,
              hsCodesCount: hsCodes.length,
              status: `error downloading: ${downloadError.message}`,
            });
            continue;
          }

          // 2. Uploader vers le nouveau chemin (écrase si existe)
          const { error: uploadError } = await supabase.storage
            .from("pdf-documents")
            .upload(newPath, fileData, {
              contentType: "application/pdf",
              upsert: true,
            });

          if (uploadError) {
            console.error(`Upload error for ${newPath}:`, uploadError);
            results.push({
              id: pdf.id,
              title: pdf.title,
              oldPath: pdf.file_path,
              newPath: newPath,
              detectedChapter: finalChapter,
              hsCodesCount: hsCodes.length,
              status: `error uploading: ${uploadError.message}`,
            });
            continue;
          }

          // 3. Mettre à jour l'enregistrement en BDD
          const { error: updateError } = await supabase
            .from("pdf_documents")
            .update({
              file_path: newPath,
              file_name: expectedFileName,
              title: `Chapitre SH ${paddedChapter}`,
            })
            .eq("id", pdf.id);

          if (updateError) {
            console.error(`Update error for ${pdf.id}:`, updateError);
            results.push({
              id: pdf.id,
              title: pdf.title,
              oldPath: pdf.file_path,
              newPath: newPath,
              detectedChapter: finalChapter,
              hsCodesCount: hsCodes.length,
              status: `error updating db: ${updateError.message}`,
            });
            continue;
          }

          // 4. Supprimer l'ancien fichier (si différent du nouveau)
          if (pdf.file_path !== newPath) {
            const { error: deleteError } = await supabase.storage
              .from("pdf-documents")
              .remove([pdf.file_path]);

            if (deleteError) {
              console.warn(`Warning: Could not delete old file ${pdf.file_path}:`, deleteError);
            }
          }

          results.push({
            id: pdf.id,
            title: pdf.title,
            oldPath: pdf.file_path,
            newPath: newPath,
            detectedChapter: finalChapter,
            hsCodesCount: hsCodes.length,
            status: "renamed successfully",
          });

          console.log(`✅ Renamed: ${pdf.file_path} -> ${newPath} (Chapter ${finalChapter})`);
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          results.push({
            id: pdf.id,
            title: pdf.title,
            oldPath: pdf.file_path,
            newPath: newPath,
            detectedChapter: finalChapter,
            hsCodesCount: hsCodes.length,
            status: `error: ${errorMessage}`,
          });
        }
      }
    }

    const summary = {
      total: results.length,
      wouldRename: results.filter((r) => r.status === "would rename").length,
      renamed: results.filter((r) => r.status === "renamed successfully").length,
      alreadyCorrect: results.filter((r) => r.status === "already correct").length,
      errors: results.filter((r) => r.status.startsWith("error")).length,
      skipped: results.filter((r) => r.status.startsWith("skipped")).length,
    };

    return new Response(
      JSON.stringify({
        success: true,
        dryRun,
        summary,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error in rename-storage-files:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});