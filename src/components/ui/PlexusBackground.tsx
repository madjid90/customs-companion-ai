import { useEffect, useRef } from "react";

interface PlexusBackgroundProps {
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export function PlexusBackground({ className = "" }: PlexusBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let isMobile = false;
    let PARTICLE_COUNT = 60;
    let MAX_DIST = 150;
    let started = false;
    let isVisible = true;
    let lastFrameTime = 0;

    // 30fps desktop, 20fps mobile
    const getFrameInterval = () => (isMobile ? 66 : 33); // ms — 15fps mobile, 30fps desktop

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      width = parent.clientWidth;
      height = parent.clientHeight;
      // On mobile, use half-resolution canvas for much better GPU perf
      const dpr = isMobile ? 0.5 : Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);
      isMobile = width < 768;
      PARTICLE_COUNT = isMobile ? 12 : 45;
      MAX_DIST = isMobile ? 100 : 150;
      initParticles();
    };

    const initParticles = () => {
      particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        radius: Math.random() * 1.5 + 0.5,
      }));
    };

    const draw = (timestamp: number) => {
      if (!isVisible) {
        animationRef.current = requestAnimationFrame(draw);
        return;
      }

      const elapsed = timestamp - lastFrameTime;
      if (elapsed < getFrameInterval()) {
        animationRef.current = requestAnimationFrame(draw);
        return;
      }
      lastFrameTime = timestamp;

      ctx.clearRect(0, 0, width, height);
      const particles = particlesRef.current;

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MAX_DIST) {
            const opacity = (1 - dist / MAX_DIST) * (isMobile ? 0.15 : 0.35);
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(76, 139, 245, ${opacity})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = isMobile ? "rgba(76, 139, 245, 0.20)" : "rgba(76, 139, 245, 0.40)";
        ctx.fill();
      }

      animationRef.current = requestAnimationFrame(draw);
    };

    const start = () => {
      if (started) return;
      started = true;
      resize();
      animationRef.current = requestAnimationFrame(draw);
    };

    // Pause when tab is hidden
    const handleVisibility = () => {
      isVisible = !document.hidden;
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // Pause when canvas is off-screen
    const io = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting && !document.hidden;
      },
      { threshold: 0.1 }
    );
    io.observe(canvas);

    // Defer canvas animation to after first paint
    if ("requestIdleCallback" in window) {
      (window as any).requestIdleCallback(start, { timeout: 2000 });
    } else {
      setTimeout(start, 100);
    }

    const ro = new ResizeObserver(() => {
      if (started) resize();
    });
    ro.observe(canvas.parentElement!);

    return () => {
      cancelAnimationFrame(animationRef.current);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{ contain: "layout paint size" }}
      aria-hidden="true"
    />
  );
}
