import { Tag, Package, Home, ClipboardCheck, Factory, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DetectedIntent } from "@/hooks/useIntentDetection";

interface Props {
  intent: DetectedIntent;
  onLaunch: () => void;
  onDismiss: () => void;
}

const MODE_META = {
  import: { icon: Package, label: "Import", color: "text-primary border-primary/30 bg-primary/5" },
  mre: { icon: Home, label: "MRE", color: "text-secondary border-secondary/30 bg-secondary/5" },
  conformity: { icon: ClipboardCheck, label: "Conformité", color: "text-warning border-warning/30 bg-warning/5" },
  investor: { icon: Factory, label: "Investissement", color: "text-accent-foreground border-accent bg-accent" },
} as const;

/**
 * Petite carte affichée dans la bulle assistant quand un intent fort
 * est détecté. Propose un CTA "Lancer le module" qui ouvre l'overlay
 * inline (Classification ou Consultation).
 */
export function IntentInlineCard({ intent, onLaunch, onDismiss }: Props) {
  if (intent.kind === "chat") return null;

  if (intent.kind === "classify") {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary/15 flex items-center justify-center flex-shrink-0">
            <Tag className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Classification guidée disponible</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              J'ai détecté une demande de classement de produit. Le mode QCM
              vous guidera en quelques questions vers le code SH le plus précis.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={onLaunch} className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Lancer le QCM
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Répondre en texte
          </Button>
        </div>
      </div>
    );
  }

  // consultation
  const meta = MODE_META[intent.mode];
  const Icon = meta.icon;
  return (
    <div className={cn("rounded-xl border p-4 space-y-3", meta.color)}>
      <div className="flex items-start gap-3">
        <div className="h-8 w-8 rounded-lg bg-background/60 flex items-center justify-center flex-shrink-0">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            Consultation {meta.label} disponible
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Je peux générer un rapport complet (taxes, documents requis,
            réglementation) en quelques étapes guidées.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={onLaunch} className="gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          Ouvrir le formulaire
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Répondre en texte
        </Button>
      </div>
    </div>
  );
}
