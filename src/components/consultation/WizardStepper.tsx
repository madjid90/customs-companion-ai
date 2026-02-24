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
    <div className="flex items-center w-full">
      {steps.map((s, i) => {
        const state = i < currentStep ? "done" : i === currentStep ? "active" : "future";
        return (
          <div key={s.id} className={cn("flex items-center", i < steps.length - 1 && "flex-1")}>
            {/* Circle + label */}
            <div className="flex flex-col items-center">
              <button
                type="button"
                onClick={() => state === "done" && onStepClick(i)}
                className={cn(
                  "flex items-center justify-center rounded-full font-bold transition-all duration-300",
                  state === "active" && "w-11 h-11 bg-foreground text-background text-sm shadow-[0_0_0_5px_hsl(var(--foreground)/0.08)]",
                  state === "done" && "w-9 h-9 bg-primary text-primary-foreground text-xs cursor-pointer hover:scale-105",
                  state === "future" && "w-9 h-9 bg-muted text-muted-foreground text-xs cursor-default"
                )}
              >
                {state === "done" ? <Check className="h-4 w-4" /> : i + 1}
              </button>
              <span
                className={cn(
                  "mt-2 whitespace-nowrap text-[11px]",
                  state === "active" ? "font-bold text-foreground" : "font-medium text-muted-foreground"
                )}
              >
                {s.label}
              </span>
            </div>

            {/* Connector line */}
            {i < steps.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-[2px] mx-2 rounded-full transition-colors duration-300 self-start mt-[18px]",
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
