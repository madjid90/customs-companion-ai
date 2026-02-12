import { useIsMobile } from "@/hooks/use-mobile";

interface GradientMeshBackgroundProps {
  variant?: "blue-green" | "green-blue" | "cyan-center";
  className?: string;
}

export function GradientMeshBackground({
  variant = "blue-green",
  className = "",
}: GradientMeshBackgroundProps) {
  const isMobile = useIsMobile();

  // On mobile, use smaller blobs with much less blur to avoid GPU stalls
  const blur = isMobile ? "blur-[40px]" : "blur-[100px]";
  const blurLg = isMobile ? "blur-[50px]" : "blur-[120px]";
  const blurSm = isMobile ? "blur-[30px]" : "blur-[80px]";

  const blobs = {
    "blue-green": (
      <>
        <div className={`absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-primary/[0.05] md:bg-primary/[0.10] ${blur}`} />
        <div className={`absolute -bottom-32 -right-32 w-[400px] h-[400px] rounded-full bg-secondary/[0.05] md:bg-secondary/[0.10] ${blur}`} />
      </>
    ),
    "green-blue": (
      <>
        <div className={`absolute -top-32 -right-32 w-[450px] h-[450px] rounded-full bg-secondary/[0.05] md:bg-secondary/[0.10] ${blur}`} />
        <div className={`absolute -bottom-32 -left-32 w-[400px] h-[400px] rounded-full bg-primary/[0.04] md:bg-primary/[0.08] ${blur}`} />
      </>
    ),
    "cyan-center": (
      <>
        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-primary/[0.04] md:bg-primary/[0.08] ${blurLg}`} />
        <div className={`absolute -top-20 -right-20 w-[300px] h-[300px] rounded-full bg-secondary/[0.04] md:bg-secondary/[0.08] ${blurSm}`} />
        <div className={`absolute -bottom-20 -left-20 w-[300px] h-[300px] rounded-full bg-primary/[0.03] md:bg-primary/[0.06] ${blurSm}`} />
      </>
    ),
  };

  return (
    <div
      className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
      style={{ contain: "layout paint" }}
      aria-hidden="true"
    >
      {blobs[variant]}
    </div>
  );
}
