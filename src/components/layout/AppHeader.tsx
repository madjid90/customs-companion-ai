import { Link, useLocation } from "react-router-dom";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/button";
import { usePhoneAuth } from "@/hooks/usePhoneAuth";
import { LogOut, Menu } from "lucide-react";

interface AppHeaderProps {
  onHistoryToggle?: () => void;
  isHistoryOpen?: boolean;
}

export function AppHeader({ onHistoryToggle, isHistoryOpen }: AppHeaderProps) {
  const { phoneUser, signOut } = usePhoneAuth();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass" role="banner">
      <nav className="container mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center justify-between">
        {/* Mobile: hamburger menu for history */}
        <div className="md:hidden">
          {onHistoryToggle ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={onHistoryToggle}
              className="h-9 w-9 rounded-full hover:bg-primary/5 hover:text-primary"
              title="Historique"
            >
              <Menu className="h-5 w-5" />
            </Button>
          ) : (
            <div className="w-9" />
          )}
        </div>

        {/* Desktop logo */}
        <div className="hidden md:flex items-center gap-6">
          <Logo />
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {phoneUser && (
            <span className="hidden sm:inline text-sm text-muted-foreground">
              {phoneUser.display_name || phoneUser.phone}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={signOut}
            className="h-9 w-9 rounded-full hover:bg-destructive/10 hover:text-destructive"
            title="Déconnexion"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </nav>
    </header>
  );
}
