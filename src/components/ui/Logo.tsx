import { ShieldCheck } from "lucide-react";
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
    <Link to="/" className="flex items-center gap-2.5 group">
      <div className={`${config.container} rounded-xl flex items-center justify-center shadow-glow group-hover:scale-110 transition-transform ${
        variant === "light" 
          ? "bg-white/20 group-hover:bg-white/30" 
          : "bg-gradient-hero"
      }`}>
        <ShieldCheck className={`${config.icon} text-primary-foreground`} strokeWidth={2.5} />
      </div>
      {showText && (
        <span className={`${config.text} font-bold tracking-tight ${
          variant === "light" ? "text-white" : "text-foreground"
        }`}>
          Douane<span className="gradient-text font-extrabold">AI</span>
        </span>
      )}
    </Link>
  );
}
