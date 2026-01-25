import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function HeroSection() {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/chat?q=${encodeURIComponent(query)}`);
    }
  };

  return (
    <section className="relative overflow-hidden hero-gradient py-20 md:py-32">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-1/2 -left-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <div className="container mx-auto px-4 relative">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent/20 text-accent mb-6 animate-fade-in">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">Assistant IA nouvelle génération</span>
          </div>

          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-primary-foreground mb-6 animate-slide-up">
            Votre assistant douanier{" "}
            <span className="text-accent">intelligent</span>
          </h1>

          <p className="text-lg md:text-xl text-primary-foreground/80 mb-10 animate-slide-up" style={{ animationDelay: "0.1s" }}>
            Classifiez vos produits, calculez vos droits de douane, obtenez des réponses instantanées
          </p>

          <form onSubmit={handleSearch} className="animate-slide-up" style={{ animationDelay: "0.2s" }}>
            <div className="relative max-w-2xl mx-auto">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Posez votre question ou recherchez un code SH..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full h-14 pl-12 pr-36 text-base bg-card border-0 shadow-lg focus-visible:ring-accent"
              />
              <Button
                type="submit"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-10 px-6 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold shadow-gold"
              >
                Rechercher
              </Button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
