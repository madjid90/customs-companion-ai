import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAuthHeaders } from "@/lib/authHeaders";
import { useToast } from "@/hooks/use-toast";
import { useUploadState, UploadedFile, ExtractionData, DocumentType } from "@/hooks/useUploadState";
import { storeFile, getStoredFile, removeStoredFile, removeStoredFiles, clearAllStoredFiles, cleanupOldFiles } from "@/lib/fileStorage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Upload, 
  FileText, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  Brain,
  Database,
  Eye,
  Clock,
  RotateCcw,
  Trash2,
  BookOpen,
  FileCheck,
  Scale,
  ScrollText
} from "lucide-react";
import ExtractionPreviewDialog from "@/components/admin/ExtractionPreviewDialog";
import ReingestionPanel from "@/components/admin/ReingestionPanel";
import EmbeddingPanel from "@/components/admin/EmbeddingPanel";
import MissingChunksPanel from "@/components/admin/MissingChunksPanel";

// Document type configuration
const DOCUMENT_TYPES: { value: DocumentType; label: string; icon: React.ReactNode; description: string; pipeline: "analyze" | "ingest" }[] = [
  { value: "tarif", label: "Tarif SH", icon: <FileCheck className="h-4 w-4" />, description: "Codes SH, taux DD, lignes tarifaires", pipeline: "analyze" },
  { value: "accord", label: "Accord commercial", icon: <Scale className="h-4 w-4" />, description: "Accords, conventions, traités", pipeline: "ingest" },
  { value: "reglementation", label: "Réglementation", icon: <BookOpen className="h-4 w-4" />, description: "Code des douanes, lois, décrets", pipeline: "ingest" },
  { value: "circulaire", label: "Circulaire", icon: <ScrollText className="h-4 w-4" />, description: "Circulaires, notes, instructions", pipeline: "ingest" },
];

export default function AdminUpload() {
  const { files, setFiles, updateFileStatus, queueFile, processNext, isProcessing, setIsProcessing, clearAll, removeFile: removeFileFromState } = useUploadState();
  const [isDragging, setIsDragging] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<UploadedFile | null>(null);
  const [selectedDocType, setSelectedDocType] = useState<DocumentType>("tarif");
  const [isRetryingAll, setIsRetryingAll] = useState(false);
  const { toast } = useToast();
  const processingRef = useRef(false);

  // Cleanup old IndexedDB files on mount (older than 48h)
  useEffect(() => {
    cleanupOldFiles(48 * 60 * 60 * 1000).then(count => {
      if (count > 0) console.log(`[FileStorage] Cleaned up ${count} old files`);
    });
  }, []);
  
  // Fonction batch avec callbacks dynamiques pour chaque fichier
  // Accumule les données de chaque batch pour prévisualisation avant insertion
  const runBatchExtraction = useCallback(async (
    pdfId: string,
    filePath: string,
    fileId: string,
    fileName: string
  ) => {
    const BATCH_SIZE = 2; // Reduced from 4 to avoid browser timeouts
    const DELAY_BETWEEN_BATCHES = 1500;
    const FETCH_TIMEOUT_MS = 180000; // 3 min (reduced to detect issues faster)
    
    let startPage = 1;
    let runId: string | null = null;
    let totalPages = 0;
    let processedPages = 0;
    let done = false;
    
    // Accumulateurs pour les données de tous les batches
    const accumulatedTariffLines: Array<{
      national_code: string;
      hs_code_6: string;
      description: string;
      duty_rate: number;
      unit?: string;
    }> = [];
    const accumulatedHsCodes: Array<{
      code: string;
      code_clean: string;
      description: string;
      level: string;
    }> = [];
    const accumulatedNotes: Array<{
      note_type: string;
      anchor?: string;
      note_text: string;
      page_number?: number;
    }> = [];
    
    // Résumé généré au premier batch
    let documentSummary = "";
    
    // Helper: fetch with retry
    const fetchWithRetry = async (body: object, maxRetries = 3): Promise<Response> => {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        
        try {
          updateFileStatus(fileId, { 
            error: attempt > 0 
              ? `Tentative ${attempt + 1}/${maxRetries}...` 
              : `Page ${startPage}...`
          });
          
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-pdf`,
            {
              method: "POST",
              headers: await getAuthHeaders(),
              body: JSON.stringify(body),
              signal: controller.signal,
            }
          );
          
          clearTimeout(timeoutId);
          return response;
        } catch (err: any) {
          clearTimeout(timeoutId);
          lastError = err;
          console.warn(`[Retry] Attempt ${attempt + 1} failed:`, err.message);
          
          if (attempt < maxRetries - 1) {
            // Exponential backoff: 3s, 6s, 12s
            const delay = 3000 * Math.pow(2, attempt);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }
      throw lastError || new Error("Fetch failed after retries");
    };
    
    while (!done) {
      try {
        const response = await fetchWithRetry({
          pdfId,
          filePath,
          previewOnly: true,
          start_page: startPage,
          max_pages: BATCH_SIZE,
          extraction_run_id: runId,
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
        }
        
        const batchResult = await response.json();
        
        if (!runId) runId = batchResult.extraction_run_id;
        totalPages = batchResult.total_pages || totalPages;
        processedPages = batchResult.processed_pages || processedPages;
        
        // Capturer le résumé au premier batch (seulement s'il n'est pas déjà défini)
        if (batchResult.summary && !documentSummary) {
          documentSummary = batchResult.summary;
          console.log("[Batch] Captured document summary:", documentSummary.substring(0, 100) + "...");
        }
        
        // Accumuler les données de ce batch
        if (batchResult.tariff_lines && Array.isArray(batchResult.tariff_lines)) {
          for (const line of batchResult.tariff_lines) {
            accumulatedTariffLines.push({
              national_code: line.national_code,
              hs_code_6: line.hs_code_6,
              description: line.description || "",
              duty_rate: line.duty_rate || 0,
              unit: line.unit_norm || line.unit || undefined,
            });
          }
        }
        
        if (batchResult.hs_codes && Array.isArray(batchResult.hs_codes)) {
          for (const hs of batchResult.hs_codes) {
            // Éviter les doublons
            if (!accumulatedHsCodes.some(h => h.code_clean === hs.code_clean)) {
              accumulatedHsCodes.push({
                code: hs.code,
                code_clean: hs.code_clean,
                description: hs.description || "",
                level: hs.level || "subheading",
              });
            }
          }
        }
        
        if (batchResult.notes && Array.isArray(batchResult.notes)) {
          for (const note of batchResult.notes) {
            accumulatedNotes.push({
              note_type: note.note_type,
              anchor: note.anchor,
              note_text: note.note_text,
              page_number: note.page_number,
            });
          }
        }
        
        // Calculer la progression (60% à 95%)
        const progressPercent = totalPages > 0 
          ? 60 + Math.round((processedPages / totalPages) * 35)
          : 70;
        
        updateFileStatus(fileId, { 
          progress: progressPercent,
          error: `Page ${processedPages}/${totalPages}... (${accumulatedTariffLines.length} lignes)`
        });
        
        if (batchResult.done) {
          done = true;
          return {
            success: true,
            stats: batchResult.stats,
            processedPages,
            totalPages,
            // Retourner les données accumulées pour prévisualisation
            tariff_lines: accumulatedTariffLines,
            hs_codes: accumulatedHsCodes,
            notes: accumulatedNotes,
            // Résumé intelligent généré au premier batch
            summary: documentSummary,
          };
        } else if (batchResult.next_page) {
          startPage = batchResult.next_page;
          // Attendre entre les batches
          await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
        } else {
          throw new Error("Réponse batch invalide");
        }
        
      } catch (err: any) {
        throw err;
      }
    }
    
    return { 
      success: true, 
      stats: { tariff_lines_inserted: 0 }, 
      processedPages, 
      totalPages,
      tariff_lines: accumulatedTariffLines,
      hs_codes: accumulatedHsCodes,
      notes: accumulatedNotes,
      summary: documentSummary,
    };
  }, [updateFileStatus]);

  // Ingestion pour documents réglementaires (accords, circulaires, code des douanes)
  // Orchestration côté client pour éviter les timeouts sur gros documents
  // Supporte la reprise automatique pour les documents partiellement traités
  const runLegalIngestion = useCallback(async (
    pdfId: string,
    filePath: string,
    fileId: string,
    fileName: string,
    docType: DocumentType
  ) => {
    const BATCH_SIZE = 1; // Single page per request for very dense legal docs
    const FETCH_TIMEOUT_MS = 180000; // 3 min - edge function can take 2min+ for dense pages with retries
    const DELAY_BETWEEN_BATCHES = 2500; // More buffer between batches to avoid rate limits
    
    updateFileStatus(fileId, { 
      progress: 60,
      error: "Préparation du document..."
    });

    // Mapper le type vers source_type
    const sourceTypeMap: Record<DocumentType, string> = {
      tarif: "tariff",
      accord: "agreement",
      reglementation: "law",
      circulaire: "circular",
    };

    // === RESUME LOGIC: Check for existing chunks ===
    // NOTE: The edge function may replace source_ref with the extracted reference
    // (e.g., "4955/312" instead of "file_24976 (7)"), so we DON'T use resume logic
    // based on source_ref. Instead, we always start fresh since cleanup already removed old data.
    const sourceRef = fileName.replace(".pdf", "");
    const resumeFromPage = 1;

    // Récupérer le PDF depuis le storage pour l'envoyer en base64
    const { data: pdfBlob, error: downloadError } = await supabase.storage
      .from("pdf-documents")
      .download(filePath);
    
    if (downloadError || !pdfBlob) {
      throw new Error(`Impossible de télécharger le PDF: ${downloadError?.message}`);
    }

    // Convertir en base64
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    // Helper: fetch with timeout
    const fetchWithTimeout = async (body: object): Promise<Response> => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ingest-legal-doc`,
          {
            method: "POST",
            headers: await getAuthHeaders(),
            body: JSON.stringify(body),
            signal: controller.signal,
          }
        );
        
        clearTimeout(timeoutId);
        return response;
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    };

    let sourceId: number | null = null;
    let totalPages = 0;
    let processedPages = 0;
    let totalChunks = 0;
    let totalCodes = 0;
    let totalEvidence = 0;
    
    // Always start fresh (cleanup already removed old data)
    updateFileStatus(fileId, { 
      progress: 62,
      error: "Ingestion page 1..."
    });

    const firstBatchResponse = await fetchWithTimeout({
      source_type: sourceTypeMap[docType],
      source_ref: sourceRef,
      title: fileName.replace(".pdf", "").replace(/_/g, " "),
      pdf_base64: base64,
      country_code: "MA",
      generate_embeddings: true,
      detect_hs_codes: true,
      batch_mode: true,
      start_page: resumeFromPage,
      end_page: resumeFromPage + BATCH_SIZE - 1,
      ...(sourceId ? { source_id: sourceId } : {}),
    });

    if (!firstBatchResponse.ok) {
      const errorText = await firstBatchResponse.text();
      throw new Error(`HTTP ${firstBatchResponse.status}: ${errorText.substring(0, 200)}`);
    }

    const firstResult = await firstBatchResponse.json();
    
    if (!firstResult.success) {
      throw new Error(firstResult.error || "Erreur lors de l'ingestion");
    }

    // Handle already-complete documents (all pages already processed in a previous run)
    if (firstResult.already_complete) {
      console.log(`[LegalIngestion] Document already fully ingested (${firstResult.total_pages} pages)`);
      updateFileStatus(fileId, {
        status: "success",
        progress: 100,
        error: undefined,
      });
      toast({
        title: "✅ Document déjà traité",
        description: `Ce document (${firstResult.total_pages} pages) a déjà été entièrement ingéré.`,
      });
      return {
        success: true,
        chunks_created: 0,
        detected_codes_count: 0,
        evidence_created: 0,
        pages_processed: 0,
        already_complete: true,
      };
    }

    sourceId = firstResult.source_id || sourceId;
    totalPages = firstResult.total_pages || BATCH_SIZE;
    processedPages += firstResult.pages_processed || BATCH_SIZE;
    totalChunks += firstResult.chunks_created || 0;
    totalCodes += firstResult.detected_codes_count || 0;
    totalEvidence += firstResult.evidence_created || 0;

    console.log(`[LegalIngestion] First batch done: ${processedPages}/${totalPages} pages, source_id=${sourceId}`);

    // Process remaining batches
    let currentPage = resumeFromPage + BATCH_SIZE;

    while (currentPage <= totalPages) {
      const endPage = Math.min(currentPage + BATCH_SIZE - 1, totalPages);
      const batchNum = Math.ceil(currentPage / BATCH_SIZE);
      
      const progressPercent = 62 + Math.round((processedPages / totalPages) * 35);
      
      updateFileStatus(fileId, { 
        progress: progressPercent,
        error: `⏳ Page ${currentPage}/${totalPages} — envoi en cours...`
      });

      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));

      // Retry logic for individual batches (up to 2 retries)
      let batchSuccess = false;
      for (let attempt = 0; attempt < 3 && !batchSuccess; attempt++) {
        try {
          if (attempt > 0) {
            updateFileStatus(fileId, { 
              error: `🔄 Page ${currentPage}/${totalPages} — tentative ${attempt + 1}/3...`
            });
            await new Promise(r => setTimeout(r, 3000 * attempt));
          }

          updateFileStatus(fileId, { 
            error: `⏳ Page ${currentPage}/${totalPages} — analyse IA (~20s)...`
          });

          const batchResponse = await fetchWithTimeout({
            source_type: sourceTypeMap[docType],
            source_ref: fileName.replace(".pdf", ""),
            pdf_base64: base64,
            country_code: "MA",
            generate_embeddings: true,
            detect_hs_codes: true,
            batch_mode: true,
            start_page: currentPage,
            end_page: endPage,
            source_id: sourceId,
          });

          if (!batchResponse.ok) {
            const errorText = await batchResponse.text();
            console.warn(`[LegalIngestion] Batch ${batchNum} HTTP error: ${errorText.substring(0, 100)}`);
            if (attempt === 2) break; // Last attempt, skip this batch
            continue;
          }
          
          const batchResult = await batchResponse.json();
          
          if (batchResult.success) {
            processedPages += batchResult.pages_processed || 0;
            totalChunks += batchResult.chunks_created || 0;
            totalCodes += batchResult.detected_codes_count || 0;
            totalEvidence += batchResult.evidence_created || 0;
            batchSuccess = true;
            
            console.log(`[LegalIngestion] Batch ${batchNum} done: ${processedPages}/${totalPages} pages`);
            
            updateFileStatus(fileId, { 
              progress: 62 + Math.round((processedPages / totalPages) * 35),
              error: `✅ Page ${currentPage}/${totalPages} — ${totalChunks} segments`
            });
          }
        } catch (batchError: any) {
          console.warn(`[LegalIngestion] Batch ${batchNum} attempt ${attempt + 1} failed:`, batchError.message);
          if (attempt === 2) {
            console.error(`[LegalIngestion] Batch ${batchNum} failed after 3 attempts, skipping`);
          }
        }
      }

      currentPage = endPage + 1;
    }

    return {
      success: true,
      chunks_created: totalChunks,
      detected_codes_count: totalCodes,
      evidence_created: totalEvidence,
      pages_processed: processedPages,
    };
  }, [updateFileStatus]);

  const detectDocumentTypeFromName = (fileName: string): { category: string; label: string } => {
    const name = fileName.toLowerCase();
    
    // Priorité aux documents tarifaires (incluant SH CODE / HS CODE)
    if (name.includes("tarif") || name.includes("ddi") || name.includes("chapitre") ||
        name.includes("sh code") || name.includes("hs code") || name.includes("shcode") || name.includes("hscode")) {
      return { category: "tarif", label: "Tarif douanier" };
    }
    if (name.includes("circulaire") || name.includes("circ")) {
      return { category: "circulaire", label: "Circulaire" };
    }
    if (name.includes("note") || name.includes("technique")) {
      return { category: "note", label: "Note technique" };
    }
    if (name.includes("avis") || name.includes("classement")) {
      return { category: "avis", label: "Avis de classement" };
    }
    if (name.includes("accord") || name.includes("convention")) {
      return { category: "accord", label: "Accord commercial" };
    }
    if (name.includes("reglement") || name.includes("loi") || name.includes("decret")) {
      return { category: "reglementation", label: "Réglementation" };
    }
    
    return { category: "autre", label: "Document douanier" };
  };

  // Process a single file - route to correct pipeline based on document type
  const processFile = async (file: File, fileId: string, chosenDocType?: DocumentType) => {
    // Use the chosen document type, or fallback to detection from filename
    const docTypeFromName = detectDocumentTypeFromName(file.name);
    const effectiveDocType = chosenDocType || (docTypeFromName.category as DocumentType) || "tarif";
    const pipeline = DOCUMENT_TYPES.find(d => d.value === effectiveDocType)?.pipeline || "analyze";
    
    updateFileStatus(fileId, { status: "uploading", progress: 10, documentType: effectiveDocType });

    try {
      // 0. Check for duplicates based on file name - DELETE old version to allow replacement
      const pdfTitle = file.name.replace(".pdf", "").replace(/_/g, " ");
      const { data: existingDocs } = await supabase
        .from("pdf_documents")
        .select("id, title, file_name, file_path")
        .or(`file_name.eq.${file.name},title.ilike.${pdfTitle}`)
        .eq("is_active", true)
        .limit(1);
      
      if (existingDocs && existingDocs.length > 0) {
        const existing = existingDocs[0];
        console.log(`[Replace] Removing old document: ${existing.id} - ${existing.title}`);
        updateFileStatus(fileId, { 
          progress: 5,
          error: `♻️ Remplacement de "${existing.title}"...`
        });
        
        // Delete old file from storage if exists
        if (existing.file_path) {
          await supabase.storage.from("pdf-documents").remove([existing.file_path]);
        }
        
        // Delete related extractions
        await supabase.from("pdf_extractions").delete().eq("pdf_id", existing.id);
        
        // Delete related extraction runs
        await supabase.from("pdf_extraction_runs").delete().eq("pdf_id", existing.id);
        
        // Delete related legal_references
        await supabase.from("legal_references").delete().eq("pdf_id", existing.id);
        
        // Delete the old document record
        await supabase.from("pdf_documents").delete().eq("id", existing.id);
        
        // Also clean up old tariff data for this document
        await supabase.from("country_tariffs")
          .delete()
          .eq("source_pdf", existing.file_path);
        
        console.log(`[Replace] Old document ${existing.id} deleted, proceeding with new upload`);
      }
      
      // Also clean up legal_sources/legal_chunks from previous ingestion runs
      // This prevents the "already_complete" false positive when re-uploading
      // IMPORTANT: The edge function may replace source_ref with the extracted reference
      // (e.g., "4955/312" instead of "file_24976 (7)"), so we search broadly
      const sourceRef = file.name.replace(".pdf", "");
      
      // Search by exact filename-based ref AND by partial match (edge function may have changed it)
      const { data: existingLegalSources } = await supabase
        .from("legal_sources")
        .select("id, source_ref")
        .or(`source_ref.eq.${sourceRef},source_ref.ilike.%${sourceRef.replace(/[^a-zA-Z0-9]/g, '%')}%`);
      
      // Also check if there's a legal_references entry linked to a pdf with this filename
      const { data: linkedRefs } = await supabase
        .from("legal_references")
        .select("reference_number")
        .ilike("context", `%${file.name.replace(".pdf", "").substring(0, 30)}%`)
        .limit(5);
      
      // Collect all potential source_refs to clean up
      const refsToClean = new Set<string>();
      refsToClean.add(sourceRef);
      if (linkedRefs) {
        for (const ref of linkedRefs) {
          refsToClean.add(ref.reference_number);
        }
      }
      
      // Clean up all matching legal_sources
      const allSourcesToClean: { id: number; source_ref: string }[] = existingLegalSources || [];
      
      // Also search by linked refs from legal_references
      for (const refNum of refsToClean) {
        if (refNum !== sourceRef) {
          const { data: additionalSources } = await supabase
            .from("legal_sources")
            .select("id, source_ref")
            .eq("source_ref", refNum);
          if (additionalSources) {
            for (const src of additionalSources) {
              if (!allSourcesToClean.some(s => s.id === src.id)) {
                allSourcesToClean.push(src);
              }
            }
          }
        }
      }
      
      if (allSourcesToClean.length > 0) {
        for (const src of allSourcesToClean) {
          console.log(`[Replace] Cleaning up legal_source ${src.id} (ref: "${src.source_ref}")`);
          await supabase.from("legal_chunks").delete().eq("source_id", src.id);
          await supabase.from("hs_evidence").delete().eq("source_id", src.id);
          await supabase.from("legal_sources").delete().eq("id", src.id);
        }
        console.log(`[Replace] Cleaned up ${allSourcesToClean.length} old legal_source(s)`);
      }
      
      // Also clean up any pdf_documents created by the edge function (stored at circulaires/...)
      // Search by all known refs
      for (const refNum of refsToClean) {
        const safeRef = refNum.replace(/[^a-zA-Z0-9]/g, '%');
        const { data: edgeFunctionDocs } = await supabase
          .from("pdf_documents")
          .select("id, file_path")
          .ilike("file_path", `circulaires/%${safeRef}%`)
          .eq("is_active", true);
        
        if (edgeFunctionDocs && edgeFunctionDocs.length > 0) {
          for (const efDoc of edgeFunctionDocs) {
            console.log(`[Replace] Removing edge-function-created doc: ${efDoc.id}`);
            if (efDoc.file_path) {
              await supabase.storage.from("pdf-documents").remove([efDoc.file_path]);
            }
            await supabase.from("legal_references").delete().eq("pdf_id", efDoc.id);
            await supabase.from("pdf_documents").delete().eq("id", efDoc.id);
          }
        }
      }
      
      updateFileStatus(fileId, { progress: 15 });

      // 1. Upload to Supabase Storage
      const filePath = `uploads/${Date.now()}_${file.name}`;
      updateFileStatus(fileId, { progress: 20 });

      const { error: uploadError } = await supabase.storage
        .from("pdf-documents")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw uploadError;
      updateFileStatus(fileId, { progress: 40 });

      // 2. Create PDF document record with selected category
      const { data: pdfDoc, error: insertError } = await supabase
        .from("pdf_documents")
        .insert({
          title: pdfTitle,
          file_name: file.name,
          file_path: filePath,
          file_size_bytes: file.size,
          category: effectiveDocType,
          country_code: "MA",
          mime_type: "application/pdf",
          is_active: true,
          is_verified: false,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;
      updateFileStatus(fileId, { 
        progress: 60, 
        status: "analyzing",
        pdfId: pdfDoc.id,
        filePath: filePath,
      });

      // 3. Route to appropriate pipeline based on document type
      if (pipeline === "ingest") {
        // ========== LEGAL DOCUMENT INGESTION (RAG) ==========
        try {
          const ingestionResult = await runLegalIngestion(
            pdfDoc.id,
            filePath,
            fileId,
            file.name,
            effectiveDocType
          );

          // Clean up IndexedDB blob on success
          removeStoredFile(fileId);
          
          updateFileStatus(fileId, {
            status: "success",
            progress: 100,
            pdfId: pdfDoc.id,
            error: undefined,
            analysis: {
              summary: `Document ingéré pour RAG: ${ingestionResult.chunks_created} segments, ${ingestionResult.detected_codes_count} codes SH détectés`,
              key_points: [],
              hs_codes: [],
              tariff_lines: [],
              document_type: "regulatory",
              full_text_length: ingestionResult.pages_processed * 1000,
            },
          });
          
          toast({
            title: "✅ Document réglementaire ingéré",
            description: `${ingestionResult.chunks_created} segments créés, ${ingestionResult.detected_codes_count} codes SH détectés pour le RAG`,
          });
        } catch (err: any) {
          console.error("Legal ingestion error:", err);
          updateFileStatus(fileId, {
            status: "error",
            progress: 100,
            error: err.message || "Erreur d'ingestion",
          });
          toast({
            title: "Erreur d'ingestion",
            description: err.message || "Impossible d'ingérer le document",
            variant: "destructive",
          });
        }
      } else {
        // ========== TARIFF EXTRACTION (analyze-pdf) ==========
        let analysisData = null;
        let analysisError = null;
        
        try {
          updateFileStatus(fileId, { 
            progress: 65,
            error: "Lancement de l'extraction batch..."
          });
          
          // Utiliser le batch extraction qui accumule les données de toutes les pages
          const batchResult = await runBatchExtraction(
            pdfDoc.id,
            filePath,
            fileId,
            file.name
          );
          
          // Mettre à jour le statut 
          updateFileStatus(fileId, { 
            progress: 95,
            error: `Extraction terminée: ${batchResult.tariff_lines?.length || 0} lignes`
          });
          
          // Utiliser les données accumulées directement (pas de requête DB car previewOnly=true)
          const tariffLines = batchResult.tariff_lines || [];
          const hsCodesFull = batchResult.hs_codes || [];
          const notes = batchResult.notes || [];
          const summary = batchResult.summary || "";
          
          // Construire un fallback de résumé si Claude n'en a pas généré
          const fallbackSummary = `Extraction terminée: ${tariffLines.length} lignes tarifaires, ${hsCodesFull.length} codes SH, ${notes.length} notes`;
          
          analysisData = {
            summary: summary || fallbackSummary,
            key_points: [],
            tariff_lines: tariffLines,
            hs_codes: hsCodesFull,
            hs_codes_full: hsCodesFull,
            notes: notes,
            chapter_info: undefined,
            document_type: "tariff" as const,
            trade_agreements: [],
            full_text: "",
          };
          
        } catch (err: any) {
          console.error("Batch extraction error:", err);
          analysisError = err;
        }

        if (analysisError || !analysisData) {
          console.warn("Analysis error (non-blocking):", analysisError);
          updateFileStatus(fileId, {
            status: "error",
            progress: 100,
            error: analysisError?.message || "Erreur réseau - réessayez",
          });
          toast({
            title: "Erreur d'analyse",
            description: "Connexion perdue ou service surchargé. Réessayez dans quelques instants.",
            variant: "destructive",
          });
        } else {
          // Show preview instead of auto-inserting
          const extractionData: ExtractionData = {
            summary: analysisData?.summary || "",
            key_points: analysisData?.key_points || [],
            hs_codes: analysisData?.hs_codes || [],
            hs_codes_full: analysisData?.hs_codes_full || [],
            tariff_lines: analysisData?.tariff_lines || [],
            notes: analysisData?.notes || [],
            chapter_info: analysisData?.chapter_info,
            pdfId: pdfDoc.id,
            pdfTitle: pdfTitle,
            countryCode: "MA",
            document_type: analysisData?.document_type || "tariff",
            trade_agreements: analysisData?.trade_agreements || [],
            full_text_length: analysisData?.full_text?.length || 0,
          };

          const hsCount = extractionData.hs_codes?.length || 0;
          const tariffCount = extractionData.tariff_lines?.length || 0;

          // Clean up IndexedDB blob on successful extraction (preview is good enough)
          removeStoredFile(fileId);
          
          // Tariff documents need validation
          updateFileStatus(fileId, {
            status: "preview",
            progress: 100,
            pdfId: pdfDoc.id,
            analysis: extractionData,
          });
          
          toast({
            title: "📋 Analyse terminée - Prévisualisation",
            description: `${hsCount} codes SH et ${tariffCount} lignes tarifaires détectés. Cliquez sur "Prévisualiser" pour valider.`,
          });
        }
      }
    } catch (error: any) {
      console.error("Upload error:", error);
      updateFileStatus(fileId, {
        status: "error",
        error: error.message || "Erreur lors de l'upload",
      });
      toast({
        title: "Erreur",
        description: error.message || "Impossible d'uploader le fichier",
        variant: "destructive",
      });
    }
  };

  // Process the queue one by one
  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    
    const nextItem = processNext();
    if (!nextItem) {
      setIsProcessing(false);
      return;
    }

    processingRef.current = true;
    setIsProcessing(true);
    
    // Use the document type stored directly in the queue item (guaranteed to be the one selected at queue time)
    const docType = nextItem.documentType;
    
    await processFile(nextItem.file, nextItem.fileId, docType);
    
    processingRef.current = false;
    
    // Process next file after a small delay
    setTimeout(() => {
      processQueue();
    }, 500);
  }, [processNext, setIsProcessing]);

  // Start processing when files are queued
  useEffect(() => {
    if (!isProcessing && files.some(f => f.status === "queued")) {
      processQueue();
    }
  }, [files, isProcessing, processQueue]);

  // Queue a file for processing with selected document type
  const addToQueue = async (file: File, docType: DocumentType) => {
    const fileId = crypto.randomUUID();
    const uploadedFile: UploadedFile = {
      id: fileId,
      name: file.name,
      size: file.size,
      status: "queued",
      progress: 0,
      countryCode: "MA",
      documentType: docType,
    };
    // Store the actual File blob in IndexedDB for retry resilience
    await storeFile(fileId, file, docType);
    queueFile(file, uploadedFile);
  };

  const openPreview = (file: UploadedFile) => {
    setSelectedFile(file);
    setPreviewDialogOpen(true);
  };

  const handleInsertComplete = () => {
    if (selectedFile) {
      updateFileStatus(selectedFile.id, { status: "success" });
      toast({
        title: "✅ Données insérées",
        description: "Les codes ont été enregistrés en base de données",
      });
    }
    setSelectedFile(null);
  };

  // Récupérer pdfId/filePath depuis la DB pour un fichier en erreur, puis relancer
  // Si le fichier n'existe pas en DB, tenter de le re-uploader depuis IndexedDB
  const recoverAndRetry = async (file: UploadedFile) => {
    updateFileStatus(file.id, { error: "Recherche du fichier en base..." });

    try {
      // 1. Chercher le document en DB par nom de fichier
      const { data: docs, error: searchError } = await supabase
        .from("pdf_documents")
        .select("id, file_path, category")
        .eq("file_name", file.name)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!searchError && docs && docs.length > 0) {
        // Fichier trouvé en DB → mettre à jour l'état et relancer l'analyse
        const doc = docs[0];
        updateFileStatus(file.id, { 
          pdfId: doc.id, 
          filePath: doc.file_path,
          documentType: file.documentType || (doc.category as DocumentType) || "circulaire",
          error: "Fichier récupéré, relance en cours..."
        });

        const recoveredFile: UploadedFile = {
          ...file,
          pdfId: doc.id,
          filePath: doc.file_path,
          documentType: file.documentType || (doc.category as DocumentType) || "circulaire",
        };

        await retryAnalysis(recoveredFile);
        return;
      }

      // 2. Fichier non trouvé en DB → tenter de le récupérer depuis IndexedDB
      updateFileStatus(file.id, { error: "Fichier absent de la base, recherche locale..." });

      const storedBlob = await getStoredFile(file.id);
      
      if (!storedBlob) {
        toast({
          title: "Fichier introuvable",
          description: "Le fichier original n'est plus disponible. Veuillez le re-uploader.",
          variant: "destructive",
        });
        updateFileStatus(file.id, { error: "Fichier introuvable - re-uploadez le PDF" });
        return;
      }

      // 3. Re-uploader complètement depuis le blob IndexedDB
      updateFileStatus(file.id, { 
        status: "uploading",
        progress: 10,
        error: "Re-upload depuis le cache local..." 
      });

      const docType = file.documentType || "circulaire";
      await processFile(storedBlob, file.id, docType);
      
    } catch (err: any) {
      console.error("Recovery error:", err);
      updateFileStatus(file.id, { 
        status: "error",
        error: err.message || "Erreur de récupération" 
      });
      toast({
        title: "Erreur",
        description: err.message || "Impossible de récupérer le fichier",
        variant: "destructive",
      });
    }
  };

  // Relancer l'analyse d'un fichier en erreur - route vers le bon pipeline selon le type
  const retryAnalysis = async (file: UploadedFile) => {
    if (!file.pdfId || !file.filePath) {
      toast({
        title: "Erreur",
        description: "Informations manquantes pour relancer l'analyse. Veuillez re-uploader le fichier.",
        variant: "destructive",
      });
      return;
    }

    // Déterminer le pipeline selon le type de document
    const docType = file.documentType || "tarif";
    const pipeline = DOCUMENT_TYPES.find(d => d.value === docType)?.pipeline || "analyze";

    // Mettre à jour le statut
    updateFileStatus(file.id, { 
      status: "analyzing", 
      progress: 60,
      error: undefined 
    });

    toast({
      title: "🔄 Relance de l'analyse",
      description: pipeline === "ingest" 
        ? "Ingestion réglementaire en cours..." 
        : "Extraction tarifaire page par page...",
    });

    try {
      if (pipeline === "ingest") {
        // ========== LEGAL DOCUMENT INGESTION (RAG) ==========
        const ingestionResult = await runLegalIngestion(
          file.pdfId,
          file.filePath!,
          file.id,
          file.name,
          docType
        );

        // Clean up IndexedDB blob on success
        removeStoredFile(file.id);

        // Handle already_complete or missing result gracefully
        const chunksCreated = ingestionResult?.chunks_created ?? 0;
        const detectedCodes = ingestionResult?.detected_codes_count ?? 0;
        const pagesProcessed = ingestionResult?.pages_processed ?? 0;
        const isAlreadyComplete = ingestionResult?.already_complete === true;
        
        updateFileStatus(file.id, {
          status: "success",
          progress: 100,
          pdfId: file.pdfId,
          error: undefined,
          analysis: {
            summary: isAlreadyComplete 
              ? "Document déjà entièrement traité"
              : `Document ingéré pour RAG: ${chunksCreated} segments, ${detectedCodes} codes SH détectés`,
            key_points: [],
            hs_codes: [],
            tariff_lines: [],
            document_type: "regulatory",
            full_text_length: pagesProcessed * 1000,
          },
        });

        toast({
          title: isAlreadyComplete ? "✅ Document déjà traité" : "✅ Document réglementaire ingéré",
          description: isAlreadyComplete 
            ? "Ce document a déjà été entièrement ingéré."
            : `${chunksCreated} segments créés, ${detectedCodes} codes SH détectés`,
        });
      } else {
        // ========== TARIFF EXTRACTION (analyze-pdf) ==========
        // Supprimer toute extraction existante et runs précédents
        await Promise.all([
          supabase.from("pdf_extractions").delete().eq("pdf_id", file.pdfId),
          supabase.from("pdf_extraction_runs").delete().eq("pdf_id", file.pdfId),
        ]);

        const result = await runBatchExtraction(
          file.pdfId,
          file.filePath!,
          file.id,
          file.name
        );

        const tariffLines = result.tariff_lines || [];
        const hsCodesFull = result.hs_codes || [];
        const notes = result.notes || [];
        
        if (tariffLines.length > 0 || hsCodesFull.length > 0) {
          const extractionDataResult: ExtractionData = {
            summary: result.summary || `Extraction terminée: ${tariffLines.length} lignes tarifaires, ${hsCodesFull.length} codes SH, ${notes.length} notes`,
            key_points: [],
            hs_codes: hsCodesFull,
            hs_codes_full: hsCodesFull,
            tariff_lines: tariffLines,
            notes: notes,
            chapter_info: undefined,
            pdfId: file.pdfId,
            pdfTitle: file.name,
            countryCode: "MA",
            document_type: "tariff",
            trade_agreements: [],
            full_text_length: 0,
          };

          // Clean up IndexedDB blob on success
          removeStoredFile(file.id);
          
          updateFileStatus(file.id, {
            status: "preview",
            progress: 100,
            analysis: extractionDataResult,
            error: undefined,
          });

          toast({
            title: "✅ Analyse terminée",
            description: `${tariffLines.length} lignes tarifaires extraites`,
          });
        } else {
          throw new Error("Aucune donnée tarifaire extraite");
        }
      }
    } catch (err: any) {
      console.error("Retry analysis error:", err);
      
      updateFileStatus(file.id, {
        status: "error",
        progress: 100,
        error: err.message || "Erreur d'analyse",
      });

      toast({
        title: "Erreur",
        description: err.message || "Impossible d'analyser le fichier",
        variant: "destructive",
      });
    }
  };

  // Relancer tous les fichiers en erreur séquentiellement
  const retryAllErrors = async () => {
    const errorFiles = files.filter(f => f.status === "error");
    if (errorFiles.length === 0) return;

    setIsRetryingAll(true);
    toast({
      title: "🔄 Relance globale",
      description: `${errorFiles.length} fichier(s) en erreur à traiter...`,
    });

    let successCount = 0;
    let failCount = 0;

    for (const file of errorFiles) {
      try {
        if (file.pdfId && file.filePath) {
          // pdfId déjà connu → relancer directement
          await retryAnalysis(file);
        } else {
          // pdfId inconnu → récupérer depuis la DB puis relancer
          await recoverAndRetry(file);
        }
        successCount++;
      } catch (err) {
        console.error(`Retry failed for ${file.name}:`, err);
        failCount++;
      }
      // Pause entre chaque fichier pour éviter la surcharge
      await new Promise(r => setTimeout(r, 2000));
    }

    setIsRetryingAll(false);
    toast({
      title: successCount > 0 ? "✅ Relance terminée" : "❌ Échec",
      description: `${successCount} réussi(s), ${failCount} échoué(s) sur ${errorFiles.length}`,
      variant: failCount === errorFiles.length ? "destructive" : "default",
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    Array.from(selectedFiles).forEach((file) => {
      if (file.type === "application/pdf") {
        addToQueue(file, selectedDocType);
      } else {
        toast({
          title: "Format non supporté",
          description: `${file.name} n'est pas un fichier PDF`,
          variant: "destructive",
        });
      }
    });
    
    e.target.value = "";
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const droppedFiles = e.dataTransfer.files;
      Array.from(droppedFiles).forEach((file) => {
        if (file.type === "application/pdf") {
          addToQueue(file, selectedDocType);
        } else {
          toast({
            title: "Format non supporté",
            description: `${file.name} n'est pas un fichier PDF`,
            variant: "destructive",
          });
        }
      });
    },
    [selectedDocType, toast]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getStatusIcon = (status: UploadedFile["status"]) => {
    switch (status) {
      case "queued":
        return <Clock className="h-5 w-5 text-muted-foreground" />;
      case "uploading":
        return <Loader2 className="h-5 w-5 animate-spin text-primary" />;
      case "analyzing":
        return <Brain className="h-5 w-5 animate-pulse text-warning" />;
      case "preview":
        return <Eye className="h-5 w-5 text-primary" />;
      case "success":
        return <CheckCircle2 className="h-5 w-5 text-success" />;
      case "error":
        return <XCircle className="h-5 w-5 text-destructive" />;
    }
  };

  const getStatusLabel = (status: UploadedFile["status"]) => {
    switch (status) {
      case "queued":
        return "En attente";
      case "uploading":
        return "Upload...";
      case "analyzing":
        return "Analyse IA...";
      case "preview":
        return "À valider";
      case "success":
        return "Terminé";
      case "error":
        return "Erreur";
    }
  };

  // Count queued files
  const queuedCount = files.filter(f => f.status === "queued").length;

  // Remove a file from the list (and cleanup storage/DB/IndexedDB if already uploaded)
  const removeFile = useCallback(async (fileToRemove: UploadedFile) => {
    // Clean up IndexedDB blob
    await removeStoredFile(fileToRemove.id);
    
    // If file was already uploaded to DB/storage, clean up
    if (fileToRemove.pdfId) {
      try {
        // Delete from storage
        if (fileToRemove.filePath) {
          await supabase.storage.from("pdf-documents").remove([fileToRemove.filePath]);
        }
        
        // Delete related data
        await supabase.from("pdf_extractions").delete().eq("pdf_id", fileToRemove.pdfId);
        await supabase.from("pdf_extraction_runs").delete().eq("pdf_id", fileToRemove.pdfId);
        await supabase.from("pdf_documents").delete().eq("id", fileToRemove.pdfId);
        
        // Clean up tariff data if exists
        if (fileToRemove.filePath) {
          await supabase.from("country_tariffs").delete().eq("source_pdf", fileToRemove.filePath);
        }
        
        toast({
          title: "Document supprimé",
          description: `${fileToRemove.name} a été supprimé de la base de données.`,
        });
      } catch (error) {
        console.error("Error cleaning up file:", error);
        toast({
          title: "Erreur de suppression",
          description: "Le fichier a été retiré de la liste mais des données peuvent persister.",
          variant: "destructive",
        });
      }
    }
    
    // Remove from local state (uses both context function and localStorage)
    removeFileFromState(fileToRemove.id);
  }, [removeFileFromState, toast]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="admin-page-header animate-fade-in">
        <h1>Upload intelligent</h1>
        <p>
          Déposez vos PDFs — L'IA analyse et vous permet de valider avant insertion
        </p>
      </div>

      {/* Process explanation – step cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-slide-up">
        <div className="step-card">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Upload className="h-5 w-5 text-primary" />
          </div>
          <p className="font-semibold text-sm">1. Upload</p>
          <p className="text-xs text-muted-foreground mt-1">Glissez vos PDFs</p>
        </div>
        <div className="step-card">
          <div className="w-11 h-11 rounded-xl bg-warning/10 flex items-center justify-center mx-auto mb-3">
            <Brain className="h-5 w-5 text-warning" />
          </div>
          <p className="font-semibold text-sm">2. Analyse IA</p>
          <p className="text-xs text-muted-foreground mt-1">Extraction automatique</p>
        </div>
        <div className="step-card">
          <div className="w-11 h-11 rounded-xl bg-destructive/10 flex items-center justify-center mx-auto mb-3">
            <Eye className="h-5 w-5 text-destructive" />
          </div>
          <p className="font-semibold text-sm">3. Prévisualisation</p>
          <p className="text-xs text-muted-foreground mt-1">Correction manuelle</p>
        </div>
        <div className="step-card">
          <div className="w-11 h-11 rounded-xl bg-success/10 flex items-center justify-center mx-auto mb-3">
            <Database className="h-5 w-5 text-success" />
          </div>
          <p className="font-semibold text-sm">4. Insertion</p>
          <p className="text-xs text-muted-foreground mt-1">Données validées</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Drop Zone */}
        <Card className="animate-slide-up card-elevated border-border/20">
          <CardHeader>
            <CardTitle>Déposer des documents</CardTitle>
            <CardDescription>
              Sélectionnez le type puis déposez vos PDFs
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Document Type Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Type de document</label>
              <Select value={selectedDocType} onValueChange={(v) => setSelectedDocType(v as DocumentType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      <div className="flex items-center gap-2">
                        {type.icon}
                        <div>
                          <span className="font-medium">{type.label}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            {type.pipeline === "analyze" ? "(extraction tableaux)" : "(RAG/recherche)"}
                          </span>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {DOCUMENT_TYPES.find(t => t.value === selectedDocType)?.description}
              </p>
            </div>

            {/* Drop Zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`
                relative border-2 border-dashed rounded-2xl p-10 text-center transition-all cursor-pointer
                ${isDragging
                  ? "border-primary bg-primary/5 scale-[1.02]"
                  : "border-border/50 hover:border-primary/30 hover:bg-primary/5"
                }
              `}
            >
              <input
                type="file"
                accept=".pdf"
                multiple
                onChange={handleFileSelect}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className={`w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center transition-all ${isDragging ? "blue-gradient accent-glow" : "bg-primary/10"}`}>
                <Upload className={`h-6 w-6 transition-colors ${isDragging ? "text-white" : "text-primary"}`} />
              </div>
              <p className="text-lg font-semibold mb-1">
                Glissez vos PDFs ici
              </p>
              <p className="text-sm text-muted-foreground">
                ou cliquez pour sélectionner
              </p>
            </div>
            
            {/* Current type indicator */}
            <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-muted/50">
              {DOCUMENT_TYPES.find(t => t.value === selectedDocType)?.icon}
              <span className="text-sm">
                Les fichiers seront traités comme <strong>{DOCUMENT_TYPES.find(t => t.value === selectedDocType)?.label}</strong>
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Upload Queue */}
        <Card className="animate-slide-up card-elevated border-border/20" style={{ animationDelay: "0.1s" }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle>Résultats</CardTitle>
              <CardDescription>
                {files.length === 0
                  ? "En attente de fichiers..."
                  : `${files.filter((f) => f.status === "success").length}/${files.length} traités`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {/* Relancer tout - visible quand il y a des fichiers en erreur */}
              {files.some(f => f.status === "error") && !isProcessing && !isRetryingAll && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={retryAllErrors}
                  className="gap-1 text-primary hover:text-primary"
                >
                  <RotateCcw className="h-4 w-4" />
                  Relancer tout ({files.filter(f => f.status === "error").length})
                </Button>
              )}
              {isRetryingAll && (
                <Button variant="outline" size="sm" disabled className="gap-1">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Relance en cours...
                </Button>
              )}
              {files.length > 0 && !isProcessing && !isRetryingAll && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={async () => {
                    await clearAllStoredFiles();
                    clearAll();
                    toast({
                      title: "Historique vidé",
                      description: "La liste des uploads et le cache local ont été effacés.",
                    });
                  }}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Vider
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <FileText className="h-16 w-16 mb-4 opacity-30" />
                <p className="text-lg">Aucun document</p>
                <p className="text-sm">Uploadez des PDFs pour commencer</p>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-4">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="p-4 border rounded-lg space-y-3 bg-card"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-destructive shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium truncate max-w-[180px]">
                              {file.name}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{formatFileSize(file.size)}</span>
                              {file.documentType && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0">
                                  {DOCUMENT_TYPES.find(t => t.value === file.documentType)?.label || file.documentType}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(file.status)}
                          <Badge
                            variant={
                              file.status === "success"
                                ? "default"
                                : file.status === "error"
                                ? "destructive"
                                : file.status === "preview"
                                ? "secondary"
                                : "secondary"
                            }
                            className="shrink-0"
                          >
                            {getStatusLabel(file.status)}
                          </Badge>
                          {/* Delete button - only show when not actively processing */}
                          {file.status !== "uploading" && file.status !== "analyzing" && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => removeFile(file)}
                              title="Supprimer de la liste"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {(file.status === "uploading" || file.status === "analyzing") && (
                        <Progress value={file.progress} className="h-2" />
                      )}

                      {file.error && (
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-destructive">{file.error}</p>
                          {file.status === "error" && (
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => {
                                if (file.pdfId && file.filePath) {
                                  retryAnalysis(file);
                                } else {
                                  recoverAndRetry(file);
                                }
                              }}
                              className="gap-2 ml-2 shrink-0"
                              disabled={isRetryingAll}
                            >
                              <RotateCcw className="h-4 w-4" />
                              Relancer
                            </Button>
                          )}
                        </div>
                      )}

                      {file.status === "preview" && file.analysis && (
                        <div className="pt-2 border-t space-y-3">
                          <p className="text-sm line-clamp-2">
                            <strong>Résumé:</strong> {file.analysis.summary}
                          </p>
                          <div className="flex items-center justify-between">
                            <div className="flex gap-2 flex-wrap">
                              {/* Affichage adapté selon le type de document */}
                                  {file.analysis.document_type === "regulatory" ? (
                                <>
                                  <Badge variant="outline" className="text-xs bg-muted">
                                    📋 Réglementaire
                                  </Badge>
                                  {file.analysis.document_reference && (
                                    <Badge variant="outline" className="text-xs">
                                      {file.analysis.document_reference}
                                    </Badge>
                                  )}
                                  {(file.analysis.legal_references?.length || 0) > 0 && (
                                    <Badge variant="outline" className="text-xs bg-primary/10 text-primary">
                                      ⚖️ {file.analysis.legal_references?.length} réf. légales
                                    </Badge>
                                  )}
                                  {file.analysis.effective_date && (
                                    <Badge variant="outline" className="text-xs bg-success/10 text-success">
                                      📅 {file.analysis.effective_date}
                                    </Badge>
                                  )}
                                  {(file.analysis.trade_agreements?.length || 0) > 0 && (
                                    <Badge variant="outline" className="text-xs">
                                      {file.analysis.trade_agreements?.length} accord(s)
                                    </Badge>
                                  )}
                                </>
                              ) : (
                                <>
                                  <Badge variant="outline" className="text-xs">
                                    {file.analysis.hs_codes?.length || 0} codes SH
                                  </Badge>
                                  <Badge variant="outline" className="text-xs">
                                    {file.analysis.tariff_lines?.length || 0} lignes tarifaires
                                  </Badge>
                                </>
                              )}
                            </div>
                            <Button 
                              size="sm" 
                              onClick={() => openPreview(file)}
                              className="gap-2"
                            >
                              <Eye className="h-4 w-4" />
                              Prévisualiser
                            </Button>
                          </div>
                        </div>
                      )}

                      {file.status === "success" && file.analysis && (
                        <div className="pt-2 border-t space-y-2">
                          <p className="text-xs text-success flex items-center gap-1">
                            <CheckCircle2 className="h-4 w-4" />
                            {file.analysis.document_type === "regulatory" 
                              ? `Document réglementaire sauvegardé${file.analysis.full_text_length ? ` (${Math.round(file.analysis.full_text_length / 1000)}k caractères)` : ""}`
                              : `${file.analysis.hs_codes?.length || 0} codes SH et ${file.analysis.tariff_lines?.length || 0} lignes tarifaires insérés`
                            }
                          </p>
                          {/* Affichage enrichi pour documents réglementaires */}
                          {file.analysis.document_type === "regulatory" && (
                            <div className="text-xs space-y-1 text-muted-foreground bg-muted/50 p-2 rounded">
                              {file.analysis.document_reference && (
                                <p><strong>📄 Réf:</strong> {file.analysis.document_reference}</p>
                              )}
                              {file.analysis.issuing_authority?.name && (
                                <p><strong>🏛️ Émetteur:</strong> {file.analysis.issuing_authority.name}</p>
                              )}
                              {file.analysis.effective_date && (
                                <p><strong>📅 Application:</strong> {file.analysis.effective_date}</p>
                              )}
                              {(file.analysis.legal_references?.length || 0) > 0 && (
                                <p><strong>⚖️ Réf. légales:</strong> {file.analysis.legal_references?.length} référence(s)</p>
                              )}
                              {(file.analysis.important_dates?.length || 0) > 0 && (
                                <p><strong>📆 Dates clés:</strong> {file.analysis.important_dates?.length} date(s)</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Missing Chunks Panel */}
      <MissingChunksPanel />

      {/* Re-ingestion Panel */}
      <ReingestionPanel />

      {/* Embedding Generation Panel */}
      <EmbeddingPanel />

      {/* Preview Dialog */}
      {selectedFile && selectedFile.analysis && (
        <ExtractionPreviewDialog
          open={previewDialogOpen}
          onOpenChange={setPreviewDialogOpen}
          extractionData={selectedFile.analysis}
          pdfId={selectedFile.pdfId || ""}
          pdfTitle={selectedFile.name}
          countryCode={selectedFile.countryCode || "MA"}
          onInsertComplete={handleInsertComplete}
        />
      )}
    </div>
  );
}
