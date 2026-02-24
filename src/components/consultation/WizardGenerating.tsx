import { Check, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import type { ConsultationMode } from "./ConsultationModeSelector";

interface Props {
  mode: ConsultationMode;
  isDone: boolean;
  onViewReport: () => void;
  onNewConsultation: () => void;
}

const GEN_LABELS: Record<ConsultationMode, string[]> = {
  import: [
    "Recherche dans la base de données douanière...",
    "Classification du produit (code SH)...",
    "Calcul des droits et taxes...",
    "Génération du rapport complet...",
  ],
  mre: [
    "Recherche dans la base de données douanière...",
    "Vérification des règles MRE...",
    "Calcul des droits et taxes...",
    "Génération du rapport complet...",
  ],
  conformity: [
    "Recherche dans la base de données douanière...",
    "Vérification des autorités...",
    "Calcul des droits et taxes...",
    "Génération du rapport complet...",
  ],
  investor: [
    "Recherche dans la base de données douanière...",
    "Comparaison des régimes...",
    "Calcul des droits et taxes...",
    "Génération du rapport complet...",
  ],
};

export function WizardGenerating({ mode, isDone, onViewReport, onNewConsultation }: Props) {
  const [visibleStep, setVisibleStep] = useState(0);
  const labels = GEN_LABELS[mode];

  useEffect(() => {
    if (isDone) {
      setVisibleStep(labels.length);
      return;
    }
    const timers = [
      setTimeout(() => setVisibleStep(1), 800),
      setTimeout(() => setVisibleStep(2), 2200),
      setTimeout(() => setVisibleStep(3), 3800),
    ];
    return () => timers.forEach(clearTimeout);
  }, [isDone, labels.length]);

  return (
    <div className="max-w-lg mx-auto card-elevated p-8 md:p-10 text-center mt-12 animate-fade-in relative overflow-hidden">
      <div className="absolute inset-0 opacity-[0.03] hero-gradient" />
      {!isDone ? (
        <>
          <div className="flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
          <p className="text-lg font-bold text-foreground mt-5 mb-1">Génération en cours</p>
          <p className="text-sm text-muted-foreground">L'IA analyse votre demande et consulte les bases réglementaires</p>
        </>
      ) : (
        <>
          <div className="flex justify-center text-success">
            <Check className="h-6 w-6" />
          </div>
          <p className="text-lg font-bold text-foreground mt-5 mb-1">Rapport prêt !</p>
          <p className="text-sm text-muted-foreground">Votre consultation a été générée avec succès</p>
        </>
      )}

      <div className="mt-6 text-left max-w-xs mx-auto space-y-2">
        {labels.map((label, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2.5 py-1.5 text-sm transition-colors",
              visibleStep > i ? "text-success font-medium" : "text-muted-foreground"
            )}
          >
            {visibleStep > i ? (
              <Check className="h-4 w-4 text-success shrink-0" />
            ) : (
              <span className={cn("w-4 h-4 rounded-full shrink-0 inline-block", visibleStep === i ? "bg-foreground" : "bg-border")} />
            )}
            {label}
          </div>
        ))}
      </div>

      {isDone && (
        <div className="mt-7 flex gap-3 justify-center">
          <Button onClick={onViewReport} className="cta-gradient rounded-xl px-6">Voir le rapport</Button>
          <Button variant="outline" onClick={onNewConsultation} className="rounded-xl">Nouvelle consultation</Button>
        </div>
      )}
    </div>
  );
}
