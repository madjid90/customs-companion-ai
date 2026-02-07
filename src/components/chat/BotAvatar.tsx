import { cn } from "@/lib/utils";

interface BotAvatarProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function BotAvatar({ size = "sm", className }: BotAvatarProps) {
  const sizeClasses = {
    sm: "w-7 h-7 md:w-8 md:h-8",
    md: "w-10 h-10 md:w-12 md:h-12",
    lg: "w-20 h-20 md:w-24 md:h-24",
  };

  const iconSizes = {
    sm: "h-7 w-7 md:h-8 md:w-8",
    md: "h-10 w-10 md:h-12 md:w-12",
    lg: "h-12 w-12 md:h-14 md:w-14",
  };

  return (
    <div
      className={cn(
        "flex-shrink-0 flex items-center justify-center",
        sizeClasses[size],
        className
      )}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        className={iconSizes[size]}
      >
        <defs>
          <linearGradient id={`bot-grad-${size}`} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="hsl(217, 91%, 55%)" />
            <stop offset="50%" stopColor="hsl(180, 70%, 45%)" />
            <stop offset="100%" stopColor="hsl(145, 65%, 50%)" />
          </linearGradient>
        </defs>
        <path d="M12 8V4H8" stroke={`url(#bot-grad-${size})`} />
        <rect width="16" height="12" x="4" y="8" rx="2" stroke={`url(#bot-grad-${size})`} />
        <path d="M2 14h2" stroke={`url(#bot-grad-${size})`} />
        <path d="M20 14h2" stroke={`url(#bot-grad-${size})`} />
        <path d="M15 13v2" stroke={`url(#bot-grad-${size})`} />
        <path d="M9 13v2" stroke={`url(#bot-grad-${size})`} />
      </svg>
    </div>
  );
}
