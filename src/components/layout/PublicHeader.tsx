import { Link } from "react-router-dom";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

export function PublicHeader() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-card/90 backdrop-blur-xl border-b border-border">
      <div className="container mx-auto px-4">
        <div className="flex h-16 items-center justify-between">
          <Logo />

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2">
              <span className="chip chip-success">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                En ligne
              </span>
            </div>
            <Link to="/admin/login">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground hover:bg-primary/5 rounded-xl">
                <Settings className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Admin</span>
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
