import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, Database, ExternalLink, FileCheck2, Loader2, Network, PlayCircle, SearchCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getAuthHeaders } from "@/lib/authHeaders";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type DiscoveryResult = {
  source_code?: string;
  connector_type?: string;
  mode?: string;
  status?: string;
  will_download?: boolean;
  will_materialize_document?: boolean;
  asset_count?: number;
  document_count?: number;
  html_page_count?: number;
  legal_extraction_job_count?: number;
  error?: string;
};

type DiscoveryResponse = {
  success: boolean;
  execute: boolean;
  include_draft: boolean;
  materialize_documents: boolean;
  selected_count: number;
  results: DiscoveryResult[];
  error?: string;
};

export default function AdminCorpus() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["corpus-control-center"],
    queryFn: async () => {
      const [sources, documents, issues, legal, hs, documentCount, pageCount, issueCount] = await Promise.all([
        supabase.from("regulatory_sources").select("id,code,name,authority_name,acquisition_mode,reuse_status,active,base_url").order("name"),
        supabase.from("source_documents").select("id,title,document_type,lifecycle_status,official_reference,created_at").order("created_at", { ascending: false }).limit(25),
        supabase.from("ingestion_issues").select("id,severity,status,issue_type,description,created_at").eq("status", "open").order("created_at", { ascending: false }).limit(25),
        supabase.from("legal_instruments").select("id", { count: "exact", head: true }),
        supabase.from("hs_nodes").select("id", { count: "exact", head: true }),
        supabase.from("source_documents").select("id", { count: "exact", head: true }),
        supabase.from("source_pages").select("id", { count: "exact", head: true }),
        supabase.from("ingestion_issues").select("id", { count: "exact", head: true }).eq("status", "open"),
      ]);
      for (const result of [sources, documents, issues, legal, hs, documentCount, pageCount, issueCount]) if (result.error) throw result.error;
      return {
        sources: sources.data || [],
        documents: documents.data || [],
        issues: issues.data || [],
        legalCount: legal.count || 0,
        hsCount: hs.count || 0,
        documentCount: documentCount.count || 0,
        pageCount: pageCount.count || 0,
        issueCount: issueCount.count || 0,
      };
    },
  });

  const publish = useMutation({
    mutationFn: async (id: string) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Non authentifié");
      const { error: publishError } = await supabase
        .from("source_documents")
        .update({ lifecycle_status: "published", published_by: auth.user.id, published_at: new Date().toISOString() })
        .eq("id", id);
      if (publishError) throw publishError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["corpus-control-center"] });
      toast.success("Document publié dans le cerveau douanier");
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  if (isLoading) return <div className="p-8">Chargement du corpus…</div>;
  if (error) return <div className="p-8 text-destructive">{error.message}</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-primary">CENTRE DE CONTRÔLE</p>
          <h1 className="text-3xl font-bold">Corpus & ingestion</h1>
          <p className="text-muted-foreground">Chaque source, révision et anomalie reste traçable avant publication.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link to="/admin/corpus/qualite-pages">Corriger les pages</Link></Button>
          <Button asChild><Link to="/admin/corpus/import">Importer un dossier PDF</Link></Button>
        </div>
      </div>

      <SourceDiscoveryPanel />

      <div className="grid gap-4 md:grid-cols-5">
        <Metric icon={Database} label="Sources recensées" value={data!.sources.length} />
        <Metric icon={FileCheck2} label="Documents" value={data!.documentCount} />
        <Metric icon={FileCheck2} label="Pages extraites" value={data!.pageCount} />
        <Metric icon={Network} label="Textes juridiques" value={data!.legalCount} />
        <Metric icon={AlertTriangle} label="Anomalies ouvertes" value={data!.issueCount} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Registre des sources</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {data!.sources.map((source) => (
              <div key={source.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{source.name}</div>
                    <div className="text-xs text-muted-foreground">{source.code} · {source.authority_name}</div>
                  </div>
                  <Badge variant={source.reuse_status === "authorized" ? "default" : "secondary"}>{source.reuse_status}</Badge>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{source.acquisition_mode}</span>
                  {source.base_url && (
                    <a className="flex items-center gap-1 text-primary" href={source.base_url} target="_blank" rel="noreferrer">
                      Source <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>File de qualité</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {data!.issues.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">Aucune anomalie ouverte.</p>
            ) : data!.issues.map((issue) => (
              <div key={issue.id} className="rounded-lg border p-3">
                <div className="flex justify-between"><b className="text-sm">{issue.issue_type}</b><Badge variant={issue.severity === "blocking" ? "destructive" : "secondary"}>{issue.severity}</Badge></div>
                <p className="my-2 text-sm text-muted-foreground">{issue.description}</p>
                <p className="text-xs text-muted-foreground">Corriger la page source ou relancer son extraction avant de clore cette anomalie.</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Derniers documents</CardTitle></CardHeader>
        <CardContent>
          {data!.documents.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Aucun document ingéré. Utilisez “Ingestion” pour charger le corpus initial.</p>
          ) : (
            <div className="divide-y">
              {data!.documents.map((document) => (
                <div key={document.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <b className="text-sm">{document.title}</b>
                    <p className="text-xs text-muted-foreground">{document.official_reference || "Sans référence"} · {document.document_type}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{document.lifecycle_status}</Badge>
                    {["quality_review", "legal_review"].includes(document.lifecycle_status) && <Button size="sm" onClick={() => publish.mutate(document.id)}>Publier</Button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SourceDiscoveryPanel() {
  const queryClient = useQueryClient();
  const [sourceCode, setSourceCode] = useState("");
  const [includeDraft, setIncludeDraft] = useState(false);
  const [materializeDocuments, setMaterializeDocuments] = useState(true);
  const [lastResult, setLastResult] = useState<DiscoveryResponse | null>(null);

  const runDiscovery = useMutation({
    mutationFn: async (execute: boolean) => {
      const headers = await getAuthHeaders(true);
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/source-discovery`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          execute,
          include_draft: includeDraft,
          materialize_documents: execute && materializeDocuments,
          source_code: sourceCode.trim() || undefined,
          limit: 25,
          max_index_links: 25,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) throw new Error(payload.error || "Découverte source impossible");
      return payload as DiscoveryResponse;
    },
    onSuccess: (payload) => {
      setLastResult(payload);
      queryClient.invalidateQueries({ queryKey: ["corpus-control-center"] });
      toast.success(payload.execute ? "Découverte source exécutée" : "Simulation de découverte terminée");
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><SearchCheck className="h-5 w-5 text-primary" /> Découverte des sources officielles</CardTitle>
        <CardDescription>
          Lance le moteur en ligne Supabase. Le dry-run ne modifie rien. L'exécution télécharge et versionne les sources officielles actives sans publier de règles métier.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTitle>Garde-fou</AlertTitle>
          <AlertDescription>Cette action crée des assets et documents sources en brouillon. Elle ne publie pas automatiquement de règle juridique, de code SH ou d'obligation.</AlertDescription>
        </Alert>

        <div className="grid gap-4 lg:grid-cols-[1fr_auto_auto] lg:items-end">
          <div className="space-y-2">
            <Label htmlFor="source-code">Filtrer une source optionnelle</Label>
            <Input id="source-code" placeholder="Ex: MIC_IMPORT_LICENSE_LIST" value={sourceCode} onChange={(event) => setSourceCode(event.target.value)} />
          </div>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
            <Switch id="include-draft" checked={includeDraft} onCheckedChange={setIncludeDraft} />
            <Label htmlFor="include-draft" className="text-sm">Inclure les brouillons</Label>
          </div>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
            <Switch id="materialize-documents" checked={materializeDocuments} onCheckedChange={setMaterializeDocuments} />
            <Label htmlFor="materialize-documents" className="text-sm">Créer les documents source</Label>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => runDiscovery.mutate(false)} disabled={runDiscovery.isPending}>
            {runDiscovery.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SearchCheck className="mr-2 h-4 w-4" />} Simuler
          </Button>
          <Button onClick={() => runDiscovery.mutate(true)} disabled={runDiscovery.isPending}>
            {runDiscovery.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />} Exécuter en ligne
          </Button>
        </div>

        {lastResult && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={lastResult.execute ? "default" : "secondary"}>{lastResult.execute ? "exécution" : "dry-run"}</Badge>
              <span>{lastResult.selected_count} source(s) sélectionnée(s)</span>
            </div>
            <div className="space-y-2">
              {lastResult.results.map((result, index) => (
                <div key={`${result.source_code || index}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background p-2 text-sm">
                  <span className="font-medium">{result.source_code || "source inconnue"}</span>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {result.mode && <span>{result.mode}</span>}
                    {result.status && <Badge variant={result.status === "failed" ? "destructive" : "outline"}>{result.status}</Badge>}
                    {typeof result.asset_count === "number" && <span>{result.asset_count} asset(s)</span>}
                    {typeof result.document_count === "number" && <span>{result.document_count} document(s)</span>}
                    {typeof result.html_page_count === "number" && <span>{result.html_page_count} page(s) HTML</span>}
                    {typeof result.legal_extraction_job_count === "number" && <span>{result.legal_extraction_job_count} extraction(s) juridique(s)</span>}
                    {result.error && <span className="text-destructive">{result.error}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex gap-3 pt-6">
        <Icon className="h-8 w-8 text-primary" />
        <div><div className="text-2xl font-bold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>
      </CardContent>
    </Card>
  );
}
