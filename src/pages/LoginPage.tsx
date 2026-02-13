import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Mail, ArrowRight, Loader2, KeyRound, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Logo } from "@/components/ui/Logo";
import { Label } from "@/components/ui/label";
import { useAppAuth } from "@/hooks/useAppAuth";
import { useToast } from "@/hooks/use-toast";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isBootstrap, setIsBootstrap] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const otpInputRef = useRef<HTMLInputElement>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, setSessionFromOtp } = useAppAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (isAuthenticated) {
      const from = location.state?.from?.pathname || "/app/chat";
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, location]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

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
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
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
        description: `Un email a été envoyé à ${email}`,
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
          email: email.trim().toLowerCase(),
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

      navigate("/app/chat");
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
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
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
    <div className="min-h-[100dvh] flex flex-col items-center justify-center page-gradient p-4 overflow-auto">
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
            <h1 className="text-2xl font-extrabold tracking-tight mb-2">
              {step === "email" ? "Me connecter" : "Vérification"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {step === "email"
                ? "Accédez à votre espace membre"
                : `Code envoyé à ${email}`}
            </p>
          </div>

          {step === "email" ? (
            <form onSubmit={handleSendOtp} className="space-y-6">
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
                  className="rounded-xl h-10 bg-muted/50 border-input text-sm placeholder:text-xs"
                  autoFocus
                  required
                />
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-12 cta-gradient rounded-xl text-sm font-semibold gap-2"
                disabled={isLoading || !email.trim()}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Envoi en cours...
                  </>
                ) : (
                  <>
                    Me connecter
                    <ArrowRight className="h-5 w-5" />
                  </>
                )}
              </Button>

              <div className="text-center pt-2">
                <p className="text-sm text-muted-foreground">
                  Pas encore de compte ?{" "}
                  <Link to="/demander-acces" className="text-primary font-medium hover:underline">
                    Demander l'accès
                  </Link>
                </p>
              </div>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-6">
              {isBootstrap && (
                <div className="space-y-2">
                  <Label htmlFor="displayName" className="text-sm font-semibold">Votre nom (premier utilisateur)</Label>
                  <Input
                    id="displayName"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Votre nom complet"
                    className="rounded-xl h-10 bg-muted/50"
                    maxLength={100}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="otp" className="flex items-center gap-2 text-sm font-semibold">
                  <KeyRound className="h-4 w-4 text-primary" />
                  Code de vérification
                </Label>
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
                  className="rounded-xl h-10 bg-muted/50 text-center text-xl tracking-[0.5em] font-mono placeholder:text-xs"
                  required
                />
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-12 cta-gradient rounded-xl text-sm font-semibold"
                disabled={isLoading || otp.length !== 6}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
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
                    setStep("email");
                    setOtp("");
                    setError("");
                  }}
                >
                  <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                  Changer l'email
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
        </CardContent>
      </Card>
    </div>
  );
}
