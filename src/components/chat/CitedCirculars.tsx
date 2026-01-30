import { FileText, Download, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CircularReference {
  id: string;
  reference_type: string;
  reference_number: string;
  title?: string;
  reference_date?: string;
  download_url?: string;
  pdf_title?: string;
}

interface CitedCircularsProps {
  circulars: CircularReference[];
  onDocumentClick: (url: string, title: string) => void;
  isSearchingDoc?: boolean;
}

export function CitedCirculars({ circulars, onDocumentClick, isSearchingDoc }: CitedCircularsProps) {
  if (!circulars || circulars.length === 0) return null;

  // Deduplicate by reference_number
  const uniqueCirculars = circulars.reduce((acc, curr) => {
    const key = curr.reference_number || curr.id;
    if (!acc.find(c => (c.reference_number || c.id) === key)) {
      acc.push(curr);
    }
    return acc;
  }, [] as CircularReference[]);

  if (uniqueCirculars.length === 0) return null;

  return (
    <div className="mt-4 pt-3 border-t border-border/30">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
          Sources réglementaires citées
        </span>
      </div>
      <div className="space-y-2">
        {uniqueCirculars.slice(0, 5).map((circular, index) => (
          <div
            key={`${circular.id}-${index}`}
            className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors group"
          >
            <div className="flex-shrink-0 w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium bg-accent/15 text-accent px-1.5 py-0.5 rounded">
                  {circular.reference_type || "Circulaire"}
                </span>
                <span className="text-sm font-semibold text-foreground">
                  {circular.reference_number}
                </span>
                {circular.reference_date && (
                  <span className="text-xs text-muted-foreground">
                    ({new Date(circular.reference_date).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "short",
                      year: "numeric"
                    })})
                  </span>
                )}
              </div>
              {circular.title && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                  {circular.title}
                </p>
              )}
            </div>
            {circular.download_url && (
              <button
                onClick={() => onDocumentClick(circular.download_url!, circular.title || circular.reference_number)}
                disabled={isSearchingDoc}
                className={cn(
                  "flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md",
                  "text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20",
                  "transition-colors cursor-pointer",
                  "opacity-0 group-hover:opacity-100 focus:opacity-100",
                  isSearchingDoc && "opacity-50 cursor-wait"
                )}
              >
                <ExternalLink className="h-3 w-3" />
                <span>Consulter</span>
              </button>
            )}
          </div>
        ))}
        {uniqueCirculars.length > 5 && (
          <p className="text-xs text-muted-foreground text-center py-1">
            + {uniqueCirculars.length - 5} autre(s) référence(s)
          </p>
        )}
      </div>
    </div>
  );
}
