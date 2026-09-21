import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Scale, FileText, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const TYPES = ["customs_code","law","decree","order","circular","instruction","decision","agreement","treaty","procedure","guide"] as const;
const RANK:Record<string,number>={constitution:100,treaty:90,agreement:90,law:80,customs_code:80,decree:70,order:60,circular:40,instruction:30,decision:30,procedure:20,guide:10};
const ARTICLE = /(?:^|\n)\s*(?:Article|Art\.)\s+(\d+(?:\s*(?:bis|ter|quater))?)\s*[.:\-–]?/gim;
async function digest(text:string){const bytes=new TextEncoder().encode(text);const hash=await crypto.subtle.digest("SHA-256",bytes);return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("")}
function articlesFromPage(text:string,page:number,pageId:string){const matches=[...text.matchAll(ARTICLE)];return matches.map((match,index)=>({number:match[1].replace(/\s+/g," ").trim(),body_text:text.slice(match.index!+match[0].length,matches[index+1]?.index??text.length).trim(),page_start:page,page_end:page,source_page_id:pageId})).filter(item=>item.body_text.length>=20);}

export default function AdminLegalReview(){
  const qc=useQueryClient();
  const [selected,setSelected]=useState<string>("");
  const [type,setType]=useState<string>("circular");
  const [reference,setReference]=useState("");
  const [title,setTitle]=useState("");
  const [authority,setAuthority]=useState("ADII");
  const {data:documents=[]}=useQuery({queryKey:["legal-review-documents"],queryFn:async()=>{const {data,error}=await supabase.from("source_documents").select("id,title,document_type,lifecycle_status,sha256,official_reference").in("lifecycle_status",["draft","extracted","quality_review","legal_review"]).order("created_at",{ascending:false}).limit(100);if(error)throw error;return data;}});
  const selectedDoc=documents.find(doc=>doc.id===selected);
  useEffect(()=>{if(selectedDoc){setTitle(selectedDoc.title);setReference(selectedDoc.official_reference||"");setType(TYPES.includes(selectedDoc.document_type as typeof TYPES[number])?selectedDoc.document_type:"circular");}},[selectedDoc?.id]);
  const {data:pages=[]}=useQuery({queryKey:["legal-review-pages",selected],enabled:!!selected,queryFn:async()=>{const {data,error}=await supabase.from("source_pages").select("id,page_number,text_content,text_sha256,review_status").eq("source_document_id",selected).order("page_number").limit(1000);if(error)throw error;return data;}});
  const candidates=useMemo(()=>pages.flatMap(page=>articlesFromPage(page.text_content,page.page_number,page.id)),[pages]);
  const save=useMutation({mutationFn:async()=>{
    if(!selectedDoc||!reference.trim()||!title.trim()||!authority.trim())throw new Error("Référence, titre et autorité sont requis");
    if(!pages.length)throw new Error("Aucune page extraite : revoir l’ingestion ou lancer l’OCR");
    const {data:existingInstrument,error:lookupError}=await supabase.from("legal_instruments").select("id").eq("jurisdiction_code","MA").eq("instrument_type",type).eq("official_reference",reference.trim()).maybeSingle();
    if(lookupError)throw lookupError;
    let instrumentId=existingInstrument?.id;
    if(!instrumentId){const {data:created,error}=await supabase.from("legal_instruments").insert({jurisdiction_code:"MA",instrument_type:type,official_reference:reference.trim(),canonical_title:title.trim(),issuing_authority:authority.trim(),authority_rank:RANK[type]||20,status:"draft"}).select("id").single();if(error)throw error;instrumentId=created.id;}
    const contentHash=await digest(pages.map(page=>page.text_sha256).join("|"));
    const {data:existingVersion,error:versionLookupError}=await supabase.from("legal_versions").select("id,status").eq("instrument_id",instrumentId).eq("content_hash",contentHash).maybeSingle();
    if(versionLookupError)throw versionLookupError;
    if(existingVersion?.status==="published")throw new Error("Cette version est déjà publiée : ses articles ne doivent pas être réécrits par une nouvelle extraction.");
    let versionId=existingVersion?.id;
    if(!versionId){const {data:created,error}=await supabase.from("legal_versions").insert({instrument_id:instrumentId,source_document_id:selectedDoc.id,version_label:`Document ${selectedDoc.sha256.slice(0,12)}`,content_hash:contentHash,status:"draft"}).select("id").single();if(error)throw error;versionId=created.id;}
    if(candidates.length){const rows=candidates.map((candidate,index)=>({legal_version_id:versionId,provision_type:"article",number:candidate.number,heading:`Article ${candidate.number}`,body_text:candidate.body_text,hierarchy_path:`article/${candidate.number}/page/${candidate.page_start}/segment/${index}`,sequence_number:index,page_start:candidate.page_start,page_end:candidate.page_end,source_page_id:candidate.source_page_id,extraction_confidence:55,review_status:"needs_review"}));for(let i=0;i<rows.length;i+=100){const {error}=await supabase.from("legal_provisions").upsert(rows.slice(i,i+100),{onConflict:"legal_version_id,hierarchy_path",ignoreDuplicates:true});if(error)throw error;}}
    const {error:statusError}=await supabase.from("source_documents").update({lifecycle_status:"legal_review",official_reference:reference.trim()}).eq("id",selectedDoc.id);if(statusError)throw statusError;
    return candidates.length;
  },onSuccess:count=>{qc.invalidateQueries({queryKey:["legal-review-documents"]});toast.success(`${count} articles candidats créés en revue juridique`);},onError:(error:Error)=>toast.error(error.message)});
  return <div className="space-y-6"><div><p className="text-sm font-semibold text-primary">HIÉRARCHIE JURIDIQUE</p><h1 className="text-3xl font-bold">Qualification des textes</h1><p className="text-muted-foreground">Associez un PDF à sa référence officielle, puis créez une version et des articles brouillons reliés à leur page.</p></div>
  <Card><CardHeader><CardTitle>Document source</CardTitle></CardHeader><CardContent className="space-y-4"><Select value={selected} onValueChange={setSelected}><SelectTrigger><SelectValue placeholder="Choisir un PDF en revue"/></SelectTrigger><SelectContent>{documents.map(doc=><SelectItem key={doc.id} value={doc.id}>{doc.title} · {doc.lifecycle_status}</SelectItem>)}</SelectContent></Select>{selectedDoc&&<div className="flex gap-2 text-sm"><Badge variant="outline">{selectedDoc.document_type}</Badge><Badge variant="secondary">{pages.length} pages</Badge><Badge variant="secondary">{candidates.length} articles candidats</Badge></div>}</CardContent></Card>
  {selectedDoc&&<div className="grid gap-6 xl:grid-cols-[1fr_1fr]"><Card><CardHeader><CardTitle className="flex gap-2"><Scale className="h-5 w-5"/>Identification</CardTitle></CardHeader><CardContent className="space-y-3"><label className="block text-sm">Type de texte<Select value={type} onValueChange={setType}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{TYPES.map(value=><SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label><label className="block text-sm">Référence officielle<Input value={reference} onChange={event=>setReference(event.target.value)} placeholder="Ex. Circulaire n° 0000/000"/></label><label className="block text-sm">Titre<Input value={title} onChange={event=>setTitle(event.target.value)}/></label><label className="block text-sm">Autorité émettrice<Input value={authority} onChange={event=>setAuthority(event.target.value)}/></label><div className="rounded-lg bg-muted p-3 text-sm">Rang juridique proposé : <b>{RANK[type]||20}</b>. Une circulaire ne peut pas modifier une loi ; ses effets doivent être reliés au texte habilitant.</div><Button disabled={save.isPending||!pages.length} onClick={()=>save.mutate()}>{save.isPending?"Création…":"Créer le brouillon juridique"}</Button></CardContent></Card>
  <Card><CardHeader><CardTitle className="flex gap-2"><FileText className="h-5 w-5"/>Preuves et qualité</CardTitle></CardHeader><CardContent className="max-h-[32rem] overflow-auto space-y-3">{pages.length===0?<p className="text-muted-foreground">Aucune page extraite.</p>:pages.slice(0,30).map(page=><div key={page.id} className="rounded-lg border p-3"><div className="flex justify-between"><b>Page {page.page_number}</b><Badge variant={page.text_content.length<80?"destructive":"outline"}>{page.text_content.length<80?"OCR requis":page.review_status}</Badge></div><p className="mt-2 text-xs whitespace-pre-wrap text-muted-foreground line-clamp-5">{page.text_content.slice(0,1000)}</p></div>)}{pages.length>30&&<p className="text-xs text-muted-foreground">Aperçu limité aux 30 premières pages.</p>}</CardContent></Card></div>}
  <Card><CardContent className="flex gap-3 py-4 text-sm text-muted-foreground"><AlertTriangle className="h-5 w-5 shrink-0"/>Les articles détectés restent « à vérifier » ; ni la version ni le texte ne sont publiés automatiquement.</CardContent></Card></div>;
}
