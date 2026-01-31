import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

// =============================================================================
// TYPES
// =============================================================================

export interface BatchStats {
  tariff_lines_inserted: number;
  hs_codes_inserted: number;
  notes_inserted: number;
  pages_skipped: number;
  errors: string[];
}

export interface BatchResponse {
  extraction_run_id: string;
  done: boolean;
  next_page: number | null;
  processed_pages: number;
  total_pages: number;
  stats: BatchStats;
  status: "processing" | "done" | "error";
  pdfId: string;
  pdfTitle?: string;
  countryCode?: string;
  error?: string;
}

export interface BatchProgress {
  pdfId: string;
  pdfTitle?: string;
  extractionRunId: string | null;
  status: "idle" | "processing" | "paused" | "done" | "error";
  currentPage: number;
  totalPages: number;
  processedPages: number;
  stats: BatchStats;
  error?: string;
  startTime?: number;
  elapsedMs?: number;
  estimatedRemainingMs?: number;
}

export interface UseBatchExtractionOptions {
  batchSize?: number;
  delayBetweenBatches?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  onProgress?: (progress: BatchProgress) => void;
  onComplete?: (progress: BatchProgress) => void;
  onError?: (error: string, progress: BatchProgress) => void;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_BATCH_SIZE = 4;
const DEFAULT_DELAY_BETWEEN_BATCHES = 1500;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 5000;
const FETCH_TIMEOUT_MS = 300000; // 5 minutes par batch

// =============================================================================
// HOOK
// =============================================================================

export function useBatchExtraction(options: UseBatchExtractionOptions = {}) {
  const {
    batchSize = DEFAULT_BATCH_SIZE,
    delayBetweenBatches = DEFAULT_DELAY_BETWEEN_BATCHES,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY,
    onProgress,
    onComplete,
    onError,
  } = options;

  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const abortRef = useRef(false);
  const startTimeRef = useRef<number>(0);

  /**
   * Met à jour le temps écoulé et estimation restante
   */
  const updateTiming = useCallback((prog: BatchProgress): BatchProgress => {
    const now = Date.now();
    const elapsed = startTimeRef.current ? now - startTimeRef.current : 0;
    
    // Estimation basée sur la vitesse actuelle
    let estimatedRemaining: number | undefined;
    if (prog.processedPages > 0 && prog.totalPages > prog.processedPages) {
      const msPerPage = elapsed / prog.processedPages;
      const remainingPages = prog.totalPages - prog.processedPages;
      estimatedRemaining = msPerPage * remainingPages;
    }
    
    return {
      ...prog,
      elapsedMs: elapsed,
      estimatedRemainingMs: estimatedRemaining,
    };
  }, []);

  /**
   * Appelle l'Edge Function analyze-pdf en mode batch avec retry
   */
  const callBatchApi = useCallback(async (
    pdfId: string,
    filePath: string,
    startPage: number,
    extractionRunId: string | null,
    retryCount = 0
  ): Promise<BatchResponse> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
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
            pdfId,
            filePath,
            previewOnly: false,
            start_page: startPage,
            max_pages: batchSize,
            extraction_run_id: extractionRunId,
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (response.status === 429) {
        // Rate limited - retry after delay
        if (retryCount < maxRetries) {
          console.log(`[Batch] Rate limited, retry ${retryCount + 1}/${maxRetries} in ${retryDelayMs}ms...`);
          toast({
            title: "Rate limit atteint",
            description: `Nouvelle tentative dans ${retryDelayMs / 1000}s...`,
            variant: "default",
          });
          await new Promise(r => setTimeout(r, retryDelayMs * (retryCount + 1)));
          return callBatchApi(pdfId, filePath, startPage, extractionRunId, retryCount + 1);
        }
        throw new Error("Limite de requêtes dépassée. Réessayez plus tard.");
      }

      if (!response.ok) {
        const errorText = await response.text();
        
        // Retry on 5xx errors
        if (response.status >= 500 && retryCount < maxRetries) {
          console.log(`[Batch] Server error ${response.status}, retry ${retryCount + 1}/${maxRetries}...`);
          await new Promise(r => setTimeout(r, retryDelayMs));
          return callBatchApi(pdfId, filePath, startPage, extractionRunId, retryCount + 1);
        }
        
        throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
      }

      return await response.json();
      
    } catch (err: any) {
      clearTimeout(timeoutId);
      
      if (err.name === 'AbortError') {
        // Timeout - check if extraction continued in background
        console.log(`[Batch] Timeout after ${FETCH_TIMEOUT_MS}ms, checking backend status...`);
        
        if (extractionRunId) {
          // Vérifier si l'extraction a quand même progressé
          const { data: run } = await supabase
            .from("pdf_extraction_runs")
            .select("*")
            .eq("id", extractionRunId)
            .single();
          
          if (run && run.current_page > startPage) {
            console.log(`[Batch] Backend progressed to page ${run.current_page}, continuing...`);
            const statsData = run.stats as unknown as BatchStats | null;
            return {
              extraction_run_id: extractionRunId,
              done: run.status === "done",
              next_page: run.status === "done" ? null : run.current_page,
              processed_pages: run.processed_pages || 0,
              total_pages: run.total_pages || 0,
              stats: statsData || {
                tariff_lines_inserted: 0,
                hs_codes_inserted: 0,
                notes_inserted: 0,
                pages_skipped: 0,
                errors: [],
              },
              status: run.status as "processing" | "done" | "error",
              pdfId,
            };
          }
        }
        
        throw new Error("Timeout - l'extraction a pris trop de temps. Réessayez avec un batch plus petit.");
      }
      
      // Network error - retry
      if (err.message.includes("Failed to fetch") && retryCount < maxRetries) {
        console.log(`[Batch] Network error, retry ${retryCount + 1}/${maxRetries}...`);
        await new Promise(r => setTimeout(r, retryDelayMs));
        return callBatchApi(pdfId, filePath, startPage, extractionRunId, retryCount + 1);
      }
      
      throw err;
    }
  }, [batchSize, maxRetries, retryDelayMs]);

  /**
   * Démarre ou reprend l'extraction batch d'un PDF
   */
  const startBatchExtraction = useCallback(async (
    pdfId: string,
    filePath: string,
    existingRunId?: string,
    pdfTitle?: string
  ): Promise<BatchProgress> => {
    abortRef.current = false;
    setIsProcessing(true);
    startTimeRef.current = Date.now();

    let currentProgress: BatchProgress = {
      pdfId,
      pdfTitle,
      extractionRunId: existingRunId || null,
      status: "processing",
      currentPage: 1,
      totalPages: 0,
      processedPages: 0,
      stats: {
        tariff_lines_inserted: 0,
        hs_codes_inserted: 0,
        notes_inserted: 0,
        pages_skipped: 0,
        errors: [],
      },
      startTime: startTimeRef.current,
    };

    // Si reprise, récupérer l'état existant
    if (existingRunId) {
      const { data: existingRun } = await supabase
        .from("pdf_extraction_runs")
        .select("*")
        .eq("id", existingRunId)
        .single();

      if (existingRun) {
        const statsData = existingRun.stats as unknown as BatchStats | null;
        currentProgress = {
          pdfId,
          pdfTitle: existingRun.file_name || pdfTitle,
          extractionRunId: existingRunId,
          status: "processing",
          currentPage: existingRun.current_page || 1,
          totalPages: existingRun.total_pages || 0,
          processedPages: existingRun.processed_pages || 0,
          stats: statsData || currentProgress.stats,
          startTime: startTimeRef.current,
        };
        
        console.log(`[Batch] Resuming from page ${currentProgress.currentPage}/${currentProgress.totalPages}`);
      }
    }

    setProgress(updateTiming(currentProgress));
    onProgress?.(updateTiming(currentProgress));

    try {
      let done = false;
      let startPage = currentProgress.currentPage;
      let runId = currentProgress.extractionRunId;
      let consecutiveErrors = 0;

      while (!done && !abortRef.current) {
        console.log(`[Batch] Processing pages starting at ${startPage}...`);

        try {
          const batchResult = await callBatchApi(pdfId, filePath, startPage, runId);
          consecutiveErrors = 0; // Reset on success

          // Mettre à jour le run ID si c'est le premier appel
          if (!runId && batchResult.extraction_run_id) {
            runId = batchResult.extraction_run_id;
          }

          // Mettre à jour la progression
          currentProgress = {
            pdfId,
            pdfTitle: batchResult.pdfTitle || pdfTitle,
            extractionRunId: runId,
            status: batchResult.done ? "done" : "processing",
            currentPage: batchResult.next_page || batchResult.total_pages,
            totalPages: batchResult.total_pages,
            processedPages: batchResult.processed_pages,
            stats: batchResult.stats,
            startTime: startTimeRef.current,
          };

          const progressWithTiming = updateTiming(currentProgress);
          setProgress(progressWithTiming);
          onProgress?.(progressWithTiming);

          if (batchResult.done) {
            done = true;
            currentProgress.status = "done";
            
            toast({
              title: "Extraction terminée",
              description: `${currentProgress.stats.tariff_lines_inserted} lignes tarifaires extraites`,
            });
          } else if (batchResult.next_page) {
            startPage = batchResult.next_page;
            
            // Pause entre les batches pour éviter le rate limiting
            if (delayBetweenBatches > 0) {
              await new Promise(r => setTimeout(r, delayBetweenBatches));
            }
          } else {
            throw new Error("Réponse batch invalide: next_page manquant");
          }
          
        } catch (batchErr: any) {
          consecutiveErrors++;
          console.error(`[Batch] Error (attempt ${consecutiveErrors}):`, batchErr.message);
          
          if (consecutiveErrors >= maxRetries) {
            throw batchErr;
          }
          
          // Log error and continue
          currentProgress.stats.errors.push(`Batch starting ${startPage}: ${batchErr.message}`);
          
          // Attendre avant de réessayer
          await new Promise(r => setTimeout(r, retryDelayMs * consecutiveErrors));
        }
      }

      if (abortRef.current) {
        currentProgress.status = "paused";
        setProgress(updateTiming(currentProgress));
        
        // Mettre à jour le statut en DB
        if (runId) {
          await supabase
            .from("pdf_extraction_runs")
            .update({ status: "paused" })
            .eq("id", runId);
        }
        
        toast({
          title: "Extraction en pause",
          description: `${currentProgress.processedPages}/${currentProgress.totalPages} pages traitées`,
        });
      } else {
        onComplete?.(updateTiming(currentProgress));
      }

      setIsProcessing(false);
      return updateTiming(currentProgress);

    } catch (error: any) {
      console.error("[Batch] Fatal error:", error);
      
      currentProgress.status = "error";
      currentProgress.error = error.message;
      
      const progressWithTiming = updateTiming(currentProgress);
      setProgress(progressWithTiming);
      onError?.(error.message, progressWithTiming);
      setIsProcessing(false);
      
      toast({
        title: "Erreur d'extraction",
        description: error.message,
        variant: "destructive",
      });
      
      return progressWithTiming;
    }
  }, [callBatchApi, delayBetweenBatches, maxRetries, retryDelayMs, updateTiming, onProgress, onComplete, onError]);

  /**
   * Met en pause l'extraction en cours
   */
  const pauseExtraction = useCallback(() => {
    console.log("[Batch] Pause requested");
    abortRef.current = true;
  }, []);

  /**
   * Reprend une extraction en pause
   */
  const resumeExtraction = useCallback(async (
    pdfId: string,
    filePath: string,
    runId: string,
    pdfTitle?: string
  ): Promise<BatchProgress> => {
    return startBatchExtraction(pdfId, filePath, runId, pdfTitle);
  }, [startBatchExtraction]);

  /**
   * Récupère les runs d'extraction existants pour un PDF
   */
  const getExistingRuns = useCallback(async (pdfId: string) => {
    const { data, error } = await supabase
      .from("pdf_extraction_runs")
      .select("*")
      .eq("pdf_id", pdfId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Batch] Error fetching runs:", error);
      return [];
    }

    return data || [];
  }, []);

  /**
   * Récupère le dernier run non-terminé pour un PDF
   */
  const getLatestIncompleteRun = useCallback(async (pdfId: string) => {
    const { data, error } = await supabase
      .from("pdf_extraction_runs")
      .select("*")
      .eq("pdf_id", pdfId)
      .in("status", ["processing", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[Batch] Error fetching incomplete run:", error);
      return null;
    }

    return data;
  }, []);

  /**
   * Annule un run d'extraction
   */
  const cancelExtraction = useCallback(async (runId: string) => {
    abortRef.current = true;
    
    const { error } = await supabase
      .from("pdf_extraction_runs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", runId);
    
    if (error) {
      console.error("[Batch] Error cancelling run:", error);
    }
    
    setIsProcessing(false);
    setProgress(null);
  }, []);

  return {
    progress,
    isProcessing,
    startBatchExtraction,
    pauseExtraction,
    resumeExtraction,
    cancelExtraction,
    getExistingRuns,
    getLatestIncompleteRun,
  };
}

export default useBatchExtraction;
