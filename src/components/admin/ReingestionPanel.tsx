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
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Database,
  Layers,
  Hash,
  PlayCircle,
  StopCircle,
  ListFilter,
} from "lucide-react";

// ============================================================================
// TYPES
// ============================================================================

interface LegalSourceStats {
  id: number;
  source_ref: string;
  title: string | null;
  source_type: string;
  total_chunks: number | null;
  is_current: boolean | null;
  // Computed stats
  actual_chunks: number;
  chunks_with_embeddings: number;
  chunks_with_hierarchy: number;
  chunks_with_keywords: number;
  evidence_count: number;
  distinct_pages: number;
  // Associated PDF info
  pdf_id: string | null;
  pdf_file_path: string | null;
  pdf_file_name: string | null;
}

interface ReingestionProgress {
  sourceId: number;
  status: "cleaning" | "ingesting" | "done" | "error";
  currentPage: number;
  totalPages: number;
  chunksCreated: number;
  error?: string;
}

interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  currentSourceTitle: string;
  isRunning: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function ReingestionPanel() {
  const [sources, setSources] = useState<LegalSourceStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<ReingestionProgress | null>(null);
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const cancelBatchRef = useRef(false);
  const { toast } = useToast();

  // Load legal sources with stats
  const loadSources = useCallback(async () => {
    setLoading(true);
    try {
      // Get all legal sources
      const { data: legalSources, error } = await supabase
        .from("legal_sources")
        .select("id, source_ref, title, source_type, total_chunks, is_current")
        .order("id", { ascending: true });

      if (error) throw error;
      if (!legalSources || legalSources.length === 0) {
        setSources([]);
        setLoading(false);
        return;
      }

      // Get stats for each source in parallel
      const statsPromises = legalSources.map(async (src) => {
        const [chunksRes, embeddingsRes, hierarchyRes, keywordsRes, evidenceRes, pagesRes, pdfRes] = await Promise.all([
          supabase.from("legal_chunks").select("id", { count: "exact", head: true }).eq("source_id", src.id),
          supabase.from("legal_chunks").select("id", { count: "exact", head: true }).eq("source_id", src.id).not("embedding", "is", null),
          supabase.from("legal_chunks").select("id", { count: "exact", head: true }).eq("source_id", src.id).not("hierarchy_path", "is", null),
          supabase.from("legal_chunks").select("id", { count: "exact", head: true }).eq("source_id", src.id).not("keywords", "is", null),
          supabase.from("hs_evidence").select("id", { count: "exact", head: true }).eq("source_id", src.id),
          supabase.from("legal_chunks").select("page_number").eq("source_id", src.id).not("page_number", "is", null),
          // Find associated PDF document - use broader matching
          supabase.from("pdf_documents")
            .select("id, file_path, file_name")
            .eq("is_active", true)
            .or(`document_reference.eq.${src.source_ref},title.ilike.%${(src.title || src.source_ref).substring(0, 30)}%`)
            .limit(1),
        ]);

        const pdfDoc = pdfRes.data?.[0] || null;

        // Count distinct pages from the page_number results
        const pageNumbers = pagesRes.data || [];
        const distinctPageCount = new Set(
          (pageNumbers as { page_number: number | null }[])
            .map(p => p.page_number)
            .filter(Boolean)
        ).size;

        return {
          ...src,
          actual_chunks: chunksRes.count || 0,
          chunks_with_embeddings: embeddingsRes.count || 0,
          chunks_with_hierarchy: hierarchyRes.count || 0,
          chunks_with_keywords: keywordsRes.count || 0,
          evidence_count: evidenceRes.count || 0,
          distinct_pages: distinctPageCount,
          pdf_id: pdfDoc?.id || null,
          pdf_file_path: pdfDoc?.file_path || null,
          pdf_file_name: pdfDoc?.file_name || null,
        } as LegalSourceStats;
      });

      const results = await Promise.all(statsPromises);
      setSources(results);
    } catch (err) {
      console.error("Error loading sources:", err);
      toast({
        title: "Erreur",
        description: "Impossible de charger les sources",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

  // Re-ingest a source
  const reingest = useCallback(async (source: LegalSourceStats) => {
    if (!source.pdf_file_path) {
      toast({
        title: "Fichier introuvable",
        description: "Aucun PDF associé trouvé dans le storage. Veuillez re-uploader le document.",
        variant: "destructive",
      });
      return;
    }

    const BATCH_SIZE = 1;
    const FETCH_TIMEOUT_MS = 180000;
    const DELAY_BETWEEN_BATCHES = 2500;

    try {
      // === STEP 1: CLEANUP ===
      setProgress({
        sourceId: source.id,
        status: "cleaning",
        currentPage: 0,
        totalPages: 0,
        chunksCreated: 0,
      });

      console.log(`[Reingest] Cleaning source ${source.id} (${source.source_ref})...`);

      // Delete old chunks and evidence
      const [chunksDelete, evidenceDelete] = await Promise.all([
        supabase.from("legal_chunks").delete().eq("source_id", source.id),
        supabase.from("hs_evidence").delete().eq("source_id", source.id),
      ]);

      if (chunksDelete.error) console.warn("Chunks delete error:", chunksDelete.error);
      if (evidenceDelete.error) console.warn("Evidence delete error:", evidenceDelete.error);

      // Reset source metadata
      await supabase.from("legal_sources")
        .update({ total_chunks: 0 })
        .eq("id", source.id);

      console.log(`[Reingest] Cleanup done. Downloading PDF...`);

      // === STEP 2: DOWNLOAD PDF ===
      const { data: pdfBlob, error: downloadError } = await supabase.storage
        .from("pdf-documents")
        .download(source.pdf_file_path);

      if (downloadError || !pdfBlob) {
        throw new Error(`Impossible de télécharger le PDF: ${downloadError?.message}`);
      }

      // Convert to base64
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
      );

      // Map source_type
      const sourceTypeMap: Record<string, string> = {
        law: "law",
        circular: "circular",
        agreement: "agreement",
        note: "note",
        decree: "decree",
        decision: "decision",
      };

      // === STEP 3: INGEST PAGE BY PAGE ===
      setProgress(prev => prev ? { ...prev, status: "ingesting" } : null);

      let sourceId = source.id;
      let totalPages = 0;
      let processedPages = 0;
      let totalChunks = 0;

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

      // First batch
      const firstResponse = await fetchWithTimeout({
        source_type: sourceTypeMap[source.source_type] || "law",
        source_ref: source.source_ref,
        title: source.title || source.source_ref,
        pdf_base64: base64,
        country_code: "MA",
        generate_embeddings: true,
        detect_hs_codes: true,
        batch_mode: true,
        start_page: 1,
        end_page: BATCH_SIZE,
        source_id: sourceId,
      });

      if (!firstResponse.ok) {
        const errorText = await firstResponse.text();
        throw new Error(`HTTP ${firstResponse.status}: ${errorText.substring(0, 200)}`);
      }

      const firstResult = await firstResponse.json();
      if (!firstResult.success) throw new Error(firstResult.error || "Erreur d'ingestion");

      sourceId = firstResult.source_id || sourceId;
      totalPages = firstResult.total_pages || BATCH_SIZE;
      processedPages += firstResult.pages_processed || BATCH_SIZE;
      totalChunks += firstResult.chunks_created || 0;

      setProgress({
        sourceId: source.id,
        status: "ingesting",
        currentPage: processedPages,
        totalPages,
        chunksCreated: totalChunks,
      });

      // Remaining batches
      let currentPage = 1 + BATCH_SIZE;
      while (currentPage <= totalPages) {
        const endPage = Math.min(currentPage + BATCH_SIZE - 1, totalPages);

        await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));

        let batchSuccess = false;
        for (let attempt = 0; attempt < 3 && !batchSuccess; attempt++) {
          try {
            if (attempt > 0) {
              await new Promise(r => setTimeout(r, 3000 * attempt));
            }

            const batchResponse = await fetchWithTimeout({
              source_type: sourceTypeMap[source.source_type] || "law",
              source_ref: source.source_ref,
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

              setProgress({
                sourceId: source.id,
                status: "ingesting",
                currentPage: processedPages,
                totalPages,
                chunksCreated: totalChunks,
              });
            }
          } catch (batchError: any) {
            console.warn(`[Reingest] Batch attempt ${attempt + 1} failed:`, batchError.message);
            if (attempt === 2) {
              console.error(`[Reingest] Page ${currentPage} failed after 3 attempts, skipping`);
            }
          }
        }

        currentPage = endPage + 1;
      }

      // === DONE ===
      setProgress({
        sourceId: source.id,
        status: "done",
        currentPage: processedPages,
        totalPages,
        chunksCreated: totalChunks,
      });

      toast({
        title: "✅ Ré-ingestion terminée",
        description: `${totalChunks} segments créés sur ${processedPages} pages avec le pipeline amélioré.`,
      });

      // Reload stats
      await loadSources();

    } catch (err: any) {
      console.error("[Reingest] Error:", err);
      setProgress(prev => prev ? {
        ...prev,
        status: "error",
        error: err.message,
      } : null);
      toast({
        title: "Erreur de ré-ingestion",
        description: err.message,
        variant: "destructive",
      });
    }
  }, [toast, loadSources]);

  // Only structured documents (law/code) need hierarchy-based re-ingestion
  // Circulars, notes, agreements don't have formal structure requiring hierarchy
  const needsReingest = (source: LegalSourceStats): boolean => {
    if (source.actual_chunks === 0) return false;
    if (source.source_type !== "law") return false;
    return source.chunks_with_hierarchy === 0;
  };

  // Batch re-ingest all documents that need it
  const reingestAll = useCallback(async () => {
    const toProcess = sources.filter(needsReingest);
    if (toProcess.length === 0) {
      toast({ title: "Rien à faire", description: "Tous les documents sont déjà en bon état." });
      return;
    }

    cancelBatchRef.current = false;
    setBatchProgress({
      total: toProcess.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      currentSourceTitle: toProcess[0].title || toProcess[0].source_ref,
      isRunning: true,
    });

    let completed = 0;
    let failed = 0;
    let skipped = 0;

    for (const source of toProcess) {
      if (cancelBatchRef.current) {
        skipped = toProcess.length - completed - failed;
        break;
      }

      setBatchProgress(prev => prev ? {
        ...prev,
        currentSourceTitle: source.title || source.source_ref,
      } : null);

      try {
        await reingest(source);
        completed++;
      } catch {
        failed++;
      }

      setBatchProgress(prev => prev ? {
        ...prev,
        completed,
        failed,
        skipped,
      } : null);

      // Small delay between documents to avoid overwhelming the server
      if (!cancelBatchRef.current) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    setBatchProgress(prev => prev ? {
      ...prev,
      isRunning: false,
      completed,
      failed,
      skipped,
    } : null);

    toast({
      title: cancelBatchRef.current ? "⏹️ Ré-ingestion interrompue" : "✅ Ré-ingestion globale terminée",
      description: `${completed} réussis, ${failed} échoués${skipped > 0 ? `, ${skipped} ignorés` : ""}`,
    });

    // Reload stats
    await loadSources();
  }, [sources, reingest, toast, loadSources]);

  const cancelBatch = useCallback(() => {
    cancelBatchRef.current = true;
    toast({ title: "Arrêt demandé", description: "La ré-ingestion s'arrêtera après le document en cours." });
  }, [toast]);

  // Compute quality score
  const getQualityScore = (source: LegalSourceStats) => {
    if (source.actual_chunks === 0) return 0;
    const embeddingRate = source.chunks_with_embeddings / source.actual_chunks;
    const hierarchyRate = source.chunks_with_hierarchy / source.actual_chunks;
    const keywordRate = source.chunks_with_keywords / source.actual_chunks;
    return Math.round(embeddingRate * 40 + hierarchyRate * 40 + keywordRate * 20);
  };

  const getQualityColor = (score: number) => {
    if (score >= 80) return "text-success";
    if (score >= 50) return "text-warning";
    return "text-destructive";
  };

  const getQualityLabel = (score: number) => {
    if (score >= 80) return "Bon";
    if (score >= 50) return "Moyen";
    return "Faible";
  };

  const isReingesting = progress?.status === "cleaning" || progress?.status === "ingesting";
  const isBatchRunning = batchProgress?.isRunning === true;
  const filteredSources = sources.filter(needsReingest);
  const sourcesToFix = filteredSources.length;

  return (
    <Card className="animate-slide-up card-elevated border-border/20">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Ré-ingestion des documents
          </CardTitle>
          <CardDescription>
            Relancer le pipeline amélioré (contextual chunking + article-aware) sur les documents existants
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadSources}
            disabled={loading || isReingesting || isBatchRunning}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Batch controls */}
        {!loading && sources.length > 0 && (
          <div className="mb-4 p-3 rounded-lg border bg-muted/30 space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <ListFilter className="h-4 w-4 text-muted-foreground" />
                  <span>
                    <strong>{sourcesToFix}</strong> document{sourcesToFix > 1 ? "s" : ""} à ré-ingérer
                  </span>
                </div>
              <div className="flex items-center gap-2">
                {isBatchRunning ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={cancelBatch}
                    className="gap-2"
                  >
                    <StopCircle className="h-4 w-4" />
                    Arrêter
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={reingestAll}
                    disabled={sourcesToFix === 0 || isReingesting}
                    className="gap-2"
                  >
                    <PlayCircle className="h-4 w-4" />
                    Ré-ingérer tout ({sourcesToFix})
                  </Button>
                )}
              </div>
            </div>

            {/* Batch progress */}
            {batchProgress && (
              <div className="space-y-2">
                <Progress
                  value={batchProgress.total > 0
                    ? Math.round(((batchProgress.completed + batchProgress.failed) / batchProgress.total) * 100)
                    : 0
                  }
                  className="h-2"
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {batchProgress.isRunning
                      ? `📄 ${batchProgress.currentSourceTitle}`
                      : "Terminé"
                    }
                  </span>
                  <span>
                    {batchProgress.completed + batchProgress.failed}/{batchProgress.total}
                    {batchProgress.failed > 0 && ` (${batchProgress.failed} échoués)`}
                    {batchProgress.skipped > 0 && ` (${batchProgress.skipped} ignorés)`}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            Chargement des sources...
          </div>
        ) : sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Database className="h-12 w-12 mb-3 opacity-30" />
            <p>Aucune source légale indexée</p>
          </div>
        ) : (
          <ScrollArea className="h-[500px]">
            <div className="space-y-4">
              {sources.filter(needsReingest).map((source) => {
                const qualityScore = getQualityScore(source);
                const isActive = progress?.sourceId === source.id;
                const progressPercent = isActive && progress?.totalPages
                  ? Math.round((progress.currentPage / progress.totalPages) * 100)
                  : 0;

                return (
                  <div
                    key={source.id}
                    className={`p-4 border rounded-lg space-y-3 bg-card ${isActive ? "ring-2 ring-primary/50" : ""}`}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="h-5 w-5 text-primary shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium truncate max-w-[300px]">
                            {source.title || source.source_ref}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline" className="text-[10px] px-1 py-0">
                              {source.source_type}
                            </Badge>
                            <span>ID: {source.id}</span>
                            {source.pdf_file_name && (
                              <span className="truncate max-w-[150px]">{source.pdf_file_name}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`shrink-0 ${
                            qualityScore >= 80 
                              ? "border-green-500 bg-green-500/10 text-green-700" 
                              : qualityScore >= 50 
                                ? "border-yellow-500 bg-yellow-500/10 text-yellow-700" 
                                : "border-red-500 bg-red-500/10 text-red-700"
                          }`}
                        >
                          {getQualityLabel(qualityScore)} ({qualityScore}%)
                        </Badge>
                      </div>
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                      <div className="flex items-center gap-1.5 p-2 rounded bg-muted/50">
                        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                        <span><strong>{source.actual_chunks}</strong> chunks</span>
                      </div>
                      <div className="flex items-center gap-1.5 p-2 rounded bg-muted/50">
                        <Database className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>
                          <strong>{source.chunks_with_embeddings}</strong>/{source.actual_chunks} embeddings
                        </span>
                      </div>
                      <div className={`flex items-center gap-1.5 p-2 rounded ${source.chunks_with_hierarchy === 0 ? "bg-destructive/10" : "bg-muted/50"}`}>
                        {source.chunks_with_hierarchy === 0 ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        )}
                        <span>
                          <strong>{source.chunks_with_hierarchy}</strong>/{source.actual_chunks} hierarchy
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 p-2 rounded bg-muted/50">
                        <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                        <span><strong>{source.evidence_count}</strong> hs_evidence</span>
                      </div>
                      <div className="flex items-center gap-1.5 p-2 rounded bg-muted/50">
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                        <span><strong>{source.distinct_pages}</strong> pages</span>
                      </div>
                    </div>

                    {/* Progress bar during re-ingestion */}
                    {isActive && (progress?.status === "cleaning" || progress?.status === "ingesting") && (
                      <div className="space-y-2">
                        <Progress value={progress.status === "cleaning" ? 5 : progressPercent} className="h-2" />
                        <p className="text-xs text-muted-foreground">
                          {progress.status === "cleaning" && "🧹 Nettoyage des anciens chunks..."}
                          {progress.status === "ingesting" && (
                            <>⏳ Page {progress.currentPage}/{progress.totalPages} — {progress.chunksCreated} segments créés</>
                          )}
                        </p>
                      </div>
                    )}

                    {isActive && progress?.status === "done" && (
                      <p className="text-xs text-success flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4" />
                        Ré-ingestion terminée : {progress.chunksCreated} segments sur {progress.totalPages} pages
                      </p>
                    )}

                    {isActive && progress?.status === "error" && (
                      <p className="text-xs text-destructive">❌ {progress.error}</p>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        {source.chunks_with_hierarchy === 0 && (
                          <span className="text-warning">⚠️ hierarchy_path manquant</span>
                        )}
                        {!source.pdf_file_path && (
                          <span className="text-destructive">⚠️ Aucun PDF associé</span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant={qualityScore < 80 ? "default" : "outline"}
                        onClick={() => reingest(source)}
                        disabled={isReingesting || isBatchRunning || !source.pdf_file_path}
                        className="gap-2"
                      >
                        {isActive && isReingesting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        Ré-ingérer
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
