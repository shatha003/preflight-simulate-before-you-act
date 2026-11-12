"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// A hand-drawn signature, revealed stroke by stroke while the button is held.
const SIGNATURE =
  "M6 40 C 14 8, 30 6, 26 30 C 24 44, 38 44, 46 24 C 52 10, 58 40, 70 30 C 78 24, 80 14, 92 22 C 104 30, 96 44, 112 34 C 126 24, 134 14, 146 26 C 152 34, 160 34, 172 20 M 10 49 C 60 44, 120 51, 210 43";

/**
 * Sign-off. Executing is a deliberate act, so you sign for it: press and hold, and the
 * signature writes itself. Let go early and it fades. Works with Space or Enter held too.
 */
export function SignOff({
  label,
  disabledLabel,
  holdMs = 1100,
  disabled,
  busy,
  onComplete,
}: {
  label: string;
  disabledLabel: string;
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
        }, 400);
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

  const off = disabled || busy;
  return (
    <button
      type="button"
      disabled={off}
      aria-describedby="sign-help"
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
      className="group block w-[190px] select-none sm:w-[250px] text-left disabled:opacity-45"
      style={{ touchAction: "none" }}
    >
      <svg viewBox="0 0 220 56" className="block h-10 w-full sm:h-14" aria-hidden fill="none" strokeLinecap="round" strokeLinejoin="round">
        <text x="2" y="14" fontSize="15" className="font-hand" fill="var(--red)" stroke="none">
          x
        </text>
        <path d={SIGNATURE} pathLength={1} stroke="var(--ink)" strokeWidth="1.6" opacity="0.14" />
        <path d={SIGNATURE} pathLength={1} stroke="var(--ink)" strokeWidth="2.4" strokeDasharray="1" strokeDashoffset={1 - progress} />
      </svg>
      <span className="mt-0.5 block border-t-2 border-ink pt-1 text-[15px] italic">{busy ? "Working…" : off ? disabledLabel : progress > 0 ? "Keep holding…" : label}</span>
      <span id="sign-help" className="sr-only">
        Press and hold for about one second to sign off and run the job.
      </span>
    </button>
  );
}
