import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FolderKanban, Plus, Ship, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

export default function Cases() {
  const qc = useQueryClient();
  const { data: org, isLoading: orgLoading, error: orgError } = useOrganization();
  const [title, setTitle] = useState("");
  const [origin, setOrigin] = useState("");
  const { data: cases = [], isLoading } = useQuery({
    queryKey: ["customs-cases", org?.organization_id],
    enabled: !!org,
    queryFn: async () => {
      const { data, error } = await supabase.from("customs_cases").select("*").eq("organization_id", org!.organization_id).order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const createCase = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user || !org || !title.trim()) throw new Error("Titre requis");
      const reference = `DOS-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
      const { error } = await supabase.from("customs_cases").insert({ organization_id: org.organization_id, created_by: auth.user.id, reference, title: title.trim(), operation_type: "import", origin_country: origin.trim().toUpperCase() || null });
      if (error) throw error;
    },
    onSuccess: () => { setTitle(""); setOrigin(""); qc.invalidateQueries({ queryKey: ["customs-cases"] }); toast.success("Dossier créé"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const stats = useMemo(() => ({ active: cases.filter(c => !["closed", "archived"].includes(c.status)).length, ready: cases.filter(c => c.status === "ready").length }), [cases]);

  if (orgError) return <StateError message={orgError.message} />;
  return <div className="container mx-auto max-w-6xl p-4 md:p-8 space-y-6">
    <div><p className="text-sm font-semibold text-primary">PARCOURS DOUANIER</p><h1 className="text-3xl font-bold">Dossiers import / export</h1><p className="text-muted-foreground">Centralisez les produits, pièces, classifications SH, règles et documents générés.</p></div>
    <div className="grid gap-4 md:grid-cols-3">
      <Metric label="Dossiers actifs" value={stats.active} /><Metric label="Prêts à déclarer" value={stats.ready} /><Metric label="Total" value={cases.length} />
    </div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5"/>Nouveau dossier</CardTitle></CardHeader><CardContent className="flex flex-col md:flex-row gap-3"><Input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ex. Import de groupes électrogènes"/><Input value={origin} onChange={e=>setOrigin(e.target.value)} placeholder="Pays d’origine (CN, FR…)" className="md:max-w-56"/><Button onClick={()=>createCase.mutate()} disabled={!title.trim()||createCase.isPending}>Créer</Button></CardContent></Card>
    <div className="grid gap-4 md:grid-cols-2">
      {(isLoading||orgLoading) && <p>Chargement…</p>}
      {!isLoading && cases.length===0 && <Card className="md:col-span-2"><CardContent className="py-12 text-center text-muted-foreground"><FolderKanban className="mx-auto mb-3 h-10 w-10"/>Créez votre premier dossier pour lancer l’analyse douanière.</CardContent></Card>}
      {cases.map(c=><Link key={c.id} to={`/app/dossiers/${c.id}`}><Card className="h-full transition hover:border-primary/40 hover:shadow-md"><CardHeader className="pb-3"><div className="flex justify-between gap-3"><CardTitle className="text-lg">{c.title}</CardTitle><Badge variant="secondary">{c.status}</Badge></div></CardHeader><CardContent className="space-y-2 text-sm"><div className="font-mono text-muted-foreground">{c.reference}</div><div className="flex gap-4"><span className="flex items-center gap-1"><Ship className="h-4 w-4"/>{c.operation_type}</span><span>{c.origin_country || "Origine à préciser"} → {c.destination_country}</span></div><p className="text-xs text-muted-foreground">Mis à jour {new Date(c.updated_at).toLocaleDateString("fr-FR")}</p></CardContent></Card></Link>)}
    </div>
  </div>;
}

function Metric({label,value}:{label:string;value:number}) { return <Card><CardContent className="pt-6"><div className="text-3xl font-bold">{value}</div><div className="text-sm text-muted-foreground">{label}</div></CardContent></Card>; }
function StateError({message}:{message:string}) { return <div className="container p-8"><Card><CardContent className="flex gap-3 py-8"><AlertCircle className="text-destructive"/><div><b>Impossible d’ouvrir l’espace entreprise</b><p className="text-sm text-muted-foreground">{message}</p></div></CardContent></Card></div>; }
