import { useState, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Lock, Eye, EyeOff, AlertCircle, Mail, ArrowRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Logo } from "@/components/ui/Logo";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, signIn, isLoading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && user && isAdmin) {
      const from = location.state?.from?.pathname || "/admin/upload";
      navigate(from, { replace: true });
    }
  }, [user, isAdmin, authLoading, navigate, location]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    const { error } = await signIn(email, password);

    if (error) {
      if (error.message.includes("Invalid login credentials")) {
        setError("Email ou mot de passe incorrect");
      } else if (error.message.includes("Email not confirmed")) {
        setError("Veuillez confirmer votre email");
      } else {
        setError(error.message);
      }
      setIsLoading(false);
      return;
    }

    setIsLoading(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center page-gradient">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center page-gradient p-4">
      {/* Back button */}
      <div className="w-full max-w-md mb-6">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-border/50 bg-card text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>

      <Card className="w-full max-w-md animate-slide-up card-elevated border border-border/20 rounded-3xl overflow-hidden">
        <CardContent className="p-8 md:p-10">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="mx-auto mb-5">
              <Logo size="lg" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight mb-2">
              Administration
            </h1>
            <p className="text-sm text-muted-foreground">
              Connectez-vous pour accéder au panneau d'administration
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
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
                placeholder="admin@example.com"
                className="rounded-xl h-12 bg-muted/50"
                autoFocus
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="flex items-center gap-2 text-sm font-semibold">
                <Lock className="h-4 w-4 text-primary" />
                Mot de passe
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Votre mot de passe"
                  className="rounded-xl h-12 bg-muted/50 pr-12"
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-14 cta-gradient rounded-2xl text-base font-semibold gap-2"
              disabled={isLoading || !email || !password}
            >
              {isLoading ? (
                "Connexion..."
              ) : (
                <>
                  Me connecter
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
