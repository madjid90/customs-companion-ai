import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, ExternalLink } from "lucide-react";
import { toast } from "sonner";

type SourceDocument = { id: string; title: string; document_type: string; lifecycle_status: string; storage_bucket: string; storage_path: string; source_url: string | null; metadata: unknown };

function documentHeading(document: SourceDocument) {
  const metadata = document.metadata as { auto_profile?: { heading?: string; family?: string } } | null;
  return metadata?.auto_profile?.heading || document.title;
}

export default function LegalExplorer() {
  const [query, setQuery] = useState("");
  const search = query.trim();
  const { data: pages = [], isFetching, error } = useQuery({
    queryKey: ["legal-corpus-search", search],
    enabled: search.length >= 3,
    queryFn: async () => {
      const { data, error } = await supabase.from("source_pages")
        .select("id,page_number,text_content,review_status,source_documents!inner(id,title,document_type,lifecycle_status,storage_bucket,storage_path,source_url,metadata)")
        .ilike("text_content", `%${search.replace(/[%_]/g, "")}%`)
        .neq("review_status", "rejected")
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: instruments = [] } = useQuery({
    queryKey: ["published-legal-instruments", search],
    queryFn: async () => {
      let request = supabase.from("legal_instruments").select("id,canonical_title,official_reference,instrument_type,status").limit(30);
      if (search) request = request.ilike("canonical_title", `%${search.replace(/[%_]/g, "")}%`);
      const { data, error } = await request;
      if (error) throw error;
      return data ?? [];
    },
  });

  async function openSource(document: SourceDocument, pageNumber: number) {
    if (document.source_url) {
      window.open(`${document.source_url}#page=${pageNumber}`, "_blank", "noopener,noreferrer");
      return;
    }
    const { data, error } = await supabase.storage.from(document.storage_bucket).createSignedUrl(document.storage_path, 300);
    if (error || !data?.signedUrl) { toast.error("PDF indisponible pour ce compte"); return; }
    window.open(`${data.signedUrl}#page=${pageNumber}`, "_blank", "noopener,noreferrer");
  }

  return <div className="container mx-auto max-w-6xl p-4 md:p-8 space-y-6">
    <div><p className="text-sm font-semibold text-primary">RECHERCHE JURIDIQUE</p><h1 className="text-3xl font-bold">Droit douanier marocain</h1><p className="text-muted-foreground">Retrouvez les passages des documents ingérés. Les extraits provisoires restent consultables pendant leur vérification.</p></div>
    <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input className="pl-10" value={query} onChange={event => setQuery(event.target.value)} placeholder="Circulaire, article, autorisation, marchandise…" /></div>
    <div className="flex flex-wrap gap-2"><Badge variant="secondary">{instruments.length} texte(s) structuré(s)</Badge>{search.length >= 3 && <Badge variant="outline">{pages.length} extrait(s) trouvés, maximum 30</Badge>}</div>
    {error && <p role="alert" className="text-sm text-destructive">Recherche momentanément indisponible : {String(error)}</p>}
    {search.length < 3 && <Card><CardContent className="py-8 text-muted-foreground">Saisissez au moins trois caractères pour rechercher dans les PDF.</CardContent></Card>}
    {search.length >= 3 && !isFetching && pages.length === 0 && <Card><CardContent className="py-8 text-muted-foreground">Aucun extrait correspondant. Essayez un autre terme ou une référence plus courte.</CardContent></Card>}
    <div className="space-y-3">{pages.map(page => {
      const document = page.source_documents as SourceDocument;
      const position = page.text_content.toLocaleLowerCase().indexOf(search.toLocaleLowerCase());
      const excerpt = page.text_content.slice(Math.max(0, position - 180), Math.max(0, position - 180) + 650);
      return <Card key={page.id}><CardHeader className="pb-2"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">{documentHeading(document)}</CardTitle><p className="text-sm text-muted-foreground">{document.title} · page {page.page_number} · {document.document_type}</p></div><Badge variant={document.lifecycle_status === "published" ? "default" : "outline"}>{document.lifecycle_status === "published" ? "Publié" : "Extrait provisoire"}</Badge></div></CardHeader><CardContent><p className="text-sm whitespace-pre-wrap line-clamp-6">{excerpt}</p><Button variant="link" className="px-0 mt-2" onClick={() => openSource(document, page.page_number)}>Voir le PDF source <ExternalLink className="ml-1 h-3 w-3"/></Button></CardContent></Card>;
    })}</div>
    {instruments.length > 0 && <section className="space-y-2"><h2 className="text-xl font-semibold">Textes structurés</h2>{instruments.map(instrument => <Card key={instrument.id}><CardContent className="py-4"><div className="font-medium">{instrument.canonical_title}</div><div className="text-sm text-muted-foreground">{instrument.official_reference} · {instrument.instrument_type} · {instrument.status}</div></CardContent></Card>)}</section>}
  </div>;
}
