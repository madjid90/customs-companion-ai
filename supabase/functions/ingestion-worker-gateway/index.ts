import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.91.1";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
const hash = async (value: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const pageClasses=new Set(["blank","native_text","scanned","hybrid","short_text","table","form","vector_complex","unknown"]);
const strategies=new Set(["none","native_pdf","compare","pdfium","ocr","layout","vision","hybrid","quarantine"]);
const jobScopes: Record<string,string> = { ocr_page: "ocr_page", extract_tariff: "extract_tariff" };
const allowedRunStatus=new Set(["completed","review_required","rejected","failed"]);
const allowedTableStatus=new Set(["proposed","accepted","ambiguous","rejected"]);
const allowedRowStatus=new Set(["proposed","valid","ambiguous","invalid"]);
const allowedColumnNames=new Set(["hs_code","designation","unit","duty_rate","vat_rate","regime","notes","other"]);

async function authorize(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (token.length < 40 || token.length > 200) return null;
  const tokenHash = await hash(token);
  const { data } = await db.from("worker_access_tokens").select("id,scopes").eq("token_sha256", tokenHash)
    .is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!data || !Array.isArray(data.scopes) || !data.scopes.some((scope:string)=>Object.values(jobScopes).includes(scope))) return null;
  await db.from("worker_access_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return data;
}

const hasScope = (token:any, scope:string) => Array.isArray(token?.scopes) && token.scopes.includes(scope);

async function claim(input: Record<string, unknown>, token:any) {
  const workerId = String(input.worker_id || "");
  const batchSize = Math.max(1, Math.min(5, Number(input.batch_size || 1)));
  const jobType = String(input.job_type || "ocr_page");
  if (!/^[a-zA-Z0-9._:-]{3,120}$/.test(workerId)) return json({ error: "invalid_worker_id" }, 400);
  if (!jobScopes[jobType]) return json({ error: "unsupported_job_type" }, 400);
  if (!hasScope(token, jobScopes[jobType])) return json({ error: "scope_forbidden" }, 403);
  const { data: jobs, error } = await db.rpc("claim_ingestion_jobs", { worker_id: workerId, accepted_types: [jobType], batch_size: batchSize });
  if (error) throw error;
  const output = [];
  for (const job of jobs || []) {
    if (jobType === "ocr_page") {
      const [{ data: document, error: documentError }, { data: page, error: pageError }] = await Promise.all([
        db.from("source_documents").select("storage_bucket,storage_path").eq("id", job.source_document_id).single(),
        db.from("source_pages").select("text_content,text_sha256,extraction_confidence,extraction_method").eq("id", job.source_page_id).single(),
      ]);
      if (documentError || pageError) throw documentError || pageError;
      const { data: signed, error: signedError } = await db.storage.from(document.storage_bucket).createSignedUrl(document.storage_path, 900);
      if (signedError) throw signedError;
      output.push({ ...job, download_url: signed.signedUrl, source_page: page });
    } else {
      const [{ data: document, error: documentError }, { data: page, error: pageError }] = await Promise.all([
        db.from("source_documents").select("document_type,title,official_reference").eq("id", job.source_document_id).single(),
        db.from("source_pages").select("text_content,text_sha256,extraction_confidence,extraction_method,page_number").eq("id", job.source_page_id).single(),
      ]);
      if (documentError || pageError) throw documentError || pageError;
      output.push({ ...job, source_document: document, source_page: page });
    }
  }
  return json({ jobs: output });
}

async function submit(input: Record<string, any>, token:any) {
  if(!hasScope(token,"ocr_page"))return json({error:"scope_forbidden"},403);
  const workerId = String(input.worker_id || "");
  const jobId = String(input.job_id || "");
  const { data: job } = await db.from("ingestion_jobs").select("*").eq("id", jobId).eq("status", "running").eq("locked_by", workerId).maybeSingle();
  if (!job) return json({ error: "lease_lost" }, 409);
  if (job.job_type !== "ocr_page") return json({ error: "wrong_job_type" }, 409);
  await saveDiagnostic(job.source_page_id,input.diagnostic);
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
  let publicationStatus="not_eligible";
  if(fusion.status==="selected"&&Number(fusion.selected_score)>=80){
    const {error:publicationError}=await db.rpc("publish_selected_page_fusion",{target_decision_id:decisionId,minimum_score:80});
    publicationStatus=publicationError?"blocked":"published";
  }
  const { data: completed, error: completeError }=await db.rpc("complete_ingestion_job",{job_id:job.id,worker_id:workerId,job_result:{fusion_decision_id:decisionId,fusion_status:fusion.status,selected_source:fusion.selected_source,selected_score:fusion.selected_score,pdfium_output_id:pdfiumOutputId,ocr_output_id:ocrOutputId,publication_status:publicationStatus}});
  if(completeError||!completed)return json({error:"lease_lost"},409);
  return json({status:"completed",decision_id:decisionId});
}

async function submitTariff(input:Record<string,any>, token:any){
  if(!hasScope(token,"extract_tariff"))return json({error:"scope_forbidden"},403);
  const workerId=String(input.worker_id||""),jobId=String(input.job_id||"");
  const {data:job}=await db.from("ingestion_jobs").select("*").eq("id",jobId).eq("status","running").eq("locked_by",workerId).maybeSingle();
  if(!job)return json({error:"lease_lost"},409);
  if(job.job_type!=="extract_tariff"||job.pipeline_version_id!=="tariff-extractor-v2")return json({error:"wrong_job_type"},409);
  if(!validHash(input.input_text_sha256)||!allowedRunStatus.has(String(input.status)))return json({error:"invalid_tariff_result"},400);
  const {data:page,error:pageError}=await db.from("source_pages").select("text_sha256").eq("id",job.source_page_id).single();
  if(pageError)throw pageError;
  if(page.text_sha256!==input.input_text_sha256)return json({error:"input_text_hash_mismatch"},409);
  const tables=Array.isArray(input.tables)?input.tables:[];
  if(tables.length>50)return json({error:"too_many_tables"},400);
  const rowCount=tables.reduce((sum:number,table:any)=>sum+(Array.isArray(table.rows)?table.rows.length:0),0);
  if(rowCount>5000)return json({error:"too_many_rows"},400);
  const runRecord={source_page_id:job.source_page_id,pipeline_version_id:"tariff-extractor-v2",input_text_sha256:input.input_text_sha256,status:String(input.status),table_count:Number(input.table_count||tables.length),row_count:Number(input.row_count||rowCount),valid_row_count:Number(input.valid_row_count||0),quality_score:input.quality_score??null,metrics:typeof input.metrics==="object"&&input.metrics?input.metrics:{}};
  const {data:prior,error:priorError}=await db.from("tariff_extraction_runs").select("id").match({source_page_id:job.source_page_id,pipeline_version_id:"tariff-extractor-v2",input_text_sha256:input.input_text_sha256}).maybeSingle();
  if(priorError)throw priorError;
  let runId=prior?.id;
  if(!runId){const {data,error}=await db.from("tariff_extraction_runs").insert(runRecord).select("id").single();if(error)throw error;runId=data.id;}
  const {count:existingTableCount}=await db.from("tariff_table_candidates").select("id",{count:"exact",head:true}).eq("extraction_run_id",runId);
  if(!existingTableCount){
    for(const table of tables){
      const tableIndex=Number(table.table_index||0);
      if(!allowedTableStatus.has(String(table.status||"proposed")))return json({error:"invalid_table_status"},400);
      const {data:insertedTable,error:tableError}=await db.from("tariff_table_candidates").insert({extraction_run_id:runId,source_page_id:job.source_page_id,table_index:tableIndex,header_map:typeof table.header_map==="object"&&table.header_map?table.header_map:{},bbox:table.bbox||null,confidence:Number(table.confidence||0),status:String(table.status||"proposed"),reason_codes:Array.isArray(table.reason_codes)?table.reason_codes:[]}).select("id").single();
      if(tableError)throw tableError;
      for(const row of Array.isArray(table.rows)?table.rows:[]){
        if(!allowedRowStatus.has(String(row.validation_status||"proposed")))return json({error:"invalid_row_status"},400);
        const {data:insertedRow,error:rowError}=await db.from("tariff_row_candidates").insert({table_candidate_id:insertedTable.id,source_page_id:job.source_page_id,row_index:Number(row.row_index||0),raw_text:String(row.raw_text||"").slice(0,250000),raw_text_sha256:String(row.raw_text_sha256||""),hs_code_raw:row.hs_code_raw||null,hs_code_normalized:row.hs_code_normalized||null,hs_level:row.hs_level||null,designation:row.designation||null,unit_code:row.unit_code||null,duty_rate_raw:row.duty_rate_raw||null,duty_rate:row.duty_rate??null,vat_rate_raw:row.vat_rate_raw||null,vat_rate:row.vat_rate??null,regime:row.regime||null,notes:row.notes||null,bbox:row.bbox||null,confidence:Number(row.confidence||0),validation_status:String(row.validation_status||"proposed"),validation_codes:Array.isArray(row.validation_codes)?row.validation_codes:[],publication_status:"candidate"}).select("id").single();
        if(rowError)throw rowError;
        const cells=(Array.isArray(row.cells)?row.cells:[]).filter((cell:any)=>allowedColumnNames.has(String(cell.column_name)));
        if(cells.length){
          const {error:cellError}=await db.from("tariff_cell_evidence").insert(cells.slice(0,50).map((cell:any)=>({row_candidate_id:insertedRow.id,source_page_id:job.source_page_id,source_block_id:cell.source_block_id||null,column_name:String(cell.column_name),column_index:Number(cell.column_index||0),raw_value:String(cell.raw_value||"").slice(0,250000),normalized_value:cell.normalized_value??null,bbox:cell.bbox||null,confidence:Number(cell.confidence||0),evidence_sha256:String(cell.evidence_sha256||"")})));
          if(cellError)throw cellError;
        }
      }
    }
  }
  const {data:completed,error:completeError}=await db.rpc("complete_ingestion_job",{job_id:job.id,worker_id:workerId,job_result:{tariff_extraction_run_id:runId,status:input.status,table_count:runRecord.table_count,row_count:runRecord.row_count,valid_row_count:runRecord.valid_row_count,quality_score:runRecord.quality_score}});
  if(completeError||!completed)return json({error:"lease_lost"},409);
  return json({status:"completed",tariff_extraction_run_id:runId});
}

async function saveDiagnostic(sourcePageId:string, diagnostic:any){
  if(!diagnostic||!pageClasses.has(diagnostic.pageClass)||!strategies.has(diagnostic.strategy)||typeof diagnostic.metrics!=="object")throw new Error("invalid_diagnostic");
  const {error}=await db.from("page_diagnostic_results").upsert({source_page_id:sourcePageId,pipeline_version_id:"page-diagnostic-v2",page_class:diagnostic.pageClass,recommended_strategy:diagnostic.strategy,confidence:diagnostic.confidence,reason_codes:diagnostic.reasons||[],metrics:diagnostic.metrics},{onConflict:"source_page_id,pipeline_version_id"});
  if(error)throw error;
}

async function completeBlank(input:Record<string,any>, token:any){
  if(!hasScope(token,"ocr_page"))return json({error:"scope_forbidden"},403);
  const workerId=String(input.worker_id||""),jobId=String(input.job_id||"");
  const {data:job}=await db.from("ingestion_jobs").select("*").eq("id",jobId).eq("status","running").eq("locked_by",workerId).maybeSingle();
  if(!job)return json({error:"lease_lost"},409);
  if(job.job_type!=="ocr_page")return json({error:"wrong_job_type"},409);
  if(input.diagnostic?.pageClass!=="blank")return json({error:"blank_class_required"},400);
  await saveDiagnostic(job.source_page_id,input.diagnostic);
  const {data,error}=await db.rpc("complete_ingestion_job",{job_id:job.id,worker_id:workerId,job_result:{page_class:"blank",fusion_status:"not_required",selected_source:"none"}});
  if(error||!data)return json({error:"lease_lost"},409);
  return json({status:"completed",page_class:"blank"});
}

async function failJob(input: Record<string, unknown>, token:any) {
  const workerId=String(input.worker_id||""), jobId=String(input.job_id||""), message=String(input.error_message||"worker_error").slice(0,2000);
  const {data:job}=await db.from("ingestion_jobs").select("job_type").eq("id",jobId).eq("status","running").eq("locked_by",workerId).maybeSingle();
  if(!job)return json({error:"lease_lost"},409);
  const scope=jobScopes[String(job.job_type)];
  if(scope&&!hasScope(token,scope))return json({error:"scope_forbidden"},403);
  const {data,error}=await db.rpc("fail_ingestion_job",{job_id:jobId,worker_id:workerId,error_code:String(input.error_code||"worker_error").slice(0,120),error_message:message});
  if(error)throw error;
  return json({status:data});
}

serve(async req => {
  if(req.method!=="POST")return json({error:"POST required"},405);
  const token=await authorize(req);
  if(!token)return json({error:"Unauthorized"},401);
  try { const input=await req.json(); const action=new URL(req.url).searchParams.get("action"); if(action==="claim")return await claim(input,token); if(action==="submit")return await submit(input,token); if(action==="submit_tariff")return await submitTariff(input,token); if(action==="complete_blank")return await completeBlank(input,token); if(action==="fail")return await failJob(input,token); return json({error:"unknown_action"},400); }
  catch(error){return json({error:error instanceof Error?error.message:String(error)},500);}
});
