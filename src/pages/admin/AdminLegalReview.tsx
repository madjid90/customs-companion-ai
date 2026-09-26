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
function provisionsFromPage(text:string,page:number,pageId:string){
  const matches=[...text.matchAll(ARTICLE)];
  const articles=matches.map((match,index)=>({provision_type:"article",number:match[1].replace(/\s+/g," ").trim(),body_text:text.slice(match.index!+match[0].length,matches[index+1]?.index??text.length).trim(),page_start:page,page_end:page,source_page_id:pageId})).filter(item=>item.body_text.length>=20);
  if(articles.length)return articles;
  return text.trim().length>=80?[{provision_type:"note",number:`page-${page}`,body_text:text.trim(),page_start:page,page_end:page,source_page_id:pageId}]:[];
}

export default function AdminLegalReview(){
  const qc=useQueryClient();
  const [selected,setSelected]=useState<string>("");
  const [filter,setFilter]=useState("");
  const [offset,setOffset]=useState(0);
  const [type,setType]=useState<string>("");
  const [reference,setReference]=useState("");
  const [title,setTitle]=useState("");
  const [authority,setAuthority]=useState("");
  const {data:documentPage}=useQuery({queryKey:["legal-review-documents",filter,offset],queryFn:async()=>{let query=supabase.from("source_documents").select("id,title,document_type,lifecycle_status,sha256,official_reference",{count:"exact"}).in("lifecycle_status",["draft","extracted","quality_review","legal_review"]);if(filter.trim())query=query.ilike("title",`%${filter.trim().replace(/[%_,]/g,"")}%`);const {data,error,count}=await query.order("created_at",{ascending:false}).range(offset,offset+99);if(error)throw error;return {rows:data,total:count||0};}});
  const documents=documentPage?.rows||[];
  const selectedDoc=documents.find(doc=>doc.id===selected);
  useEffect(()=>{if(selectedDoc){setTitle(selectedDoc.title);setReference(selectedDoc.official_reference||"");setType(TYPES.includes(selectedDoc.document_type as typeof TYPES[number])?selectedDoc.document_type:"");setAuthority("");}},[selectedDoc]);
  const {data:pages=[]}=useQuery({queryKey:["legal-review-pages",selected],enabled:!!selected,queryFn:async()=>{const all=[];for(let offset=0;offset<5000;offset+=500){const {data,error}=await supabase.from("source_pages").select("id,page_number,text_content,text_sha256,review_status").eq("source_document_id",selected).order("page_number").range(offset,offset+499);if(error)throw error;all.push(...data);if(data.length<500)return all;}throw new Error("Document de plus de 5 000 pages : traiter par volumes séparés");}});
  const candidates=useMemo(()=>pages.flatMap(page=>provisionsFromPage(page.text_content,page.page_number,page.id)),[pages]);
  const save=useMutation({mutationFn:async()=>{
    if(!selectedDoc||!type||!reference.trim()||!title.trim()||!authority.trim())throw new Error("Type juridique vérifié, référence, titre et autorité sont requis");
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
    if(candidates.length){const rows=candidates.map((candidate,index)=>({legal_version_id:versionId,provision_type:candidate.provision_type,number:candidate.number,heading:candidate.provision_type==="article"?`Article ${candidate.number}`:`Page ${candidate.page_start} — texte à qualifier`,body_text:candidate.body_text,hierarchy_path:`${candidate.provision_type}/${candidate.number}/page/${candidate.page_start}/segment/${index}`,sequence_number:index,page_start:candidate.page_start,page_end:candidate.page_end,source_page_id:candidate.source_page_id,extraction_confidence:candidate.provision_type==="article"?55:30,review_status:"needs_review"}));for(let i=0;i<rows.length;i+=100){const {error}=await supabase.from("legal_provisions").upsert(rows.slice(i,i+100),{onConflict:"legal_version_id,hierarchy_path",ignoreDuplicates:true});if(error)throw error;}}
    const {error:statusError}=await supabase.from("source_documents").update({lifecycle_status:"legal_review",official_reference:reference.trim()}).eq("id",selectedDoc.id);if(statusError)throw statusError;
    return candidates.length;
  },onSuccess:count=>{qc.invalidateQueries({queryKey:["legal-review-documents"]});toast.success(`${count} dispositions candidates créées en revue juridique`);},onError:(error:Error)=>toast.error(error.message)});
  return <div className="space-y-6"><div><p className="text-sm font-semibold text-primary">HIÉRARCHIE JURIDIQUE</p><h1 className="text-3xl font-bold">Qualification des textes</h1><p className="text-muted-foreground">Associez un PDF à sa référence officielle, puis créez une version et des articles brouillons reliés à leur page.</p></div>
  <Card><CardHeader><CardTitle>Document source</CardTitle></CardHeader><CardContent className="space-y-4"><Input value={filter} onChange={event=>{setFilter(event.target.value);setOffset(0);setSelected("");}} placeholder="Rechercher un PDF par titre" aria-label="Rechercher un document source"/><Select value={selected} onValueChange={setSelected}><SelectTrigger><SelectValue placeholder="Choisir un PDF en revue"/></SelectTrigger><SelectContent>{documents.map(doc=><SelectItem key={doc.id} value={doc.id}>{doc.title} · {doc.lifecycle_status}</SelectItem>)}</SelectContent></Select><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{documentPage?.total||0} documents · {documentPage?.total?offset+1:0}–{Math.min(offset+100,documentPage?.total||0)}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={offset===0} onClick={()=>{setOffset(Math.max(0,offset-100));setSelected("");}}>Précédents</Button><Button size="sm" variant="outline" disabled={offset+100>=(documentPage?.total||0)} onClick={()=>{setOffset(offset+100);setSelected("");}}>Suivants</Button></div></div>{selectedDoc&&<div className="flex gap-2 text-sm"><Badge variant="outline">{selectedDoc.document_type}</Badge><Badge variant="secondary">{pages.length} pages</Badge><Badge variant="secondary">{candidates.length} dispositions candidates</Badge></div>}</CardContent></Card>
  {selectedDoc&&<div className="grid gap-6 xl:grid-cols-[1fr_1fr]"><Card><CardHeader><CardTitle className="flex gap-2"><Scale className="h-5 w-5"/>Identification</CardTitle></CardHeader><CardContent className="space-y-3"><label className="block text-sm">Type de texte<Select value={type} onValueChange={setType}><SelectTrigger><SelectValue placeholder="Qualifier le type juridique"/></SelectTrigger><SelectContent>{TYPES.map(value=><SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></label><label className="block text-sm">Référence officielle<Input value={reference} onChange={event=>setReference(event.target.value)} placeholder="Ex. Circulaire n° 0000/000"/></label><label className="block text-sm">Titre<Input value={title} onChange={event=>setTitle(event.target.value)}/></label><label className="block text-sm">Autorité émettrice<Input value={authority} onChange={event=>setAuthority(event.target.value)}/></label><div className="rounded-lg bg-muted p-3 text-sm">Rang juridique proposé : <b>{type ? RANK[type] : "à déterminer"}</b>. Une circulaire ne peut pas modifier une loi ; ses effets doivent être reliés au texte habilitant.</div><Button disabled={save.isPending||!pages.length||!type} onClick={()=>save.mutate()}>{save.isPending?"Création…":"Créer le brouillon juridique"}</Button></CardContent></Card>
  <Card><CardHeader><CardTitle className="flex gap-2"><FileText className="h-5 w-5"/>Preuves et qualité</CardTitle></CardHeader><CardContent className="max-h-[32rem] overflow-auto space-y-3">{pages.length===0?<p className="text-muted-foreground">Aucune page extraite.</p>:pages.slice(0,30).map(page=><div key={page.id} className="rounded-lg border p-3"><div className="flex justify-between"><b>Page {page.page_number}</b><Badge variant={page.text_content.length<80?"destructive":"outline"}>{page.text_content.length<80?"OCR requis":page.review_status}</Badge></div><p className="mt-2 text-xs whitespace-pre-wrap text-muted-foreground line-clamp-5">{page.text_content.slice(0,1000)}</p></div>)}{pages.length>30&&<p className="text-xs text-muted-foreground">Aperçu limité aux 30 premières pages.</p>}</CardContent></Card></div>}
  <Card><CardContent className="flex gap-3 py-4 text-sm text-muted-foreground"><AlertTriangle className="h-5 w-5 shrink-0"/>Les articles détectés restent « à vérifier » ; ni la version ni le texte ne sont publiés automatiquement.</CardContent></Card></div>;
}
