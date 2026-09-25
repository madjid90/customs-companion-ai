import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.91.1";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
const hash = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

async function authorize(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (token.length < 40 || token.length > 200) return null;
  const tokenHash = await hash(token);
  const { data } = await db.from("worker_access_tokens").select("id,scopes").eq("token_sha256", tokenHash)
    .is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!data || !data.scopes.includes("ocr_page")) return null;
  await db.from("worker_access_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data;
}

async function claim(input: Record<string, unknown>) {
  const workerId = String(input.worker_id || "");
  const batchSize = Math.max(1, Math.min(5, Number(input.batch_size || 1)));
  if (!/^[a-zA-Z0-9._:-]{3,120}$/.test(workerId)) return json({ error: "invalid_worker_id" }, 400);
  const { data: jobs, error } = await db.rpc("claim_ingestion_jobs", { worker_id: workerId, accepted_types: ["ocr_page"], batch_size: batchSize });
  if (error) throw error;
  const output = [];
  for (const job of jobs || []) {
    const [{ data: document, error: documentError }, { data: page, error: pageError }] = await Promise.all([
      db.from("source_documents").select("storage_bucket,storage_path").eq("id", job.source_document_id).single(),
      db.from("source_pages").select("text_content,text_sha256,extraction_confidence,extraction_method").eq("id", job.source_page_id).single(),
    ]);
    if (documentError || pageError) throw documentError || pageError;
    const { data: signed, error: signedError } = await db.storage.from(document.storage_bucket).createSignedUrl(document.storage_path, 900);
    if (signedError) throw signedError;
    output.push({ ...job, download_url: signed.signedUrl, source_page: page });
  }
  return json({ jobs: output });
}

async function submit(input: Record<string, any>) {
  const workerId = String(input.worker_id || "");
  const jobId = String(input.job_id || "");
  const { data: job } = await db.from("ingestion_jobs").select("*").eq("id", jobId).eq("status", "running").eq("locked_by", workerId).maybeSingle();
  if (!job) return json({ error: "lease_lost" }, 409);
  const pdfium = input.pdfium || {}, ocr = input.ocr || {}, fusion = input.fusion || {};
  if (typeof pdfium.text !== "string" || typeof ocr.text !== "string" || pdfium.text.length>250000 || ocr.text.length>250000 || !validHash(pdfium.sha256) || !validHash(ocr.sha256) || !validHash(fusion.input_signature)) return json({ error: "invalid_output" }, 400);
  const outputs:any[] = [];
  for (const item of [
    { engine:"pypdfium2", engine_version:String(pdfium.engine_version||"unknown"), output_kind:"text", text_content:pdfium.text, confidence:pdfium.confidence, output_sha256:pdfium.sha256, payload:{ pdfium_version:pdfium.pdfium_version } },
    { engine:"tesseract.js", engine_version:String(ocr.engine_version||"tesseract.js-6.0.1"), output_kind:"ocr", text_content:ocr.text, confidence:ocr.confidence, output_sha256:ocr.sha256, payload:{ image_sha256:ocr.image_sha256, languages:ocr.languages } },
  ]) {
    const identity = { source_page_id:job.source_page_id, pipeline_version_id:"page-diagnostic-v1", engine:item.engine, engine_version:item.engine_version, output_kind:item.output_kind, output_sha256:item.output_sha256 };
    const { data: existing } = await db.from("page_engine_outputs").select("id").match(identity).maybeSingle();
    if (existing) outputs.push({ source:item.engine, id:existing.id });
    else { const { data, error } = await db.from("page_engine_outputs").insert({ ...identity, text_content:item.text_content, confidence:item.confidence, payload:item.payload }).select("id").single(); if(error) throw error; outputs.push({source:item.engine,id:data.id}); }
  }
  const ocrOutputId = outputs.find(x=>x.source==="tesseract.js").id;
  const pdfiumOutputId = outputs.find(x=>x.source==="pypdfium2").id;
  if (Array.isArray(ocr.blocks) && ocr.blocks.length<=5000) {
    const { count } = await db.from("page_blocks").select("id",{count:"exact",head:true}).eq("engine_output_id",ocrOutputId);
    if (!count && ocr.blocks.length) { const { error }=await db.from("page_blocks").insert(ocr.blocks.map((b:any)=>({ source_page_id:job.source_page_id,engine_output_id:ocrOutputId,block_type:"paragraph",reading_order:Number(b.reading_order||0),text_content:String(b.text_content||"").slice(0,250000),bbox:b.bbox||{},confidence:b.confidence,metadata:b.metadata||{} }))); if(error) throw error; }
  }
  const selectedOutputId = fusion.selected_source==="ocr" ? ocrOutputId : fusion.selected_source==="pdfium" ? pdfiumOutputId : null;
  const decisionRow = { source_page_id:job.source_page_id,pipeline_version_id:"page-fusion-v1",input_signature:fusion.input_signature,selected_source:fusion.selected_source,selected_engine_output_id:selectedOutputId,selected_text_sha256:fusion.selected_text_sha256||null,selected_score:fusion.selected_score??null,status:fusion.status,reason_codes:fusion.reason_codes||[],candidate_scores:fusion.candidate_scores||[],algorithm_version:String(fusion.algorithm_version||"") };
  const { data: prior }=await db.from("page_fusion_decisions").select("id").eq("source_page_id",job.source_page_id).eq("pipeline_version_id","page-fusion-v1").eq("input_signature",fusion.input_signature).maybeSingle();
  let decisionId=prior?.id;
  if(!decisionId){const {data,error}=await db.from("page_fusion_decisions").insert(decisionRow).select("id").single();if(error)throw error;decisionId=data.id;}
  const selectedText = fusion.selected_source==="ocr" ? ocr.text : fusion.selected_source==="pdfium" ? pdfium.text : fusion.selected_source==="native_pdf" ? String(input.native_text||"") : "";
  const {error: diagnosticError}=await db.from("page_diagnostics").update({
    status:fusion.status==="rejected"?"incomplete":"complete",
    recommended_strategy:fusion.status==="rejected"?"vision":fusion.selected_source,
    character_count:selectedText.length,
    word_count:selectedText.trim()?selectedText.trim().split(/\s+/u).length:0,
    line_count:selectedText?selectedText.split("\n").length:0,
    requires_ocr:false,
    quality_score:fusion.selected_score??0,
    metrics:{basis:"audited_fusion",fusion_decision_id:decisionId,algorithm_version:fusion.algorithm_version},
  }).eq("source_page_id",job.source_page_id).eq("pipeline_version_id","page-diagnostic-v1");
  if(diagnosticError)throw diagnosticError;
  if(fusion.status==="rejected"){
    const {error:visionError}=await db.from("ingestion_jobs").upsert({job_type:"analyze_layout",pipeline_version_id:"page-diagnostic-v1",source_document_id:job.source_document_id,source_page_id:job.source_page_id,idempotency_key:`analyze_layout:${job.source_page_id}:page-diagnostic-v1`,payload:{reason:"all_text_engines_empty",page_number:job.payload.page_number},priority:95},{onConflict:"idempotency_key",ignoreDuplicates:true});
    if(visionError)throw visionError;
  }
  const { data: completed, error: completeError }=await db.rpc("complete_ingestion_job",{job_id:job.id,worker_id:workerId,job_result:{fusion_decision_id:decisionId,fusion_status:fusion.status,selected_source:fusion.selected_source,selected_score:fusion.selected_score,pdfium_output_id:pdfiumOutputId,ocr_output_id:ocrOutputId}});
  if(completeError||!completed)return json({error:"lease_lost"},409);
  return json({status:"completed",decision_id:decisionId});
}

async function failJob(input: Record<string, unknown>) {
  const workerId=String(input.worker_id||""), jobId=String(input.job_id||""), message=String(input.error_message||"worker_error").slice(0,2000);
  const {data,error}=await db.rpc("fail_ingestion_job",{job_id:jobId,worker_id:workerId,error_code:String(input.error_code||"worker_error").slice(0,120),error_message:message});
  if(error)throw error;
  return json({status:data});
}

serve(async req => {
  if(req.method!=="POST")return json({error:"POST required"},405);
  if(!await authorize(req))return json({error:"Unauthorized"},401);
  try { const input=await req.json(); const action=new URL(req.url).searchParams.get("action"); if(action==="claim")return await claim(input); if(action==="submit")return await submit(input); if(action==="fail")return await failJob(input); return json({error:"unknown_action"},400); }
  catch(error){return json({error:error instanceof Error?error.message:String(error)},500);}
});
