import { Link } from "react-router-dom";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/button";
import { Settings, History } from "lucide-react";

interface PublicHeaderProps {
  onHistoryToggle?: () => void;
  isHistoryOpen?: boolean;
}

export function PublicHeader({ onHistoryToggle, isHistoryOpen }: PublicHeaderProps) {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass" role="banner">
      <nav className="container mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center justify-between">
        {/* Mobile: history button instead of logo */}
        {onHistoryToggle && !isHistoryOpen ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onHistoryToggle}
            className="md:hidden h-9 w-9 rounded-full hover:bg-primary/5 hover:text-primary"
            title="Historique"
          >
            <History className="h-5 w-5" />
          </Button>
        ) : (
          <div className="md:hidden w-9" />
        )}

        {/* Desktop: always show logo */}
        <div className="hidden md:block">
          <Logo />
        </div>

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
