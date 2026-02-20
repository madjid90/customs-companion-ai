import { Package, Home, ClipboardCheck, Factory } from "lucide-react";
import { cn } from "@/lib/utils";

export type ConsultationMode = "import" | "mre" | "conformity" | "investor";

interface ModeOption {
  id: ConsultationMode;
  icon: React.ElementType;
  title: string;
  subtitle: string;
}

const modes: ModeOption[] = [
  { id: "import", icon: Package, title: "Import Standard", subtitle: "Classification, droits & taxes, documents" },
  { id: "mre", icon: Home, title: "MRE — Retour", subtitle: "Véhicule, effets personnels, franchise" },
  { id: "conformity", icon: ClipboardCheck, title: "Conformités", subtitle: "ONSSA, ANRT, CoC, DMP, ONICL" },
  { id: "investor", icon: Factory, title: "Investissement", subtitle: "Régimes avantageux, zones franches" },
];

interface Props {
  selected: ConsultationMode;
  onSelect: (mode: ConsultationMode) => void;
}

const modeColors: Record<ConsultationMode, { active: string; hover: string; icon: string }> = {
  import: { active: "border-primary bg-primary/5", hover: "hover:border-primary/40", icon: "text-primary" },
  mre: { active: "border-secondary bg-secondary/5", hover: "hover:border-secondary/40", icon: "text-secondary" },
  conformity: { active: "border-warning bg-warning/5", hover: "hover:border-warning/40", icon: "text-warning" },
  investor: { active: "border-accent-foreground bg-accent", hover: "hover:border-accent-foreground/40", icon: "text-accent-foreground" },
};

export function ConsultationModeSelector({ selected, onSelect }: Props) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Type de consultation</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const isActive = selected === mode.id;
          const colors = modeColors[mode.id];
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => onSelect(mode.id)}
              className={cn(
                "relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 cursor-pointer text-center",
                isActive ? colors.active : `border-border bg-card ${colors.hover}`
              )}
            >
              <Icon className={cn("h-7 w-7", isActive ? colors.icon : "text-muted-foreground")} />
              <span className="text-sm font-semibold text-foreground">{mode.title}</span>
              <span className="text-xs text-muted-foreground leading-tight">{mode.subtitle}</span>
              {isActive && (
                <div className={cn("absolute -top-1 -right-1 w-3 h-3 rounded-full", {
                  "bg-primary": mode.id === "import",
                  "bg-secondary": mode.id === "mre",
                  "bg-warning": mode.id === "conformity",
                  "bg-accent-foreground": mode.id === "investor",
                })} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
