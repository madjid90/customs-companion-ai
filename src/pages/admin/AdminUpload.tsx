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

      // 3. Call AI analysis edge function - nouvelle architecture asynchrone
      let analysisData = null;
      let analysisError = null;
      const INITIAL_TIMEOUT_MS = 30000; // 30s pour la réponse initiale (processing marker)
      const MAX_POLL_TIME_MS = 600000; // 10 minutes max de polling
      const POLL_INTERVAL_MS = 5000; // Vérifier toutes les 5 secondes
      
      try {
        // Appel initial - devrait répondre rapidement avec status: "processing"
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), INITIAL_TIMEOUT_MS);
        
        updateFileStatus(fileId, { 
          progress: 65,
          error: undefined
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
          if (response.status === 429 || response.status === 503) {
            throw new Error("Service occupé, réessayez dans quelques instants");
          }
          throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
        }
        
        const initialResponse = await response.json();
        
        // Si on a déjà les données complètes (cache), les utiliser directement
        if (initialResponse.summary && initialResponse.summary !== "__PROCESSING__" && !initialResponse.status) {
          console.log("✅ Immediate response with cached data");
          analysisData = initialResponse;
        } 
        // Si le traitement est asynchrone (status: "processing"), commencer le polling
        else if (initialResponse.status === "processing") {
          console.log("📡 Background processing started, polling for results...");
          
          updateFileStatus(fileId, { 
            progress: 70,
            error: "Analyse IA en cours (peut prendre 1-3 min pour les gros PDFs)..."
          });
          
          // Polling jusqu'à ce que l'extraction soit complète
          const pollStartTime = Date.now();
          let pollCount = 0;
          
          while (Date.now() - pollStartTime < MAX_POLL_TIME_MS) {
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
            pollCount++;
            
            const elapsedSec = Math.round((Date.now() - pollStartTime) / 1000);
            updateFileStatus(fileId, { 
              progress: 70 + Math.min(pollCount * 2, 25),
              error: `Analyse IA en cours... (${elapsedSec}s)`
            });
            
            // Vérifier si l'extraction est complète
            const { data: extraction } = await supabase
              .from("pdf_extractions")
              .select("id, summary, key_points, detected_tariff_changes, mentioned_hs_codes, extracted_text, extracted_data")
              .eq("pdf_id", pdfDoc.id)
              .maybeSingle();
            
            if (extraction && extraction.summary && extraction.summary !== "__PROCESSING__") {
              // Vérifier si c'est une erreur
              if (extraction.summary.startsWith("Erreur:")) {
                throw new Error(extraction.summary);
              }
              
              console.log(`✅ Extraction complete after ${elapsedSec}s`);
              
              const tariffChanges = extraction.detected_tariff_changes as any[] || [];
              const hsCodesRaw = extraction.mentioned_hs_codes as string[] || [];
              const extractedData = extraction.extracted_data as any || {};
              
              // Utiliser hs_codes_full depuis extracted_data (avec descriptions)
              const hsCodesFull = extractedData.hs_codes_full as Array<{code: string; code_clean: string; description: string; level: string}> || [];
              
              // Préférer hs_codes_full (avec descriptions) sinon fallback sur mentioned_hs_codes
              const hsCodes = hsCodesFull.length > 0 
                ? hsCodesFull 
                : hsCodesRaw.map((code: string) => ({
                    code: code,
                    code_clean: code.replace(/[^0-9]/g, ""),
                    description: "",
                    level: code.length <= 4 ? "chapter" : code.length <= 6 ? "heading" : "subheading"
                  }));
              
              analysisData = {
                summary: extraction.summary,
                key_points: extraction.key_points || [],
                tariff_lines: tariffChanges,
                hs_codes: hsCodes,
                hs_codes_full: hsCodesFull,
                chapter_info: extractedData.chapter_info,
                document_type: extractedData.document_type || (tariffChanges.length > 0 ? "tariff" : "regulatory"),
                trade_agreements: extractedData.trade_agreements || [],
                full_text: extraction.extracted_text || "",
              };
              break;
            } else {
              console.log(`⏳ Still processing... (poll ${pollCount}, ${elapsedSec}s elapsed)`);
            }
          }
          
          if (!analysisData) {
            throw new Error("Timeout: L'analyse a pris trop de temps. Le PDF est peut-être trop volumineux.");
          }
        } else {
          // Réponse inattendue
          console.warn("Unexpected response format:", initialResponse);
          throw new Error("Réponse inattendue du serveur");
        }
        
      } catch (err: any) {
        // Gérer les erreurs de timeout/réseau en vérifiant la base
        const isTimeout = err.name === "AbortError";
        const isNetworkError = err.message?.includes("Failed to fetch") || 
                                err.message?.includes("NetworkError");
        
        if (isTimeout || isNetworkError) {
          updateFileStatus(fileId, { 
            progress: 75,
            error: "Connexion perdue, vérification en cours..."
          });
          
          // Attendre un peu puis vérifier si le serveur a terminé
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          const { data: recoveryCheck } = await supabase
            .from("pdf_extractions")
            .select("id, summary, key_points, detected_tariff_changes, mentioned_hs_codes, extracted_text, extracted_data")
            .eq("pdf_id", pdfDoc.id)
            .maybeSingle();
          
          if (recoveryCheck && recoveryCheck.summary && 
              recoveryCheck.summary !== "__PROCESSING__" && 
              !recoveryCheck.summary.startsWith("Erreur:")) {
            console.log("✅ Recovery: extraction found after network error");
            
            const tariffChanges = recoveryCheck.detected_tariff_changes as any[] || [];
            const hsCodesRaw = recoveryCheck.mentioned_hs_codes as string[] || [];
            const extractedData = recoveryCheck.extracted_data as any || {};
            
            // Utiliser hs_codes_full depuis extracted_data (avec descriptions)
            const hsCodesFull = extractedData.hs_codes_full as Array<{code: string; code_clean: string; description: string; level: string}> || [];
            
            // Préférer hs_codes_full (avec descriptions) sinon fallback sur mentioned_hs_codes
            const hsCodes = hsCodesFull.length > 0 
              ? hsCodesFull 
              : hsCodesRaw.map((code: string) => ({
                  code: code,
                  code_clean: code.replace(/[^0-9]/g, ""),
                  description: "",
                  level: code.length <= 4 ? "chapter" : code.length <= 6 ? "heading" : "subheading"
                }));
            
            analysisData = {
              summary: recoveryCheck.summary,
              key_points: recoveryCheck.key_points || [],
              tariff_lines: tariffChanges,
              hs_codes: hsCodes,
              hs_codes_full: hsCodesFull,
              chapter_info: extractedData.chapter_info,
              document_type: extractedData.document_type || (tariffChanges.length > 0 ? "tariff" : "regulatory"),
              trade_agreements: extractedData.trade_agreements || [],
              full_text: recoveryCheck.extracted_text || "",
            };
          } else if (recoveryCheck?.summary === "__PROCESSING__") {
            // Commencer un polling étendu
            const EXTENDED_POLL_TIME = 300000; // 5 minutes
            const pollStartTime = Date.now();
            
            while (Date.now() - pollStartTime < EXTENDED_POLL_TIME) {
              await new Promise(resolve => setTimeout(resolve, 10000));
              
              const elapsedSec = Math.round((Date.now() - pollStartTime) / 1000);
              updateFileStatus(fileId, { 
                progress: 80,
                error: `Analyse en cours... (${elapsedSec}s)`
              });
              
              const { data: pollCheck } = await supabase
                .from("pdf_extractions")
                .select("id, summary, key_points, detected_tariff_changes, mentioned_hs_codes, extracted_text, extracted_data")
                .eq("pdf_id", pdfDoc.id)
                .maybeSingle();
              
              if (pollCheck && pollCheck.summary && 
                  pollCheck.summary !== "__PROCESSING__" && 
                  !pollCheck.summary.startsWith("Erreur:")) {
                const tariffChanges = pollCheck.detected_tariff_changes as any[] || [];
                const extractedData = pollCheck.extracted_data as any || {};
                
                // Utiliser hs_codes_full depuis extracted_data (avec descriptions)
                const hsCodesFull = extractedData.hs_codes_full as Array<{code: string; code_clean: string; description: string; level: string}> || [];
                const hsCodesRaw = pollCheck.mentioned_hs_codes as string[] || [];
                
                // Préférer hs_codes_full (avec descriptions) sinon fallback sur mentioned_hs_codes
                const hsCodes = hsCodesFull.length > 0 
                  ? hsCodesFull 
                  : hsCodesRaw.map((code: string) => ({
                      code: code,
                      code_clean: code.replace(/[^0-9]/g, ""),
                      description: "",
                      level: code.length <= 4 ? "chapter" : code.length <= 6 ? "heading" : "subheading"
                    }));
                
                analysisData = {
                  summary: pollCheck.summary,
                  key_points: pollCheck.key_points || [],
                  tariff_lines: tariffChanges,
                  hs_codes: hsCodes,
                  hs_codes_full: hsCodesFull,
                  chapter_info: extractedData.chapter_info,
                  document_type: extractedData.document_type || (tariffChanges.length > 0 ? "tariff" : "regulatory"),
                  trade_agreements: extractedData.trade_agreements || [],
                  full_text: pollCheck.extracted_text || "",
                };
                break;
              }
            }
          }
        }
        
        if (!analysisData) {
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
          .select("id, summary, key_points, detected_tariff_changes, mentioned_hs_codes, extracted_text, extracted_data")
          .eq("pdf_id", pdfDoc.id)
          .maybeSingle();
        
        // Vérifier que c'est une extraction COMPLÈTE (pas le marqueur PROCESSING)
        if (finalCheck && finalCheck.summary && finalCheck.summary !== "__PROCESSING__") {
          console.log("Extraction found in final check, recovering data...");
          const tariffChanges = finalCheck.detected_tariff_changes as any[] || [];
          const extractedData = finalCheck.extracted_data as any || {};
          
          // Utiliser hs_codes_full depuis extracted_data (avec descriptions)
          const hsCodesFull = extractedData.hs_codes_full as Array<{code: string; code_clean: string; description: string; level: string}> || [];
          const hsCodesRaw = finalCheck.mentioned_hs_codes as string[] || [];
          
          // Préférer hs_codes_full (avec descriptions) sinon fallback sur mentioned_hs_codes
          const hsCodes = hsCodesFull.length > 0 
            ? hsCodesFull 
            : hsCodesRaw.map((code: string) => ({
                code: code,
                code_clean: code.replace(/[^0-9]/g, ""),
                description: "",
                level: code.length <= 4 ? "chapter" : code.length <= 6 ? "heading" : "subheading"
              }));
          
          analysisData = {
            summary: finalCheck.summary,
            key_points: finalCheck.key_points || [],
            tariff_lines: tariffChanges,
            hs_codes: hsCodes,
            hs_codes_full: hsCodesFull,
            chapter_info: extractedData.chapter_info,
            document_type: extractedData.document_type || (tariffChanges.length > 0 ? "tariff" : "regulatory"),
            trade_agreements: extractedData.trade_agreements || [],
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
          hs_codes_full: analysisData?.hs_codes_full || [],
          tariff_lines: analysisData?.tariff_lines || [],
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

    const MAX_POLL_TIME_MS = 600000; // 10 minutes max
    const POLL_INTERVAL_MS = 5000;

    try {
      // Appel initial - devrait répondre rapidement
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

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

      const initialResponse = await response.json();
      let analysisData = null;

      // Si données complètes retournées directement
      if (initialResponse.summary && initialResponse.summary !== "__PROCESSING__" && !initialResponse.status) {
        analysisData = initialResponse;
      }
      // Si traitement asynchrone
      else if (initialResponse.status === "processing") {
        updateFileStatus(file.id, { 
          progress: 70,
          error: "Analyse IA en cours..."
        });

        const pollStartTime = Date.now();
        
        while (Date.now() - pollStartTime < MAX_POLL_TIME_MS) {
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
          
          const elapsedSec = Math.round((Date.now() - pollStartTime) / 1000);
          updateFileStatus(file.id, { 
            progress: 70 + Math.min(Math.floor(elapsedSec / 10), 25),
            error: `Analyse en cours... (${elapsedSec}s)`
          });
          
          const { data: extraction } = await supabase
            .from("pdf_extractions")
            .select("id, summary, key_points, detected_tariff_changes, mentioned_hs_codes, extracted_text, extracted_data")
            .eq("pdf_id", file.pdfId)
            .maybeSingle();
          
          if (extraction && extraction.summary && extraction.summary !== "__PROCESSING__") {
            if (extraction.summary.startsWith("Erreur:")) {
              throw new Error(extraction.summary);
            }
            
            const tariffChanges = extraction.detected_tariff_changes as any[] || [];
            const hsCodesRaw = extraction.mentioned_hs_codes as string[] || [];
            const extractedData = extraction.extracted_data as any || {};
            
            // Utiliser hs_codes_full depuis extracted_data (avec descriptions)
            const hsCodesFull = extractedData.hs_codes_full as Array<{code: string; code_clean: string; description: string; level: string}> || [];
            
            // Préférer hs_codes_full (avec descriptions) sinon fallback sur mentioned_hs_codes
            const hsCodes = hsCodesFull.length > 0 
              ? hsCodesFull 
              : hsCodesRaw.map((code: string) => ({
                  code: code,
                  code_clean: code.replace(/[^0-9]/g, ""),
                  description: "",
                  level: code.length <= 4 ? "chapter" : code.length <= 6 ? "heading" : "subheading"
                }));
            
            analysisData = {
              summary: extraction.summary,
              key_points: extraction.key_points || [],
              tariff_lines: tariffChanges,
              hs_codes: hsCodes,
              hs_codes_full: hsCodesFull,
              chapter_info: extractedData.chapter_info,
              document_type: extractedData.document_type || (tariffChanges.length > 0 ? "tariff" : "regulatory"),
              trade_agreements: extractedData.trade_agreements || [],
              full_text: extraction.extracted_text || "",
            };
            break;
          }
        }
        
        if (!analysisData) {
          throw new Error("Timeout: L'analyse a pris trop de temps");
        }
      }

      if (analysisData) {
        const extractionData: ExtractionData = {
          summary: analysisData.summary || "",
          key_points: analysisData.key_points || [],
          hs_codes: analysisData.hs_codes || [],
          hs_codes_full: analysisData.hs_codes_full || [],
          tariff_lines: analysisData.tariff_lines || [],
          chapter_info: analysisData.chapter_info,
          pdfId: file.pdfId,
          pdfTitle: file.name,
          countryCode: "MA",
          document_type: analysisData.document_type || "tariff",
          trade_agreements: analysisData.trade_agreements || [],
          full_text_length: analysisData.full_text?.length || 0,
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
      }

    } catch (err: any) {
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
