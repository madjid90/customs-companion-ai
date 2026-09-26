import { useEffect, useRef, useState } from "react";
import { pdfjs } from "react-pdf";
import { createPdfOcrWorker, recognizePdfPage } from "@/lib/pdf/ocr";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

export default function AdminPageQuality() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [correctedText, setCorrectedText] = useState("");
  const [reason, setReason] = useState("");
  const [ocrProgress, setOcrProgress] = useState<{done:number;total:number;improved:number;failed:number}|null>(null);
  const [ocrRunning, setOcrRunning] = useState(false);
  const stopOcr = useRef(false);
  const { data: issues = [], isLoading } = useQuery({ queryKey: ["page-quality-issues"], queryFn: async () => {
    const { data, error } = await supabase.from("ingestion_issues").select("id,ingestion_run_id,page_number,issue_type,severity,description,created_at").eq("status", "open").in("issue_type", ["empty_page", "ocr_noise", "table_alignment"]).not("page_number", "is", null).order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    return data;
  } });
  const issue = issues.find((item) => item.id === selectedId);
  const { data: run } = useQuery({ queryKey: ["page-quality-run", issue?.ingestion_run_id], enabled: !!issue, queryFn: async () => { const { data, error } = await supabase.from("ingestion_runs").select("id,source_document_id").eq("id", issue!.ingestion_run_id).single(); if (error) throw error; return data; } });
  const { data: document } = useQuery({ queryKey: ["page-quality-document", run?.source_document_id], enabled: !!run, queryFn: async () => { const { data, error } = await supabase.from("source_documents").select("id,title,storage_bucket,storage_path,lifecycle_status").eq("id", run!.source_document_id).single(); if (error) throw error; return data; } });
  const { data: page } = useQuery({ queryKey: ["page-quality-page", document?.id, issue?.page_number], enabled: !!document && !!issue?.page_number, queryFn: async () => { const { data, error } = await supabase.from("source_pages").select("id,page_number,text_content,review_status,extraction_method").eq("source_document_id", document!.id).eq("page_number", issue!.page_number!).maybeSingle(); if (error) throw error; return data; } });
  const { data: signedUrl } = useQuery({ queryKey: ["page-quality-pdf-url", document?.id], enabled: !!document, queryFn: async () => { const { data, error } = await supabase.storage.from(document!.storage_bucket).createSignedUrl(document!.storage_path, 900); if (error) throw error; return data.signedUrl; }, staleTime: 10 * 60 * 1000 });
  const { data: history = [] } = useQuery({ queryKey: ["page-quality-history", page?.id], enabled: !!page, queryFn: async () => { const { data, error } = await supabase.from("source_page_revisions").select("id,correction_reason,reviewed_at,previous_sha256,corrected_sha256").eq("source_page_id", page!.id).order("reviewed_at", { ascending: false }).limit(20); if (error) throw error; return data; } });
  useEffect(() => { setCorrectedText(page?.text_content || ""); setReason(""); }, [selectedId, page?.id, page?.text_content]);
  const correct = useMutation({ mutationFn: async () => {
    if (!issue || !page) throw new Error("Sélectionnez une anomalie avec page extraite");
    if (correctedText.trim().length < 80 || reason.trim().length < 10) throw new Error("Saisissez le texte corrigé et expliquez la vérification sur le PDF");
    const { error } = await supabase.rpc("correct_source_page", { target_issue_id: issue.id, corrected_text_input: correctedText.trim(), correction_reason_input: reason.trim() });
    if (error) throw error;
  }, onSuccess: () => { setSelectedId(""); qc.invalidateQueries({ queryKey: ["page-quality-issues"] }); qc.invalidateQueries({ queryKey: ["page-quality-page"] }); qc.invalidateQueries({ queryKey: ["page-quality-history"] }); qc.invalidateQueries({ queryKey: ["corpus-control-center"] }); toast.success("Page corrigée et anomalie résolue avec trace d'audit"); }, onError: (error: Error) => toast.error(error.message) });

  async function runAutomaticOcr() {
    if (ocrRunning) return;
    stopOcr.current = false;
    setOcrRunning(true);
    let worker: Awaited<ReturnType<typeof createPdfOcrWorker>> | null = null;
    let done = 0, improved = 0, failed = 0;
    try {
      const queue: Array<{id:string;ingestion_run_id:string;page_number:number}> = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase.from("ingestion_issues")
          .select("id,ingestion_run_id,page_number")
          .eq("status","open").eq("issue_type","empty_page")
          .not("page_number","is",null)
          .order("id").range(offset,offset+499);
        if (error) throw error;
        queue.push(...(data ?? []).filter((item):item is {id:string;ingestion_run_id:string;page_number:number} => item.page_number !== null));
        if ((data?.length ?? 0) < 500) break;
      }
      setOcrProgress({done,total:queue.length,improved,failed});
      if (!queue.length) { toast.info("Aucune page sans texte à traiter"); return; }
      const runIds=[...new Set(queue.map(item=>item.ingestion_run_id))];
      const runs=new Map<string,string>();
      for(let index=0;index<runIds.length;index+=100){
        const {data,error}=await supabase.from("ingestion_runs").select("id,source_document_id").in("id",runIds.slice(index,index+100));
        if(error)throw error;
        for(const run of data??[])runs.set(run.id,run.source_document_id);
      }
      const documentIds=[...new Set(runs.values())];
      const documents=new Map<string,{storage_bucket:string;storage_path:string}>();
      for(let index=0;index<documentIds.length;index+=100){
        const {data,error}=await supabase.from("source_documents").select("id,storage_bucket,storage_path").in("id",documentIds.slice(index,index+100));
        if(error)throw error;
        for(const document of data??[])documents.set(document.id,document);
      }
      const grouped=new Map<string,typeof queue>();
      for(const item of queue){const documentId=runs.get(item.ingestion_run_id);if(!documentId)continue;const group=grouped.get(documentId)??[];group.push(item);grouped.set(documentId,group);}
      worker=await createPdfOcrWorker();
      for(const [documentId,items] of grouped){
        if(stopOcr.current)break;
        const document=documents.get(documentId);
        if(!document){failed+=items.length;done+=items.length;continue;}
        try{
          const {data:blob,error}=await supabase.storage.from(document.storage_bucket).download(document.storage_path);
          if(error||!blob)throw error??new Error("PDF indisponible");
          const bytes=new Uint8Array(await blob.arrayBuffer());
          const pdf=await pdfjs.getDocument({data:bytes}).promise;
          try{
            for(const item of items){
              if(stopOcr.current)break;
              try{
                const page=await pdf.getPage(item.page_number);
                const recognized=await recognizePdfPage(page,worker);
                if(recognized.text.length>=80){
                  const {error:saveError}=await supabase.rpc("apply_automatic_ocr",{target_issue_id:item.id,ocr_text:recognized.text,ocr_confidence:recognized.confidence});
                  if(saveError)throw saveError;
                  improved++;
                }else failed++;
              }catch(error){console.warn("OCR page failed",item.id,error);failed++;}
              done++;
              setOcrProgress({done,total:queue.length,improved,failed});
            }
          }finally{await pdf.destroy();}
        }catch(error){console.warn("OCR document failed",documentId,error);failed+=items.length;done+=items.length;setOcrProgress({done,total:queue.length,improved,failed});}
      }
      toast.success(`${improved} page(s) enrichie(s) par OCR ; ${failed} sans résultat exploitable`);
      qc.invalidateQueries({queryKey:["page-quality-issues"]});
      qc.invalidateQueries({queryKey:["page-quality-page"]});
      qc.invalidateQueries({queryKey:["corpus-control-center"]});
    }catch(error){toast.error(error instanceof Error?error.message:"OCR indisponible");}
    finally{await worker?.terminate();setOcrRunning(false);}
  }

  return <div className="space-y-6"><div><p className="text-sm font-semibold text-primary">CONTRÔLE DU CORPUS</p><h1 className="text-3xl font-bold">Pages PDF à corriger</h1><p className="text-muted-foreground">L'OCR automatique peut réparer en lot les pages sans texte. Les résultats restent provisoires ; les corrections manuelles restent traçables.</p><div className="mt-4 flex flex-wrap items-center gap-3"><Button onClick={runAutomaticOcr} disabled={ocrRunning}>{ocrRunning?"OCR en cours…":"Lancer l'OCR du corpus"}</Button><Button variant="outline" onClick={()=>{stopOcr.current=true}} disabled={!ocrRunning}>Arrêter après la page</Button>{ocrProgress&&<span className="text-sm text-muted-foreground">{ocrProgress.done}/{ocrProgress.total} pages · {ocrProgress.improved} enrichies · {ocrProgress.failed} sans résultat</span>}</div></div>
    <div className="grid gap-6 xl:grid-cols-[22rem_1fr]"><Card><CardHeader><CardTitle>Anomalies ouvertes {isLoading ? "…" : `(${issues.length} affichées)`}</CardTitle></CardHeader><CardContent className="max-h-[75vh] space-y-2 overflow-auto">{issues.map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full rounded-lg border p-3 text-left ${selectedId === item.id ? "border-primary bg-muted" : "hover:bg-muted"}`}><div className="flex justify-between gap-2"><b>Page {item.page_number}</b><Badge variant={item.severity === "blocking" ? "destructive" : "secondary"}>{item.issue_type}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{item.description}</p></button>)}{!isLoading && !issues.length && <p className="text-sm text-muted-foreground">Aucune anomalie de page ouverte.</p>}</CardContent></Card>
      <div className="space-y-6">{issue ? <><Card><CardHeader><CardTitle>{document?.title || "Chargement du document…"} · page {issue.page_number}</CardTitle></CardHeader><CardContent className="space-y-3">{document?.lifecycle_status === "published" && <p className="text-sm text-destructive">Ce document est publié et immuable : ingérez une nouvelle révision.</p>}{signedUrl ? <iframe title={`Document source, page ${issue.page_number}`} src={`${signedUrl}#page=${issue.page_number}`} className="h-[28rem] w-full rounded-lg border" /> : <p className="text-sm text-muted-foreground">PDF source en cours de chargement.</p>}{!page && <p className="text-sm text-destructive">La page manque dans l'extraction. Relancez l'ingestion du document avant la correction.</p>}</CardContent></Card>{page && <Card><CardHeader><CardTitle>Texte corrigé et justification</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-xs text-muted-foreground">Extraction : {page.extraction_method} · statut {page.review_status}</p><Textarea value={correctedText} onChange={(event) => setCorrectedText(event.target.value)} rows={18} aria-label="Texte corrigé de la page" /><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Comment avez-vous vérifié cette page sur le PDF ?" aria-label="Motif de correction" /><Button disabled={correct.isPending || document?.lifecycle_status === "published" || correctedText.trim() === page.text_content.trim()} onClick={() => correct.mutate()}>Enregistrer la correction</Button>{history.length > 0 && <div className="border-t pt-3"><b className="text-sm">Historique des corrections</b>{history.map((entry) => <p key={entry.id} className="mt-2 text-xs text-muted-foreground">{new Date(entry.reviewed_at).toLocaleString("fr-FR")} · {entry.correction_reason}</p>)}</div>}</CardContent></Card>}</> : <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Sélectionnez une anomalie pour ouvrir le PDF et sa page.</CardContent></Card>}</div></div>
  </div>;
}
