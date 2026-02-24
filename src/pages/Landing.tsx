import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/Logo";
import { CookieConsent } from "@/components/ui/CookieConsent";
import { useState } from "react";
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

// Backgrounds rendered at App level
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

/* ─── Data ─────────────────────────────────────────────── */
const stats = [
  { value: "10k+", label: "Lignes tarifaires" },
  { value: "40k+", label: "Équipements ANRT" },
  { value: "990+", label: "Documents indexés" },
  { value: "24/7", label: "Disponibilité" },
];

const steps = [
  { icon: UserPlus, title: "Inscription", desc: "Email + société. 30 secondes." },
  { icon: Users, title: "Validation", desc: "L'admin valide votre demande." },
  { icon: Send, title: "Chat & Consultation", desc: "Posez vos questions ou lancez une simulation." },
  { icon: Headphones, title: "Support", desc: "Assistance et mises à jour continues." },
];

const features = [
  { icon: Search, title: "Classification SH intelligente", desc: "Identifiez le code SH exact via un QCM interactif avec scores de probabilité et justifications RGI." },
  { icon: FileText, title: "Consultation Import", desc: "Simulez vos droits et taxes (DDI, TVA, TIC) avec calcul automatisé et rapport détaillé exportable en PDF." },
  { icon: Shield, title: "Conformité réglementaire", desc: "Vérifiez les exigences CoC, ANRT, ONSSA et DMP avec 40 000+ équipements homologués indexés." },
  { icon: Globe, title: "Accords commerciaux", desc: "Consultez les tarifs préférentiels et preuves d'origine (EUR.1, ATR, Form A) par accord." },
  { icon: Zap, title: "Analyse de documents", desc: "Uploadez DUM, factures ou fiches techniques pour une extraction et analyse IA instantanée." },
  { icon: MessageSquare, title: "Chat IA sourcé", desc: "Réponses en temps réel avec citations vérifiées (circulaires, articles de loi, tarifs officiels)." },
];

const faqs = [
  { q: "Comment fonctionne l'assistant douanier IA ?", a: "Notre assistant utilise l'intelligence artificielle et une base de 12 000+ segments juridiques pour analyser votre question et vous fournir une réponse précise avec les sources légales citées (circulaires, Code des Douanes, notes SH)." },
  { q: "Comment accéder à l'assistant ?", a: "L'accès se fait sur invitation. Remplissez le formulaire de demande avec votre adresse email et le nom de votre société, puis un administrateur validera votre demande." },
  { q: "Quels types de questions puis-je poser ?", a: "Codes SH, tarifs douaniers, règles d'origine, procédures d'import/export, conformité (CoC, ANRT, ONSSA), régimes économiques, contentieux, valeur en douane, zones franches et bien plus." },
  { q: "Qu'est-ce que le module Consultation ?", a: "Un assistant guidé qui génère des rapports détaillés pour 4 cas : Import (calcul fiscal), MRE (franchise véhicule), Conformité (documents requis) et Investisseur (comparaison de régimes). Chaque rapport est exportable en PDF." },
  { q: "Comment sont vérifiées les réponses ?", a: "Chaque réponse est accompagnée de ses sources légales vérifiées. Le système filtre les preuves pour ne garder que celles directement liées aux codes SH mentionnés." },
  { q: "Puis-je utiliser l'assistant sur mobile ?", a: "Oui, l'assistant est 100% responsive et fonctionne parfaitement sur téléphone, tablette et ordinateur." },
];

export default function Landing() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Prefetch login chunk on hover for instant navigation
  const prefetchLogin = () => {
    import("@/pages/LoginPage");
  };

  return (
    <div className="min-h-screen page-gradient relative" role="main">
      {/* Background is now persistent at App level — no local rendering needed */}
      {/* ─── Header ──────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border/40" role="banner">
        <nav className="container mx-auto px-4 sm:px-6 h-14 flex items-center justify-between" aria-label="Navigation principale">
          <Logo />
          <div className="hidden sm:flex items-center gap-6">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Fonctionnalités</a>
            <a href="#how" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Comment ça marche</a>
            <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors">FAQ</a>
            <Link to="/login" className="text-sm font-medium text-foreground hover:text-primary transition-colors" onMouseEnter={prefetchLogin}>
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
            aria-label="Ouvrir le menu"
            aria-expanded={mobileMenuOpen}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
        </nav>
      </header>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] bg-background flex flex-col p-6 sm:hidden animate-fade-in" role="dialog" aria-label="Menu de navigation">
          <div className="flex items-center justify-between mb-8">
            <Logo />
            <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(false)} aria-label="Fermer le menu">
              <X className="h-5 w-5" aria-hidden="true" />
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
      <section className="relative pt-20 pb-8 md:pt-28 md:pb-16 px-4 sm:px-6 overflow-hidden min-h-screen flex flex-col justify-center">
        {/* Background video */}
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover z-0"
          src="/videos/hero-bg.mp4"
        />
        {/* Overlay for readability */}
        <div className="absolute inset-0 bg-background/75 backdrop-blur-[2px] z-[1]" />
        <div className="container mx-auto max-w-6xl relative z-10">
          <div className="grid md:grid-cols-2 gap-8 md:gap-12 items-center">
            {/* Left – Text */}
            <div className="text-center md:text-left flex flex-col items-center md:items-start">
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
                <span className="gradient-text">douanier</span>{" "}
                propulsé par l'<span className="gradient-text">IA</span>
              </h1>

              <p className="text-sm md:text-base text-muted-foreground leading-relaxed mb-6 max-w-lg">
                Codes SH, tarifs douaniers, réglementations — obtenez des
                réponses précises et sourcées en quelques secondes.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 mb-6 w-full sm:w-auto">
                <Link to="/demander-acces">
                  <Button className="cta-gradient rounded-xl h-12 px-7 text-sm font-semibold gap-2 shadow-lg w-full sm:w-auto">
                    Demander un accès
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link to="/login" onMouseEnter={prefetchLogin}>
                  <Button variant="outline" className="rounded-xl h-12 px-7 text-sm font-medium gap-2 w-full sm:w-auto">
                    Se connecter
                  </Button>
                </Link>
              </div>

              <div className="flex items-center justify-center md:justify-start gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-secondary" /> Sur invitation</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-secondary" /> Sans engagement</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-secondary" /> 100% sécurisé</span>
              </div>
            </div>

            {/* Right – Visual cards */}
            <div className="hidden md:flex flex-col gap-4">
              {/* Chat illustration */}
              <div className="card-elevated p-5 relative overflow-hidden">
                <div className="absolute inset-0 opacity-[0.04] hero-gradient" />
                <div className="relative z-10 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-lg cta-gradient flex items-center justify-center flex-shrink-0">
                      <MessageSquare className="h-4 w-4 text-white" />
                    </div>
                    <div className="bg-muted/50 rounded-xl rounded-tl-none p-3 text-xs text-foreground leading-relaxed flex-1">
                      Quel est le droit d'importation pour les antennes télécom <span className="font-semibold text-primary">8517.71</span> au Maroc ?
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <BarChart3 className="h-4 w-4 text-primary" />
                    </div>
                    <div className="bg-card border border-border/40 rounded-xl rounded-tl-none p-3 text-xs text-foreground leading-relaxed flex-1">
                      Le code <span className="font-semibold text-primary">8517.71.00.00</span> — Antennes et réflecteurs d'antennes — est soumis à un DDI de <span className="font-bold text-secondary">2,5%</span> et une TVA de <span className="font-bold text-secondary">20%</span>.
                      <div className="mt-2 flex gap-1.5">
                        <span className="inline-flex items-center gap-1 bg-primary/5 text-primary text-[10px] font-medium px-2 py-0.5 rounded-full">
                          <BookOpen className="h-2.5 w-2.5" /> Circulaire 4591/312
                        </span>
                        <span className="inline-flex items-center gap-1 bg-secondary/10 text-secondary text-[10px] font-medium px-2 py-0.5 rounded-full">
                          <Shield className="h-2.5 w-2.5" /> Vérifié
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Documentation & Réglementation illustration */}
              <div className="card-elevated p-5 relative overflow-hidden">
                <div className="absolute inset-0 opacity-[0.04] hero-gradient" />
                <div className="relative z-10 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="h-7 w-7 rounded-lg cta-gradient flex items-center justify-center flex-shrink-0">
                      <Shield className="h-3.5 w-3.5 text-white" />
                    </div>
                    <span className="text-xs font-bold text-foreground">Conformité & Réglementation</span>
                  </div>
                  <div className="space-y-2">
                    {/* CoC */}
                    <div className="bg-muted/40 rounded-lg p-2.5 flex items-center gap-2.5">
                      <div className="h-6 w-6 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="h-3 w-3 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-foreground">Certificat de Conformité (CoC)</div>
                        <div className="text-[10px] text-muted-foreground">Requis · Contrôle MCINT</div>
                      </div>
                      <span className="inline-flex items-center gap-1 bg-warning/10 text-warning text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0">
                        Obligatoire
                      </span>
                    </div>
                    {/* ANRT */}
                    <div className="bg-muted/40 rounded-lg p-2.5 flex items-center gap-2.5">
                      <div className="h-6 w-6 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Lock className="h-3 w-3 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-foreground">Agrément ANRT</div>
                        <div className="text-[10px] text-muted-foreground">Équipement télécom · Homologation</div>
                      </div>
                      <span className="inline-flex items-center gap-1 bg-secondary/10 text-secondary text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Vérifié
                      </span>
                    </div>
                    {/* ONSSA */}
                    <div className="bg-muted/40 rounded-lg p-2.5 flex items-center gap-2.5">
                      <div className="h-6 w-6 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <FileText className="h-3 w-3 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-foreground">Contrôle ONSSA</div>
                        <div className="text-[10px] text-muted-foreground">Produits alimentaires · Sanitaire</div>
                      </div>
                      <span className="inline-flex items-center gap-1 bg-warning/10 text-warning text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0">
                        Obligatoire
                      </span>
                    </div>
                    {/* DMP */}
                    <div className="bg-muted/40 rounded-lg p-2.5 flex items-center gap-2.5">
                      <div className="h-6 w-6 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Globe className="h-3 w-3 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-foreground">Autorisation DMP</div>
                        <div className="text-[10px] text-muted-foreground">Dispositifs médicaux · Pharma</div>
                      </div>
                      <span className="inline-flex items-center gap-1 bg-secondary/10 text-secondary text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Vérifié
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

          {/* ─── Stats bar (inside hero) ───────────────── */}
          <div className="container mx-auto max-w-6xl relative z-10 mt-8 md:mt-12">
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
      <section id="how" className="relative py-10 md:py-16 px-4 sm:px-6 bg-muted/30">
        <div className="container mx-auto max-w-6xl relative z-10">
          <div className="text-center mb-8 md:mb-10">
            <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Comment ça marche</span>
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
                <span className="absolute -top-2.5 left-3 z-10 text-[10px] font-bold text-primary-foreground bg-primary rounded-full px-2.5 py-0.5">
                  {i + 1}
                </span>
                <div className="step-card pt-6 h-full !p-4 !pt-6">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <step.icon className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="font-bold text-xs md:text-sm text-card-foreground mb-1">{step.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features Grid ───────────────────────────── */}
      <section id="features" className="relative py-10 md:py-16 px-4 sm:px-6">
        <div className="container mx-auto max-w-6xl relative z-10">
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
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                  <feature.icon className="h-4 w-4 text-primary" />
                </div>
                <h3 className="font-bold text-xs md:text-sm text-card-foreground mb-1">{feature.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ ─────────────────────────────────────── */}
      <section id="faq" className="relative py-10 md:py-16 px-4 sm:px-6" aria-labelledby="faq-heading">
        <div className="container mx-auto max-w-6xl relative z-10">
          <div className="text-center mb-8 md:mb-10">
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-card border border-border/50 rounded-full px-3 py-1.5 mb-3">
              <HelpCircle className="h-3.5 w-3.5" />
              FAQ
            </div>
            <h2 id="faq-heading" className="text-xl md:text-2xl font-extrabold mb-2">Questions fréquentes</h2>
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
      <section className="relative py-10 md:py-16 px-4 sm:px-6 bg-muted/30">
        <div className="container mx-auto max-w-6xl text-center">
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
              <p className="text-xs text-muted-foreground mt-3 flex items-center justify-center gap-3">
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Sur invitation</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Sans engagement</span>
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> 100% sécurisé</span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────── */}
      <footer className="border-t border-border/40 py-6 px-4 sm:px-6">
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
