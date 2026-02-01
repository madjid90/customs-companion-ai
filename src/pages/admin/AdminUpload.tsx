import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useUploadState, UploadedFile, ExtractionData } from "@/hooks/useUploadState";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
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
  RotateCcw
} from "lucide-react";
import ExtractionPreviewDialog from "@/components/admin/ExtractionPreviewDialog";

export default function AdminUpload() {
  const { files, updateFileStatus, queueFile, processNext, isProcessing, setIsProcessing } = useUploadState();
  const [isDragging, setIsDragging] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<UploadedFile | null>(null);
  const { toast } = useToast();
  const processingRef = useRef(false);
  
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
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
                "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              },
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

  const detectDocumentType = (fileName: string): { category: string; label: string } => {
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

  // Process a single file
  const processFile = async (file: File, fileId: string) => {
    const docType = detectDocumentType(file.name);
    
    updateFileStatus(fileId, { status: "uploading", progress: 10 });

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
        
        // Delete the old document record
        await supabase.from("pdf_documents").delete().eq("id", existing.id);
        
        // Also clean up old tariff data for this document
        await supabase.from("country_tariffs")
          .delete()
          .eq("source_pdf", existing.file_path);
        
        console.log(`[Replace] Old document ${existing.id} deleted, proceeding with new upload`);
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

      // 2. Create PDF document record with auto-detected category
      const { data: pdfDoc, error: insertError } = await supabase
        .from("pdf_documents")
        .insert({
          title: pdfTitle,
          file_name: file.name,
          file_path: filePath,
          file_size_bytes: file.size,
          category: docType.category,
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

      // 3. Utiliser le batch extraction automatique pour gérer les PDFs multi-pages
      // Les données sont accumulées côté client et présentées pour validation AVANT insertion
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
        const stats = batchResult.stats || {};
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
          document_type: tariffLines.length > 0 ? "tariff" : "regulatory",
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
          // Champs enrichis pour documents réglementaires
          document_reference: analysisData?.document_reference,
          publication_date: analysisData?.publication_date,
          effective_date: analysisData?.effective_date,
          expiry_date: analysisData?.expiry_date,
          legal_references: analysisData?.legal_references || [],
          important_dates: analysisData?.important_dates || [],
          issuing_authority: analysisData?.issuing_authority,
          recipients: analysisData?.recipients || [],
          abrogates: analysisData?.abrogates || [],
          modifies: analysisData?.modifies || [],
        };

        const isRegulatoryDoc = extractionData.document_type === "regulatory";
        const hsCount = extractionData.hs_codes?.length || 0;
        const tariffCount = extractionData.tariff_lines?.length || 0;

        // For regulatory documents with no tariff data, mark as success directly
        if (isRegulatoryDoc && hsCount === 0 && tariffCount === 0) {
          updateFileStatus(fileId, {
            status: "success",
            progress: 100,
            pdfId: pdfDoc.id,
            analysis: extractionData,
          });
          
          toast({
            title: "✅ Document réglementaire traité",
            description: `Texte extrait et indexé pour le chat RAG (${extractionData.full_text_length} caractères)`,
          });
        } else {
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
    
    await processFile(nextItem.file, nextItem.fileId);
    
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

  // Queue a file for processing
  const addToQueue = (file: File) => {
    const fileId = crypto.randomUUID();
    const uploadedFile: UploadedFile = {
      id: fileId,
      name: file.name,
      size: file.size,
      status: "queued",
      progress: 0,
      countryCode: "MA",
    };
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

  // Relancer l'analyse d'un fichier en erreur - utilise le batch extraction automatique
  const retryAnalysis = async (file: UploadedFile) => {
    if (!file.pdfId || !file.filePath) {
      toast({
        title: "Erreur",
        description: "Informations manquantes pour relancer l'analyse",
        variant: "destructive",
      });
      return;
    }

    // Supprimer toute extraction existante et runs précédents
    await Promise.all([
      supabase.from("pdf_extractions").delete().eq("pdf_id", file.pdfId),
      supabase.from("pdf_extraction_runs").delete().eq("pdf_id", file.pdfId),
    ]);

    // Mettre à jour le statut
    updateFileStatus(file.id, { 
      status: "analyzing", 
      progress: 60,
      error: undefined 
    });

    toast({
      title: "🔄 Relance de l'analyse batch",
      description: "Extraction automatique page par page...",
    });

    try {
      // Utiliser la fonction batch extraction avec callbacks dynamiques
      // Le résultat contient directement les données accumulées (previewOnly=true)
      const result = await runBatchExtraction(
        file.pdfId,
        file.filePath!,
        file.id,
        file.name
      );

      // Utiliser les données accumulées directement depuis le résultat du batch
      // (pas de requête DB car previewOnly=true ne persiste pas les données)
      const tariffLines = result.tariff_lines || [];
      const hsCodesFull = result.hs_codes || [];
      const notes = result.notes || [];
      
      if (tariffLines.length > 0 || hsCodesFull.length > 0) {
        const extractionDataResult: ExtractionData = {
          summary: `Extraction terminée: ${tariffLines.length} lignes tarifaires, ${hsCodesFull.length} codes SH, ${notes.length} notes`,
          key_points: [],
          hs_codes: hsCodesFull,
          hs_codes_full: hsCodesFull,
          tariff_lines: tariffLines,
          notes: notes,
          chapter_info: undefined,
          pdfId: file.pdfId,
          pdfTitle: file.name,
          countryCode: "MA",
          document_type: tariffLines.length > 0 ? "tariff" : "regulatory",
          trade_agreements: [],
          full_text_length: 0,
        };

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

    } catch (err: any) {
      console.error("Batch retry error:", err);
      
      updateFileStatus(file.id, {
        status: "error",
        progress: 100,
        error: err.message || "Erreur d'analyse batch",
      });

      toast({
        title: "Erreur",
        description: err.message || "Impossible d'analyser le fichier",
        variant: "destructive",
      });
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    Array.from(selectedFiles).forEach((file) => {
      if (file.type === "application/pdf") {
        addToQueue(file);
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
          addToQueue(file);
        } else {
          toast({
            title: "Format non supporté",
            description: `${file.name} n'est pas un fichier PDF`,
            variant: "destructive",
          });
        }
      });
    },
    [queueFile]
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
        return <Loader2 className="h-5 w-5 animate-spin text-accent" />;
      case "analyzing":
        return <Brain className="h-5 w-5 animate-pulse text-warning" />;
      case "preview":
        return <Eye className="h-5 w-5 text-accent" />;
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in">
        <h1 className="text-3xl font-bold text-foreground">Upload intelligent</h1>
        <p className="text-muted-foreground mt-1">
          Déposez vos PDFs — L'IA analyse et vous permet de valider avant insertion
        </p>
      </div>

      {/* Process explanation */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-accent/5 border-accent/20">
          <CardContent className="pt-6 text-center">
            <Upload className="h-8 w-8 mx-auto mb-2 text-accent" />
            <p className="font-medium">1. Upload</p>
            <p className="text-sm text-muted-foreground">Glissez vos PDFs</p>
          </CardContent>
        </Card>
        <Card className="bg-warning/5 border-warning/20">
          <CardContent className="pt-6 text-center">
            <Brain className="h-8 w-8 mx-auto mb-2 text-warning" />
            <p className="font-medium">2. Analyse IA</p>
            <p className="text-sm text-muted-foreground">Extraction automatique</p>
          </CardContent>
        </Card>
        <Card className="bg-accent/5 border-accent/20">
          <CardContent className="pt-6 text-center">
            <Eye className="h-8 w-8 mx-auto mb-2 text-accent" />
            <p className="font-medium">3. Prévisualisation</p>
            <p className="text-sm text-muted-foreground">Correction manuelle</p>
          </CardContent>
        </Card>
        <Card className="bg-success/5 border-success/20">
          <CardContent className="pt-6 text-center">
            <Database className="h-8 w-8 mx-auto mb-2 text-success" />
            <p className="font-medium">4. Insertion</p>
            <p className="text-sm text-muted-foreground">Données validées</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Drop Zone */}
        <Card className="animate-slide-up">
          <CardHeader>
            <CardTitle>Déposer des documents</CardTitle>
            <CardDescription>
              PDFs de tarifs, circulaires, notes, avis de classement...
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`
                relative border-2 border-dashed rounded-xl p-12 text-center transition-all cursor-pointer
                ${isDragging
                  ? "border-accent bg-accent/10 scale-[1.02]"
                  : "border-border hover:border-accent/50 hover:bg-accent/5"
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
              <Upload className={`h-16 w-16 mx-auto mb-4 transition-colors ${isDragging ? "text-accent" : "text-muted-foreground"}`} />
              <p className="text-xl font-medium mb-2">
                Glissez vos PDFs ici
              </p>
              <p className="text-muted-foreground">
                ou cliquez pour sélectionner
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Badge variant="outline">Tarifs douaniers</Badge>
                <Badge variant="outline">Circulaires</Badge>
                <Badge variant="outline">Notes techniques</Badge>
                <Badge variant="outline">Avis de classement</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Upload Queue */}
        <Card className="animate-slide-up" style={{ animationDelay: "0.1s" }}>
          <CardHeader>
            <CardTitle>Résultats</CardTitle>
            <CardDescription>
              {files.length === 0
                ? "En attente de fichiers..."
                : `${files.filter((f) => f.status === "success").length}/${files.length} traités`}
            </CardDescription>
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
                          <FileText className="h-8 w-8 text-destructive shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium truncate max-w-[180px]">
                              {file.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatFileSize(file.size)}
                            </p>
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
                        </div>
                      </div>

                      {(file.status === "uploading" || file.status === "analyzing") && (
                        <Progress value={file.progress} className="h-2" />
                      )}

                      {file.error && (
                        <div className="flex items-center justify-between">
                          <p className="text-sm text-destructive">{file.error}</p>
                          {file.status === "error" && file.pdfId && file.filePath && (
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => retryAnalysis(file)}
                              className="gap-2 ml-2 shrink-0"
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
                                  <Badge variant="outline" className="text-xs bg-accent/10">
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
