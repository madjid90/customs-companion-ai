import { Logo } from "@/components/ui/Logo";
import { Link } from "react-router-dom";
import { Bot } from "lucide-react";

export function PublicFooter() {
  return (
    <footer className="border-t bg-card">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bot className="h-4 w-4" />
            <span>Propulsé par IA</span>
          </div>

          <Logo size="sm" />

          <div className="flex items-center gap-6 text-sm">
            <Link to="/about" className="text-muted-foreground hover:text-foreground transition-colors">
              À propos
            </Link>
            <Link to="/contact" className="text-muted-foreground hover:text-foreground transition-colors">
              Contact
            </Link>
            <Link to="/legal" className="text-muted-foreground hover:text-foreground transition-colors">
              Mentions légales
            </Link>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} DouaneAI. Tous droits réservés.
        </div>
      </div>
    </footer>
  );
}
