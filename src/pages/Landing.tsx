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
  Lock,
  HelpCircle,
  UserPlus,
  Users,
  Send,
  Headphones,
  Menu,
  X,
  BarChart3,
  BookOpen,
} from "lucide-react";
import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/* ─── Data ─────────────────────────────────────────────── */
const stats = [
  { value: "10k+", label: "Codes SH" },
  { value: "<3s", label: "Temps de réponse" },
  { value: "100%", label: "Sources vérifiées" },
  { value: "24/7", label: "Disponibilité" },
];

const steps = [
  { icon: UserPlus, title: "Inscription", desc: "Téléphone + société. 30 secondes." },
  { icon: Users, title: "Validation", desc: "L'admin valide votre demande." },
  { icon: Send, title: "Chat IA", desc: "Posez vos questions douanières." },
  { icon: Headphones, title: "Support", desc: "Assistance et mises à jour." },
];

const features = [
  { icon: Search, title: "Recherche HS intelligente", desc: "Trouvez le code SH exact grâce à la recherche sémantique IA." },
  { icon: FileText, title: "Analyse de documents", desc: "Uploadez DUM, factures ou circulaires pour une analyse instantanée." },
  { icon: Globe, title: "Réglementation à jour", desc: "Base mise à jour avec les dernières circulaires et tarifs." },
  { icon: Zap, title: "Réponses instantanées", desc: "Réponses en temps réel avec sources citées et vérifiables." },
  { icon: Shield, title: "Données sécurisées", desc: "Vos données et conversations sont protégées et confidentielles." },
  { icon: MessageSquare, title: "Chat contextuel", desc: "L'assistant comprend le contexte pour des réponses pertinentes." },
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
        <nav className="container mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Logo />
          <div className="hidden sm:flex items-center gap-6">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Fonctionnalités</a>
            <a href="#how" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Comment ça marche</a>
            <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors">FAQ</a>
            <Link to="/login" className="text-sm font-medium text-foreground hover:text-primary transition-colors">
              Connexion
            </Link>
            <Link to="/demander-acces">
              <Button size="sm" className="cta-gradient rounded-xl h-9 px-5 text-sm font-semibold gap-1.5">
                Demander un accès
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="sm:hidden"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
        </nav>
      </header>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] bg-background flex flex-col p-6 sm:hidden animate-fade-in">
          <div className="flex items-center justify-between mb-8">
            <Logo />
            <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="space-y-5 text-base font-medium">
            <a href="#features" className="block" onClick={() => setMobileMenuOpen(false)}>Fonctionnalités</a>
            <a href="#how" className="block" onClick={() => setMobileMenuOpen(false)}>Comment ça marche</a>
            <a href="#faq" className="block" onClick={() => setMobileMenuOpen(false)}>FAQ</a>
            <Link to="/login" className="block" onClick={() => setMobileMenuOpen(false)}>Connexion</Link>
          </div>
          <div className="mt-auto pt-6">
            <Link to="/demander-acces" onClick={() => setMobileMenuOpen(false)}>
              <Button className="w-full cta-gradient rounded-xl h-12 text-sm font-semibold gap-2">
                Demander un accès
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* ─── Hero Section ────────────────────────────── */}
      <section className="pt-24 pb-12 md:pt-28 md:pb-16 px-1.5 sm:px-3">
        <div className="mx-auto">
          <div className="grid md:grid-cols-2 gap-8 md:gap-12 items-center">
            {/* Left – Text */}
            <div className="animate-slide-up">
              <div className="inline-flex items-center gap-2 mb-5 bg-card rounded-full px-3.5 py-1.5 border border-border/40 shadow-sm text-xs">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary" />
                </span>
                <span className="font-semibold text-foreground">En ligne</span>
                <span className="text-muted-foreground">· Sur invitation</span>
              </div>

              <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-[2.75rem] font-extrabold tracking-tight leading-[1.15] mb-4">
                Votre assistant{" "}
                <span className="gradient-text">douanier intelligent</span>{" "}
                propulsé par l'IA
              </h1>

              <p className="text-sm md:text-base text-muted-foreground leading-relaxed mb-6 max-w-lg">
                Codes SH, tarifs douaniers, réglementations — obtenez des
                réponses précises et sourcées en quelques secondes.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <Link to="/demander-acces">
                  <Button className="cta-gradient rounded-xl h-12 px-7 text-sm font-semibold gap-2 shadow-lg w-full sm:w-auto">
                    Demander un accès
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link to="/login">
                  <Button variant="outline" className="rounded-xl h-12 px-7 text-sm font-medium gap-2 w-full sm:w-auto">
                    Se connecter
                  </Button>
                </Link>
              </div>

              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-secondary" /> Sur invitation</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-secondary" /> Sans engagement</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-secondary" /> 100% sécurisé</span>
              </div>
            </div>

            {/* Right – Visual card */}
            <div className="hidden md:block animate-fade-in">
              <div className="card-elevated p-6 relative overflow-hidden">
                <div className="absolute inset-0 opacity-[0.04] hero-gradient" />
                <div className="relative z-10 space-y-4">
                  {/* Mock chat */}
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-lg cta-gradient flex items-center justify-center flex-shrink-0">
                      <MessageSquare className="h-4 w-4 text-white" />
                    </div>
                    <div className="bg-muted/50 rounded-xl rounded-tl-none p-3 text-xs text-foreground leading-relaxed flex-1">
                      Quel est le taux de droit de douane pour le code SH <span className="font-semibold text-primary">8471.30</span> au Maroc ?
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <BarChart3 className="h-4 w-4 text-primary" />
                    </div>
                    <div className="bg-card border border-border/40 rounded-xl rounded-tl-none p-3 text-xs text-foreground leading-relaxed flex-1">
                      Le taux de droit d'importation pour le code <span className="font-semibold text-primary">8471.30</span> est de <span className="font-bold text-secondary">2,5%</span>.
                      <div className="mt-2 flex gap-1.5">
                        <span className="inline-flex items-center gap-1 bg-primary/5 text-primary text-[10px] font-medium px-2 py-0.5 rounded-full">
                          <BookOpen className="h-2.5 w-2.5" /> Circulaire n°6345
                        </span>
                        <span className="inline-flex items-center gap-1 bg-secondary/10 text-secondary text-[10px] font-medium px-2 py-0.5 rounded-full">
                          <Shield className="h-2.5 w-2.5" /> Vérifié
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Stats bar ───────────────────────────────── */}
      <section className="py-8 px-1.5 sm:px-3">
        <div className="mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            {stats.map((s, i) => (
              <div key={i} className="card-elevated p-4 text-center">
                <div className="text-xl md:text-2xl font-extrabold gradient-text mb-0.5">{s.value}</div>
                <div className="text-xs text-muted-foreground font-medium">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How it works ────────────────────────────── */}
      <section id="how" className="py-12 md:py-16 px-1.5 sm:px-3">
        <div className="mx-auto">
          <div className="text-center mb-8 md:mb-10">
            <span className="text-xs font-semibold text-primary uppercase tracking-wider">Comment ça marche</span>
            <h2 className="text-xl md:text-2xl font-extrabold mt-2 mb-2">
              4 étapes pour commencer
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Un processus simple et transparent.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            {steps.map((step, i) => (
              <div key={i} className="relative">
                <span className="absolute -top-2.5 left-3 z-10 text-[10px] font-bold text-white bg-primary rounded-full px-2.5 py-0.5">
                  {i + 1}
                </span>
                <div className="step-card pt-6 h-full !p-4 !pt-6">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <step.icon className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="font-bold text-xs md:text-sm text-card-foreground mb-1">{step.title}</h3>
                  <p className="text-[11px] md:text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features Grid ───────────────────────────── */}
      <section id="features" className="py-12 md:py-16 px-1.5 sm:px-3 bg-muted/30">
        <div className="mx-auto">
          <div className="text-center mb-8 md:mb-10">
            <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Fonctionnalités</span>
            <h2 className="text-xl md:text-2xl font-extrabold mt-2 mb-2">
              Tout ce dont vous avez besoin
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Un outil complet pour simplifier vos opérations douanières.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            {features.map((feature, i) => (
              <div key={i} className="card-elevated p-4 md:p-5">
                <div className="h-9 w-9 rounded-lg cta-gradient flex items-center justify-center mb-3">
                  <feature.icon className="h-4 w-4 text-white" />
                </div>
                <h3 className="font-bold text-xs md:text-sm text-card-foreground mb-1">{feature.title}</h3>
                <p className="text-[11px] md:text-xs text-muted-foreground leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ ─────────────────────────────────────── */}
      <section id="faq" className="py-12 md:py-16 px-1.5 sm:px-3">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-8 md:mb-10">
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-card border border-border/50 rounded-full px-3 py-1.5 mb-3">
              <HelpCircle className="h-3.5 w-3.5" />
              FAQ
            </div>
            <h2 className="text-xl md:text-2xl font-extrabold mb-2">Questions fréquentes</h2>
            <p className="text-sm text-muted-foreground">
              Tout ce que vous devez savoir sur DouaneAI.
            </p>
          </div>

          <div className="card-elevated p-3 md:p-5">
            <Accordion type="single" collapsible className="w-full">
              {faqs.map((faq, i) => (
                <AccordionItem key={i} value={`faq-${i}`} className="border-border/40">
                  <AccordionTrigger className="text-left text-xs md:text-sm font-medium hover:no-underline py-3">
                    {faq.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-xs md:text-sm text-muted-foreground leading-relaxed pb-3">
                    {faq.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      {/* ─── CTA Section ─────────────────────────────── */}
      <section className="py-12 md:py-16 px-1.5 sm:px-3 bg-muted/30">
        <div className="mx-auto max-w-4xl text-center">
          <div className="card-elevated p-8 md:p-10 relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.03] hero-gradient" />
            <div className="relative z-10">
              <h2 className="text-xl md:text-2xl font-extrabold mb-3">
                Prêt à commencer ?
              </h2>
              <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
                Demandez votre accès en quelques clics et commencez à utiliser l'assistant.
              </p>
              <Link to="/demander-acces">
                <Button className="cta-gradient rounded-xl px-8 h-12 text-sm font-semibold gap-2 shadow-lg">
                  Demander un accès
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <p className="text-[11px] text-muted-foreground mt-3 flex items-center justify-center gap-3">
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Sur invitation</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Sans engagement</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> 100% sécurisé</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────── */}
      <footer className="border-t border-border/40 py-6 px-1.5 sm:px-3">
        <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <Logo size="sm" />
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} DouaneAI. Tous droits réservés.
          </p>
        </div>
      </footer>


      <CookieConsent />
    </div>
  );
}
