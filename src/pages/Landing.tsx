import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/Logo";
import { CookieConsent } from "@/components/ui/CookieConsent";
import {
  ArrowRight,
  Shield,
  MessageSquare,
  Search,
  FileText,
  Zap,
  Globe,
  CheckCircle2,
  Monitor,
  Lock,
  HelpCircle,
  UserPlus,
  Users,
  Send,
  Headphones,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/* ─── Data ─────────────────────────────────────────────── */
const steps = [
  { icon: UserPlus, title: "Inscription en 30 sec", desc: "Téléphone + nom de société. Gratuit." },
  { icon: Users, title: "Validation Admin", desc: "L'administrateur valide votre demande." },
  { icon: Send, title: "Accédez au Chat", desc: "Posez vos questions, obtenez des réponses sourcées." },
  { icon: Headphones, title: "Support continu", desc: "Assistance et mises à jour réglementaires." },
];

const features = [
  { icon: MessageSquare, title: "100% digital par Chat", desc: "Par chat, zéro appel téléphonique." },
  { icon: Zap, title: "Réponses en < 3s", desc: "Temps de réponse moyen constaté." },
  { icon: Shield, title: "Sources vérifiables", desc: "Chaque réponse citée avec sa source légale." },
  { icon: Globe, title: "Réglementation à jour", desc: "Base de données mise à jour en continu." },
];

const featureDetails = [
  { icon: Search, title: "Recherche HS intelligente", desc: "Trouvez le code SH exact grâce à la recherche sémantique alimentée par l'IA." },
  { icon: FileText, title: "Analyse de documents", desc: "Uploadez vos DUM, factures ou circulaires pour une analyse instantanée." },
  { icon: Globe, title: "Réglementation à jour", desc: "Base de données mise à jour avec les dernières circulaires et tarifs en vigueur." },
  { icon: Zap, title: "Réponses instantanées", desc: "Obtenez des réponses en temps réel avec des sources citées et vérifiables." },
  { icon: Shield, title: "Données sécurisées", desc: "Vos données et conversations sont protégées et confidentielles." },
  { icon: MessageSquare, title: "Chat contextuel", desc: "L'assistant comprend le contexte de vos questions pour des réponses pertinentes." },
];

const faqs = [
  { q: "Comment fonctionne l'assistant douanier IA ?", a: "Notre assistant utilise l'intelligence artificielle pour analyser votre question, rechercher dans notre base de données de réglementations douanières, et vous fournir une réponse précise avec les sources légales citées." },
  { q: "L'inscription est-elle vraiment gratuite ?", a: "Oui, l'inscription et l'accès à l'assistant sont entièrement gratuits. Vous n'avez besoin que de votre numéro de téléphone et du nom de votre société." },
  { q: "Quels types de questions puis-je poser ?", a: "Vous pouvez poser des questions sur les codes SH, les tarifs douaniers, les règles d'origine, les procédures d'import/export, les circulaires et toute réglementation douanière." },
  { q: "Comment sont vérifiées les réponses ?", a: "Chaque réponse est accompagnée de ses sources légales (circulaires, articles de loi, tarifs officiels). Vous pouvez vérifier chaque information." },
  { q: "Puis-je utiliser l'assistant sur mobile ?", a: "Oui, l'assistant est 100% responsive et fonctionne parfaitement sur téléphone, tablette et ordinateur." },
];

export default function Landing() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen page-gradient">
      {/* ─── Header ──────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border/40">
        <nav className="container mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden sm:inline-flex">
              Connexion
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="sm:hidden"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </nav>
      </header>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] bg-background flex flex-col p-6 sm:hidden animate-fade-in">
          <div className="flex items-center justify-between mb-10">
            <Logo />
            <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="space-y-6 text-lg font-medium">
            <Link to="/" className="block" onClick={() => setMobileMenuOpen(false)}>Accueil</Link>
            <Link to="/login" className="block" onClick={() => setMobileMenuOpen(false)}>Connexion</Link>
          </div>
          <div className="mt-auto pt-8">
            <Link to="/demander-acces" onClick={() => setMobileMenuOpen(false)}>
              <Button className="w-full cta-gradient rounded-2xl h-14 text-base font-semibold gap-2">
                Demander mes accès
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* ─── Hero Section ────────────────────────────── */}
      <section className="pt-28 md:pt-40 pb-16 md:pb-28 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          {/* Live badge */}
          <div className="inline-flex items-center gap-2.5 mb-8 bg-card rounded-full px-5 py-2.5 border border-border/30 shadow-sm animate-fade-in">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-secondary" />
            </span>
            <span className="text-sm font-semibold text-foreground">en direct</span>
            <span className="text-sm text-muted-foreground">Sur invitation uniquement</span>
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-[3.5rem] font-extrabold tracking-tight leading-[1.1] mb-6 md:mb-8 animate-slide-up">
            Votre assistant{" "}
            <span className="gradient-text">douanier intelligent</span>{" "}
            propulsé par l'IA
          </h1>

          <p className="text-base md:text-lg text-muted-foreground leading-relaxed mb-8 md:mb-10 max-w-2xl mx-auto animate-fade-in">
            Codes SH, tarifs douaniers, réglementations — obtenez des
            réponses précises et sourcées en quelques secondes.
          </p>

          {/* Chips */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-10 animate-fade-in">
            <span className="chip">
              <Lock className="h-3.5 w-3.5" />
              100% sécurisé
            </span>
            <span className="chip">
              <Monitor className="h-3.5 w-3.5" />
              100% digital
            </span>
          </div>
        </div>
      </section>

      {/* ─── Sticky CTA bottom (mobile) ──────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-50 p-4 sm:hidden safe-area-bottom bg-background/80 backdrop-blur-lg border-t border-border/30">
        <Link to="/demander-acces">
          <Button className="w-full cta-gradient rounded-2xl h-14 text-base font-semibold gap-2 shadow-xl">
            Demander mes accès — C'est parti !
            <ArrowRight className="h-5 w-5" />
          </Button>
        </Link>
        <p className="text-xs text-muted-foreground text-center mt-2 flex items-center justify-center gap-3">
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> 30 sec</span>
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Sans engagement</span>
          <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Gratuit</span>
        </p>
      </div>

      {/* ─── How it works ────────────────────────────── */}
      <section className="py-16 md:py-28 px-4">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-14 md:mb-16">
            <span className="text-sm font-semibold text-primary uppercase tracking-wider">Comment ça marche</span>
            <h2 className="text-2xl md:text-3xl font-extrabold mt-3 mb-4">
              Rejoignez DouaneAI en 4 étapes
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Un processus simple et transparent pour accéder à votre assistant douanier intelligent.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {steps.map((step, i) => (
              <div key={i} className="relative">
                <span className="absolute -top-3 left-4 z-10 text-xs font-bold text-white bg-primary rounded-full px-3 py-1">
                  Étape {i + 1}
                </span>
                <div className="step-card pt-8 h-full">
                  <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                    <step.icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-bold text-sm md:text-base text-card-foreground mb-1.5">{step.title}</h3>
                  <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features Grid (Nos avantages) ───────────── */}
      <section className="py-16 md:py-28 px-4 bg-muted/30">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-14 md:mb-16">
            <span className="text-sm font-semibold text-secondary uppercase tracking-wider">Nos avantages</span>
            <h2 className="text-2xl md:text-3xl font-extrabold mt-3 mb-4">
              Pourquoi choisir DouaneAI ?
            </h2>
            <div className="flex flex-wrap items-center justify-center gap-2 mb-4">
              <span className="chip chip-primary"><Zap className="h-3.5 w-3.5" /> Codes SH</span>
              <span className="chip chip-success"><Globe className="h-3.5 w-3.5" /> Tarifs</span>
              <span className="chip"><FileText className="h-3.5 w-3.5" /> Circulaires</span>
            </div>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Des réponses précises, sans risque et sourcées.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 md:gap-6">
            {features.map((feature, i) => (
              <div key={i} className="card-elevated p-5 md:p-6 text-center">
                <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <feature.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-bold text-sm md:text-base text-card-foreground mb-1">{feature.title}</h3>
                <p className="text-xs md:text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Detailed features ───────────────────────── */}
      <section className="py-16 md:py-28 px-4">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-14 md:mb-16">
            <h2 className="text-2xl md:text-3xl font-extrabold mb-4">
              Tout ce dont vous avez besoin
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Un outil complet pour simplifier vos opérations douanières
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4 md:gap-6">
            {featureDetails.map((feature, i) => (
              <div key={i} className="card-elevated p-6 flex flex-col items-start gap-4">
                <div className="h-11 w-11 rounded-xl cta-gradient flex items-center justify-center">
                  <feature.icon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-card-foreground mb-1.5">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ ─────────────────────────────────────── */}
      <section className="py-16 md:py-28 px-4 bg-muted/30">
        <div className="container mx-auto max-w-2xl">
          <div className="text-center mb-10 md:mb-14">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground bg-card border border-border/50 rounded-full px-4 py-2 mb-4">
              <HelpCircle className="h-4 w-4" />
              FAQ
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold mb-3">Questions fréquentes</h2>
            <p className="text-muted-foreground">
              Tout ce que vous devez savoir sur DouaneAI.
            </p>
          </div>

          <div className="card-elevated p-4 md:p-6">
            <Accordion type="single" collapsible className="w-full">
              {faqs.map((faq, i) => (
                <AccordionItem key={i} value={`faq-${i}`} className="border-border/40">
                  <AccordionTrigger className="text-left text-sm md:text-base font-medium hover:no-underline py-4">
                    {faq.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground leading-relaxed pb-4">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      {/* ─── CTA Section ─────────────────────────────── */}
      <section className="py-16 md:py-28 px-4">
        <div className="container mx-auto max-w-2xl text-center">
          <div className="card-elevated p-10 md:p-16 relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.03] hero-gradient" />
            <div className="relative z-10">
              <h2 className="text-2xl md:text-3xl font-extrabold mb-4">
                Prêt à commencer ?
              </h2>
              <p className="text-muted-foreground mb-10">
                Demandez votre accès en quelques clics pour commencer à utiliser
                l'assistant douanier.
              </p>
              <Link to="/demander-acces">
                <Button
                  size="lg"
                  className="cta-gradient rounded-2xl px-10 h-14 md:h-16 text-base md:text-lg font-semibold gap-3 shadow-xl hover:shadow-2xl"
                >
                  Demander mes accès
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
              <p className="text-xs text-muted-foreground mt-4 flex items-center justify-center gap-4">
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Sur invitation</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Sans engagement</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> 100% sécurisé</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────── */}
      <footer className="border-t border-border/40 py-8 px-4 pb-24 sm:pb-8">
        <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <Logo size="sm" />
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} DouaneAI. Tous droits réservés.
          </p>
        </div>
      </footer>

      <CookieConsent />
    </div>
  );
}
