import { Logo } from "@/components/ui/Logo";
import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";

export function PublicFooter() {
  return (
    <footer className="border-t border-border/30 bg-card/70 backdrop-blur-lg">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span>Propulsé par IA</span>
          </div>

          <Logo size="sm" />

          <div className="flex items-center gap-6 text-sm">
            <Link to="/about" className="text-muted-foreground hover:text-primary transition-colors">
              À propos
            </Link>
            <Link to="/contact" className="text-muted-foreground hover:text-primary transition-colors">
              Contact
            </Link>
            <Link to="/legal" className="text-muted-foreground hover:text-primary transition-colors">
              Mentions légales
            </Link>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-border/30 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} DouaneAI. Tous droits réservés.
        </div>
      </div>
    </footer>
  );
}
