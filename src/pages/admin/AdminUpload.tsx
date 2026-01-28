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

  const detectDocumentType = (fileName: string): { category: string; label: string } => {
    const name = fileName.toLowerCase();
    
    if (name.includes("tarif") || name.includes("ddi") || name.includes("chapitre")) {
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
      const pdfTitle = file.name.replace(".pdf", "").replace(/_/g, " ");
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

      // 3. Call AI analysis edge function with AbortController timeout and retry
      let analysisData = null;
      let analysisError = null;
      const MAX_RETRIES = 3;
      const TIMEOUT_MS = 300000; // 5 minutes timeout for large PDFs
      
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          // Create AbortController for timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
          
          updateFileStatus(fileId, { 
            progress: 65 + attempt * 5,
            error: attempt > 0 ? `Tentative ${attempt + 1}/${MAX_RETRIES + 1}...` : undefined
          });
          
          // Use fetch directly with AbortSignal for better timeout control
          const response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-pdf`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
                "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              },
              body: JSON.stringify({ 
                pdfId: pdfDoc.id,
                filePath: filePath,
                previewOnly: true
              }),
              signal: controller.signal,
            }
          );
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            const errorText = await response.text();
            // Check if it's a rate limit error
            if (response.status === 429 || response.status === 503) {
              if (attempt < MAX_RETRIES) {
                const waitTime = 10000 * (attempt + 1);
                console.log(`Rate limited, retry ${attempt + 1}/${MAX_RETRIES} in ${waitTime/1000}s...`);
                updateFileStatus(fileId, { 
                  progress: 70 + attempt * 5,
                  error: `Service occupé, nouvelle tentative dans ${waitTime/1000}s...`
                });
                await new Promise(resolve => setTimeout(resolve, waitTime));
                continue;
              }
            }
            throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
          }
          
          analysisData = await response.json();
          break;
          
        } catch (err: any) {
          // Handle abort/timeout or network errors
          const isTimeout = err.name === "AbortError";
          const isNetworkError = err.message?.includes("Failed to fetch") || 
                                  err.message?.includes("NetworkError") ||
                                  err.message?.includes("network");
          
          if (isTimeout || isNetworkError) {
            // Le serveur peut encore être en train de traiter - polling avec patience
            updateFileStatus(fileId, { 
              progress: 75,
              error: `Connexion perdue, vérification en cours...`
            });
            
            // Polling ÉTENDU: vérifier toutes les 10 secondes pendant 5 minutes max
            // (PDFs volumineux peuvent prendre 2-3 minutes avec Claude)
            const MAX_POLLS = 30;  // 5 minutes max
            const POLL_INTERVAL = 10000;
            
            for (let poll = 0; poll < MAX_POLLS; poll++) {
              updateFileStatus(fileId, { 
                progress: 75 + Math.min(poll, 15),
                error: `Analyse en cours... (${poll * 10}s/${MAX_POLLS * 10}s)`
              });
              
              await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
              
              // Vérifier si l'extraction existe déjà en base
              const { data: existingExtraction } = await supabase
                .from("pdf_extractions")
                .select("id, summary, key_points, detected_tariff_changes, mentioned_hs_codes, extracted_text")
                .eq("pdf_id", pdfDoc.id)
                .maybeSingle();
              
              // Vérifier si c'est une extraction COMPLÈTE (pas juste le marqueur PROCESSING)
              if (existingExtraction && existingExtraction.summary && existingExtraction.summary !== "__PROCESSING__") {
                // L'extraction existe! Récupérer les données depuis la base
                console.log(`✅ Extraction found in database after ${(poll + 1) * 10}s polling`);
                
                const tariffChanges = existingExtraction.detected_tariff_changes as any[] || [];
                const hsCodesRaw = existingExtraction.mentioned_hs_codes as string[] || [];
                
                analysisData = {
                  summary: existingExtraction.summary,
                  key_points: existingExtraction.key_points || [],
                  tariff_lines: tariffChanges,
                  hs_codes: hsCodesRaw.map((code: string) => ({
                    code: code,
                    code_clean: code.replace(/[^0-9]/g, ""),
                    description: "",
                    level: code.length <= 4 ? "chapter" : code.length <= 6 ? "heading" : "subheading"
                  })),
                  document_type: tariffChanges.length > 0 ? "tariff" : "regulatory",
                  full_text: existingExtraction.extracted_text || "",
                };
                break;
              } else if (existingExtraction?.summary === "__PROCESSING__") {
                // Le serveur traite encore - continuer à attendre
                console.log(`⏳ Server still processing PDF... (poll ${poll + 1})`);
              }
            }
            
            // Si trouvé via polling, sortir de la boucle retry
            if (analysisData) {
              break;
            }
            
            // Si pas trouvé et qu'il reste des tentatives, réessayer l'appel
            if (attempt < MAX_RETRIES) {
              const waitTime = 5000;
              console.log(`${isTimeout ? "Timeout" : "Network error"}, retry ${attempt + 1}/${MAX_RETRIES}...`);
              updateFileStatus(fileId, { 
                progress: 70,
                error: `Réessai ${attempt + 1}/${MAX_RETRIES}...`
              });
              await new Promise(resolve => setTimeout(resolve, waitTime));
              continue;
            }
          }
          
          analysisError = err;
        }
      }

      // NOUVEAU: Après toutes les tentatives, vérifier une dernière fois si l'extraction existe
      if ((analysisError || !analysisData)) {
        updateFileStatus(fileId, { 
          progress: 90,
          error: `Vérification finale de l'extraction...`
        });
        
        const { data: finalCheck } = await supabase
          .from("pdf_extractions")
          .select("id, summary, key_points, detected_tariff_changes, mentioned_hs_codes, extracted_text")
          .eq("pdf_id", pdfDoc.id)
          .maybeSingle();
        
        // Vérifier que c'est une extraction COMPLÈTE (pas le marqueur PROCESSING)
        if (finalCheck && finalCheck.summary && finalCheck.summary !== "__PROCESSING__") {
          console.log("Extraction found in final check, recovering data...");
          const tariffChanges = finalCheck.detected_tariff_changes as any[] || [];
          const hsCodesRaw = finalCheck.mentioned_hs_codes as string[] || [];
          
          analysisData = {
            summary: finalCheck.summary,
            key_points: finalCheck.key_points || [],
            tariff_lines: tariffChanges,
            hs_codes: hsCodesRaw.map((code: string) => ({
              code: code,
              code_clean: code.replace(/[^0-9]/g, ""),
              description: "",
              level: code.length <= 4 ? "chapter" : code.length <= 6 ? "heading" : "subheading"
            })),
            document_type: tariffChanges.length > 0 ? "tariff" : "regulatory",
            full_text: finalCheck.extracted_text || "",
          };
          analysisError = null;
        }
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
          tariff_lines: analysisData?.tariff_lines || [],
          chapter_info: analysisData?.chapter_info,
          pdfId: pdfDoc.id,
          pdfTitle: pdfTitle,
          countryCode: "MA",
          document_type: analysisData?.document_type || "tariff",
          trade_agreements: analysisData?.trade_agreements || [],
          full_text_length: analysisData?.full_text?.length || 0,
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

  // Relancer l'analyse d'un fichier en erreur
  const retryAnalysis = async (file: UploadedFile) => {
    if (!file.pdfId || !file.filePath) {
      toast({
        title: "Erreur",
        description: "Informations manquantes pour relancer l'analyse",
        variant: "destructive",
      });
      return;
    }

    // Supprimer toute extraction existante (marqueur PROCESSING ou erreur)
    await supabase
      .from("pdf_extractions")
      .delete()
      .eq("pdf_id", file.pdfId);

    // Mettre à jour le statut
    updateFileStatus(file.id, { 
      status: "analyzing", 
      progress: 60,
      error: undefined 
    });

    toast({
      title: "🔄 Relance de l'analyse",
      description: "Analyse IA en cours...",
    });

    // Relancer l'analyse
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-pdf`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ 
            pdfId: file.pdfId,
            filePath: file.filePath,
            previewOnly: true
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const analysisData = await response.json();

      const extractionData: ExtractionData = {
        summary: analysisData?.summary || "",
        key_points: analysisData?.key_points || [],
        hs_codes: analysisData?.hs_codes || [],
        tariff_lines: analysisData?.tariff_lines || [],
        chapter_info: analysisData?.chapter_info,
        pdfId: file.pdfId,
        pdfTitle: file.name,
        countryCode: "MA",
        document_type: analysisData?.document_type || "tariff",
        trade_agreements: analysisData?.trade_agreements || [],
        full_text_length: analysisData?.full_text?.length || 0,
      };

      updateFileStatus(file.id, {
        status: "preview",
        progress: 100,
        analysis: extractionData,
        error: undefined,
      });

      toast({
        title: "✅ Analyse terminée",
        description: `${extractionData.hs_codes?.length || 0} codes SH et ${extractionData.tariff_lines?.length || 0} lignes détectées`,
      });

    } catch (err: any) {
      // Vérifier si l'extraction a été créée malgré l'erreur réseau
      const { data: extraction } = await supabase
        .from("pdf_extractions")
        .select("id, summary, key_points, detected_tariff_changes, mentioned_hs_codes, extracted_text")
        .eq("pdf_id", file.pdfId)
        .maybeSingle();

      if (extraction && extraction.summary && extraction.summary !== "__PROCESSING__") {
        const tariffChanges = extraction.detected_tariff_changes as any[] || [];
        const hsCodesRaw = extraction.mentioned_hs_codes as string[] || [];

        const extractionData: ExtractionData = {
          summary: extraction.summary,
          key_points: extraction.key_points as string[] || [],
          hs_codes: hsCodesRaw.map((code: string) => ({
            code: code,
            code_clean: code.replace(/[^0-9]/g, ""),
            description: "",
            level: code.length <= 4 ? "chapter" : code.length <= 6 ? "heading" : "subheading"
          })),
          tariff_lines: tariffChanges,
          pdfId: file.pdfId,
          pdfTitle: file.name,
          countryCode: "MA",
          document_type: tariffChanges.length > 0 ? "tariff" : "regulatory",
          full_text_length: extraction.extracted_text?.length || 0,
        };

        updateFileStatus(file.id, {
          status: "preview",
          progress: 100,
          analysis: extractionData,
          error: undefined,
        });

        toast({
          title: "✅ Extraction récupérée",
          description: "L'analyse a réussi côté serveur",
        });
      } else {
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
                                  {(file.analysis.trade_agreements?.length || 0) > 0 && (
                                    <Badge variant="outline" className="text-xs">
                                      {file.analysis.trade_agreements?.length} accord(s)
                                    </Badge>
                                  )}
                                  {(file.analysis.full_text_length || 0) > 0 && (
                                    <Badge variant="outline" className="text-xs bg-success/10 text-success">
                                      ✓ Texte extrait
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
                        <div className="pt-2 border-t">
                          <p className="text-xs text-success flex items-center gap-1">
                            <CheckCircle2 className="h-4 w-4" />
                            {file.analysis.document_type === "regulatory" 
                              ? `Document réglementaire sauvegardé${file.analysis.full_text_length ? ` (${Math.round(file.analysis.full_text_length / 1000)}k caractères)` : ""}`
                              : `${file.analysis.hs_codes?.length || 0} codes SH et ${file.analysis.tariff_lines?.length || 0} lignes tarifaires insérés`
                            }
                          </p>
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
