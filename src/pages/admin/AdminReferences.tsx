import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getAuthHeaders } from "@/lib/authHeaders";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Handshake,
  MapPin,
  ShieldCheck,
  BookOpen,
  Loader2,
  Sparkles,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Trash2,
  Link2,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

type TabKey = "trade_agreements" | "origin_rules" | "controlled_products" | "knowledge_documents" | "preferential_tariffs";

const TAB_CONFIG: Record<TabKey, { label: string; icon: typeof Handshake; description: string }> = {
  trade_agreements: {
    label: "Accords commerciaux",
    icon: Handshake,
    description: "Accords de libre-échange et conventions commerciales",
  },
  origin_rules: {
    label: "Règles d'origine",
    icon: MapPin,
    description: "Critères d'origine par code SH et accord",
  },
  controlled_products: {
    label: "Produits contrôlés",
    icon: ShieldCheck,
    description: "Produits soumis à licence, restriction ou prohibition",
  },
  knowledge_documents: {
    label: "Base de connaissances",
    icon: BookOpen,
    description: "Documents synthétiques pour la recherche sémantique",
  },
  preferential_tariffs: {
    label: "Taux préférentiels",
    icon: Link2,
    description: "Liaison des taux préférentiels aux accords commerciaux",
  },
};

export default function AdminReferences() {
  const [activeTab, setActiveTab] = useState<TabKey>("trade_agreements");
  const [extracting, setExtracting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ table: TabKey; id: string; label: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Queries for each table
  const { data: agreements, isLoading: loadingAgreements } = useQuery({
    queryKey: ["ref-trade-agreements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trade_agreements")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: originRules, isLoading: loadingOriginRules } = useQuery({
    queryKey: ["ref-origin-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("origin_rules")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: controlledProducts, isLoading: loadingControlled } = useQuery({
    queryKey: ["ref-controlled-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("controlled_products")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: knowledgeDocs, isLoading: loadingKnowledge } = useQuery({
    queryKey: ["ref-knowledge-documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("knowledge_documents")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: prefTariffs, isLoading: loadingPref } = useQuery({
    queryKey: ["ref-preferential-tariffs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("country_tariffs")
        .select("id, national_code, description_local, duty_rate, agreement_code, source, source_pdf")
        .not("agreement_code", "is", null)
        .eq("is_active", true)
        .order("agreement_code")
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  const counts: Record<TabKey, number> = {
    trade_agreements: agreements?.length || 0,
    origin_rules: originRules?.length || 0,
    controlled_products: controlledProducts?.length || 0,
    knowledge_documents: knowledgeDocs?.length || 0,
    preferential_tariffs: prefTariffs?.length || 0,
  };

  const isLoading: Record<TabKey, boolean> = {
    trade_agreements: loadingAgreements,
    origin_rules: loadingOriginRules,
    controlled_products: loadingControlled,
    knowledge_documents: loadingKnowledge,
    preferential_tariffs: loadingPref,
  };

  const runExtraction = async (table: TabKey | "all") => {
    setExtracting(table);
    toast({
      title: "🤖 Extraction IA en cours...",
      description: table === "all"
        ? "Analyse de toutes les tables de référence"
        : `Extraction pour ${TAB_CONFIG[table as TabKey]?.label || table}`,
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 min timeout
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/populate-references`,
        {
          method: "POST",
          headers: await getAuthHeaders(),
          body: JSON.stringify({ table: table === "all" ? null : table }),
          signal: controller.signal,
        },
      );
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const resultSummary = Object.entries(data.results || {})
        .map(([t, r]: [string, any]) => {
          const label = TAB_CONFIG[t as TabKey]?.label || t;
          if (r.linked !== undefined) return `${label}: ${r.linked} liés, ${r.skipped} ignorés`;
          return `${label}: ${r.inserted} ajoutés, ${r.skipped} ignorés`;
        })
        .join("\n");

      toast({
        title: "✅ Extraction terminée",
        description: resultSummary || "Aucune donnée extraite",
      });

      // Refresh all queries
      queryClient.invalidateQueries({ queryKey: ["ref-trade-agreements"] });
      queryClient.invalidateQueries({ queryKey: ["ref-origin-rules"] });
      queryClient.invalidateQueries({ queryKey: ["ref-controlled-products"] });
      queryClient.invalidateQueries({ queryKey: ["ref-knowledge-documents"] });
      queryClient.invalidateQueries({ queryKey: ["ref-preferential-tariffs"] });
    } catch (error: any) {
      toast({
        title: "❌ Erreur d'extraction",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setExtracting(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);

    try {
      // Map virtual tab keys to actual DB tables
      const actualTable = deleteTarget.table === "preferential_tariffs" ? "country_tariffs" : deleteTarget.table;
      
      if (deleteTarget.table === "preferential_tariffs") {
        // For preferential tariffs, unlink by setting agreement_code to null
        const { error } = await supabase
          .from("country_tariffs" as any)
          .update({ agreement_code: null })
          .eq("id", deleteTarget.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from(actualTable as any)
          .update({ is_active: false })
          .eq("id", deleteTarget.id);
        if (error) throw error;
      }

      toast({ title: "✅ Supprimé", description: `"${deleteTarget.label}" désactivé` });
      const queryKey = deleteTarget.table === "preferential_tariffs" 
        ? "ref-preferential-tariffs" 
        : `ref-${deleteTarget.table.replace("_", "-")}`;
      queryClient.invalidateQueries({ queryKey: [queryKey] });
    } catch (error: any) {
      toast({ title: "❌ Erreur", description: error.message, variant: "destructive" });
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="animate-fade-in flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="admin-page-header">
          <h1>Tables de référence</h1>
          <p>Données structurées extraites par IA depuis vos documents juridiques</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => runExtraction(activeTab)}
            disabled={!!extracting}
            variant="outline"
            className="gap-2"
          >
            {extracting === activeTab ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Extraire {TAB_CONFIG[activeTab].label}
          </Button>
          <Button
            onClick={() => runExtraction("all")}
            disabled={!!extracting}
            className="gap-2"
          >
            {extracting === "all" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Tout extraire
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {(Object.entries(TAB_CONFIG) as [TabKey, typeof TAB_CONFIG[TabKey]][]).map(([key, config]) => {
          const Icon = config.icon;
          return (
            <Card
              key={key}
              className={`cursor-pointer transition-all hover:shadow-md ${activeTab === key ? "ring-2 ring-primary/50" : ""}`}
              onClick={() => setActiveTab(key)}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{counts[key]}</p>
                  <p className="text-xs text-muted-foreground">{config.label}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
        <TabsList className="grid grid-cols-5 w-full">
          {(Object.entries(TAB_CONFIG) as [TabKey, typeof TAB_CONFIG[TabKey]][]).map(([key, config]) => (
            <TabsTrigger key={key} value={key} className="text-xs sm:text-sm gap-1">
              <config.icon className="h-4 w-4 hidden sm:block" />
              {config.label.split(" ")[0]}
              {counts[key] > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">{counts[key]}</Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Trade Agreements Tab */}
        <TabsContent value="trade_agreements">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Accords commerciaux</CardTitle>
              <CardDescription>{TAB_CONFIG.trade_agreements.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingAgreements ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : !agreements?.length ? (
                <EmptyState table="trade_agreements" onExtract={() => runExtraction("trade_agreements")} extracting={!!extracting} />
              ) : (
                <ScrollArea className="max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Nom</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Parties</TableHead>
                        <TableHead>Entrée en vigueur</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {agreements.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-mono text-xs">{a.code}</TableCell>
                          <TableCell className="font-medium max-w-[200px] truncate">{a.name_fr}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{a.agreement_type || "—"}</Badge>
                          </TableCell>
                          <TableCell className="text-xs max-w-[150px] truncate">
                            {Array.isArray(a.parties) ? (a.parties as string[]).join(", ") : "—"}
                          </TableCell>
                          <TableCell className="text-xs">{a.entry_into_force || "—"}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive/60 hover:text-destructive"
                              onClick={() => setDeleteTarget({ table: "trade_agreements", id: a.id, label: a.name_fr })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Origin Rules Tab */}
        <TabsContent value="origin_rules">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Règles d'origine</CardTitle>
              <CardDescription>{TAB_CONFIG.origin_rules.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingOriginRules ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : !originRules?.length ? (
                <EmptyState table="origin_rules" onExtract={() => runExtraction("origin_rules")} extracting={!!extracting} />
              ) : (
                <ScrollArea className="max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code SH</TableHead>
                        <TableHead>Accord</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Règle</TableHead>
                        <TableHead>% VA</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {originRules.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-xs">{r.hs_code}</TableCell>
                          <TableCell className="font-mono text-xs">{r.agreement_code}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{r.rule_type || "—"}</Badge>
                          </TableCell>
                          <TableCell className="text-xs max-w-[250px] truncate">{r.rule_text || "—"}</TableCell>
                          <TableCell className="text-xs">{r.value_added_percent ? `${r.value_added_percent}%` : "—"}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive/60 hover:text-destructive"
                              onClick={() => setDeleteTarget({ table: "origin_rules", id: r.id, label: `${r.hs_code} (${r.agreement_code})` })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Controlled Products Tab */}
        <TabsContent value="controlled_products">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Produits contrôlés</CardTitle>
              <CardDescription>{TAB_CONFIG.controlled_products.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingControlled ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : !controlledProducts?.length ? (
                <EmptyState table="controlled_products" onExtract={() => runExtraction("controlled_products")} extracting={!!extracting} />
              ) : (
                <ScrollArea className="max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code SH</TableHead>
                        <TableHead>Type de contrôle</TableHead>
                        <TableHead>Autorité</TableHead>
                        <TableHead>Procédure</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {controlledProducts.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs">{p.hs_code}</TableCell>
                          <TableCell>
                            <Badge variant={p.control_type === "prohibition" ? "destructive" : "outline"}>
                              {p.control_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{p.control_authority || "—"}</TableCell>
                          <TableCell className="text-xs max-w-[250px] truncate">{p.procedure_description || "—"}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive/60 hover:text-destructive"
                              onClick={() => setDeleteTarget({ table: "controlled_products", id: p.id, label: `${p.hs_code} (${p.control_type})` })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Knowledge Documents Tab */}
        <TabsContent value="knowledge_documents">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Base de connaissances</CardTitle>
              <CardDescription>{TAB_CONFIG.knowledge_documents.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingKnowledge ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : !knowledgeDocs?.length ? (
                <EmptyState table="knowledge_documents" onExtract={() => runExtraction("knowledge_documents")} extracting={!!extracting} />
              ) : (
                <ScrollArea className="max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Titre</TableHead>
                        <TableHead>Catégorie</TableHead>
                        <TableHead>Référence</TableHead>
                        <TableHead>Résumé</TableHead>
                        <TableHead>Embedding</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {knowledgeDocs.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium max-w-[200px] truncate">{d.title}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{d.category || "—"}</Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono max-w-[120px] truncate">{d.reference || "—"}</TableCell>
                          <TableCell className="text-xs max-w-[250px] truncate">{d.summary || "—"}</TableCell>
                          <TableCell>
                            {d.embedding ? (
                              <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-warning" />
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive/60 hover:text-destructive"
                              onClick={() => setDeleteTarget({ table: "knowledge_documents", id: d.id, label: d.title })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Preferential Tariffs Tab */}
        <TabsContent value="preferential_tariffs">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Taux préférentiels liés</CardTitle>
              <CardDescription>{TAB_CONFIG.preferential_tariffs.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingPref ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : !prefTariffs?.length ? (
                <EmptyState table="preferential_tariffs" onExtract={() => runExtraction("preferential_tariffs")} extracting={!!extracting} />
              ) : (
                <ScrollArea className="max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code national</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Taux (%)</TableHead>
                        <TableHead>Accord</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {prefTariffs.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell className="font-mono text-xs">{t.national_code}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate">{t.description_local || "—"}</TableCell>
                          <TableCell className="text-xs">{t.duty_rate != null ? `${t.duty_rate}%` : "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{t.agreement_code || "—"}</Badge>
                          </TableCell>
                          <TableCell className="text-xs max-w-[120px] truncate">{t.source_pdf || t.source || "—"}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive/60 hover:text-destructive"
                              onClick={() => setDeleteTarget({ table: "preferential_tariffs" as TabKey, id: t.id, label: `${t.national_code} (${t.agreement_code})` })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
            <AlertDialogDescription>
              Voulez-vous désactiver "{deleteTarget?.label}" ? L'enregistrement sera masqué mais pas supprimé définitivement.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Désactiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================================================================
// EMPTY STATE COMPONENT
// ============================================================================

function EmptyState({
  table,
  onExtract,
  extracting,
}: {
  table: string;
  onExtract: () => void;
  extracting: boolean;
}) {
  return (
    <div className="text-center py-12 space-y-4">
      <AlertCircle className="h-12 w-12 text-muted-foreground/40 mx-auto" />
      <div>
        <p className="text-muted-foreground">Aucune donnée dans cette table</p>
        <p className="text-sm text-muted-foreground/60">
          Lancez l'extraction IA pour analyser vos documents juridiques
        </p>
      </div>
      <Button onClick={onExtract} disabled={extracting} className="gap-2">
        {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Lancer l'extraction IA
      </Button>
    </div>
  );
}
