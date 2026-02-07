import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Phone, ArrowRight, Loader2, KeyRound, ArrowLeft, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/ui/Logo";
import { Label } from "@/components/ui/label";
import { usePhoneAuth } from "@/hooks/usePhoneAuth";
import { useToast } from "@/hooks/use-toast";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const COUNTRY_CODES = [
  { code: "+212", flag: "🇲🇦", label: "Maroc", placeholder: "6XX XXX XXX" },
  { code: "+33", flag: "🇫🇷", label: "France", placeholder: "6 XX XX XX XX" },
];

export default function PhoneLogin() {
  const [countryIndex, setCountryIndex] = useState(0);
  const [phoneLocal, setPhoneLocal] = useState("");
  const [otp, setOtp] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isBootstrap, setIsBootstrap] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [countryOpen, setCountryOpen] = useState(false);
  const otpInputRef = useRef<HTMLInputElement>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isManager, setSessionFromOtp } = usePhoneAuth();
  const { toast } = useToast();

  const country = COUNTRY_CODES[countryIndex];
  const fullPhone = `${country.code}${phoneLocal.replace(/\s/g, "")}`;

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      const from = location.state?.from?.pathname || "/app/chat";
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, isManager, navigate, location]);

  // Countdown for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Auto-focus OTP input
  useEffect(() => {
    if (step === "otp" && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [step]);

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ phone: fullPhone }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Erreur lors de l'envoi du code");
        setIsLoading(false);
        return;
      }

      setIsBootstrap(data.isBootstrap || false);
      setStep("otp");
      setCountdown(60);
      toast({
        title: "Code envoyé !",
        description: `Un SMS a été envoyé au ${country.code} ${phoneLocal}`,
      });
    } catch (err) {
      setError("Erreur de connexion au serveur");
    }

    setIsLoading(false);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          phone: fullPhone,
          code: otp.trim(),
          displayName: isBootstrap ? displayName.trim() : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Code incorrect");
        setIsLoading(false);
        return;
      }

      // Set session in Supabase client
      await setSessionFromOtp(
        {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        },
        data.user
      );

      toast({
        title: "Connexion réussie !",
        description: `Bienvenue ${data.user.display_name || ""}`,
      });

      navigate("/app/chat", { replace: true });
    } catch (err) {
      setError("Erreur de connexion au serveur");
    }

    setIsLoading(false);
  };

  const handleResendOtp = async () => {
    if (countdown > 0) return;
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-otp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ phone: fullPhone }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Erreur lors du renvoi");
      } else {
        setCountdown(60);
        toast({ title: "Code renvoyé !" });
      }
    } catch {
      setError("Erreur de connexion");
    }

    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center page-gradient p-4">
      <Card className="w-full max-w-md animate-slide-up card-elevated border border-border/20">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto">
            <Logo size="lg" />
          </div>
          <div>
            <CardTitle className="text-2xl font-display font-extrabold tracking-tight">
              {step === "phone" ? "Connexion" : "Vérification"}
            </CardTitle>
            <CardDescription>
              {step === "phone"
                ? "Entrez votre numéro pour recevoir un code de vérification"
                : `Code envoyé au ${country.code} ${phoneLocal}`}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {step === "phone" ? (
            <form onSubmit={handleSendOtp} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="phone">Numéro de téléphone</Label>
                <div className="flex gap-2">
                  {/* Country selector */}
                  <div className="relative">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 h-10 px-3 rounded-xl border border-input bg-background text-sm hover:bg-accent/50 transition-colors whitespace-nowrap"
                      onClick={() => setCountryOpen(!countryOpen)}
                    >
                      <span className="text-lg leading-none">{country.flag}</span>
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
                              i === countryIndex ? "bg-primary/5 text-primary font-medium" : "text-foreground"
                            }`}
                            onClick={() => {
                              setCountryIndex(i);
                              setCountryOpen(false);
                            }}
                          >
                            <span className="text-lg leading-none">{c.flag}</span>
                            <span>{c.label}</span>
                            <span className="ml-auto text-muted-foreground">{c.code}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Phone input */}
                  <div className="relative flex-1">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      value={phoneLocal}
                      onChange={(e) => setPhoneLocal(e.target.value)}
                      placeholder={country.placeholder}
                      className="pl-10 rounded-xl"
                      autoFocus
                      required
                    />
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-12 cta-gradient rounded-xl text-base"
                disabled={isLoading || !phoneLocal.trim()}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Envoi en cours...
                  </>
                ) : (
                  <>
                    Recevoir le code
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-5">
              {isBootstrap && (
                <div className="space-y-2">
                  <Label htmlFor="displayName">Votre nom (premier manager)</Label>
                  <Input
                    id="displayName"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Votre nom complet"
                    className="rounded-xl"
                    maxLength={100}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="otp">Code de vérification</Label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    ref={otpInputRef}
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    className="pl-10 rounded-xl text-center text-xl tracking-[0.5em] font-mono"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-12 cta-gradient rounded-xl text-base"
                disabled={isLoading || otp.length !== 6}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Vérification...
                  </>
                ) : (
                  "Vérifier et se connecter"
                )}
              </Button>

              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => {
                    setStep("phone");
                    setOtp("");
                    setError("");
                  }}
                >
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                  Changer le numéro
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={handleResendOtp}
                  disabled={countdown > 0 || isLoading}
                >
                  {countdown > 0 ? `Renvoyer (${countdown}s)` : "Renvoyer le code"}
                </Button>
              </div>
            </form>
          )}

          <div className="mt-6 text-center">
            <p className="text-xs text-muted-foreground">
              Accès sur invitation uniquement
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}