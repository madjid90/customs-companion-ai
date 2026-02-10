interface GradientMeshBackgroundProps {
  variant?: "blue-green" | "green-blue" | "cyan-center";
  className?: string;
}

export function GradientMeshBackground({
  variant = "blue-green",
  className = "",
}: GradientMeshBackgroundProps) {
  const blobs = {
    "blue-green": (
      <>
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-primary/[0.05] md:bg-primary/[0.10] blur-[100px]" />
        <div className="absolute -bottom-32 -right-32 w-[400px] h-[400px] rounded-full bg-secondary/[0.05] md:bg-secondary/[0.10] blur-[100px]" />
      </>
    ),
    "green-blue": (
      <>
        <div className="absolute -top-32 -right-32 w-[450px] h-[450px] rounded-full bg-secondary/[0.05] md:bg-secondary/[0.10] blur-[100px]" />
        <div className="absolute -bottom-32 -left-32 w-[400px] h-[400px] rounded-full bg-primary/[0.04] md:bg-primary/[0.08] blur-[100px]" />
      </>
    ),
    "cyan-center": (
      <>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-primary/[0.04] md:bg-primary/[0.08] blur-[120px]" />
        <div className="absolute -top-20 -right-20 w-[300px] h-[300px] rounded-full bg-secondary/[0.04] md:bg-secondary/[0.08] blur-[80px]" />
        <div className="absolute -bottom-20 -left-20 w-[300px] h-[300px] rounded-full bg-primary/[0.03] md:bg-primary/[0.06] blur-[80px]" />
      </>
    ),
  };

  return (
    <div
      className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
      aria-hidden="true"
    >
      {blobs[variant]}
    </div>
  );
}
