import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft,
  Building2,
  Mail,
  Loader2,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";

export default function RequestAccess() {
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [honeypot, setHoneypot] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!companyName.trim() || !email.trim()) return;

    const emailTrimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      setError("Adresse email invalide");
      return;
    }

    setIsSubmitting(true);

    try {
      let response: Response | null = null;
      for (let attempt = 0; attempt <= 1; attempt++) {
        try {
          response = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-access-request`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              },
              body: JSON.stringify({
                company_name: companyName.trim(),
                email: emailTrimmed,
                website: honeypot,
              }),
            }
          );
          if (response.ok || response.status < 500 || attempt === 1) break;
          await new Promise(r => setTimeout(r, 1500));
        } catch {
          if (attempt === 1) throw new Error("network");
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      const data = await response!.json();

      if (!response!.ok) {
        setError(data.error || "Une erreur est survenue. Veuillez réessayer.");
      } else {
        setIsSubmitted(true);
      }
    } catch {
      setError("Erreur de connexion. Vérifiez votre connexion internet et réessayez.");
    }

    setIsSubmitting(false);
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen page-gradient flex items-center justify-center px-4">
        <Card className="w-full max-w-md card-elevated rounded-3xl overflow-hidden animate-slide-up">
          <CardContent className="p-10 text-center">
            <div className="h-16 w-16 rounded-full bg-secondary/10 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="h-8 w-8 text-secondary" />
            </div>
            <h1 className="text-2xl font-extrabold mb-3">Demande envoyée !</h1>
            <p className="text-muted-foreground mb-8 leading-relaxed">
              Votre demande d'accès a été soumise avec succès. Vous recevrez un
              email de confirmation une fois votre accès validé.
            </p>
            <Link to="/">
              <Button variant="outline" className="rounded-2xl px-6 h-12">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Retour à l'accueil
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] page-gradient flex flex-col items-center justify-center px-4 overflow-auto">
      {/* Back button */}
      <div className="w-full max-w-md mb-4 md:mb-6 flex-shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-border/50 bg-card text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>

      <Card className="w-full max-w-md card-elevated border border-border/20 rounded-3xl overflow-hidden flex-shrink-0">
        <CardContent className="p-6 md:p-10">
          {/* Header */}
          <div className="text-center mb-5 md:mb-8">
            <div className="mx-auto mb-3 md:mb-5">
              <Logo size="lg" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight mb-2">Demander mes accès</h1>
            <p className="text-sm text-muted-foreground">
              Remplissez le formulaire ci-dessous pour accéder à DouaneAI.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Company name */}
            <div className="space-y-2">
              <Label htmlFor="company" className="flex items-center gap-2 text-sm font-semibold">
                <Building2 className="h-4 w-4 text-primary" />
                Nom de la société
              </Label>
              <Input
                id="company"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Ex: Import Export SARL"
                className="rounded-xl h-10 bg-muted/50 text-sm placeholder:text-xs"
                maxLength={200}
                required
              />
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2 text-sm font-semibold">
                <Mail className="h-4 w-4 text-primary" />
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="votre@email.com"
                className="rounded-xl h-10 bg-muted/50 text-sm placeholder:text-xs"
                required
              />
            </div>

            {/* Honeypot */}
            <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", opacity: 0, height: 0, overflow: "hidden" }}>
              <label htmlFor="website">Website</label>
              <input
                id="website"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive font-medium">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full cta-gradient rounded-xl h-12 text-sm font-semibold gap-2"
              disabled={isSubmitting || !companyName.trim() || !email.trim()}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Envoi en cours...
                </>
              ) : (
                <>
                  Envoyer ma demande
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-border/40 text-center">
            <p className="text-sm text-muted-foreground">
              Vous avez déjà un accès ?{" "}
              <Link to="/login" className="text-primary font-medium hover:underline">
                Se connecter
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
