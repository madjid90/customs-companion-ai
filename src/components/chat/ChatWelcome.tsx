import { useState, useEffect } from "react";
import { Sparkles, FileImage, Search, Scale, Package, FileCheck, Globe, Truck, ShieldAlert, Calculator, BookOpen, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { BotAvatar } from "./BotAvatar";

interface ChatWelcomeProps {
  onQuestionClick: (question: string) => void;
}

const allQuestions = [
  {
    icon: FileImage,
    question: "Quels documents sont requis pour importer des produits alimentaires ?",
  },
  {
    icon: Search,
    question: "Quelle est la procédure de dédouanement au Maroc ?",
  },
  {
    icon: Scale,
    question: "Quelles sont les règles d'origine pour bénéficier de l'accord UE-Maroc ?",
  },
  {
    icon: Sparkles,
    question: "Mon produit nécessite-t-il une licence d'importation ?",
  },
  {
    icon: Package,
    question: "Comment classifier un produit électronique dans le système harmonisé ?",
  },
  {
    icon: FileCheck,
    question: "Quels sont les droits de douane pour les textiles importés de Chine ?",
  },
  {
    icon: Globe,
    question: "Quels accords de libre-échange le Maroc a-t-il signés ?",
  },
  {
    icon: Truck,
    question: "Quelles sont les formalités pour l'exportation de produits agricoles ?",
  },
  {
    icon: ShieldAlert,
    question: "Mon produit est-il soumis à des contrôles sanitaires ?",
  },
  {
    icon: Calculator,
    question: "Comment calculer les droits et taxes à l'importation ?",
  },
  {
    icon: BookOpen,
    question: "Où trouver le code SH d'un produit cosmétique ?",
  },
  {
    icon: Scale,
    question: "Quelles sont les pénalités en cas de fausse déclaration douanière ?",
  },
];

const getRandomQuestions = (count: number) => {
  const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
};

export function ChatWelcome({ onQuestionClick }: ChatWelcomeProps) {
  const [suggestedQuestions, setSuggestedQuestions] = useState(() => getRandomQuestions(4));

  useEffect(() => {
    const interval = setInterval(() => {
      setSuggestedQuestions(getRandomQuestions(4));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const refreshQuestions = () => {
    setSuggestedQuestions(getRandomQuestions(4));
  };

  return (
    <div className="flex flex-col items-center justify-start md:justify-center min-h-0 h-full max-h-full px-3 md:px-6 pt-4 md:py-6 animate-fade-in overflow-hidden">
      {/* Robot icon */}
      <div className="relative mb-1 md:mb-5 flex-shrink-0">
        <div className="absolute inset-0 w-14 h-14 md:w-20 md:h-20 rounded-full bg-success/6 blur-2xl -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2" />
        <div className="relative animate-float">
          <BotAvatar size="md" className="border-0 bg-transparent md:hidden" />
          <BotAvatar size="lg" className="border-0 bg-transparent hidden md:flex" />
        </div>
      </div>

      {/* Title block */}
      <h2 className="text-lg md:text-2xl font-extrabold text-foreground mb-1 tracking-tight text-center flex-shrink-0">
        Votre assistant douanier
      </h2>
      <p className="text-xs md:text-sm text-muted-foreground mb-3 md:mb-6 text-center max-w-md leading-relaxed flex-shrink-0">
        Classification SH, tarifs, réglementations — obtenez des réponses précises et sourcées.
      </p>

      {/* Suggestion cards */}
      <div className="w-full max-w-xl space-y-2 md:space-y-0 md:bg-card md:rounded-2xl md:border md:border-border md:shadow-md md:overflow-hidden flex-shrink-0">
        {suggestedQuestions.map((item, i) => (
          <button
            key={`${item.question}-${i}`}
            className={cn(
              "group flex items-center gap-3 md:gap-4 text-left w-full px-4 py-2.5 md:px-5 md:py-3.5 rounded-xl md:rounded-none bg-card md:bg-transparent border border-border/50 md:border-0 shadow-sm md:shadow-none hover:bg-muted/50 transition-all duration-200",
              i < suggestedQuestions.length - 1 && "md:border-b md:border-border"
            )}
            onClick={() => onQuestionClick(item.question)}
          >
            <div className="flex-shrink-0 w-9 h-9 md:w-10 md:h-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
              <item.icon className="h-4 w-4 md:h-[18px] md:w-[18px] text-primary" />
            </div>
            <span className="flex-1 text-xs md:text-sm leading-snug text-muted-foreground group-hover:text-foreground transition-colors">
              {item.question}
            </span>
            <ArrowRight className="h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0" />
          </button>
        ))}
      </div>

      {/* Refresh link */}
      <button
        onClick={refreshQuestions}
        className="mt-3 md:mt-4 text-xs text-muted-foreground/60 hover:text-primary transition-colors flex items-center gap-1.5 flex-shrink-0"
      >
        <Sparkles className="h-3 w-3" />
        Autres suggestions
      </button>
    </div>
  );
}
