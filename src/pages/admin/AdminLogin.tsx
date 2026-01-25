import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Lock, Eye, EyeOff, AlertCircle, Mail, UserPlus, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/ui/Logo";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAdmin, signIn, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  // Redirect if already authenticated and admin
  useEffect(() => {
    if (!authLoading && user && isAdmin) {
      const from = location.state?.from?.pathname || "/admin";
      navigate(from, { replace: true });
    }
  }, [user, isAdmin, authLoading, navigate, location]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    if (mode === "signup") {
      // Sign up new user
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        setIsLoading(false);
        return;
      }

      if (data.user) {
        // Add admin role to user_roles table
        const { error: roleError } = await supabase
          .from("user_roles")
          .insert({ user_id: data.user.id, role: "admin" });

        if (roleError) {
          console.error("Error adding admin role:", roleError);
          setError("Compte créé mais erreur lors de l'attribution du rôle admin.");
          setIsLoading(false);
          return;
        }

        toast({
          title: "Compte admin créé !",
          description: "Vous pouvez maintenant vous connecter.",
        });
        setMode("login");
        setPassword("");
      }
      setIsLoading(false);
      return;
    }

    // Login
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

    // Auth state listener will handle redirect
    setIsLoading(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sidebar to-sidebar/95">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-sidebar to-sidebar/95 p-4">
      <Card className="w-full max-w-md animate-slide-up">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto">
            <Logo size="lg" />
          </div>
          <div>
            <CardTitle className="text-2xl">
              {mode === "login" ? "Administration" : "Créer un compte Admin"}
            </CardTitle>
            <CardDescription>
              {mode === "login"
                ? "Connectez-vous pour accéder au panneau d'administration"
                : "Créez votre premier compte administrateur"}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  className="pl-10"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "Minimum 6 caractères" : "Entrez votre mot de passe"}
                  className="pl-10 pr-10"
                  minLength={mode === "signup" ? 6 : undefined}
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
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
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full h-11 bg-accent hover:bg-accent/90 text-accent-foreground font-semibold"
              disabled={isLoading || !email || !password}
            >
              {isLoading ? (
                mode === "login" ? "Connexion..." : "Création..."
              ) : (
                <>
                  {mode === "login" ? (
                    <>
                      <LogIn className="mr-2 h-4 w-4" />
                      Se connecter
                    </>
                  ) : (
                    <>
                      <UserPlus className="mr-2 h-4 w-4" />
                      Créer le compte admin
                    </>
                  )}
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <Button
              variant="link"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setError("");
              }}
            >
              {mode === "login"
                ? "Créer un compte admin"
                : "Déjà un compte ? Se connecter"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
