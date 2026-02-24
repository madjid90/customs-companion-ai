import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/button";
import { ArrowRight, Home } from "lucide-react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center page-gradient px-4">
      <div className="text-center max-w-sm">
        <div className="mx-auto mb-8"><Logo /></div>
        <h1 className="text-6xl font-extrabold gradient-text mb-4">404</h1>
        <p className="text-lg font-semibold text-foreground mb-2">Page introuvable</p>
        <p className="text-sm text-muted-foreground mb-8">
          La page que vous recherchez n'existe pas ou a été déplacée.
        </p>
        <Link to="/">
          <Button className="cta-gradient rounded-xl h-11 px-6 text-sm font-semibold gap-2">
            <Home className="h-4 w-4" />
            Retour à l'accueil
          </Button>
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
