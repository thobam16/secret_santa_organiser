import { useEffect, useRef } from "react";

interface Flake {
  x: number;
  y: number;
  radius: number;
  speed: number;
  phase: number;
  opacity: number;
}

/** Decorative only. The canvas never participates in focus or pointer handling. */
export function Snow({ enabled }: { enabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !enabled) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const logo = new Image();
    logo.src = `${import.meta.env.BASE_URL}arm-logo.svg`;
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastTime = 0;
    let elapsed = 0;
    let logoDelay = 40 + Math.random() * 40;
    let fallingLogo: { x: number; y: number } | null = null;
    let flakes: Flake[] = [];

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = Math.min(58, Math.max(18, Math.round(width / 26)));
      flakes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 1 + Math.random() * 2,
        speed: 12 + Math.random() * 20,
        phase: Math.random() * Math.PI * 2,
        opacity: 0.15 + Math.random() * 0.2,
      }));
    };

    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (lastTime && time - lastTime < 1000 / 30) return;
      const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.08) : 0;
      lastTime = time;
      elapsed += delta;
      context.clearRect(0, 0, width, height);

      for (const flake of flakes) {
        flake.y += flake.speed * delta;
        flake.x += Math.sin(elapsed * 0.5 + flake.phase) * 6 * delta;
        if (flake.y > height + 5) {
          flake.y = -5;
          flake.x = Math.random() * width;
        }
        if (flake.x > width + 5) flake.x = -5;
        if (flake.x < -5) flake.x = width + 5;
        context.globalAlpha = flake.opacity;
        context.fillStyle = "#7d9b8c";
        context.beginPath();
        context.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#ffffff";
        context.beginPath();
        context.arc(
          flake.x - 0.35,
          flake.y - 0.35,
          flake.radius * 0.72,
          0,
          Math.PI * 2,
        );
        context.fill();
      }

      logoDelay -= delta;
      if (
        !fallingLogo &&
        logoDelay <= 0 &&
        logo.complete &&
        logo.naturalWidth
      ) {
        fallingLogo = {
          x: 24 + Math.random() * Math.max(1, width - 100),
          y: -25,
        };
      }
      if (fallingLogo) {
        fallingLogo.y += delta * 29;
        // Preserve the official artwork's proportions and horizontal orientation.
        context.globalAlpha = 0.2;
        context.drawImage(
          logo,
          fallingLogo.x,
          fallingLogo.y,
          52,
          (52 * logo.naturalHeight) / logo.naturalWidth,
        );
        if (fallingLogo.y > height + 30) {
          fallingLogo = null;
          logoDelay = 65 + Math.random() * 75;
        }
      }
      context.globalAlpha = 1;
    };

    const updatePlayback = () => {
      cancelAnimationFrame(frame);
      lastTime = 0;
      if (!document.hidden && !reducedMotion.matches)
        frame = requestAnimationFrame(tick);
      else context.clearRect(0, 0, width, height);
    };

    resize();
    updatePlayback();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", updatePlayback);
    reducedMotion.addEventListener("change", updatePlayback);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", updatePlayback);
      reducedMotion.removeEventListener("change", updatePlayback);
      context.clearRect(0, 0, width, height);
    };
  }, [enabled]);

  return (
    <canvas
      ref={canvasRef}
      className="snow-canvas"
      aria-hidden="true"
      hidden={!enabled}
    />
  );
}

export default Snow;
