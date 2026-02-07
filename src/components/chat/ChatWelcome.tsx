import { useState, useEffect } from "react";
import { ShieldCheck, Sparkles, FileImage, Search, Scale, Package, FileCheck, Globe, Truck, ShieldAlert, Calculator, BookOpen, ArrowRight, Users, Zap, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

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

const stats = [
  { icon: Users, value: "10K+", label: "Questions traitées" },
  { icon: Zap, value: "< 3s", label: "Temps de réponse" },
  { icon: CheckCircle2, value: "97%", label: "Satisfaction" },
];

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
    <div className="text-center py-6 md:py-10 animate-fade-in px-3 md:px-4 flex flex-col justify-center min-h-[calc(100dvh-180px)]">
      {/* Logo Icon with glow */}
      <div className="relative inline-flex items-center justify-center mb-4 md:mb-6">
        <div className="absolute inset-0 w-20 h-20 md:w-28 md:h-28 rounded-full bg-primary/10 blur-2xl animate-pulse-slow"></div>
        <div className="relative w-16 h-16 md:w-20 md:h-20 rounded-2xl blue-gradient flex items-center justify-center shadow-accent">
          <ShieldCheck className="h-8 w-8 md:h-10 md:w-10 text-white" strokeWidth={2} />
        </div>
      </div>
      
      {/* Title */}
      <h2 className="text-2xl md:text-4xl font-display font-extrabold text-foreground mb-1 md:mb-2 tracking-tight">
        Votre assistant douanier
      </h2>
      <p className="text-xl md:text-2xl font-display font-bold text-gradient-blue mb-3 md:mb-4">
        Comment puis-je vous aider ?
      </p>
      <p className="text-muted-foreground max-w-lg mx-auto mb-5 md:mb-8 text-sm md:text-base leading-relaxed px-2">
        Classification SH, tarifs, réglementations — obtenez des réponses précises 
        et sourcées en quelques secondes.
      </p>

      {/* Stats chips – Prodify style */}
      <div className="flex items-center justify-center gap-3 md:gap-4 mb-6 md:mb-8">
        {stats.map((stat, i) => (
          <div key={i} className="chip chip-primary">
            <stat.icon className="h-3.5 w-3.5" />
            <span className="font-semibold">{stat.value}</span>
            <span className="hidden sm:inline text-muted-foreground">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* Suggested questions – floating card style */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 md:gap-3 max-w-2xl mx-auto">
        {suggestedQuestions.map((item, i) => (
          <button
            key={`${item.question}-${i}`}
            className="group card-elevated text-left py-3.5 md:py-4 px-4 md:px-5 flex items-start gap-3 transition-all duration-300 hover:border-primary/20 border border-border/30"
            onClick={() => onQuestionClick(item.question)}
          >
            <div className="flex-shrink-0 w-8 h-8 md:w-9 md:h-9 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 group-hover:scale-105 transition-all duration-300">
              <item.icon className="h-4 w-4 md:h-[18px] md:w-[18px] text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-xs md:text-sm text-foreground/80 group-hover:text-foreground transition-colors leading-relaxed line-clamp-2">
                {item.question}
              </span>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-300 flex-shrink-0 mt-0.5" />
          </button>
        ))}
      </div>

      {/* Refresh */}
      <button
        onClick={refreshQuestions}
        className="mt-5 text-xs text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-1.5 mx-auto group"
      >
        <Sparkles className="h-3 w-3 group-hover:rotate-12 transition-transform" />
        Autres suggestions
      </button>
    </div>
  );
}