import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WizardStep {
  id: string;
  label: string;
  required?: boolean;
  smart?: boolean;
}

interface Props {
  steps: WizardStep[];
  currentStep: number;
  onStepClick: (index: number) => void;
}

export function WizardStepper({ steps, currentStep, onStepClick }: Props) {
  return (
    <div className="flex items-center gap-0 px-2">
      {steps.map((s, i) => {
        const state = i < currentStep ? "done" : i === currentStep ? "active" : "future";
        return (
          <div key={s.id} className={cn("flex items-center", i < steps.length - 1 && "flex-1")}>
            <div className="relative">
              <button
                type="button"
                onClick={() => state === "done" && onStepClick(i)}
                className={cn(
                  "flex items-center justify-center rounded-full text-xs font-semibold transition-all duration-300",
                  state === "active" && "w-8 h-8 bg-foreground text-background shadow-[0_0_0_4px_hsl(var(--foreground)/0.12)]",
                  state === "done" && "w-6 h-6 bg-primary text-primary-foreground cursor-pointer",
                  state === "future" && "w-6 h-6 bg-border text-muted-foreground cursor-default"
                )}
              >
                {state === "done" ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </button>
              <span
                className={cn(
                  "absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px]",
                  state === "active" ? "font-semibold text-foreground" : "font-normal text-muted-foreground"
                )}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-0.5 mx-1 transition-colors duration-300",
                  i < currentStep ? "bg-primary" : "bg-border"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
