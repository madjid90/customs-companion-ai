import { Zap } from "lucide-react";
import { Link } from "react-router-dom";

interface LogoProps {
  variant?: "default" | "light";
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export function Logo({ variant = "default", size = "md", showText = true }: LogoProps) {
  const sizeConfig = {
    sm: { icon: "h-4 w-4", container: "h-8 w-8", text: "text-base" },
    md: { icon: "h-5 w-5", container: "h-10 w-10", text: "text-xl" },
    lg: { icon: "h-6 w-6", container: "h-12 w-12", text: "text-2xl" },
  };

  const config = sizeConfig[size];

  return (
    <Link to="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity group">
      <div
        className={`${config.container} rounded-xl flex items-center justify-center transition-all duration-300 shadow-md ${
          variant === "light"
            ? "bg-white/20 group-hover:bg-white/30"
            : ""
        }`}
        style={
          variant !== "light"
            ? { background: "var(--gradient-hero)" }
            : undefined
        }
      >
        <Zap className={`${config.icon} text-white`} strokeWidth={2.5} fill="white" />
      </div>
      {showText && (
        <span
          className={`${config.text} font-extrabold tracking-tight font-display ${
            variant === "light" ? "text-white" : "text-foreground"
          }`}
        >
          Douane<span className="text-gradient-blue">AI</span>
        </span>
      )}
    </Link>
  );
}
