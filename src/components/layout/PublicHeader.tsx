import { Link } from "react-router-dom";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

export function PublicHeader() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass" role="banner">
      <nav className="container mx-auto px-5 sm:px-6 h-16 flex items-center justify-between">
        <Logo />

        <div className="flex items-center gap-3 sm:gap-4">
          <div className="hidden sm:flex items-center gap-2">
            <span className="chip chip-success">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
              En ligne
            </span>
          </div>
          <Link to="/admin/login">
            <Button variant="ghost" size="sm" className="text-sm px-3 sm:px-4 h-10 rounded-xl hover:bg-muted transition-colors">
              <Settings className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Admin</span>
            </Button>
          </Link>
        </div>
      </nav>
    </header>
  );
}
