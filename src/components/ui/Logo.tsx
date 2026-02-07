import { Link } from "react-router-dom";

interface LogoProps {
  variant?: "default" | "light";
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export function Logo({ variant = "default", size = "md", showText = true }: LogoProps) {
  const sizeConfig = {
    sm: { text: "text-base" },
    md: { text: "text-xl" },
    lg: { text: "text-2xl" },
  };

  const config = sizeConfig[size];

  return (
    <Link to="/" className="flex items-center gap-2.5 group">
      <span className={`${config.text} font-bold tracking-tight ${
        variant === "light" ? "text-white" : "text-foreground"
      }`}>
        Douane<span className="gradient-text font-extrabold">AI</span>
      </span>
    </Link>
  );
}
