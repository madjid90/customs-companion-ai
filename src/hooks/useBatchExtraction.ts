import { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

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
  extractionRunId: string | null;
  status: "idle" | "processing" | "paused" | "done" | "error";
  currentPage: number;
  totalPages: number;
  processedPages: number;
  stats: BatchStats;
  error?: string;
}

export interface UseBatchExtractionOptions {
  batchSize?: number;
  delayBetweenBatches?: number;
  onProgress?: (progress: BatchProgress) => void;
  onComplete?: (progress: BatchProgress) => void;
  onError?: (error: string, progress: BatchProgress) => void;
}

// =============================================================================
// HOOK
// =============================================================================

export function useBatchExtraction(options: UseBatchExtractionOptions = {}) {
  const {
    batchSize = 4,
    delayBetweenBatches = 1000,
    onProgress,
    onComplete,
    onError,
  } = options;

  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const abortRef = useRef(false);

  /**
   * Appelle l'Edge Function analyze-pdf en mode batch
   */
  const callBatchApi = useCallback(async (
    pdfId: string,
    filePath: string,
    startPage: number,
    extractionRunId: string | null
  ): Promise<BatchResponse> => {
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
          previewOnly: false,  // Insérer directement
          start_page: startPage,
          max_pages: batchSize,
          extraction_run_id: extractionRunId,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 200)}`);
    }

    return await response.json();
  }, [batchSize]);

  /**
   * Démarre ou reprend l'extraction batch d'un PDF
   */
  const startBatchExtraction = useCallback(async (
    pdfId: string,
    filePath: string,
    existingRunId?: string
  ): Promise<BatchProgress> => {
    abortRef.current = false;
    setIsProcessing(true);

    let currentProgress: BatchProgress = {
      pdfId,
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
          extractionRunId: existingRunId,
          status: "processing",
          currentPage: existingRun.current_page || 1,
          totalPages: existingRun.total_pages || 0,
          processedPages: existingRun.processed_pages || 0,
          stats: statsData || currentProgress.stats,
        };
      }
    }

    setProgress(currentProgress);
    onProgress?.(currentProgress);

    try {
      let done = false;
      let startPage = currentProgress.currentPage;
      let runId = currentProgress.extractionRunId;

      while (!done && !abortRef.current) {
        console.log(`[Batch] Processing pages starting at ${startPage}...`);

        const batchResult = await callBatchApi(pdfId, filePath, startPage, runId);

        // Mettre à jour le run ID si c'est le premier appel
        if (!runId && batchResult.extraction_run_id) {
          runId = batchResult.extraction_run_id;
        }

        // Mettre à jour la progression
        currentProgress = {
          pdfId,
          extractionRunId: runId,
          status: batchResult.done ? "done" : "processing",
          currentPage: batchResult.next_page || batchResult.total_pages,
          totalPages: batchResult.total_pages,
          processedPages: batchResult.processed_pages,
          stats: batchResult.stats,
        };

        setProgress(currentProgress);
        onProgress?.(currentProgress);

        if (batchResult.done) {
          done = true;
          currentProgress.status = "done";
        } else if (batchResult.next_page) {
          startPage = batchResult.next_page;
          
          // Pause entre les batches pour éviter le rate limiting
          if (delayBetweenBatches > 0) {
            await new Promise(r => setTimeout(r, delayBetweenBatches));
          }
        } else {
          // Erreur inattendue
          throw new Error("Réponse batch invalide: next_page manquant");
        }
      }

      if (abortRef.current) {
        currentProgress.status = "paused";
        setProgress(currentProgress);
        
        // Mettre à jour le statut en DB
        if (runId) {
          await supabase
            .from("pdf_extraction_runs")
            .update({ status: "paused" })
            .eq("id", runId);
        }
      } else {
        onComplete?.(currentProgress);
      }

      setIsProcessing(false);
      return currentProgress;

    } catch (error: any) {
      console.error("[Batch] Error:", error);
      
      currentProgress.status = "error";
      currentProgress.error = error.message;
      
      setProgress(currentProgress);
      onError?.(error.message, currentProgress);
      setIsProcessing(false);
      
      return currentProgress;
    }
  }, [callBatchApi, delayBetweenBatches, onProgress, onComplete, onError]);

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
    runId: string
  ): Promise<BatchProgress> => {
    return startBatchExtraction(pdfId, filePath, runId);
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

  return {
    progress,
    isProcessing,
    startBatchExtraction,
    pauseExtraction,
    resumeExtraction,
    getExistingRuns,
  };
}

export default useBatchExtraction;
