import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Sparkles, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function HSExplorer(){
  const [query,setQuery]=useState(""); const [analysis,setAnalysis]=useState<any>(null); const [loading,setLoading]=useState(false);
  const {data:codes=[]}=useQuery({queryKey:["hs-search",query],enabled:query.trim().length>=2,queryFn:async()=>{
    const clean=query.replace(/\D/g,"");
    let q=supabase.from("hs_nodes").select("id,code,level,description_official,description_resolved,chapter_number,review_status").limit(30);
    q=clean.length>=2?q.like("code",`${clean}%`):q.ilike("description_resolved",`%${query.trim()}%`);
    const {data,error}=await q.order("code");if(error)throw error;return data;
  }});
  async function classify(){setLoading(true);setAnalysis(null);try{const {data,error}=await supabase.functions.invoke("classify",{body:{description:query}});if(error)throw error;setAnalysis(data);}catch(e:any){toast.error(e.message||"Classification indisponible");}finally{setLoading(false)}}
  return <div className="container mx-auto max-w-6xl p-4 md:p-8 space-y-6"><div><p className="text-sm font-semibold text-primary">NOMENCLATURE & PREUVES</p><h1 className="text-3xl font-bold">Recherche et classement SH</h1><p className="text-muted-foreground">Recherchez un code officiel ou décrivez une marchandise pour obtenir des candidats justifiés.</p></div><div className="flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input className="pl-10" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Code SH ou description technique détaillée…"/></div><Button onClick={classify} disabled={query.trim().length<3||loading}><Sparkles className="mr-2 h-4 w-4"/>{loading?"Analyse…":"Classer"}</Button></div>
  {analysis&&<Card className="border-primary/30"><CardHeader><CardTitle>Analyse assistée</CardTitle></CardHeader><CardContent><pre className="whitespace-pre-wrap text-sm overflow-auto">{typeof analysis==="string"?analysis:JSON.stringify(analysis,null,2)}</pre><div className="mt-4 flex gap-2 text-xs text-muted-foreground"><AlertCircle className="h-4 w-4"/>Toute proposition doit être validée avec ses sources avant déclaration.</div></CardContent></Card>}
  <div className="space-y-3">{query.length>=2&&codes.length===0?<Card><CardContent className="py-10 text-center text-muted-foreground">Aucun code publié ne correspond. Le corpus SH doit peut-être encore être validé.</CardContent></Card>:codes.map(c=><Card key={c.id}><CardHeader className="py-4"><div className="flex gap-4"><div className="font-mono text-lg font-bold text-primary min-w-32">{c.code}</div><div className="flex-1"><CardTitle className="text-base">{c.description_resolved}</CardTitle><p className="text-sm text-muted-foreground mt-1">{c.description_official}</p></div><div className="flex flex-col gap-2"><Badge variant="outline">{c.level}</Badge><Badge variant="secondary">{c.review_status}</Badge></div></div></CardHeader></Card>)}</div></div>;
}
