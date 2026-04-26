import { X, FileText, Tag, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ConsultationReport } from "@/components/consultation/ConsultationReport";

export type SidePanelResult =
  | {
      kind: "classification";
      query: string;
      hsCode: string;
      description: string;
      confidence: "high" | "medium" | "low";
      dutyRate?: number;
      reasoning?: string;
    }
  | {
      kind: "consultation";
      mode: "import" | "mre" | "conformity" | "investor";
      report: any;
    };

interface Props {
  result: SidePanelResult | null;
  onClose: () => void;
}

/**
 * Panneau latéral droit qui s'ouvre uniquement quand un résultat
 * (classification ou consultation) est prêt. Reste pleine largeur
 * pour le chat le reste du temps.
 */
export function ResultSidePanel({ result, onClose }: Props) {
  if (!result) return null;

  return (
    <aside
      className={cn(
        "fixed inset-y-0 right-0 z-40 w-full md:w-[480px] lg:w-[560px]",
        "bg-card border-l border-border shadow-2xl",
        "flex flex-col animate-slide-in-right"
      )}
      style={{ top: "var(--app-header-height, 56px)" }}
      aria-label="Résultat"
    >
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          {result.kind === "classification" ? (
            <Tag className="h-4 w-4 text-primary flex-shrink-0" />
          ) : (
            <FileText className="h-4 w-4 text-primary flex-shrink-0" />
          )}
          <h2 className="text-sm font-semibold truncate">
            {result.kind === "classification"
              ? "Code SH retenu"
              : `Rapport ${result.mode}`}
          </h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {result.kind === "classification" ? (
            <ClassificationResultBody result={result} />
          ) : (
            <ConsultationReport data={result.report} type={result.mode} />
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}

function ClassificationResultBody({
  result,
}: {
  result: Extract<SidePanelResult, { kind: "classification" }>;
}) {
  const confColor =
    result.confidence === "high"
      ? "bg-success/15 text-success"
      : result.confidence === "medium"
      ? "bg-warning/15 text-warning"
      : "bg-destructive/15 text-destructive";

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
          Requête
        </p>
        <p className="text-sm">{result.query}</p>
      </div>

      <div className="rounded-lg border bg-background p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <code className="text-2xl font-mono font-bold text-primary">
            {result.hsCode}
          </code>
          <Badge className={confColor}>{result.confidence}</Badge>
        </div>
        <p className="text-sm text-foreground">{result.description}</p>
        {typeof result.dutyRate === "number" && (
          <p className="text-xs text-muted-foreground">
            Droit d'importation : <strong>{result.dutyRate}%</strong>
          </p>
        )}
      </div>

      {result.reasoning && (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Justification
          </p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {result.reasoning}
          </p>
        </div>
      )}
    </div>
  );
}
