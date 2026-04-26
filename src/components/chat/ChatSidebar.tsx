import { useState } from "react";
import { useChatSidebarStore } from "@/stores/chatSidebarStore";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BookmarkX, Download, ExternalLink, FileText, Loader2, Quote, Trash2, X } from "lucide-react";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { getAuthHeaders } from "@/lib/authHeaders";
import { useToast } from "@/hooks/use-toast";

interface ChatSidebarProps {
  onClose: () => void;
}

export function ChatSidebar({ onClose }: ChatSidebarProps) {
  const {
    activeTab,
    setActiveTab,
    citations,
    savedResponses,
    isLoadingSaved,
    removeCitation,
    clearCitations,
    removeSavedResponse,
  } = useChatSidebarStore();
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (savedResponses.length === 0) {
      toast({ title: "Rien à exporter", description: "Sauvegardez d'abord des réponses." });
      return;
    }
    setIsExporting(true);
    try {
      const headers = await getAuthHeaders(true);
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-saved-pdf`;
      const res = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const blob = new Blob([html], { type: "text/html" });
      const blobUrl = URL.createObjectURL(blob);
      const win = window.open(blobUrl, "_blank", "noopener,noreferrer");
      if (!win) {
        toast({
          title: "Ouverture bloquée",
          description: "Autorisez les pop-ups pour visualiser l'export.",
          variant: "destructive",
        });
      }
      // Revoke after a short delay so the new tab has time to load
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    } catch (e: any) {
      console.error("[ChatSidebar] export error", e);
      toast({
        title: "Échec de l'export",
        description: e?.message || "Veuillez réessayer.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-card border-l border-border/40">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 flex-shrink-0">
        <h2 className="text-sm font-semibold text-foreground">Volet contextuel</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-7 w-7"
          title="Fermer le volet"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "citations" | "saved")}
        className="flex-1 flex flex-col min-h-0"
      >
        <TabsList className="mx-3 mt-2 grid grid-cols-2">
          <TabsTrigger value="citations" className="gap-1.5 text-xs">
            <Quote className="h-3.5 w-3.5" />
            Citations
            {citations.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                {citations.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="saved" className="gap-1.5 text-xs">
            <FileText className="h-3.5 w-3.5" />
            Sauvegardées
            {savedResponses.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                {savedResponses.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Citations tab */}
        <TabsContent value="citations" className="flex-1 min-h-0 mt-2 mx-0">
          <div className="flex flex-col h-full">
            {citations.length > 0 && (
              <div className="flex justify-end px-3 pb-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearCitations}
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Tout effacer
                </Button>
              </div>
            )}
            <ScrollArea className="flex-1 px-3 pb-3">
              {citations.length === 0 ? (
                <EmptyState
                  icon={<Quote className="h-8 w-8" />}
                  title="Aucune citation"
                  description="Les références citées par DouaneAI dans ses réponses apparaîtront ici."
                />
              ) : (
                <div className="space-y-2">
                  {citations.map((c) => (
                    <CitationCard
                      key={c.id}
                      citation={c}
                      onRemove={() => removeCitation(c.id)}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </TabsContent>

        {/* Saved tab */}
        <TabsContent value="saved" className="flex-1 min-h-0 mt-2 mx-0">
          <div className="flex flex-col h-full">
            {savedResponses.length > 0 && (
              <div className="flex justify-end px-3 pb-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport}
                  disabled={isExporting}
                  className="h-7 text-xs"
                >
                  {isExporting ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3 mr-1" />
                  )}
                  Exporter PDF
                </Button>
              </div>
            )}
            <ScrollArea className="flex-1 px-3 pb-3">
              {isLoadingSaved && savedResponses.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : savedResponses.length === 0 ? (
                <EmptyState
                  icon={<FileText className="h-8 w-8" />}
                  title="Aucune réponse sauvegardée"
                  description="Cliquez sur l'icône de signet sous une réponse pour la sauvegarder ici."
                />
              ) : (
                <div className="space-y-2">
                  {savedResponses.map((r) => (
                    <SavedResponseCard
                      key={r.id}
                      response={r}
                      onRemove={() => removeSavedResponse(r.id)}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4 text-muted-foreground">
      <div className="opacity-40 mb-3">{icon}</div>
      <p className="text-sm font-medium mb-1 text-foreground">{title}</p>
      <p className="text-xs">{description}</p>
    </div>
  );
}

function CitationCard({
  citation,
  onRemove,
}: {
  citation: ReturnType<typeof useChatSidebarStore.getState>["citations"][number];
  onRemove: () => void;
}) {
  const label =
    citation.reference_number ||
    citation.title ||
    citation.pdf_title ||
    "Référence";
  const subtitle =
    citation.title && citation.title !== label ? citation.title : citation.pdf_title;

  return (
    <div className="group rounded-lg border border-border/40 bg-background/40 hover:bg-primary/5 hover:border-primary/30 transition-colors p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            {citation.reference_type && (
              <Badge variant="outline" className="h-4 px-1.5 text-[10px] uppercase">
                {citation.reference_type}
              </Badge>
            )}
            {citation.page_number && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                p. {citation.page_number}
              </Badge>
            )}
          </div>
          <p className="text-xs font-medium text-foreground truncate">{label}</p>
          {subtitle && (
            <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive flex-shrink-0"
          title="Retirer"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      {citation.download_url && (
        <a
          href={
            citation.page_number
              ? `${citation.download_url}#page=${citation.page_number}`
              : citation.download_url
          }
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "mt-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          )}
        >
          <ExternalLink className="h-3 w-3" />
          Ouvrir le PDF
        </a>
      )}
    </div>
  );
}

function SavedResponseCard({
  response,
  onRemove,
}: {
  response: ReturnType<typeof useChatSidebarStore.getState>["savedResponses"][number];
  onRemove: () => void;
}) {
  const date = new Date(response.savedAt);
  return (
    <div className="group rounded-lg border border-border/40 bg-background/40 hover:bg-primary/5 hover:border-primary/30 transition-colors p-2.5">
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-[11px] text-muted-foreground">
          {format(date, "d MMM yyyy, HH:mm", { locale: fr })}
        </p>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive flex-shrink-0"
          title="Retirer"
        >
          <BookmarkX className="h-3 w-3" />
        </Button>
      </div>
      <p className="text-xs font-medium text-foreground line-clamp-2 mb-1">
        {response.question}
      </p>
      <p className="text-[11px] text-muted-foreground line-clamp-3">
        {response.response.replace(/[#*`]/g, "").trim()}
      </p>
    </div>
  );
}
