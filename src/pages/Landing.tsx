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
  Clock,
  CheckCircle2,
  TrendingUp,
  Bell,
  Monitor,
  Lock,
} from "lucide-react";

/* ─── Fake live-activity data for the floating card ────────────── */
const stats = [
  { value: "99%", label: "Précision", change: "+5%" },
  { value: "< 3s", label: "Réponse", change: "-40%" },
  { value: "10k+", label: "Documents", change: "" },
];

const recentQueries = [
  { time: "10:12", user: "Agent M.", query: "Classification moteur 8501.10", status: "resolved" },
  { time: "11:45", user: "Agent K.", query: "Droits de douane chapitre 84", status: "resolved" },
  { time: "14:30", user: "Agent S.", query: "Règles d'origine ALE Maroc-UE", status: "pending" },
];

/* ─── Features data ──────────────────────────────────────── */
const features = [
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
];

/* ─── Steps ─────────────────────────────────────────────── */
const steps = [
  { num: "1", title: "Connexion", desc: "Connectez-vous avec votre numéro de téléphone invité." },
  { num: "2", title: "Posez votre question", desc: "Décrivez votre produit ou posez votre question douanière." },
  { num: "3", title: "Réponse sourcée", desc: "Recevez une réponse précise avec les sources légales citées." },
];

export default function Landing() {
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
            <Link to="/login">
              <Button className="cta-gradient rounded-full px-5 h-10 text-sm font-semibold">
                Se connecter
              </Button>
            </Link>
          </div>
        </nav>
      </header>

      {/* ─── Hero Section — Split Layout ────────────── */}
      <section className="min-h-[calc(100dvh-4rem)] md:min-h-0 flex items-center md:block pt-0 md:pt-40 md:pb-28 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            {/* Left — Copy */}
            <div className="max-w-xl mx-auto md:mx-0 text-center md:text-left">
              {/* Live badge */}
              <div className="inline-flex items-center gap-2 mb-6 md:mb-8 animate-fade-in">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-secondary" />
                </span>
                <span className="text-sm font-medium text-muted-foreground">
                  Sur invitation uniquement
                </span>
              </div>

              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-[3.5rem] font-extrabold tracking-tight leading-[1.1] mb-6 md:mb-8 animate-slide-up">
                Votre assistant{" "}
                <span className="gradient-text">douanier intelligent</span>{" "}
                propulsé par l'IA
              </h1>

              <p className="text-base md:text-lg text-muted-foreground leading-relaxed mb-8 md:mb-10 animate-fade-in">
                Codes SH, tarifs douaniers, réglementations — obtenez des
                réponses précises et sourcées en quelques secondes.
              </p>

              <Link to="/login" className="inline-block animate-slide-up">
                <Button
                  size="lg"
                  className="cta-gradient rounded-full px-10 h-14 md:h-16 text-base md:text-lg font-semibold gap-3 shadow-xl hover:shadow-2xl"
                >
                  Accéder au chat
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>

              {/* Chips */}
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 mt-6 md:mt-8 animate-fade-in">
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

            {/* Right — Floating Dashboard Card (hidden on mobile) */}
            <div className="relative animate-slide-up lg:pl-4 hidden md:block">
              {/* Notification toast - floating above card */}
              <div className="absolute -top-4 right-4 z-10 bg-card rounded-2xl border border-border/30 px-4 py-3 flex items-center gap-3 shadow-lg animate-fade-in">
                <div className="h-8 w-8 rounded-full bg-secondary/10 flex items-center justify-center">
                  <Bell className="h-4 w-4 text-secondary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Nouvelle recherche</p>
                  <p className="text-sm font-semibold text-card-foreground flex items-center gap-1">
                    Code SH trouvé
                    <CheckCircle2 className="h-3.5 w-3.5 text-secondary" />
                  </p>
                </div>
              </div>

              {/* Main dashboard card */}
              <div className="bg-card rounded-3xl border border-border/30 p-8 shadow-xl">
                {/* Stats row */}
                <div className="grid grid-cols-3 gap-5 mb-8">
                  {stats.map((s, i) => (
                    <div
                      key={i}
                      className="text-center p-4 rounded-xl bg-muted/40"
                    >
                      <p className="text-2xl lg:text-3xl font-bold text-card-foreground">{s.value}</p>
                      <p className="text-sm text-muted-foreground mt-1">{s.label}</p>
                      {s.change && (
                        <p className="text-sm font-medium text-secondary mt-1.5">{s.change}</p>
                      )}
                    </div>
                  ))}
                </div>

                {/* Activity feed */}
                <div className="space-y-0">
                  {recentQueries.map((q, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-4 py-4 border-b border-border/30 last:border-0"
                    >
                      <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                        <Clock className="h-4 w-4" />
                        <span className="text-sm font-mono">{q.time}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-base font-medium text-card-foreground">{q.user}</p>
                        <p className="text-sm text-muted-foreground truncate">{q.query}</p>
                      </div>
                      <span
                        className={`text-sm font-medium px-3 py-1.5 rounded-full shrink-0 ${
                          q.status === "resolved"
                            ? "bg-secondary/10 text-secondary"
                            : "bg-warning/10 text-warning"
                        }`}
                      >
                        {q.status === "resolved" ? "Résolu" : "En cours"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Trend badge - floating below card */}
              <div className="absolute -bottom-4 left-8 z-10 bg-card rounded-2xl border border-border/30 px-4 py-2.5 flex items-center gap-2.5 shadow-lg animate-fade-in">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Ce mois</p>
                  <p className="text-sm font-bold text-card-foreground">+35% de requêtes</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── How it works ────────────────────────────── */}
      <section className="py-16 md:py-28 px-4">
        <div className="container mx-auto max-w-4xl">
          <div className="text-center mb-14 md:mb-16">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">
              Comment ça marche ?
            </h2>
            <p className="text-muted-foreground max-w-lg mx-auto">
              Trois étapes simples pour obtenir votre réponse douanière
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {steps.map((step, i) => (
              <div key={i} className="step-card">
                <div className="h-12 w-12 rounded-2xl cta-gradient flex items-center justify-center mx-auto mb-4">
                  <span className="text-lg font-bold text-white">{step.num}</span>
                </div>
                <h3 className="font-semibold text-card-foreground mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                {i < steps.length - 1 && (
                  <div className="hidden md:block absolute top-1/2 -right-3 transform -translate-y-1/2">
                    <ArrowRight className="h-4 w-4 text-muted-foreground/40" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features Grid ───────────────────────────── */}
      <section className="py-16 md:py-28 px-4 bg-muted/30">
        <div className="container mx-auto max-w-5xl">
          <div className="text-center mb-14 md:mb-16">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">
              Tout ce dont vous avez besoin
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Un outil complet pour simplifier vos opérations douanières
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {features.map((feature, i) => (
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

      {/* ─── CTA Section ─────────────────────────────── */}
      <section className="py-16 md:py-28 px-4">
        <div className="container mx-auto max-w-2xl text-center">
          <div className="card-elevated p-10 md:p-16 relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.03] hero-gradient" />
            <div className="relative z-10">
              <h2 className="text-2xl md:text-3xl font-bold mb-4">
                Prêt à commencer ?
              </h2>
              <p className="text-muted-foreground mb-10">
                Connectez-vous avec votre numéro de téléphone pour accéder à
                l'assistant douanier.
              </p>
              <Link to="/login">
                <Button
                  size="lg"
                  className="cta-gradient rounded-full px-10 h-14 md:h-16 text-base md:text-lg font-semibold gap-3 shadow-xl hover:shadow-2xl"
                >
                  Se connecter
                  <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
              <p className="text-xs text-muted-foreground mt-4 flex items-center justify-center gap-4">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Sur invitation
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Sans engagement
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> 100% sécurisé
                </span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────── */}
      <footer className="border-t border-border/40 py-8 px-4">
        <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <Logo size="sm" />
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} DouaneAI. Tous droits réservés.
          </p>
        </div>
      </footer>
      {/* Cookie Consent */}
      <CookieConsent />
    </div>
  );
}
