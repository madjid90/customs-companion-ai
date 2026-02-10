import { Navigate, useLocation } from "react-router-dom";
import { usePhoneAuth } from "@/hooks/usePhoneAuth";
import { Loader2 } from "lucide-react";

interface PhoneProtectedRouteProps {
  children: React.ReactNode;
}

export function PhoneProtectedRoute({
  children,
}: PhoneProtectedRouteProps) {
  const { isAuthenticated, isLoading } = usePhoneAuth();
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

  return <>{children}</>;
}
