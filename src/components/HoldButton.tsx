"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Press and hold to commit. A deliberate, tactile step for an action that cannot be
 * taken lightly. Works with pointer, and with Space or Enter held down.
 */
export function HoldButton({
  label,
  holdLabel = "Keep holding…",
  holdMs = 1100,
  disabled,
  busy,
  onComplete,
}: {
  label: string;
  holdLabel?: string;
  holdMs?: number;
  disabled?: boolean;
  busy?: boolean;
  onComplete: () => void;
}) {
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const start = useRef(0);
  const done = useRef(false);

  const stop = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    start.current = 0;
    setProgress(0);
  }, []);

  const tick = useCallback(
    (t: number) => {
      if (!start.current) start.current = t;
      const p = Math.min(1, (t - start.current) / holdMs);
      setProgress(p);
      if (p >= 1) {
        raf.current = null;
        start.current = 0;
        if (!done.current) {
          done.current = true;
          onComplete();
        }
        setTimeout(() => {
          done.current = false;
          setProgress(0);
        }, 300);
        return;
      }
      raf.current = requestAnimationFrame(tick);
    },
    [holdMs, onComplete],
  );

  const begin = useCallback(() => {
    if (disabled || busy || raf.current || done.current) return;
    raf.current = requestAnimationFrame(tick);
  }, [disabled, busy, tick]);

  useEffect(() => () => stop(), [stop]);

  const holding = progress > 0 && progress < 1;
  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-describedby="hold-help"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        begin();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") stop();
      }}
      className="relative isolate min-w-[220px] select-none overflow-hidden rounded-lg border border-amber/60 bg-[#1a1407] px-5 py-3 font-display text-lg font-semibold uppercase tracking-[0.14em] text-amber transition enabled:hover:border-amber disabled:opacity-35"
      style={{ touchAction: "none" }}
    >
      <span className="absolute inset-y-0 left-0 -z-10 bg-amber" style={{ width: `${progress * 100}%`, transition: holding ? "none" : "width .2s" }} aria-hidden />
      <span className={progress > 0.5 ? "text-black" : ""}>{busy ? "Working…" : holding ? holdLabel : label}</span>
      <span id="hold-help" className="sr-only">
        Press and hold for about one second to confirm.
      </span>
    </button>
  );
}
