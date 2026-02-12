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
  Phone,
  ChevronDown,
  Loader2,
  CheckCircle2,
  Send,
  ArrowRight,
} from "lucide-react";

const COUNTRY_CODES = [
  { code: "+212", label: "Maroc", placeholder: "6XX XXX XXX" },
  { code: "+33", label: "France", placeholder: "6 XX XX XX XX" },
  { code: "+86", label: "Chine", placeholder: "1XX XXXX XXXX" },
];

export default function RequestAccess() {
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState("");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [countryIndex, setCountryIndex] = useState(0);
  const [countryOpen, setCountryOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [honeypot, setHoneypot] = useState("");

  const country = COUNTRY_CODES[countryIndex];
  const fullPhone = `${country.code}${phoneLocal.replace(/\s/g, "")}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!companyName.trim() || !phoneLocal.trim()) return;

    const digits = phoneLocal.replace(/\s/g, "");
    if (digits.length < 8 || digits.length > 12) {
      setError("Numéro de téléphone invalide");
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
                phone: fullPhone,
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
              SMS de confirmation une fois votre accès validé.
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
    <div className="min-h-screen page-gradient flex flex-col items-center justify-center px-4">
      {/* Back button */}
      <div className="w-full max-w-md mb-6">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-border/50 bg-card text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>

      <Card className="w-full max-w-md card-elevated border border-border/20 rounded-3xl overflow-hidden">
        <CardContent className="p-8 md:p-10">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="mx-auto mb-5">
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

            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="phone" className="flex items-center gap-2 text-sm font-semibold">
                <Phone className="h-4 w-4 text-primary" />
                Téléphone
              </Label>
              <div className="flex gap-2">
                <div className="relative">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 h-10 px-3 rounded-xl border border-input bg-muted/50 text-sm hover:bg-accent/50 transition-colors whitespace-nowrap"
                    onClick={() => setCountryOpen(!countryOpen)}
                  >
                      <span className="font-medium text-foreground">{country.code}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                  {countryOpen && (
                    <div className="absolute top-full left-0 mt-1 z-50 bg-card border border-border rounded-xl shadow-lg overflow-hidden min-w-[180px]">
                      {COUNTRY_CODES.map((c, i) => (
                        <button
                          key={c.code}
                          type="button"
                          className={`w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/50 transition-colors ${
                            i === countryIndex
                              ? "bg-primary/5 text-primary font-medium"
                              : "text-foreground"
                          }`}
                          onClick={() => {
                            setCountryIndex(i);
                            setCountryOpen(false);
                          }}
                        >
                          <span>{c.label}</span>
                          <span className="ml-auto text-muted-foreground">{c.code}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Input
                  id="phone"
                  type="tel"
                  value={phoneLocal}
                  onChange={(e) => setPhoneLocal(e.target.value)}
                  placeholder={country.placeholder}
                  className="rounded-xl h-10 bg-muted/50 text-sm placeholder:text-xs"
                  required
                />
              </div>
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
              disabled={isSubmitting || !companyName.trim() || !phoneLocal.trim()}
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
