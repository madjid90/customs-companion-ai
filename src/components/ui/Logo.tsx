import { ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

interface LogoProps {
  variant?: "default" | "light";
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export function Logo({ variant = "default", size = "md", showText = true }: LogoProps) {
  const sizeClasses = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-10 w-10",
  };

  const textSizeClasses = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-2xl",
  };

  const colorClasses = {
    default: "text-primary",
    light: "text-primary-foreground",
  };

  return (
    <Link to="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
      <div className={`${colorClasses[variant]} flex items-center justify-center`}>
        <ShieldCheck className={sizeClasses[size]} strokeWidth={2.5} />
      </div>
      {showText && (
        <span className={`${textSizeClasses[size]} font-bold tracking-tight ${colorClasses[variant]}`}>
          Douane<span className="text-accent">AI</span>
        </span>
      )}
    </Link>
  );
}
