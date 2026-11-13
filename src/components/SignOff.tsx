"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Sign-off. Executing is a deliberate act, so it is not a click: press and hold, and the
 * button fills with lime. Let go early and it drains. Works with Space or Enter held too.
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
  const pressing = progress > 0 && progress < 1;
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
      className={`btn hold ${pressing ? "pressing" : ""} min-w-[190px] select-none bg-cream px-6 py-3 text-[17px] text-ink sm:min-w-[240px] sm:text-[19px]`}
      style={{ touchAction: "none" }}
    >
      <span className="fill" aria-hidden style={{ transform: `scaleX(${progress})` }} />
      <span aria-hidden className="inline-block transition-transform" style={{ transform: `rotate(${progress * 360}deg) scale(${1 + progress * 0.3})` }}>
        {progress >= 1 ? "✺" : "✦"}
      </span>
      <span>{busy ? "Working…" : off ? disabledLabel : progress >= 1 ? "Signed!" : progress > 0 ? "Keep holding…" : label}</span>
      <span id="sign-help" className="sr-only">
        Press and hold for about one second to sign off and run the job.
      </span>
    </button>
  );
}
