import { useEffect, useState, useCallback } from "react";
import { ExternalLink, FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface LegalCitationProps {
  documentId: string;
  pageNumber?: number;
  /** Display order: index used as small superscript label */
  index?: number;
  /** Called when the citation is clicked - opens preview dialog */
  onOpen?: (params: { url: string; title: string; pageNumber?: number; documentId: string }) => void;
  className?: string;
}

interface ResolvedDoc {
  url: string;
  title: string;
  fileName?: string;
}

const cache = new Map<string, ResolvedDoc | null>();

async function resolveDocument(documentId: string): Promise<ResolvedDoc | null> {
  if (cache.has(documentId)) return cache.get(documentId)!;

  const { data, error } = await supabase
    .from("pdf_documents")
    .select("file_path, file_name, title")
    .eq("id", documentId)
    .maybeSingle();

  if (error || !data) {
    cache.set(documentId, null);
    return null;
  }

  const { data: urlData } = supabase.storage
    .from("pdf-documents")
    .getPublicUrl(data.file_path as string);

  const resolved: ResolvedDoc = {
    url: urlData?.publicUrl || "",
    title: (data.title as string) || (data.file_name as string) || "Document",
    fileName: data.file_name as string | undefined,
  };
  cache.set(documentId, resolved);
  return resolved;
}

/**
 * Renders a clickable inline legal citation badge linked to a PDF page.
 * Resolves the document title lazily from `pdf_documents`.
 */
export function LegalCitation({
  documentId,
  pageNumber,
  index,
  onOpen,
  className,
}: LegalCitationProps) {
  const [doc, setDoc] = useState<ResolvedDoc | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    resolveDocument(documentId).then((resolved) => {
      if (!cancelled) setDoc(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!doc?.url) return;
      const anchored = pageNumber ? `${doc.url}#page=${pageNumber}` : doc.url;
      if (onOpen) {
        onOpen({ url: anchored, title: doc.title, pageNumber, documentId });
      } else {
        window.open(anchored, "_blank", "noopener,noreferrer");
      }
    },
    [doc, pageNumber, onOpen, documentId]
  );

  // Loading state
  if (doc === undefined) {
    return (
      <span className={cn("inline-flex items-center align-baseline", className)}>
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      </span>
    );
  }

  // Failed to resolve
  if (doc === null) {
    return (
      <sup
        className={cn(
          "inline-flex items-center text-[10px] text-muted-foreground/60 mx-0.5",
          className
        )}
        title={`Référence introuvable (${documentId.slice(0, 8)}…)`}
      >
        [?]
      </sup>
    );
  }

  const label = typeof index === "number" ? `[${index}]` : "[src]";
  const tooltip = pageNumber ? `${doc.title} — page ${pageNumber}` : doc.title;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleClick}
            className={cn(
              "inline-flex items-center align-baseline mx-0.5 px-1 py-0 rounded text-[10px] font-semibold",
              "bg-primary/10 text-primary hover:bg-primary/20 hover:underline transition-colors",
              "cursor-pointer no-underline",
              className
            )}
          >
            <FileText className="h-2.5 w-2.5 mr-0.5" />
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-medium">{tooltip}</span>
            <ExternalLink className="h-3 w-3 opacity-60" />
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
