import { useState, useEffect } from "react";
import { Bot, Sparkles, FileImage, Search, Scale, Package, FileCheck, Globe, Truck, ShieldAlert, Calculator, BookOpen, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

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
    <div className="flex flex-col items-center justify-center min-h-[calc(100dvh-200px)] px-4 py-8 animate-fade-in">
      {/* Robot icon */}
      <div className="relative mb-6">
        <div className="absolute inset-0 w-20 h-20 md:w-24 md:h-24 rounded-full bg-primary/6 blur-2xl -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2" />
        <div className="relative w-20 h-20 md:w-24 md:h-24 flex items-center justify-center animate-float">
          <Bot className="h-12 w-12 md:h-14 md:w-14 text-primary" strokeWidth={1.5} />
        </div>
      </div>

      {/* Title block */}
      <h2 className="text-xl md:text-2xl font-extrabold text-foreground mb-1 tracking-tight text-center">
        Votre assistant douanier
      </h2>
      <p className="text-sm md:text-base text-muted-foreground mb-8 text-center max-w-md leading-relaxed">
        Classification SH, tarifs, réglementations — obtenez des réponses précises et sourcées.
      </p>

      {/* Suggestion cards – Switchly-style with arrow */}
      <div className="w-full max-w-xl bg-card rounded-2xl border border-border shadow-md overflow-hidden">
        {suggestedQuestions.map((item, i) => (
          <button
            key={`${item.question}-${i}`}
            className={cn(
              "group flex items-center gap-4 text-left w-full px-5 py-4 hover:bg-muted/50 transition-all duration-200",
              i < suggestedQuestions.length - 1 && "border-b border-border"
            )}
            onClick={() => onQuestionClick(item.question)}
          >
            <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
              <item.icon className="h-[18px] w-[18px] text-primary" />
            </div>
            <span className="flex-1 text-sm leading-snug text-muted-foreground group-hover:text-foreground transition-colors">
              {item.question}
            </span>
            <ArrowRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0" />
          </button>
        ))}
      </div>

      {/* Refresh link */}
      <button
        onClick={refreshQuestions}
        className="mt-5 text-xs text-muted-foreground/60 hover:text-primary transition-colors flex items-center gap-1.5"
      >
        <Sparkles className="h-3 w-3" />
        Autres suggestions
      </button>
    </div>
  );
}
