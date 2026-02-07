import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/Logo";
import {
  ArrowRight,
  Shield,
  MessageSquare,
  Search,
  FileText,
  Zap,
  Globe,
} from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen page-gradient">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass">
        <nav className="container mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Logo />
          <Link to="/login">
            <Button className="cta-gradient rounded-xl px-6 h-10">
              Se connecter
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 md:pt-40 md:pb-28 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 chip chip-primary mb-6 animate-fade-in">
            <Shield className="h-3.5 w-3.5" />
            <span>Accès sur invitation uniquement</span>
          </div>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight mb-6 animate-slide-up">
            Votre assistant
            <br />
            <span className="gradient-text">douanier intelligent</span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed animate-fade-in">
            Codes SH, tarifs douaniers, réglementations — obtenez des réponses
            précises et sourcées en quelques secondes grâce à l'IA.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-slide-up">
            <Link to="/login">
              <Button
                size="lg"
                className="cta-gradient rounded-xl px-8 h-14 text-lg font-semibold"
              >
                <MessageSquare className="mr-2 h-5 w-5" />
                Accéder au chat
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-5xl">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-4">
            Tout ce dont vous avez besoin
          </h2>
          <p className="text-muted-foreground text-center mb-12 max-w-xl mx-auto">
            Un outil complet pour simplifier vos opérations douanières
          </p>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: Search,
                title: "Recherche HS intelligente",
                desc: "Trouvez le code SH exact grâce à la recherche sémantique alimentée par l'IA.",
              },
              {
                icon: FileText,
                title: "Analyse de documents",
                desc: "Uploadez vos DUM, factures ou circulaires pour une analyse instantanée.",
              },
              {
                icon: Globe,
                title: "Réglementation à jour",
                desc: "Base de données mise à jour avec les dernières circulaires et tarifs en vigueur.",
              },
              {
                icon: Zap,
                title: "Réponses instantanées",
                desc: "Obtenez des réponses en temps réel avec des sources citées et vérifiables.",
              },
              {
                icon: Shield,
                title: "Données sécurisées",
                desc: "Vos données et conversations sont protégées et confidentielles.",
              },
              {
                icon: MessageSquare,
                title: "Chat contextuel",
                desc: "L'assistant comprend le contexte de vos questions pour des réponses pertinentes.",
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="card-elevated p-6 flex flex-col items-start gap-4"
              >
                <div className="h-11 w-11 rounded-xl cta-gradient flex items-center justify-center">
                  <feature.icon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-card-foreground mb-1.5">
                    {feature.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feature.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4">
        <div className="container mx-auto max-w-2xl text-center">
          <div className="card-elevated p-10 md:p-14 relative overflow-hidden">
            <div className="absolute inset-0 opacity-5 hero-gradient" />
            <div className="relative z-10">
              <h2 className="text-2xl md:text-3xl font-bold mb-4">
                Prêt à commencer ?
              </h2>
              <p className="text-muted-foreground mb-8">
                Connectez-vous avec votre numéro de téléphone pour accéder à
                l'assistant douanier.
              </p>
              <Link to="/login">
                <Button
                  size="lg"
                  className="cta-gradient rounded-xl px-8 h-12 text-base font-semibold"
                >
                  Se connecter
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 px-4">
        <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <Logo />
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} DouaneAI. Tous droits réservés.
          </p>
        </div>
      </footer>
    </div>
  );
}
