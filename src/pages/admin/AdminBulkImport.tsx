import { useRef, useState } from "react";
import { pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Worker as TesseractWorker } from "tesseract.js";
import { createPdfOcrWorker, recognizePdfPage } from "@/lib/pdf/ocr";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, Pause, Play, ShieldCheck } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type ImportResult = { name: string; status: "imported" | "duplicate" | "failed"; detail?: string };
const readerType: Record<string,string> = {
  "sh code": "tariff",
  "circulaire maroc": "circular",
  "circulaire faite": "circular",
  "circulaire pas faite": "circular",
  "code de la douane": "customs_code",
  "reglementation des douanes et impots indirects": "other",
  "accord internationnal": "agreement",
  "produits controles": "technical_control",
};
const normalize = (value:string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const docType = (file:File) => {
  const segments = (file.webkitRelativePath || file.name).split("/").map(normalize);
  return segments.map(segment => readerType[segment]).find(Boolean) || "other";
};
async function digest(data: ArrayBuffer) {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), b=>b.toString(16).padStart(2,"0")).join("");
}
function pageText(items: Awaited<ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["getTextContent"]>>["items"]) {
  let lastY: number | null = null;
  const parts: string[] = [];
  for (const item of items) {
    if (!("str" in item) || !item.str) continue;
    const y = item.transform?.[5] ?? null;
    parts.push(lastY !== null && y !== null && Math.abs(y-lastY) > 2 ? "\n" : " ");
    parts.push(item.str);
    lastY = y;
  }
  return parts.join("").replace(/[ \t]+/g," ").replace(/\n[ \t]+/g,"\n").trim();
}

export default function AdminBulkImport() {
  const [files,setFiles] = useState<File[]>([]);
  const [results,setResults] = useState<ImportResult[]>([]);
  const [running,setRunning] = useState(false);
  const stop = useRef(false);
  const [progress,setProgress] = useState(0);
  const ocrWorker = useRef<TesseractWorker | null>(null);
  const ocrUnavailable = useRef(false);

  async function importOne(file: File, sourceId: string, userId: string):Promise<ImportResult> {
    const relative = file.webkitRelativePath || file.name;
    let pdf: PDFDocumentProxy | undefined;
    let documentId: string | undefined;
    let runId: string | undefined;
    try {
      const bytes = await file.arrayBuffer();
      const sha256 = await digest(bytes);
      const {data: existing,error:duplicateError} = await supabase.from("source_documents").select("id,lifecycle_status,storage_path").eq("source_id",sourceId).eq("sha256",sha256).maybeSingle();
      if (duplicateError) throw duplicateError;
      if (existing && existing.lifecycle_status !== "draft") return {name:relative,status:"duplicate"};
      const storagePath = `manual/${sha256}/${encodeURIComponent(file.name)}`;
      if (!existing) {
        const {error:storageError} = await supabase.storage.from("legal-source-pdfs").upload(storagePath,file,{contentType:"application/pdf",upsert:false});
        if (storageError && !/already exists|duplicate/i.test(storageError.message)) throw storageError;
      }
      const {data:document,error:documentError} = existing ? {data:existing,error:null} : await supabase.from("source_documents").insert({
        source_id: sourceId,
        title: file.name.replace(/\.pdf$/i, ""),
        document_type: docType(file),
        storage_bucket: "legal-source-pdfs",
        storage_path: storagePath,
        mime_type: "application/pdf",
        byte_size: file.size,
        sha256,
        lifecycle_status: "draft",
        uploaded_by: userId,
        metadata: { original_relative_path: relative, classification_unverified: true },
      }).select("id").single();
      if (documentError) throw documentError;
      documentId = document.id;
      const {data:run,error:runError} = await supabase.from("ingestion_runs").insert({source_document_id:document.id,pipeline_version:"browser-native-pdf-v1",extraction_method:"native_pdf",status:"processing",started_at:new Date().toISOString(),created_by:userId}).select("id").single();
      if (runError) throw runError;
      runId = run.id;
      const task = pdfjs.getDocument({data:new Uint8Array(bytes)});
      pdf = await task.promise;
      let needsReview = 0;
      let ocrPages = 0;
      const pageBatch: Array<{source_document_id:string;page_number:number;text_content:string;text_sha256:string;extraction_method:string;extraction_confidence:number;review_status:string;metadata:Record<string,number>}> = [];
      const issueBatch: Array<{ingestion_run_id:string;page_number:number;issue_type:string;severity:string;description:string;evidence:Record<string,number>}> = [];
      const flush = async (pageNumber:number) => {
        if (pageBatch.length) { const {error} = await supabase.from("source_pages").upsert(pageBatch.splice(0),{onConflict:"source_document_id,page_number"}); if (error) throw error; }
        if (issueBatch.length) { const {error} = await supabase.from("ingestion_issues").insert(issueBatch.splice(0)); if (error) throw error; }
        const {error} = await supabase.from("ingestion_runs").update({total_pages:pdf!.numPages,processed_pages:pageNumber,failed_pages:needsReview}).eq("id",run!.id);
        if (error) throw error;
      };
      for (let pageNumber=1; pageNumber<=pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        let text = pageText(content.items);
        let ocrConfidence: number | null = null;
        if (text.length < 80 && !ocrUnavailable.current) {
          try {
            if (!ocrWorker.current) ocrWorker.current = await createPdfOcrWorker();
            const recognized = await recognizePdfPage(page, ocrWorker.current);
            if (recognized.text.length > text.length) {
              text = recognized.text;
              ocrConfidence = recognized.confidence;
              ocrPages++;
            }
          } catch (ocrError) {
            console.warn("OCR indisponible pour cette session", ocrError);
            ocrUnavailable.current = true;
          }
        }
        const textHash = await digest(new TextEncoder().encode(text).buffer);
        const review = text.length < 80 || ocrConfidence !== null;
        if (review) needsReview++;
        pageBatch.push({source_document_id:document.id,page_number:pageNumber,text_content:text,text_sha256:textHash,extraction_method:ocrConfidence!==null?"ocr":"native_pdf",extraction_confidence:ocrConfidence??(text.length<80?0:70),review_status:review?"needs_review":"unreviewed",metadata:{chars:text.length,...(ocrConfidence!==null?{ocr_confidence:ocrConfidence}:{})}});
        if (review) {
          issueBatch.push({ingestion_run_id:run.id,page_number:pageNumber,issue_type:ocrConfidence!==null?"ocr_noise":"empty_page",severity:ocrConfidence!==null?"warning":"blocking",description:ocrConfidence!==null?"Texte obtenu par OCR automatique : contrôler les caractères et les tableaux SH":"Texte absent ou insuffisant après extraction",evidence:{chars:text.length,...(ocrConfidence!==null?{ocr_confidence:ocrConfidence}:{})}});
        }
        if (pageBatch.length>=25 || pageNumber===pdf.numPages) await flush(pageNumber);
      }
      const {error:completeError} = await supabase.from("ingestion_runs").update({status:"quality_review",extraction_method:ocrPages>0?"hybrid":"native_pdf",total_pages:pdf.numPages,processed_pages:pdf.numPages,failed_pages:needsReview,quality_score:Math.round(100*(pdf.numPages-needsReview)/Math.max(1,pdf.numPages)),completed_at:new Date().toISOString()}).eq("id",run.id);
      if (completeError) throw completeError;
      const {error:lifecycleError} = await supabase.from("source_documents").update({lifecycle_status:"quality_review"}).eq("id",document.id);
      if (lifecycleError) throw lifecycleError;
      return {name:relative,status:"imported",detail:`${pdf.numPages} pages, ${ocrPages} OCR, ${needsReview} à revoir`};
    } catch(error) {
      if (runId) await supabase.from("ingestion_runs").update({status:"failed",error_summary:String(error),completed_at:new Date().toISOString()}).eq("id",runId);
      return {name:relative,status:"failed",detail:error instanceof Error?error.message:String(error)};
    } finally {
      pdf?.destroy();
    }
  }

  async function start() {
    if (!files.length || running) return;
    stop.current=false;
    setRunning(true);
    const {data:auth} = await supabase.auth.getUser();
    if (!auth.user) {setRunning(false);setResults([{name:"Authentification",status:"failed",detail:"Session expirée"}]);return;}
    const {data:source,error:sourceError} = await supabase.from("regulatory_sources").select("id").eq("code","MA_MANUAL_CORPUS").single();
    if (sourceError) {setRunning(false);setResults([{name:"Source",status:"failed",detail:sourceError.message}]);return;}
    const completed = new Set(results.filter(r=>r.status!=="failed").map(r=>r.name));
    for (let index=0; index<files.length; index++) {
      if (stop.current) break;
      const file=files[index];
      const name=file.webkitRelativePath||file.name;
      if (!completed.has(name)) {
        const result=await importOne(file,source.id,auth.user.id);
        setResults(previous=>[...previous.filter(item=>item.name!==name),result]);
      }
      setProgress(Math.round(100*(index+1)/files.length));
    }
    await ocrWorker.current?.terminate();
    ocrWorker.current=null;
    ocrUnavailable.current=false;
    setRunning(false);
  }

  const imported=results.filter(r=>r.status==="imported").length;
  const duplicated=results.filter(r=>r.status==="duplicate").length;
  const failed=results.filter(r=>r.status==="failed").length;
  return <div className="space-y-6"><div><p className="text-sm font-semibold text-primary">IMPORT INITIAL</p><h1 className="text-3xl font-bold">Corpus PDF local</h1><p className="text-muted-foreground">Déposez un dossier complet. Les pages sans texte exploitable passent automatiquement en OCR français, arabe et anglais ; leurs résultats restent signalés comme provisoires.</p></div>
  <Card><CardHeader><CardTitle className="flex items-center gap-2"><FolderOpen className="h-5 w-5"/>Choisir le dossier</CardTitle></CardHeader><CardContent className="space-y-4"><input type="file" accept=".pdf,application/pdf" multiple disabled={running} onChange={event=>{setFiles(Array.from(event.target.files||[]).filter(file=>file.name.toLowerCase().endsWith(".pdf")));setResults([]);setProgress(0);}} {...{webkitdirectory:""}} className="block w-full text-sm"/><div className="flex items-center gap-3"><Badge variant="outline">{files.length} PDF</Badge><Button onClick={start} disabled={!files.length||running}><Play className="mr-2 h-4 w-4"/>{results.length?"Reprendre":"Importer"}</Button><Button variant="outline" onClick={()=>{stop.current=true}} disabled={!running}><Pause className="mr-2 h-4 w-4"/>Arrêter après ce fichier</Button></div><Progress value={progress}/><p className="text-xs text-muted-foreground">Reprenez après une interruption en sélectionnant le même dossier. Les fichiers déjà déposés sont détectés par leur empreinte.</p></CardContent></Card>
  <div className="grid gap-4 sm:grid-cols-3"><Metric label="Importés" value={imported}/><Metric label="Doublons" value={duplicated}/><Metric label="Erreurs" value={failed}/></div>
  <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5"/>Journal de traitement</CardTitle></CardHeader><CardContent className="max-h-96 overflow-auto divide-y">{results.length===0?<p className="py-8 text-center text-muted-foreground">Aucun traitement lancé.</p>:results.map(result=><div key={result.name} className="flex justify-between gap-3 py-2 text-sm"><span className="truncate">{result.name}</span><span className={result.status==="failed"?"text-destructive":"text-muted-foreground"}>{result.status}{result.detail&&` · ${result.detail}`}</span></div>)}</CardContent></Card></div>;
}
function Metric({label,value}:{label:string;value:number}){return <Card><CardContent className="pt-6"><b className="text-2xl">{value}</b><p className="text-xs text-muted-foreground">{label}</p></CardContent></Card>}
