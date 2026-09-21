import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export default function AdminPageQuality() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState("");
  const [correctedText, setCorrectedText] = useState("");
  const [reason, setReason] = useState("");
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
  useEffect(() => { setCorrectedText(page?.text_content || ""); setReason(""); }, [selectedId, page?.id]);
  const correct = useMutation({ mutationFn: async () => {
    if (!issue || !page) throw new Error("Sélectionnez une anomalie avec page extraite");
    if (correctedText.trim().length < 80 || reason.trim().length < 10) throw new Error("Saisissez le texte corrigé et expliquez la vérification sur le PDF");
    const { error } = await supabase.rpc("correct_source_page", { target_issue_id: issue.id, corrected_text_input: correctedText.trim(), correction_reason_input: reason.trim() });
    if (error) throw error;
  }, onSuccess: () => { setSelectedId(""); qc.invalidateQueries({ queryKey: ["page-quality-issues"] }); qc.invalidateQueries({ queryKey: ["page-quality-page"] }); qc.invalidateQueries({ queryKey: ["page-quality-history"] }); qc.invalidateQueries({ queryKey: ["corpus-control-center"] }); toast.success("Page corrigée et anomalie résolue avec trace d'audit"); }, onError: (error: Error) => toast.error(error.message) });

  return <div className="space-y-6"><div><p className="text-sm font-semibold text-primary">CONTRÔLE DU CORPUS</p><h1 className="text-3xl font-bold">Pages PDF à corriger</h1><p className="text-muted-foreground">Comparez le texte extrait à la page officielle. La correction et la résolution de l'anomalie sont enregistrées ensemble.</p></div>
    <div className="grid gap-6 xl:grid-cols-[22rem_1fr]"><Card><CardHeader><CardTitle>Anomalies ouvertes {isLoading ? "…" : `(${issues.length} affichées)`}</CardTitle></CardHeader><CardContent className="max-h-[75vh] space-y-2 overflow-auto">{issues.map((item) => <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`w-full rounded-lg border p-3 text-left ${selectedId === item.id ? "border-primary bg-muted" : "hover:bg-muted"}`}><div className="flex justify-between gap-2"><b>Page {item.page_number}</b><Badge variant={item.severity === "blocking" ? "destructive" : "secondary"}>{item.issue_type}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{item.description}</p></button>)}{!isLoading && !issues.length && <p className="text-sm text-muted-foreground">Aucune anomalie de page ouverte.</p>}</CardContent></Card>
      <div className="space-y-6">{issue ? <><Card><CardHeader><CardTitle>{document?.title || "Chargement du document…"} · page {issue.page_number}</CardTitle></CardHeader><CardContent className="space-y-3">{document?.lifecycle_status === "published" && <p className="text-sm text-destructive">Ce document est publié et immuable : ingérez une nouvelle révision.</p>}{signedUrl ? <iframe title={`Document source, page ${issue.page_number}`} src={`${signedUrl}#page=${issue.page_number}`} className="h-[28rem] w-full rounded-lg border" /> : <p className="text-sm text-muted-foreground">PDF source en cours de chargement.</p>}{!page && <p className="text-sm text-destructive">La page manque dans l'extraction. Relancez l'ingestion du document avant la correction.</p>}</CardContent></Card>{page && <Card><CardHeader><CardTitle>Texte corrigé et justification</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-xs text-muted-foreground">Extraction : {page.extraction_method} · statut {page.review_status}</p><Textarea value={correctedText} onChange={(event) => setCorrectedText(event.target.value)} rows={18} aria-label="Texte corrigé de la page" /><Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Comment avez-vous vérifié cette page sur le PDF ?" aria-label="Motif de correction" /><Button disabled={correct.isPending || document?.lifecycle_status === "published" || correctedText.trim() === page.text_content.trim()} onClick={() => correct.mutate()}>Enregistrer la correction</Button>{history.length > 0 && <div className="border-t pt-3"><b className="text-sm">Historique des corrections</b>{history.map((entry) => <p key={entry.id} className="mt-2 text-xs text-muted-foreground">{new Date(entry.reviewed_at).toLocaleString("fr-FR")} · {entry.correction_reason}</p>)}</div>}</CardContent></Card>}</> : <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Sélectionnez une anomalie pour ouvrir le PDF et sa page.</CardContent></Card>}</div></div>
  </div>;
}
