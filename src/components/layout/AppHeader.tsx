import { Link, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/button";
import { useAppAuth } from "@/hooks/useAppAuth";
import { LogOut, Menu, MessageSquare, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";

interface AppHeaderProps {
  onHistoryToggle?: () => void;
  isHistoryOpen?: boolean;
}

export function AppHeader({ onHistoryToggle, isHistoryOpen }: AppHeaderProps) {
  const { appUser, signOut } = useAppAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { label: "Chat", href: "/app/chat", icon: MessageSquare },
    { label: "Consultation", href: "/app/consultation", icon: ClipboardList },
  ];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 glass" role="banner" style={{ contain: "layout style" }}>
      <nav className="container mx-auto px-4 sm:px-6 h-14 md:h-16 flex items-center justify-between">
        {/* Mobile: back button + hamburger menu for history */}
        <div className="md:hidden flex items-center gap-1">
          {onHistoryToggle && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onHistoryToggle}
              className="h-9 w-9 rounded-full hover:bg-primary/5 hover:text-primary"
              title="Historique"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
        </div>

        {/* Desktop logo */}
        <div className="hidden md:flex items-center gap-6">
          <Logo />
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {appUser && (
            <span className="hidden sm:inline text-sm text-muted-foreground">
              {appUser.display_name || appUser.email}
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
