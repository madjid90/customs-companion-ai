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
  const [query,setQuery]=useState(""); const [analysis,setAnalysis]=useState<string|null>(null); const [loading,setLoading]=useState(false);
  const {data:codes=[]}=useQuery({queryKey:["hs-search",query],enabled:query.trim().length>=2,queryFn:async()=>{
    const clean=query.replace(/\D/g,"");
    let q=supabase.from("hs_nodes").select("id,code,level,description_official,description_resolved,chapter_number,review_status").limit(30);
    q=clean.length>=2?q.like("code",`${clean}%`):q.ilike("description_resolved",`%${query.trim()}%`);
    const {data,error}=await q.order("code");if(error)throw error;return data;
  }});
  const {data:candidates=[]}=useQuery({queryKey:["hs-candidates-search",query],enabled:query.trim().length>=2,queryFn:async()=>{
    const clean=query.replace(/\D/g,"");
    let request=supabase.from("hs_extraction_candidates").select("id,code,description_fragment,page_number,confidence,derivation_method,review_status,source_document_id").neq("review_status","rejected").limit(30);
    request=clean.length>=2?request.like("code",`${clean}%`):request.ilike("description_fragment",`%${query.trim().replace(/[%_]/g,"")}%`);
    const {data,error}=await request.order("confidence",{ascending:false});if(error)throw error;
    const ids=[...new Set((data??[]).map(row=>row.source_document_id).filter((id):id is string=>Boolean(id)))];
    if(ids.length===0)return [];
    const {data:documents,error:documentError}=await supabase.from("source_documents").select("id,title,storage_bucket,storage_path").in("id",ids);
    if(documentError)throw documentError;
    const byId=new Map((documents??[]).map(document=>[document.id,document]));
    return (data??[]).map(row=>({...row,source_documents:row.source_document_id?byId.get(row.source_document_id):undefined})).filter(row=>row.source_documents);
  }});
  const exactCode=query.replace(/\D/g,"");
  const {data:relatedPages=[]}=useQuery({queryKey:["hs-context",exactCode],enabled:exactCode.length===10,queryFn:async()=>{
    const {data,error}=await supabase.rpc("search_hs_document_mentions",{search_code:exactCode,result_limit:8});
    if(error)throw error;
    return data??[];
  }});
  async function openPdf(bucket:string,path:string,pageNumber:number){
    const {data,error}=await supabase.storage.from(bucket).createSignedUrl(path,300);
    if(error||!data?.signedUrl){toast.error("PDF indisponible pour ce compte");return;}
    window.open(`${data.signedUrl}#page=${pageNumber}`,"_blank","noopener,noreferrer");
  }
  async function openCandidateSource(candidate:(typeof candidates)[number]){
    const document=candidate.source_documents;
    if(!document)return;
    await openPdf(document.storage_bucket,document.storage_path,candidate.page_number);
  }
  async function classify(){setLoading(true);setAnalysis(null);try{const {data,error}=await supabase.functions.invoke("classify",{body:{description:query}});if(error)throw error;setAnalysis(typeof data==="string"?data:JSON.stringify(data,null,2));}catch(e:unknown){toast.error(e instanceof Error?e.message:"Classification indisponible");}finally{setLoading(false)}}
  return <div className="container mx-auto max-w-6xl p-4 md:p-8 space-y-6"><div><p className="text-sm font-semibold text-primary">NOMENCLATURE & PREUVES</p><h1 className="text-3xl font-bold">Recherche et classement SH</h1><p className="text-muted-foreground">Recherchez un code officiel ou décrivez une marchandise pour obtenir des candidats justifiés.</p></div><div className="flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input className="pl-10" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Code SH ou description technique détaillée…"/></div><Button onClick={classify} disabled={query.trim().length<3||loading}><Sparkles className="mr-2 h-4 w-4"/>{loading?"Analyse…":"Classer"}</Button></div>
  {analysis&&<Card className="border-primary/30"><CardHeader><CardTitle>Analyse assistée</CardTitle></CardHeader><CardContent><pre className="whitespace-pre-wrap text-sm overflow-auto">{analysis}</pre><div className="mt-4 flex gap-2 text-xs text-muted-foreground"><AlertCircle className="h-4 w-4"/>Toute proposition doit être validée avec ses sources avant déclaration.</div></CardContent></Card>}
  <div className="space-y-3">{query.length>=2&&codes.length===0&&candidates.length===0?<Card><CardContent className="py-10 text-center text-muted-foreground">Aucun code ni candidat extrait ne correspond.</CardContent></Card>:codes.map(c=><Card key={c.id}><CardHeader className="py-4"><div className="flex gap-4"><div className="font-mono text-lg font-bold text-primary min-w-32">{c.code}</div><div className="flex-1"><CardTitle className="text-base">{c.description_resolved}</CardTitle><p className="text-sm text-muted-foreground mt-1">{c.description_official}</p></div><div className="flex flex-col gap-2"><Badge variant="outline">{c.level}</Badge><Badge variant="secondary">{c.review_status}</Badge></div></div></CardHeader></Card>)}</div>
  {candidates.length>0&&<section className="space-y-3"><h2 className="text-xl font-semibold">Candidats extraits des PDF</h2><p className="text-sm text-muted-foreground">Ces lignes servent à orienter la recherche. Un code extrait automatiquement peut être erroné ou obsolète ; vérifiez la page source avant toute déclaration.</p>{candidates.map(candidate=><Card key={candidate.id}><CardContent className="py-4 flex flex-wrap items-start gap-4"><span className="font-mono font-bold text-primary">{candidate.code}</span><div className="flex-1 min-w-48"><p className="font-medium">{candidate.description_fragment}</p><p className="text-sm text-muted-foreground">{candidate.source_documents?.title} · page {candidate.page_number} · extraction {candidate.derivation_method} · confiance technique {candidate.confidence}%</p><Button variant="link" className="px-0" onClick={()=>openCandidateSource(candidate)}>Voir la preuve PDF</Button></div><Badge variant="outline">{candidate.review_status==="validated"?"Extrait vérifié":"Provisoire"}</Badge></CardContent></Card>)}</section>}
  {exactCode.length===10&&<section className="space-y-3"><h2 className="text-xl font-semibold">Documents mentionnant ce code</h2><p className="text-sm text-muted-foreground">Association textuelle automatique. La présence du code dans un document ne signifie pas que ses règles s'appliquent à votre opération.</p>{relatedPages.length===0?<Card><CardContent className="py-6 text-sm text-muted-foreground">Aucune mention directe trouvée dans les documents accessibles.</CardContent></Card>:relatedPages.map(page=><Card key={page.source_page_id}><CardContent className="py-4"><div className="flex flex-wrap items-center gap-2 mb-2"><Badge variant="outline">{page.document_type}</Badge><span className="font-medium">{page.title}</span><span className="text-sm text-muted-foreground">page {page.page_number}</span></div><p className="text-sm whitespace-pre-wrap line-clamp-4">{page.excerpt}</p><Button variant="link" className="px-0 mt-2" onClick={()=>openPdf(page.storage_bucket,page.storage_path,page.page_number)}>Voir le PDF source</Button></CardContent></Card>)}</section>}</div>;
}
