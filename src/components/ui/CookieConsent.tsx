import { useState, useEffect } from "react";
import { Cookie, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const COOKIE_KEY = "douaneai_cookie_consent";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(COOKIE_KEY);
    if (!stored) {
      // Small delay so the banner slides in after page load
      const timer = setTimeout(() => setVisible(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(COOKIE_KEY, "accepted");
    setVisible(false);
  };

  const handleRefuse = () => {
    localStorage.setItem(COOKIE_KEY, "refused");
    setVisible(false);
  };

  const handleClose = () => {
    localStorage.setItem(COOKIE_KEY, "dismissed");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[100] flex justify-center px-4 pb-4 animate-slide-up">
      <div className="w-full max-w-2xl bg-card rounded-2xl border border-border/30 shadow-xl p-5 md:p-6 relative">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-start gap-3 md:gap-4">
          {/* Cookie icon */}
          <div className="shrink-0 h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center mt-0.5">
            <Cookie className="h-5 w-5 text-primary" />
          </div>

          <div className="flex-1 min-w-0 pr-4">
            <h3 className="text-sm font-semibold text-card-foreground mb-1">
              Nous respectons votre vie privée
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Nous utilisons des cookies essentiels pour le fonctionnement du site. Aucun cookie publicitaire n'est utilisé.{" "}
              <a
                href="#"
                className="underline underline-offset-2 hover:text-foreground transition-colors"
              >
                En savoir plus
              </a>
            </p>

            <div className="flex items-center gap-3 mt-4">
              <Button
                onClick={handleAccept}
                size="sm"
                className="cta-gradient rounded-full px-5 h-9 text-sm font-semibold"
              >
                Accepter
              </Button>
              <Button
                onClick={handleRefuse}
                variant="outline"
                size="sm"
                className="rounded-full px-5 h-9 text-sm font-semibold"
              >
                Refuser
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
