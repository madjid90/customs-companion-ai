import { useState, useEffect } from "react";
import { Bot, Sparkles, FileImage, Search, Scale, Package, FileCheck, Globe, Truck, ShieldCheck, Calculator, BookOpen } from "lucide-react";
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
    icon: ShieldCheck,
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

// Shuffle and pick random questions
const getRandomQuestions = (count: number) => {
  const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
};

export function ChatWelcome({ onQuestionClick }: ChatWelcomeProps) {
  const [suggestedQuestions, setSuggestedQuestions] = useState(() => getRandomQuestions(4));

  // Refresh questions every 30 seconds while on screen
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
    <div className="text-center py-8 md:py-12 animate-fade-in px-4">
      {/* Logo/Icon */}
      <div className="relative inline-flex items-center justify-center mb-6">
        <div className="absolute inset-0 w-24 h-24 rounded-full bg-accent/10 blur-xl"></div>
        <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/5 flex items-center justify-center border border-accent/20 shadow-lg">
          <Bot className="h-10 w-10 text-accent" />
        </div>
      </div>
      
      {/* Title */}
      <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
        Assistant <span className="text-accent">DouaneAI</span>
      </h2>
      <p className="text-muted-foreground max-w-md mx-auto mb-8 text-sm md:text-base leading-relaxed">
        Posez votre question sur la classification douanière, les tarifs, 
        ou les réglementations commerciales marocaines.
      </p>

      {/* Suggested questions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
        {suggestedQuestions.map((item, i) => (
          <Button
            key={`${item.question}-${i}`}
            variant="outline"
            className="group relative text-left h-auto py-4 px-4 justify-start whitespace-normal border-border/50 hover:border-accent/50 hover:bg-accent/5 transition-all duration-300 rounded-xl shadow-sm hover:shadow-md"
            onClick={() => onQuestionClick(item.question)}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                <item.icon className="h-4 w-4 text-accent" />
              </div>
              <span className="text-sm text-foreground/80 group-hover:text-foreground transition-colors leading-relaxed">
                {item.question}
              </span>
            </div>
          </Button>
        ))}
      </div>

      {/* Refresh button */}
      <button
        onClick={refreshQuestions}
        className="mt-4 text-xs text-muted-foreground hover:text-accent transition-colors flex items-center justify-center gap-1.5 mx-auto"
      >
        <Sparkles className="h-3 w-3" />
        Autres suggestions
      </button>

    </div>
  );
}