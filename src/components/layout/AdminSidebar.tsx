import { Link, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  Upload,
  Package,
  FileText,
  LogOut,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Inbox,
  LucideIcon,
} from "lucide-react";
import { useState } from "react";

type MenuItem = 
  | { type: "link"; icon: LucideIcon; label: string; href: string }
  | { type: "separator" };

const menuItems: MenuItem[] = [
  { type: "link", icon: Inbox, label: "Demandes d'accès", href: "/admin/access-requests" },
  { type: "separator" },
  { type: "link", icon: Upload, label: "Upload fichiers", href: "/admin/upload" },
  { type: "separator" },
  { type: "link", icon: Package, label: "Codes SH", href: "/admin/hs-codes" },
  { type: "link", icon: FileText, label: "Documents", href: "/admin/documents" },
  { type: "separator" },
  { type: "link", icon: MessageSquare, label: "Chat public", href: "/app/chat" },
];

export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = async () => {
    await signOut();
    navigate("/admin/login");
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-screen glass-sidebar flex flex-col transition-all duration-300 z-40",
        collapsed ? "w-16" : "w-64"
      )}
    >
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-border/20">
        {!collapsed && <Logo size="md" />}
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground hover:bg-primary/5 ml-auto rounded-xl"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-4">
        <nav className="px-2 space-y-1">
          {menuItems.map((item, index) => {
            if (item.type === "separator") {
              return (
                <div
                  key={`sep-${index}`}
                  className="h-px bg-border/30 my-4"
                />
              );
            }

            const Icon = item.icon;
            const isActive = location.pathname === item.href;

            return (
              <Link
                key={item.href}
                to={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-primary/8 text-primary shadow-sm"
                    : "text-muted-foreground hover:bg-primary/5 hover:text-foreground"
                )}
              >
                <Icon className={cn("h-5 w-5 flex-shrink-0", isActive && "text-primary")} />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="p-2 border-t border-border/20">
        <Button
          variant="ghost"
          className={cn(
            "w-full justify-start text-muted-foreground hover:bg-destructive/5 hover:text-destructive rounded-xl",
            collapsed && "justify-center px-0"
          )}
          onClick={handleLogout}
        >
          <LogOut className="h-5 w-5" />
          {!collapsed && <span className="ml-3">Déconnexion</span>}
        </Button>
      </div>
    </aside>
  );
}
