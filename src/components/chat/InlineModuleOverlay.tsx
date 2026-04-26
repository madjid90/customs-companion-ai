import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClassificationView } from "@/components/chat/ClassificationView";
import { ConsultationWizard } from "@/components/consultation/ConsultationWizard";
import type { ConsultationMode } from "@/components/consultation/ConsultationModeSelector";
import { cn } from "@/lib/utils";

type ActiveModule =
  | { kind: "classify"; productHint: string }
  | { kind: "consultation"; mode: ConsultationMode };

interface Props {
  active: ActiveModule | null;
  onClose: () => void;
}

/**
 * Overlay plein-écran (sous l'AppHeader) qui héberge soit le QCM
 * Classification, soit le wizard Consultation. Réutilise les composants
 * existants sans modification.
 */
export function InlineModuleOverlay({ active, onClose }: Props) {
  if (!active) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 bg-background flex flex-col",
        "animate-fade-in"
      )}
      style={{ top: "var(--app-header-height, 56px)" }}
      role="dialog"
      aria-modal="true"
    >
      <header className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <h2 className="text-sm font-semibold">
          {active.kind === "classify"
            ? "Classification guidée"
            : "Consultation guidée"}
        </h2>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </header>
      <div className="flex-1 overflow-auto">
        {active.kind === "classify" ? (
          <ClassificationView />
        ) : (
          <ConsultationWizard initialMode={active.mode} onReset={onClose} />
        )}
      </div>
    </div>
  );
}
