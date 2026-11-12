"use client";

import { useEffect, useRef, useState } from "react";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Departure-board letters. Each tile spins through glyphs, then settles on its letter. */
export function Flap({ text, className = "" }: { text: string; className?: string }) {
  const [shown, setShown] = useState(text);
  const timers = useRef<ReturnType<typeof setInterval>[]>([]);

  useEffect(() => {
    timers.current.forEach(clearInterval);
    timers.current = [];
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(text);
      return;
    }
    const target = text.padEnd(Math.max(text.length, shown.length), " ").split("");
    const cur = target.map((_, i) => shown[i] ?? " ");
    target.forEach((ch, i) => {
      if (cur[i] === ch) return;
      let ticks = 0;
      const total = 6 + i * 2;
      const id = setInterval(() => {
        ticks++;
        cur[i] = ticks >= total ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        setShown(cur.join("").trimEnd());
        if (ticks >= total) clearInterval(id);
      }, 45);
      timers.current.push(id);
    });
    return () => timers.current.forEach(clearInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const chars = text.split("");
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`} role="img" aria-label={text}>
      {chars.map((_, i) => {
        const c = shown[i] ?? " ";
        return (
          <span
            key={i}
            aria-hidden
            className="relative flex h-[clamp(44px,7vw,64px)] w-[clamp(30px,5vw,44px)] items-center justify-center overflow-hidden rounded-[5px] border border-black/60 bg-gradient-to-b from-[#1a222c] to-[#0d1218] font-display text-[clamp(32px,5.6vw,50px)] font-bold leading-none shadow-inner"
          >
            {c === " " ? "" : c}
            <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-black/70" />
            <span className="pointer-events-none absolute inset-x-0 top-1/2 mt-px h-px bg-white/5" />
          </span>
        );
      })}
    </div>
  );
}
