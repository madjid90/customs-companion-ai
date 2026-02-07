import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ArrowLeft,
  Building2,
  Phone,
  ChevronDown,
  Loader2,
  CheckCircle2,
  Send,
} from "lucide-react";

const COUNTRY_CODES = [
  { code: "+212", flag: "🇲🇦", label: "Maroc", placeholder: "6XX XXX XXX" },
  { code: "+33", flag: "🇫🇷", label: "France", placeholder: "6 XX XX XX XX" },
];

export default function RequestAccess() {
  const [companyName, setCompanyName] = useState("");
  const [phoneLocal, setPhoneLocal] = useState("");
  const [countryIndex, setCountryIndex] = useState(0);
  const [countryOpen, setCountryOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState("");

  const country = COUNTRY_CODES[countryIndex];
  const fullPhone = `${country.code}${phoneLocal.replace(/\s/g, "")}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!companyName.trim() || !phoneLocal.trim()) return;

    // Basic phone validation
    const digits = phoneLocal.replace(/\s/g, "");
    if (digits.length < 8 || digits.length > 12) {
      setError("Numéro de téléphone invalide");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error: dbError } = await supabase
        .from("access_requests")
        .insert({
          company_name: companyName.trim(),
          phone: fullPhone,
        });

      if (dbError) {
        console.error("Insert error:", dbError);
        setError("Une erreur est survenue. Veuillez réessayer.");
      } else {
        setIsSubmitted(true);
      }
    } catch {
      setError("Erreur de connexion. Veuillez réessayer.");
    }

    setIsSubmitting(false);
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen page-gradient flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="card-elevated p-10 rounded-3xl">
            <div className="h-16 w-16 rounded-full bg-secondary/10 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="h-8 w-8 text-secondary" />
            </div>
            <h1 className="text-2xl font-bold mb-3">Demande envoyée !</h1>
            <p className="text-muted-foreground mb-8 leading-relaxed">
              Votre demande d'accès a été soumise avec succès. Vous recevrez un
              SMS de confirmation une fois votre accès validé par
              l'administrateur.
            </p>
            <Link to="/">
              <Button variant="outline" className="rounded-full px-6">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Retour à l'accueil
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen page-gradient flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-6">
            <Logo size="lg" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Demander mes accès</h1>
          <p className="text-muted-foreground">
            Remplissez le formulaire ci-dessous pour demander l'accès à
            DouaneAI.
          </p>
        </div>

        {/* Form */}
        <div className="card-elevated p-8 rounded-3xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Company name */}
            <div className="space-y-2">
              <Label htmlFor="company">Nom de la société</Label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="company"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Ex: Import Export SARL"
                  className="pl-10 rounded-xl h-12"
                  maxLength={200}
                  required
                />
              </div>
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="phone">Numéro de téléphone</Label>
              <div className="flex gap-2">
                {/* Country selector */}
                <div className="relative">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 h-12 px-3 rounded-xl border border-input bg-background text-sm hover:bg-accent/50 transition-colors whitespace-nowrap"
                    onClick={() => setCountryOpen(!countryOpen)}
                  >
                    <span className="text-lg leading-none">{country.flag}</span>
                    <span className="font-medium text-foreground">
                      {country.code}
                    </span>
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
                          <span className="text-lg leading-none">{c.flag}</span>
                          <span>{c.label}</span>
                          <span className="ml-auto text-muted-foreground">
                            {c.code}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative flex-1">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    type="tel"
                    value={phoneLocal}
                    onChange={(e) => setPhoneLocal(e.target.value)}
                    placeholder={country.placeholder}
                    className="pl-10 rounded-xl h-12"
                    required
                  />
                </div>
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-sm text-destructive font-medium">{error}</p>
            )}

            {/* Submit */}
            <Button
              type="submit"
              className="w-full cta-gradient rounded-xl h-12 text-base font-semibold gap-2"
              disabled={
                isSubmitting || !companyName.trim() || !phoneLocal.trim()
              }
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Envoi en cours...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Envoyer ma demande
                </>
              )}
            </Button>
          </form>

          {/* Already have access */}
          <div className="mt-6 pt-5 border-t border-border/40 text-center">
            <p className="text-sm text-muted-foreground">
              Vous avez déjà un accès ?{" "}
              <Link
                to="/login"
                className="text-primary font-medium hover:underline"
              >
                Se connecter
              </Link>
            </p>
          </div>
        </div>

        {/* Back link */}
        <div className="text-center mt-6">
          <Link
            to="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Retour à l'accueil
          </Link>
        </div>
      </div>
    </div>
  );
}
