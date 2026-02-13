import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAuthHeaders } from "@/lib/authHeaders";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  FileText,
  Loader2,
  PlayCircle,
  StopCircle,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface MissingCircular {
  pdf_id: string;
  title: string;
  file_path: string;
  file_name: string;
  publication_date: string | null;
  reference_number: string | null;
  source_id: number | null;
  has_legal_source: boolean;
}

interface BatchState {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  currentTitle: string;
  isRunning: boolean;
}

interface ItemProgress {
  pdfId: string;
  status: "downloading" | "ingesting" | "done" | "error";
  currentPage: number;
  totalPages: number;
  chunksCreated: number;
  error?: string;
}

export default function MissingChunksPanel() {
  const [circulars, setCirculars] = useState<MissingCircular[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemProgress, setItemProgress] = useState<ItemProgress | null>(null);
  const [batchState, setBatchState] = useState<BatchState | null>(null);
  const cancelRef = useRef(false);
  const { toast } = useToast();

  const loadMissing = useCallback(async () => {
    setLoading(true);
    try {
      // Use RPC with type cast to avoid type generation dependency
      const { data, error } = await supabase.rpc(
        "get_circulars_missing_chunks" as any
      );

      if (error) throw error;

      const results: MissingCircular[] = ((data as any[]) || []).map((r: any) => ({
        pdf_id: r.pdf_id,
        title: r.title,
        file_path: r.file_path,
        file_name: r.file_name,
        publication_date: r.publication_date,
        reference_number: r.reference_number,
        source_id: r.source_id,
        has_legal_source: Boolean(r.source_id),
      }));

      setCirculars(results);
    } catch (err) {
      console.error("Error loading missing circulars:", err);
      toast({
        title: "Erreur",
        description: "Impossible de charger les circulaires manquantes",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadMissing();
  }, [loadMissing]);

  const reingestOne = useCallback(async (circular: MissingCircular) => {
    const BATCH_SIZE = 1;
    const FETCH_TIMEOUT_MS = 180000;
    const DELAY_BETWEEN_BATCHES = 2500;

    setItemProgress({
      pdfId: circular.pdf_id,
      status: "downloading",
      currentPage: 0,
      totalPages: 0,
      chunksCreated: 0,
    });

    // If has existing legal_sources with 0 chunks, clean up first
    if (circular.source_id) {
      await Promise.all([
        supabase.from("legal_chunks").delete().eq("source_id", circular.source_id),
        supabase.from("hs_evidence").delete().eq("source_id", circular.source_id),
      ]);
      await supabase.from("legal_sources").update({ total_chunks: 0 }).eq("id", circular.source_id);
    }

    // Download PDF
    const { data: pdfBlob, error: downloadError } = await supabase.storage
      .from("pdf-documents")
      .download(circular.file_path);

    if (downloadError || !pdfBlob) {
      throw new Error(`Téléchargement échoué: ${downloadError?.message}`);
    }

    const arrayBuffer = await pdfBlob.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
    );

    setItemProgress(prev => prev ? { ...prev, status: "ingesting" } : null);

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

    const sourceRef = circular.reference_number || circular.file_name.replace(".pdf", "");

    // First batch
    const firstResponse = await fetchWithTimeout({
      source_type: "circular",
      source_ref: sourceRef,
      title: circular.title || sourceRef,
      pdf_base64: base64,
      country_code: "MA",
      generate_embeddings: true,
      detect_hs_codes: true,
      batch_mode: true,
      start_page: 1,
      end_page: BATCH_SIZE,
      ...(circular.source_id ? { source_id: circular.source_id } : {}),
    });

    if (!firstResponse.ok) {
      const errorText = await firstResponse.text();
      throw new Error(`HTTP ${firstResponse.status}: ${errorText.substring(0, 200)}`);
    }

    const firstResult = await firstResponse.json();
    if (!firstResult.success) throw new Error(firstResult.error || "Erreur d'ingestion");

    if (firstResult.already_complete) {
      setItemProgress(prev => prev ? { ...prev, status: "done", chunksCreated: 0 } : null);
      return { chunks: 0, pages: 0 };
    }

    let sourceId = firstResult.source_id || circular.source_id;
    let totalPages = firstResult.total_pages || BATCH_SIZE;
    let processedPages = firstResult.pages_processed || BATCH_SIZE;
    let totalChunks = firstResult.chunks_created || 0;

    setItemProgress({
      pdfId: circular.pdf_id,
      status: "ingesting",
      currentPage: processedPages,
      totalPages,
      chunksCreated: totalChunks,
    });

    // Remaining pages
    let currentPage = 1 + BATCH_SIZE;
    while (currentPage <= totalPages) {
      if (cancelRef.current) break;
      
      const endPage = Math.min(currentPage + BATCH_SIZE - 1, totalPages);
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));

      let batchSuccess = false;
      for (let attempt = 0; attempt < 3 && !batchSuccess; attempt++) {
        try {
          if (attempt > 0) await new Promise(r => setTimeout(r, 3000 * attempt));

          const batchResponse = await fetchWithTimeout({
            source_type: "circular",
            source_ref: sourceRef,
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
            if (attempt === 2) break;
            continue;
          }

          const batchResult = await batchResponse.json();
          if (batchResult.success) {
            processedPages += batchResult.pages_processed || 0;
            totalChunks += batchResult.chunks_created || 0;
            batchSuccess = true;
            setItemProgress({
              pdfId: circular.pdf_id,
              status: "ingesting",
              currentPage: processedPages,
              totalPages,
              chunksCreated: totalChunks,
            });
          }
        } catch (err: any) {
          console.warn(`[MissingChunks] Page ${currentPage} attempt ${attempt + 1} failed:`, err.message);
        }
      }
      currentPage = endPage + 1;
    }

    setItemProgress({
      pdfId: circular.pdf_id,
      status: "done",
      currentPage: processedPages,
      totalPages,
      chunksCreated: totalChunks,
    });

    return { chunks: totalChunks, pages: processedPages };
  }, []);

  const reingestAll = useCallback(async () => {
    if (circulars.length === 0) return;

    cancelRef.current = false;
    setBatchState({
      total: circulars.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      currentTitle: circulars[0].title,
      isRunning: true,
    });

    let completed = 0;
    let failed = 0;

    for (const circular of circulars) {
      if (cancelRef.current) break;

      setBatchState(prev => prev ? {
        ...prev,
        currentTitle: circular.title,
      } : null);

      try {
        await reingestOne(circular);
        completed++;
      } catch (err: any) {
        console.error(`[MissingChunks] Failed: ${circular.title}`, err.message);
        failed++;
      }

      setBatchState(prev => prev ? {
        ...prev,
        completed,
        failed,
      } : null);

      // Delay between documents
      if (!cancelRef.current) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    const skipped = cancelRef.current ? circulars.length - completed - failed : 0;

    setBatchState(prev => prev ? {
      ...prev,
      isRunning: false,
      completed,
      failed,
      skipped,
    } : null);

    toast({
      title: cancelRef.current ? "⏹️ Interrompu" : "✅ Ré-ingestion terminée",
      description: `${completed} réussis, ${failed} échoués${skipped > 0 ? `, ${skipped} ignorés` : ""}`,
    });

    await loadMissing();
  }, [circulars, reingestOne, toast, loadMissing]);

  const cancelBatch = useCallback(() => {
    cancelRef.current = true;
    toast({ title: "Arrêt demandé", description: "Arrêt après le document en cours." });
  }, [toast]);

  const isProcessing = itemProgress?.status === "downloading" || itemProgress?.status === "ingesting";
  const isBatchRunning = batchState?.isRunning === true;

  if (loading) {
    return (
      <Card className="card-elevated border-border/20">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin mr-2 text-muted-foreground" />
          <span className="text-muted-foreground">Recherche des circulaires manquantes...</span>
        </CardContent>
      </Card>
    );
  }

  if (circulars.length === 0) {
    return (
      <Card className="card-elevated border-border/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" />
            Toutes les circulaires sont indexées
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="animate-slide-up card-elevated border-warning/30">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Circulaires sans chunks ({circulars.length})
          </CardTitle>
          <CardDescription>
            Ces circulaires ont un fichier PDF mais ne sont pas indexées pour l'IA (pas de legal_chunks)
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadMissing}
          disabled={loading || isProcessing || isBatchRunning}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        {/* Batch controls */}
        <div className="mb-4 p-3 rounded-lg border border-warning/30 bg-warning/5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">
              <strong>{circulars.length}</strong> circulaire{circulars.length > 1 ? "s" : ""} à ingérer
            </span>
            {isBatchRunning ? (
              <Button size="sm" variant="destructive" onClick={cancelBatch} className="gap-2">
                <StopCircle className="h-4 w-4" />
                Arrêter
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={reingestAll}
                disabled={isProcessing}
                className="gap-2"
              >
                <PlayCircle className="h-4 w-4" />
                Ingérer tout ({circulars.length})
              </Button>
            )}
          </div>

          {batchState && (
            <div className="space-y-2">
              <Progress
                value={batchState.total > 0
                  ? Math.round(((batchState.completed + batchState.failed) / batchState.total) * 100)
                  : 0
                }
                className="h-2"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate max-w-[250px]">
                  {batchState.isRunning ? `📄 ${batchState.currentTitle}` : "Terminé"}
                </span>
                <span>
                  {batchState.completed + batchState.failed}/{batchState.total}
                  {batchState.failed > 0 && ` (${batchState.failed} ❌)`}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Document list */}
        <ScrollArea className="h-[400px]">
          <div className="space-y-2">
            {circulars.map((c) => {
              const isActive = itemProgress?.pdfId === c.pdf_id;
              return (
                <div
                  key={c.pdf_id}
                  className={`flex items-center gap-3 p-3 border rounded-lg bg-card ${
                    isActive ? "ring-2 ring-primary/50" : ""
                  }`}
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.title}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {c.reference_number && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          {c.reference_number}
                        </Badge>
                      )}
                      {c.publication_date && (
                        <span>{new Date(c.publication_date).toLocaleDateString("fr-FR")}</span>
                      )}
                      {!c.has_legal_source && (
                        <Badge variant="destructive" className="text-[10px] px-1 py-0">
                          Pas de source
                        </Badge>
                      )}
                    </div>
                    {isActive && itemProgress && (
                      <div className="mt-1">
                        {itemProgress.status === "downloading" && (
                          <span className="text-xs text-muted-foreground">📥 Téléchargement...</span>
                        )}
                        {itemProgress.status === "ingesting" && (
                          <div className="space-y-1">
                            <Progress
                              value={itemProgress.totalPages > 0
                                ? Math.round((itemProgress.currentPage / itemProgress.totalPages) * 100)
                                : 0
                              }
                              className="h-1.5"
                            />
                            <span className="text-xs text-muted-foreground">
                              Page {itemProgress.currentPage}/{itemProgress.totalPages} — {itemProgress.chunksCreated} chunks
                            </span>
                          </div>
                        )}
                        {itemProgress.status === "done" && (
                          <span className="text-xs text-success flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            {itemProgress.chunksCreated} chunks créés
                          </span>
                        )}
                        {itemProgress.status === "error" && (
                          <span className="text-xs text-destructive flex items-center gap-1">
                            <XCircle className="h-3 w-3" />
                            {itemProgress.error}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => reingestOne(c).catch(err => {
                      setItemProgress(prev => prev ? { ...prev, status: "error", error: err.message } : null);
                    })}
                    disabled={isProcessing || isBatchRunning}
                    className="shrink-0"
                  >
                    {isActive && isProcessing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
