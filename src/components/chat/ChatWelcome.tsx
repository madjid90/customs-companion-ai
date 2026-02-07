import { useState, useEffect } from "react";
import { Bot, Sparkles, FileImage, Search, Scale, Package, FileCheck, Globe, Truck, ShieldAlert, Calculator, BookOpen, ArrowRight } from "lucide-react";

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
      {/* Robot icon with gradient */}
      <div className="relative mb-8">
        <div
          className="absolute inset-0 w-24 h-24 md:w-28 md:h-28 rounded-3xl blur-2xl opacity-20 -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2"
          style={{ background: "var(--gradient-hero)" }}
        />
        <div className="relative w-20 h-20 md:w-24 md:h-24 flex items-center justify-center animate-float">
          <Bot className="h-12 w-12 md:h-14 md:w-14 text-primary" strokeWidth={1.5} />
        </div>
      </div>

      {/* Title block – Switchly-style bold typography */}
      <h2 className="text-2xl md:text-4xl font-extrabold text-foreground mb-2 tracking-tight text-center leading-tight">
        Votre assistant{" "}
        <span className="text-gradient-blue">douanier</span>
      </h2>
      <p className="text-sm md:text-base text-muted-foreground mb-10 text-center max-w-lg leading-relaxed">
        Classification SH, tarifs, réglementations — obtenez des réponses précises et sourcées.
      </p>

      {/* Suggestion cards – Switchly rounded style */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-xl">
        {suggestedQuestions.map((item, i) => (
          <button
            key={`${item.question}-${i}`}
            className="group flex items-start gap-3 text-left p-4 rounded-2xl bg-card border border-border/30 hover:border-primary/30 hover:shadow-md transition-all duration-300 hover:-translate-y-0.5"
            onClick={() => onQuestionClick(item.question)}
          >
            <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-primary/8 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
              <item.icon className="h-4 w-4 text-primary" />
            </div>
            <span className="text-[13px] leading-snug text-muted-foreground group-hover:text-foreground transition-colors line-clamp-2 pt-1">
              {item.question}
            </span>
          </button>
        ))}
      </div>

      {/* Refresh link */}
      <button
        onClick={refreshQuestions}
        className="mt-6 text-xs text-muted-foreground/50 hover:text-primary transition-colors flex items-center gap-1.5 group"
      >
        <Sparkles className="h-3 w-3 group-hover:rotate-12 transition-transform" />
        Autres suggestions
      </button>
    </div>
  );
}
