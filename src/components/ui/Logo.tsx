import { ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

interface LogoProps {
  variant?: "default" | "light";
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export function Logo({ variant = "default", size = "md", showText = true }: LogoProps) {
  const sizeConfig = {
    sm: { icon: "h-5 w-5", container: "h-7 w-7", text: "text-base" },
    md: { icon: "h-5 w-5", container: "h-9 w-9", text: "text-lg" },
    lg: { icon: "h-6 w-6", container: "h-11 w-11", text: "text-xl" },
  };

  const config = sizeConfig[size];

  return (
    <Link to="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity group">
      <div className={`${config.container} rounded-xl flex items-center justify-center transition-all duration-300 ${
        variant === "light" 
          ? "bg-white/20 group-hover:bg-white/30" 
          : "violet-gradient shadow-accent"
      }`}>
        <ShieldCheck className={`${config.icon} text-white`} strokeWidth={2.5} />
      </div>
      {showText && (
        <span className={`${config.text} font-bold tracking-tight font-display ${
          variant === "light" ? "text-white" : "text-foreground"
        }`}>
          Douane<span className="text-gradient-violet">AI</span>
        </span>
      )}
    </Link>
  );
}