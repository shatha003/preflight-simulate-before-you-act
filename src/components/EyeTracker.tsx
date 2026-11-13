"use client";

import { useEffect } from "react";

/**
 * Every creature on the page (the crowd and the mascots) watches the pointer.
 * One listener, one animation frame per move: read all positions, then write all.
 */
export function EyeTracker() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let mx = -1;
    let my = -1;
    const R = 1.9; // how far a pupil can travel, in svg units

    const frame = () => {
      raf = 0;
      const els = document.querySelectorAll<HTMLElement | SVGElement>("[data-look]");
      const rects = Array.from(els, (el) => el.getBoundingClientRect());
      els.forEach((el, i) => {
        const r = rects[i];
        if (mx < 0 || r.bottom < 0 || r.top > window.innerHeight) {
          el.style.setProperty("--px", "0px");
          el.style.setProperty("--py", "0px");
          return;
        }
        const dx = mx - (r.left + r.width / 2);
        const dy = my - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 90) * R;
        el.style.setProperty("--px", `${((dx / d) * k).toFixed(2)}px`);
        el.style.setProperty("--py", `${((dy / d) * k).toFixed(2)}px`);
      });
    };
    const move = (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const leave = () => {
      mx = my = -1;
      if (!raf) raf = requestAnimationFrame(frame);
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}
