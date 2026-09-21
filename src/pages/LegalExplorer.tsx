import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Scale, Search, Link2 } from "lucide-react";

export default function LegalExplorer() {
  const [query,setQuery]=useState("");
  const {data: instruments=[]}=useQuery({queryKey:["legal-instruments",query],queryFn:async()=>{
    let q=supabase.from("legal_instruments").select("id,canonical_title,official_reference,instrument_type,issuing_authority,status,authority_rank").order("authority_rank").limit(80);
    if(query.trim()) q=q.or(`canonical_title.ilike.%${query.trim()}%,official_reference.ilike.%${query.trim()}%`);
    const {data,error}=await q;if(error)throw error;return data;
  }});
  const {data: relations=[]}=useQuery({queryKey:["legal-relationship-count"],queryFn:async()=>{const {data,error}=await supabase.from("legal_relationships").select("id,relationship_type").limit(500);if(error)throw error;return data;}});
  return <div className="container mx-auto max-w-6xl p-4 md:p-8 space-y-6"><div><p className="text-sm font-semibold text-primary">CORPUS OFFICIEL VERSIONNÉ</p><h1 className="text-3xl font-bold">Droit douanier marocain</h1><p className="text-muted-foreground">Textes, versions, articles et liens entre circulaires, lois et mesures tarifaires.</p></div>
  <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input className="pl-10" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Rechercher une référence, une circulaire ou un texte…"/></div>
  <div className="grid gap-4 sm:grid-cols-3"><Metric icon={Scale} label="Textes publiés" value={instruments.length}/><Metric icon={Link2} label="Liens réglementaires" value={relations.length}/><Metric icon={Search} label="Juridiction" value="Maroc"/></div>
  <div className="space-y-3">{instruments.length===0?<Card><CardContent className="py-10 text-center text-muted-foreground">Le registre est prêt. Les textes validés apparaîtront après ingestion.</CardContent></Card>:instruments.map(i=><Card key={i.id}><CardHeader className="py-4"><div className="flex items-start justify-between gap-4"><div><CardTitle className="text-base">{i.canonical_title}</CardTitle><p className="text-sm text-muted-foreground mt-1">{i.official_reference} · {i.issuing_authority}</p></div><div className="flex gap-2"><Badge variant="outline">{i.instrument_type}</Badge><Badge>{i.status}</Badge></div></div></CardHeader></Card>)}</div></div>;
}
function Metric({icon:Icon,label,value}:{icon:any;label:string;value:string|number}){return <Card><CardContent className="pt-6 flex items-center gap-3"><Icon className="h-8 w-8 text-primary"/><div><div className="text-2xl font-bold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div></CardContent></Card>}
