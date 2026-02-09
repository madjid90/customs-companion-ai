import { Link, useLocation } from "react-router-dom";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/button";
import { usePhoneAuth } from "@/hooks/usePhoneAuth";
import { LogOut, MessageSquare, Users, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

interface AppHeaderProps {
  onHistoryToggle?: () => void;
  isHistoryOpen?: boolean;
}

export function AppHeader({ onHistoryToggle, isHistoryOpen }: AppHeaderProps) {
  const { phoneUser, isManager, signOut } = usePhoneAuth();
  const location = useLocation();

  const navItems = [
    { href: "/app/chat", label: "Chat", icon: MessageSquare, show: true },
    { href: "/app/manage", label: "Utilisateurs", icon: Users, show: isManager },
  ];

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

        {/* Desktop logo + nav */}
        <div className="hidden md:flex items-center gap-6">
          <Logo />
          <div className="flex items-center gap-1">
            {navItems
              .filter((item) => item.show)
              .map((item) => (
                <Link key={item.href} to={item.href}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "text-sm px-3 h-9 rounded-lg transition-colors",
                      location.pathname.startsWith(item.href)
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <item.icon className="h-4 w-4 mr-1.5" />
                    {item.label}
                  </Button>
                </Link>
              ))}
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Mobile nav links as icons */}
          {isManager && (
            <Link to="/app/manage" className="md:hidden">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-9 w-9 rounded-full",
                  location.pathname.startsWith("/app/manage")
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="Utilisateurs"
              >
                <Users className="h-4 w-4" />
              </Button>
            </Link>
          )}
          {phoneUser && (
            <span className="hidden sm:inline text-sm text-muted-foreground">
              {phoneUser.display_name || phoneUser.phone}
            </span>
          )}
          <div className="hidden sm:flex items-center gap-2">
            <span className="chip chip-success text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
              {isManager ? "Manager" : "Agent"}
            </span>
          </div>
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
