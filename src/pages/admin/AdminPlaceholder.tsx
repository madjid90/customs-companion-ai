import { useLocation } from "react-router-dom";
import { Construction } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const pageTitles: Record<string, string> = {
  "/admin/upload": "Upload de fichiers",
  "/admin/library": "Bibliothèque PDFs",
  "/admin/scraping": "Scraping WCO",
  "/admin/veille": "Veille web",
  "/admin/hs-codes": "Gestion Codes SH",
  "/admin/tariffs": "Gestion Tarifs",
  "/admin/controlled": "Produits contrôlés",
  "/admin/documents": "Documents",
  "/admin/conversations": "Conversations",
  "/admin/settings": "Configuration",
};

export default function AdminPlaceholder() {
  const location = useLocation();
  const title = pageTitles[location.pathname] || "Page Admin";

  return (
    <div className="space-y-8">
      <div className="animate-fade-in">
        <h1 className="text-3xl font-bold text-foreground">{title}</h1>
        <p className="text-muted-foreground mt-1">
          Cette page sera bientôt disponible
        </p>
      </div>

      <Card className="animate-slide-up">
        <CardContent className="flex flex-col items-center justify-center py-20">
          <Construction className="h-16 w-16 text-muted-foreground/50 mb-4" />
          <h2 className="text-xl font-semibold text-foreground mb-2">
            En cours de développement
          </h2>
          <p className="text-muted-foreground text-center max-w-md">
            Cette fonctionnalité est en cours d'implémentation. 
            Revenez bientôt pour accéder à toutes les fonctionnalités d'administration.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
