import { useState, useCallback, useRef } from "react";
import { getAuthHeaders } from "@/lib/authHeaders";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

interface TableStatus {
  name: string;
  label: string;
  total: number;
  withEmbedding: number;
  missing: number;
  processing: boolean;
  processed: number;
  errors: number;
  done: boolean;
}

const TABLE_CONFIG = [
  { name: "legal_chunks", label: "Segments légaux" },
  { name: "country_tariffs", label: "Tarifs nationaux" },
  { name: "hs_codes", label: "Codes SH" },
  { name: "tariff_notes", label: "Notes tarifaires" },
  { name: "knowledge_documents", label: "Documents de veille" },
];

const BATCH_LIMIT = 100;
const DELAY_BETWEEN_CALLS = 2000;

export default function EmbeddingPanel() {
  const [tables, setTables] = useState<TableStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const cancelRef = useRef(false);
  const { toast } = useToast();

  // Load stats for all tables
  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");

      const results = await Promise.all(
        TABLE_CONFIG.map(async (cfg) => {
          const textColumn = cfg.name === "tariff_notes" ? "note_text" :
            cfg.name === "knowledge_documents" ? "content" :
            cfg.name === "hs_codes" ? "description_fr" :
            cfg.name === "country_tariffs" ? "description_local" :
            "chunk_text";

          const [totalRes, embRes] = await Promise.all([
            supabase.from(cfg.name as any).select("id", { count: "exact", head: true }),
            supabase.from(cfg.name as any).select("id", { count: "exact", head: true }).not("embedding", "is", null),
          ]);

          const total = totalRes.count || 0;
          const withEmbedding = embRes.count || 0;

          return {
            name: cfg.name,
            label: cfg.label,
            total,
            withEmbedding,
            missing: total - withEmbedding,
            processing: false,
            processed: 0,
            errors: 0,
            done: false,
          } as TableStatus;
        })
      );

      setTables(results);
    } catch (err) {
      console.error("Error loading embedding stats:", err);
      toast({ title: "Erreur", description: "Impossible de charger les statistiques", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Process a single table in batches
  const processTable = useCallback(async (tableName: string) => {
    let totalProcessed = 0;
    let totalErrors = 0;
    let hasMore = true;

    while (hasMore && !cancelRef.current) {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-embeddings`,
          {
            method: "POST",
            headers: await getAuthHeaders(),
            body: JSON.stringify({ table: tableName, limit: BATCH_LIMIT }),
          }
        );

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errText.substring(0, 200)}`);
        }

        const result = await response.json();
        const processed = result.results?.processed || 0;
        const errors = result.results?.errors || 0;

        totalProcessed += processed;
        totalErrors += errors;

        // Update table status
        setTables(prev => prev.map(t =>
          t.name === tableName
            ? { ...t, processed: totalProcessed, errors: totalErrors }
            : t
        ));

        // If we processed fewer than the limit, we're done
        if (processed < BATCH_LIMIT) {
          hasMore = false;
        } else {
          // Wait between batches to avoid rate limits
          await new Promise(r => setTimeout(r, DELAY_BETWEEN_CALLS));
        }
      } catch (err: any) {
        console.error(`[Embeddings] Error processing ${tableName}:`, err);
        totalErrors++;
        hasMore = false; // Stop on error
      }
    }

    return { processed: totalProcessed, errors: totalErrors };
  }, []);

  // Run all tables
  const runAll = useCallback(async () => {
    cancelRef.current = false;
    setRunning(true);

    // First load fresh stats
    await loadStats();

    const tablesToProcess = tables.filter(t => t.missing > 0);
    if (tablesToProcess.length === 0) {
      // Reload to get fresh data first
      toast({ title: "Chargement...", description: "Vérification des embeddings manquants..." });
      await loadStats();
      setRunning(false);
      return;
    }

    for (const table of tablesToProcess) {
      if (cancelRef.current) break;

      setTables(prev => prev.map(t =>
        t.name === table.name ? { ...t, processing: true } : t
      ));

      const result = await processTable(table.name);

      setTables(prev => prev.map(t =>
        t.name === table.name
          ? { ...t, processing: false, done: true, processed: result.processed, errors: result.errors }
          : t
      ));

      if (!cancelRef.current) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    setRunning(false);

    if (!cancelRef.current) {
      toast({
        title: "✅ Embeddings générés",
        description: "Tous les embeddings manquants ont été traités.",
      });
    }

    // Reload stats to show final state
    await loadStats();
  }, [tables, processTable, loadStats, toast]);

  const totalMissing = tables.reduce((sum, t) => sum + t.missing, 0);
  const totalProcessed = tables.reduce((sum, t) => sum + t.processed, 0);

  return (
    <Card className="animate-slide-up card-elevated border-border/20">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Génération d'embeddings
          </CardTitle>
          <CardDescription>
            Générer les vecteurs de recherche sémantique pour tous les documents
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {!loading && tables.length === 0 && (
            <Button variant="outline" size="sm" onClick={loadStats}>
              Vérifier
            </Button>
          )}
          {tables.length > 0 && !running && (
            <Button
              onClick={runAll}
              disabled={totalMissing === 0}
              size="sm"
              className="bg-primary/90 hover:bg-primary"
            >
              <Sparkles className="h-4 w-4 mr-1" />
              Générer tout ({totalMissing})
            </Button>
          )}
          {running && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { cancelRef.current = true; }}
            >
              Arrêter
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement des statistiques...
          </div>
        )}

        {!loading && tables.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">
            Cliquez sur "Vérifier" pour voir l'état des embeddings.
          </p>
        )}

        {tables.length > 0 && (
          <div className="space-y-3">
            {tables.map(table => {
              const pct = table.total > 0
                ? Math.round((table.withEmbedding / table.total) * 100)
                : 100;

              return (
                <div key={table.name} className="flex items-center gap-3">
                  <div className="w-36 text-sm font-medium truncate">{table.label}</div>
                  <div className="flex-1">
                    <Progress value={pct} className="h-2" />
                  </div>
                  <div className="w-28 text-xs text-right text-muted-foreground">
                    {table.withEmbedding}/{table.total}
                  </div>
                  <div className="w-20">
                    {table.processing && (
                      <Badge variant="secondary" className="text-xs">
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        {table.processed}
                      </Badge>
                    )}
                    {table.done && !table.processing && (
                      <Badge variant="outline" className="text-xs text-green-600">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {table.processed}
                      </Badge>
                    )}
                    {!table.processing && !table.done && table.missing > 0 && (
                      <Badge variant="outline" className="text-xs text-amber-600">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        {table.missing}
                      </Badge>
                    )}
                    {!table.processing && !table.done && table.missing === 0 && (
                      <Badge variant="outline" className="text-xs text-green-600">
                        ✅
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}

            {running && totalProcessed > 0 && (
              <div className="text-xs text-muted-foreground pt-2 border-t">
                {totalProcessed} embeddings générés...
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
