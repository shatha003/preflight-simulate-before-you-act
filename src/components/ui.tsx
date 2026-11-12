import type { ReactNode } from "react";

export { usd } from "@/lib/format";

export function Button({
  children,
  onClick,
  disabled,
  variant = "secondary",
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  title?: string;
  className?: string;
}) {
  const base = "px-3.5 py-1.5 text-[15px] font-medium transition disabled:opacity-40";
  const v = {
    primary: "bg-ink text-paper enabled:hover:bg-[#3a352b]",
    secondary: "border border-ink text-ink enabled:hover:bg-ink enabled:hover:text-paper",
    danger: "border border-red text-red enabled:hover:bg-red enabled:hover:text-paper",
    ghost: "px-1 underline decoration-1 underline-offset-4 text-ink enabled:hover:text-blue",
  }[variant];
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`${base} ${v} ${className}`}>
      {children}
    </button>
  );
}

/** What a verdict is called on the shop floor. Rejected proofs are "killed". */
export const verdictMeta = {
  safe: { word: "APPROVED", color: "text-ink", sub: "Safe to run" },
  review: { word: "HOLD", color: "text-blue", sub: "Needs your sign-off" },
  blocked: { word: "KILLED", color: "text-red", sub: "Blocked by policy" },
  noop: { word: "NO CHANGE", color: "text-muted", sub: "Nothing would change" },
  printed: { word: "PRINTED", color: "text-ink", sub: "Run complete" },
  recalled: { word: "RECALLED", color: "text-blue", sub: "Everything restored" },
  stopped: { word: "STOPPED", color: "text-red", sub: "Guard rolled it back" },
  idle: { word: "NO PROOF YET", color: "text-muted", sub: "Give the press a job" },
} as const;

export function Tag({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "red" | "blue" }) {
  const c = tone === "red" ? "text-red" : tone === "blue" ? "text-blue" : "text-ink";
  return <span className={`tag ${c}`}>{children}</span>;
}

/** A small italic label. Sentence case: it names a thing, it doesn't shout. */
export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`text-[15px] italic text-muted ${className}`}>{children}</div>;
}

/** Crop marks, the L-shaped corner ticks printers trim to. Purely a print-room cue; they sit outside the sheet. */
export function CropMarks() {
  const m = "absolute h-4 w-4 border-ink/70";
  return (
    <div aria-hidden className="pointer-events-none hidden sm:block">
      <span className={`${m} -left-5 -top-5 border-b border-r`} style={{ transform: "translate(0,0)" }} />
      <span className={`${m} -right-5 -top-5 border-b border-l`} />
      <span className={`${m} -bottom-5 -left-5 border-r border-t`} />
      <span className={`${m} -bottom-5 -right-5 border-l border-t`} />
    </div>
  );
}

/** Registration target, the print shop's alignment mark. Used as the logo. */
export function Registration({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="15" cy="15" r="8" />
      <circle cx="15" cy="15" r="3" />
      <path d="M15 1v10M15 19v10M1 15h10M19 15h10" />
    </svg>
  );
}
