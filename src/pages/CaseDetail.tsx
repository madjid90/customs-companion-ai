import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, PackagePlus, FileDown, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

async function hashObject(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,"0")).join("");
}

export default function CaseDetail(){
  const {id}=useParams(); const qc=useQueryClient(); const [description,setDescription]=useState("");
  const {data,isLoading}=useQuery({queryKey:["case",id],enabled:!!id,queryFn:async()=>{
    const [c,items,docs]=await Promise.all([
      supabase.from("customs_cases").select("*").eq("id",id!).single(),
      supabase.from("case_items").select("*").eq("customs_case_id",id!).order("line_number"),
      supabase.from("generated_documents").select("*").eq("customs_case_id",id!).order("created_at",{ascending:false}),
    ]); if(c.error)throw c.error;if(items.error)throw items.error;if(docs.error)throw docs.error;return {case:c.data,items:items.data,docs:docs.data};
  }});
  const addItem=useMutation({mutationFn:async()=>{if(!data||!description.trim())throw new Error("Description requise");const {error}=await supabase.from("case_items").insert({customs_case_id:data.case.id,line_number:data.items.length+1,description:description.trim()});if(error)throw error;},onSuccess:()=>{setDescription("");qc.invalidateQueries({queryKey:["case",id]});toast.success("Produit ajouté");}});
  const generate=useMutation({mutationFn:async()=>{if(!data)throw new Error("Dossier introuvable");const {data:auth}=await supabase.auth.getUser();if(!auth.user)throw new Error("Non authentifié");const content={title:`Checklist douanière — ${data.case.reference}`,operation:data.case.operation_type,route:`${data.case.origin_country||"À préciser"} → ${data.case.destination_country}`,generated_at:new Date().toISOString(),items:data.items.map(x=>({line:x.line_number,description:x.description,status:x.status})),checklist:["Facture commerciale","Liste de colisage","Document de transport","Origine et preuve préférentielle","Classement SH validé avec justification","Autorisations et contrôles techniques","Simulation des droits et taxes"]};const documentType=data.case.operation_type==="export"?"export_checklist":"import_checklist";const version=(data.docs.filter(d=>d.document_type===documentType).length||0)+1;const {error}=await supabase.from("generated_documents").insert({organization_id:data.case.organization_id,customs_case_id:data.case.id,document_type:documentType,version,status:"draft",structured_content:content,evidence_snapshot:[],content_hash:await hashObject(content),generated_by:auth.user.id});if(error)throw error;return content;},onSuccess:async(content)=>{qc.invalidateQueries({queryKey:["case",id]});const {jsPDF}=await import("jspdf");const pdf=new jsPDF();pdf.setFontSize(18);pdf.text(content.title,14,20);pdf.setFontSize(11);pdf.text(`Opération : ${content.operation}`,14,31);pdf.text(`Trajet : ${content.route}`,14,38);pdf.setFontSize(14);pdf.text("Marchandises",14,51);let y=60;for(const item of content.items){const lines=pdf.splitTextToSize(`${item.line}. ${item.description} [${item.status}]`,180);pdf.text(lines,14,y);y+=lines.length*6+2;}y+=4;pdf.setFontSize(14);pdf.text("Pièces et contrôles",14,y);y+=9;pdf.setFontSize(11);for(const item of content.checklist){pdf.rect(14,y-4,4,4);pdf.text(item,22,y);y+=8;}pdf.setFontSize(8);pdf.text("Document de travail — validation experte requise avant déclaration.",14,287);pdf.save(`${data?.case.reference}-checklist.pdf`);toast.success("Checklist PDF générée et archivée");},onError:(e:Error)=>toast.error(e.message)});
  if(isLoading||!data)return <div className="p-8">Chargement…</div>;
  return <div className="container mx-auto max-w-6xl p-4 md:p-8 space-y-6"><Link to="/app/dossiers" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4"/>Tous les dossiers</Link><div className="flex flex-col md:flex-row md:items-start justify-between gap-4"><div><p className="font-mono text-sm text-primary">{data.case.reference}</p><h1 className="text-3xl font-bold">{data.case.title}</h1><p className="text-muted-foreground">{data.case.origin_country||"Origine à préciser"} → {data.case.destination_country}</p></div><div className="flex gap-2"><Badge>{data.case.status}</Badge><Button onClick={()=>generate.mutate()} disabled={generate.isPending}><FileDown className="mr-2 h-4 w-4"/>Générer la checklist</Button></div></div>
  <div className="grid gap-6 lg:grid-cols-[2fr_1fr]"><Card><CardHeader><CardTitle>Marchandises</CardTitle></CardHeader><CardContent className="space-y-3"><div className="flex gap-2"><Input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Description technique du produit, matière, usage…"/><Button onClick={()=>addItem.mutate()}><PackagePlus className="h-4 w-4"/></Button></div>{data.items.length===0?<p className="py-8 text-center text-muted-foreground">Ajoutez les produits à classer.</p>:data.items.map(x=><div key={x.id} className="rounded-lg border p-3"><div className="flex justify-between"><b>Ligne {x.line_number}</b><Badge variant="outline">{x.status}</Badge></div><p className="mt-1 text-sm">{x.description}</p></div>)}</CardContent></Card><Card><CardHeader><CardTitle className="flex gap-2"><ShieldCheck className="h-5 w-5"/>Livrables</CardTitle></CardHeader><CardContent className="space-y-3">{data.docs.length===0?<p className="text-sm text-muted-foreground">Aucun document généré.</p>:data.docs.map(d=><div key={d.id} className="rounded-lg border p-3"><b className="text-sm">{d.document_type}</b><p className="text-xs text-muted-foreground">Version {d.version} · {d.status}</p></div>)}</CardContent></Card></div></div>;
}
