import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Database, FileCheck2, AlertTriangle, Network, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function AdminCorpus() {
  const queryClient = useQueryClient();
  const {data,isLoading,error}=useQuery({queryKey:["corpus-control-center"],queryFn:async()=>{
    const [sources,documents,issues,legal,hs]=await Promise.all([
      supabase.from("regulatory_sources").select("id,code,name,authority_name,acquisition_mode,reuse_status,active,base_url").order("name"),
      supabase.from("source_documents").select("id,title,document_type,lifecycle_status,official_reference,created_at").order("created_at",{ascending:false}).limit(25),
      supabase.from("ingestion_issues").select("id,severity,status,issue_type,description,created_at").eq("status","open").order("created_at",{ascending:false}).limit(25),
      supabase.from("legal_instruments").select("id",{count:"exact",head:true}),
      supabase.from("hs_nodes").select("id",{count:"exact",head:true}),
    ]);
    for(const r of [sources,documents,issues,legal,hs]) if(r.error) throw r.error;
    return {sources:sources.data||[],documents:documents.data||[],issues:issues.data||[],legalCount:legal.count||0,hsCount:hs.count||0};
  }});
  const publish = useMutation({mutationFn:async(id:string)=>{const {data:auth}=await supabase.auth.getUser();if(!auth.user)throw new Error("Non authentifié");const {error}=await supabase.from("source_documents").update({lifecycle_status:"published",published_by:auth.user.id,published_at:new Date().toISOString()}).eq("id",id);if(error)throw error;},onSuccess:()=>{queryClient.invalidateQueries({queryKey:["corpus-control-center"]});toast.success("Document publié dans le cerveau douanier");},onError:(e:Error)=>toast.error(e.message)});
  const resolveIssue = useMutation({mutationFn:async(id:string)=>{const {data:auth}=await supabase.auth.getUser();const {error}=await supabase.from("ingestion_issues").update({status:"resolved",resolution:"Validé depuis le centre de contrôle",resolved_by:auth.user?.id||null,resolved_at:new Date().toISOString()}).eq("id",id);if(error)throw error;},onSuccess:()=>queryClient.invalidateQueries({queryKey:["corpus-control-center"]})});
  if(isLoading)return <div className="p-8">Chargement du corpus…</div>;
  if(error)return <div className="p-8 text-destructive">{error.message}</div>;
  return <div className="space-y-6"><div><p className="text-sm font-semibold text-primary">CENTRE DE CONTRÔLE</p><h1 className="text-3xl font-bold">Corpus & ingestion</h1><p className="text-muted-foreground">Chaque source, révision et anomalie reste traçable avant publication.</p></div>
    <div className="grid gap-4 md:grid-cols-4"><Metric icon={Database} label="Sources officielles" value={data!.sources.length}/><Metric icon={FileCheck2} label="Documents" value={data!.documents.length}/><Metric icon={Network} label="Textes juridiques" value={data!.legalCount}/><Metric icon={AlertTriangle} label="Anomalies ouvertes" value={data!.issues.length}/></div>
    <div className="grid gap-6 xl:grid-cols-2"><Card><CardHeader><CardTitle>Registre des sources</CardTitle></CardHeader><CardContent className="space-y-3">{data!.sources.map(s=><div key={s.id} className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold">{s.name}</div><div className="text-xs text-muted-foreground">{s.code} · {s.authority_name}</div></div><Badge variant={s.reuse_status==="authorized"?"default":"secondary"}>{s.reuse_status}</Badge></div><div className="mt-2 flex items-center justify-between text-xs text-muted-foreground"><span>{s.acquisition_mode}</span>{s.base_url&&<a className="flex items-center gap-1 text-primary" href={s.base_url} target="_blank" rel="noreferrer">Source <ExternalLink className="h-3 w-3"/></a>}</div></div>)}</CardContent></Card>
    <Card><CardHeader><CardTitle>File de qualité</CardTitle></CardHeader><CardContent className="space-y-3">{data!.issues.length===0?<p className="py-8 text-center text-muted-foreground">Aucune anomalie ouverte.</p>:data!.issues.map(i=><div key={i.id} className="rounded-lg border p-3"><div className="flex justify-between"><b className="text-sm">{i.issue_type}</b><Badge variant={i.severity==="blocking"?"destructive":"secondary"}>{i.severity}</Badge></div><p className="my-2 text-sm text-muted-foreground">{i.description}</p><Button size="sm" variant="outline" onClick={()=>resolveIssue.mutate(i.id)}>Marquer résolue</Button></div>)}</CardContent></Card></div>
    <Card><CardHeader><CardTitle>Derniers documents</CardTitle></CardHeader><CardContent>{data!.documents.length===0?<p className="py-8 text-center text-muted-foreground">Aucun document ingéré. Utilisez “Ingestion” pour charger le corpus initial.</p>:<div className="divide-y">{data!.documents.map(d=><div key={d.id} className="flex items-center justify-between gap-3 py-3"><div><b className="text-sm">{d.title}</b><p className="text-xs text-muted-foreground">{d.official_reference||"Sans référence"} · {d.document_type}</p></div><div className="flex items-center gap-2"><Badge variant="outline">{d.lifecycle_status}</Badge>{d.lifecycle_status==="quality_review"&&<Button size="sm" onClick={()=>publish.mutate(d.id)}>Publier</Button>}</div></div>)}</div>}</CardContent></Card>
  </div>;
}
function Metric({icon:Icon,label,value}:{icon:any;label:string;value:number}){return <Card><CardContent className="pt-6 flex gap-3"><Icon className="h-8 w-8 text-primary"/><div><div className="text-2xl font-bold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div></CardContent></Card>}
