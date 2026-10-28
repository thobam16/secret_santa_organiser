import { useEffect, useRef } from "react";

interface Flake {
  x: number;
  y: number;
  radius: number;
  speed: number;
  phase: number;
  opacity: number;
  crystal: boolean;
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
    const sleigh = new Image();
    sleigh.src = `${import.meta.env.BASE_URL}sleigh.svg`;
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastTime = 0;
    let elapsed = 0;
    let logoDelay = 40 + Math.random() * 40;
    let fallingLogo: { x: number; y: number } | null = null;
    let sleighDelay = 8 + Math.random() * 6;
    let flight: { progress: number; duration: number } | null = null;
    let flightY = 140;
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
      flightY = Math.min(
        (document.querySelector(".site-header")?.getBoundingClientRect()
          .bottom || 120) + 12,
        height * 0.32,
      );
      const count = Math.min(
        150,
        Math.max(42, Math.round((width * height) / 10500)),
      );
      flakes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 1.5 + Math.random() * 3,
        speed: 18 + Math.random() * 28,
        phase: Math.random() * Math.PI * 2,
        opacity: 0.55 + Math.random() * 0.4,
        crystal: Math.random() > 0.86,
      }));
    };

    const tick = (time: number) => {
      frame = requestAnimationFrame(tick);
      if (lastTime && time - lastTime < 1000 / 30) return;
      const delta = lastTime ? Math.min((time - lastTime) / 1000, 0.08) : 0;
      lastTime = time;
      elapsed += delta;
      context.clearRect(0, 0, width, height);

      sleighDelay -= delta;
      if (
        !flight &&
        sleighDelay <= 0 &&
        sleigh.complete &&
        sleigh.naturalWidth
      ) {
        flight = { progress: 0, duration: 18 + Math.random() * 4 };
      }
      if (flight) {
        flight.progress += delta / flight.duration;
        const size = Math.min(420, Math.max(240, width * 0.29));
        const x = -size - 90 + flight.progress * (width + size + 180);
        const y = flightY + Math.sin(flight.progress * Math.PI * 2) * 16;
        // Small warm sparkles trail the sleigh without covering the interface.
        for (let i = 0; i < 11; i++) {
          const sparkleX = x - i * 12;
          const sparkleY = y + size * 0.23 + Math.sin(elapsed * 1.5 + i) * 8;
          context.globalAlpha = (1 - i / 11) * 0.65;
          context.fillStyle = i % 3 === 0 ? "#fff9dc" : "#efc46b";
          context.beginPath();
          context.arc(
            sparkleX,
            sparkleY,
            i % 3 === 0 ? 2.1 : 1.3,
            0,
            Math.PI * 2,
          );
          context.fill();
        }
        context.globalAlpha = 1;
        context.drawImage(
          sleigh,
          x,
          y,
          size,
          (size * sleigh.naturalHeight) / sleigh.naturalWidth,
        );
        if (flight.progress >= 1) {
          flight = null;
          sleighDelay = 60 + Math.random() * 50;
        }
      }

      for (const flake of flakes) {
        flake.y += flake.speed * delta;
        flake.x += Math.sin(elapsed * 0.5 + flake.phase) * 6 * delta;
        if (flake.y > height + 5) {
          flake.y = -5;
          flake.x = Math.random() * width;
        }
        if (flake.x > width + 5) flake.x = -5;
        if (flake.x < -5) flake.x = width + 5;
        context.globalAlpha = flake.opacity * 0.16;
        context.fillStyle = "#c5e9f2";
        context.beginPath();
        context.arc(flake.x, flake.y, flake.radius * 1.8, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = flake.opacity;
        context.fillStyle = "#ffffff";
        if (flake.crystal) {
          context.strokeStyle = "#ffffff";
          context.lineWidth = 1.3;
          context.beginPath();
          for (let arm = 0; arm < 6; arm++) {
            const angle = (arm * Math.PI) / 3 + flake.phase;
            context.moveTo(flake.x, flake.y);
            context.lineTo(
              flake.x + Math.cos(angle) * flake.radius * 1.6,
              flake.y + Math.sin(angle) * flake.radius * 1.6,
            );
          }
          context.stroke();
        } else {
          context.beginPath();
          context.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
          context.fill();
        }
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
        context.globalAlpha = 0.65;
        context.filter = "brightness(0) invert(1)";
        context.drawImage(
          logo,
          fallingLogo.x,
          fallingLogo.y,
          52,
          (52 * logo.naturalHeight) / logo.naturalWidth,
        );
        context.filter = "none";
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
