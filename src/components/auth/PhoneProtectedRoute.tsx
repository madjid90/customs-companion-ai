import { Navigate, useLocation } from "react-router-dom";
import { usePhoneAuth } from "@/hooks/usePhoneAuth";
import { Loader2 } from "lucide-react";

interface PhoneProtectedRouteProps {
  children: React.ReactNode;
  requireManager?: boolean;
}

export function PhoneProtectedRoute({
  children,
  requireManager = false,
}: PhoneProtectedRouteProps) {
  const { isAuthenticated, isLoading, isManager } = usePhoneAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center page-gradient">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Chargement...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireManager && !isManager) {
    return (
      <div className="min-h-screen flex items-center justify-center page-gradient">
        <div className="text-center p-8">
          <h1 className="text-2xl font-bold text-destructive mb-2">
            Accès réservé aux managers
          </h1>
          <p className="text-muted-foreground mb-4">
            Vous n'avez pas les permissions pour cette page.
          </p>
          <a href="/app/chat" className="text-primary hover:underline">
            Retour au chat
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
