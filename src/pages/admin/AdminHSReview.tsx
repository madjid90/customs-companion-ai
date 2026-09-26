import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function AdminHSReview() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [chapter, setChapter] = useState("");
  const [reviewStatus, setReviewStatus] = useState<"proposed" | "validated">("proposed");
  const [selected, setSelected] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [nomenclatureId, setNomenclatureId] = useState("");
  const [edition, setEdition] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [masterDocumentId, setMasterDocumentId] = useState("");
  const { data: nomenclatures = [] } = useQuery({ queryKey: ["hs-draft-nomenclatures"], queryFn: async () => { const { data, error } = await supabase.from("hs_nomenclatures").select("id,code,name,edition,effective_from,status").in("status", ["draft", "review"]).eq("jurisdiction_code", "MA").order("created_at", { ascending: false }); if (error) throw error; return data; } });
  const { data: sourceDocuments = [] } = useQuery({ queryKey: ["hs-source-documents"], queryFn: async () => { const { data, error } = await supabase.from("source_documents").select("id,title,document_type,lifecycle_status").eq("lifecycle_status", "published").order("created_at", { ascending: false }).limit(200); if (error) throw error; return data; } });
  const createNomenclature = useMutation({ mutationFn: async () => { if (!edition.trim() || !effectiveFrom || !masterDocumentId) throw new Error("Édition, date d'effet et document source publié sont requis"); const code = `MA-10-${edition.trim().replace(/[^a-zA-Z0-9-]/g, "-")}`; const { data, error } = await supabase.from("hs_nomenclatures").insert({ code, name: `Nomenclature tarifaire marocaine ${edition.trim()}`, jurisdiction_code: "MA", edition: edition.trim(), digits: 10, effective_from: effectiveFrom, source_document_id: masterDocumentId, status: "draft" }).select("id").single(); if (error) throw error; return data.id; }, onSuccess: (id) => { setNomenclatureId(id); qc.invalidateQueries({ queryKey: ["hs-draft-nomenclatures"] }); toast.success("Édition SH créée en brouillon"); }, onError: (error: Error) => toast.error(error.message) });
  const promote = useMutation({ mutationFn: async () => { if (!candidate || candidate.review_status !== "validated" || !nomenclatureId) throw new Error("Ligne validée et édition SH requises"); const { error } = await supabase.rpc("promote_reviewed_hs_candidate", { candidate_id: candidate.id, target_nomenclature_id: nomenclatureId }); if (error) throw error; }, onSuccess: () => toast.success("Ligne ajoutée à la nomenclature brouillon avec sa page source"), onError: (error: Error) => toast.error(error.message) });
  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ["hs-candidates", search, chapter, reviewStatus],
    queryFn: async () => {
      let query = supabase.from("hs_extraction_candidates").select("*").eq("review_status", reviewStatus).order("confidence", { ascending: true }).limit(100);
      if (chapter) query = query.eq("chapter_number", chapter);
      if (search) query = query.eq("code", search.replace(/\D/g, "").slice(0, 10));
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
  const candidate = candidates.find((item) => item.id === selected);
  const { data: duplicates = [] } = useQuery({
    queryKey: ["hs-candidate-duplicates", candidate?.code],
    enabled: !!candidate,
    queryFn: async () => {
      const { data, error } = await supabase.from("hs_extraction_candidates").select("id,source_relative_path,page_number,description_fragment,review_status").eq("code", candidate!.code).limit(50);
      if (error) throw error;
      return data;
    },
  });
  const review = useMutation({
    mutationFn: async (status: "validated" | "rejected") => {
      if (!candidate) throw new Error("Sélectionnez une ligne SH");
      if (status === "validated" && (!description.trim() || description.trim().length < 8)) throw new Error("Vérifiez et saisissez la désignation officielle complète");
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase.from("hs_extraction_candidates").update({
        review_status: status,
        description_fragment: status === "validated" ? description.trim() : candidate.description_fragment,
        review_note: note.trim() || null,
        reviewed_by: user.user?.id ?? null,
        reviewed_at: new Date().toISOString(),
      }).eq("id", candidate.id).eq("review_status", "proposed");
      if (error) throw error;
    },
    onSuccess: () => { setSelected(null); setDescription(""); setNote(""); qc.invalidateQueries({ queryKey: ["hs-candidates"] }); toast.success("Revue enregistrée"); },
    onError: (error: Error) => toast.error(error.message),
  });
  return <div className="space-y-6">
    <div><p className="text-sm font-semibold text-primary">NOMENCLATURE MAROCAINE</p><h1 className="text-3xl font-bold">Revue des codes SH extraits</h1><p className="text-muted-foreground">Chaque ligne PDF reste une proposition. Vérifiez le code, la désignation et les doublons avant validation.</p></div>
    <Card><CardContent className="grid gap-3 py-4 md:grid-cols-3"><Input aria-label="Code SH à dix chiffres" placeholder="Code exact à 10 chiffres" value={search} onChange={(event) => setSearch(event.target.value)} /><Input aria-label="Chapitre à deux chiffres" placeholder="Chapitre (ex. 01)" value={chapter} onChange={(event) => setChapter(event.target.value.replace(/\D/g, "").slice(0, 2))} /><select aria-label="Statut de revue" className="h-10 rounded-md border bg-background px-3" value={reviewStatus} onChange={(event) => { setReviewStatus(event.target.value as "proposed" | "validated"); setSelected(null); }}><option value="proposed">À vérifier</option><option value="validated">Validées</option></select></CardContent></Card>
    <Card><CardHeader><CardTitle>Édition de nomenclature</CardTitle></CardHeader><CardContent className="space-y-3"><select className="h-10 w-full rounded-md border bg-background px-3" value={nomenclatureId} onChange={(event) => setNomenclatureId(event.target.value)}><option value="">Choisir une édition brouillon</option>{nomenclatures.map((item) => <option key={item.id} value={item.id}>{item.name} · effet {item.effective_from}</option>)}</select><div className="grid gap-3 md:grid-cols-3"><Input aria-label="Édition officielle" placeholder="Édition officielle vérifiée" value={edition} onChange={(event) => setEdition(event.target.value)} /><Input aria-label="Date d'effet de l'édition" type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /><select aria-label="Document maître publié" className="h-10 w-full rounded-md border bg-background px-3" value={masterDocumentId} onChange={(event) => setMasterDocumentId(event.target.value)}><option value="">Document maître publié</option>{sourceDocuments.map((doc) => <option key={doc.id} value={doc.id}>{doc.title}</option>)}</select></div><Button variant="outline" disabled={createNomenclature.isPending} onClick={() => createNomenclature.mutate()}>Créer une édition brouillon</Button><p className="text-xs text-muted-foreground">L'édition et la date d'effet doivent être contrôlées sur la source officielle. Une ligne ne peut être promue que si son PDF et sa page ont été importés.</p></CardContent></Card>
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]"><Card><CardHeader><CardTitle>Propositions {isLoading ? "…" : `(${candidates.length} affichées)`}</CardTitle></CardHeader><CardContent className="max-h-[65vh] space-y-2 overflow-auto">{candidates.map((item) => <button key={item.id} type="button" onClick={() => { setSelected(item.id); setDescription(item.description_fragment); setNote(""); }} className={`w-full rounded-lg border p-3 text-left hover:bg-muted ${selected === item.id ? "border-primary" : ""}`}><div className="flex justify-between gap-2"><b className="font-mono">{item.code}</b><Badge variant={item.derivation_method === "inherited_prefix" ? "destructive" : "secondary"}>{item.confidence}%</Badge></div><p className="mt-1 line-clamp-2 text-sm">{item.description_fragment}</p><p className="mt-1 text-xs text-muted-foreground">{item.source_relative_path} · page {item.page_number} · ligne {item.line_number}</p></button>)}{!isLoading && !candidates.length && <p className="text-sm text-muted-foreground">Aucune proposition pour ce filtre.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Contrôle humain</CardTitle></CardHeader><CardContent className="space-y-4">{candidate ? <><div className="text-sm"><b>Code :</b> <span className="font-mono">{candidate.code}</span><br/><b>Méthode :</b> {candidate.derivation_method}<br/><b>Page :</b> {candidate.page_number}<br/><b>Extrait brut :</b> <span className="whitespace-pre-wrap">{candidate.raw_line}</span></div><div><label className="text-sm font-medium" htmlFor="hs-description">Désignation vérifiée</label><Input id="hs-description" value={description} onChange={(event) => setDescription(event.target.value)} disabled={candidate.review_status === "validated"} /></div><div><label className="text-sm font-medium" htmlFor="hs-note">Note de revue</label><Input id="hs-note" value={note} onChange={(event) => setNote(event.target.value)} disabled={candidate.review_status === "validated"} /></div><div className="rounded-lg border p-3 text-sm"><b>{duplicates.length} occurrence(s) pour ce code</b>{duplicates.map((item) => <p key={item.id} className="mt-2 text-xs">{item.source_relative_path}, p. {item.page_number} · {item.review_status} · {item.description_fragment}</p>)}</div>{candidate.review_status === "proposed" ? <div className="flex gap-2"><Button disabled={review.isPending} onClick={() => review.mutate("validated")}>Valider cette occurrence</Button><Button variant="destructive" disabled={review.isPending} onClick={() => review.mutate("rejected")}>Rejeter</Button></div> : <Button disabled={promote.isPending || !nomenclatureId || !candidate.source_page_id} onClick={() => promote.mutate()}>Ajouter à l'édition brouillon</Button>}<p className="text-xs text-muted-foreground">La validation de l’extraction ne publie pas la nomenclature. L’édition et sa date d’effet doivent être vérifiées séparément.</p></> : <p className="text-sm text-muted-foreground">Sélectionnez une proposition.</p>}</CardContent></Card></div>
  </div>;
}
