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
  variant?: "primary" | "secondary" | "danger" | "ghost" | "sun";
  title?: string;
  className?: string;
}) {
  if (variant === "ghost") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={`px-1 text-[15px] font-semibold underline decoration-2 underline-offset-4 transition enabled:hover:-rotate-2 enabled:hover:decoration-wavy disabled:opacity-40 ${className}`}
      >
        {children}
      </button>
    );
  }
  const v = {
    primary: "bg-ink text-cream",
    secondary: "bg-cream text-ink enabled:hover:bg-lime",
    danger: "bg-tomato text-ink",
    sun: "bg-sun text-ink",
  }[variant];
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`btn px-4 py-1.5 text-[15px] ${v} ${className}`}>
      {children}
    </button>
  );
}

/** What each verdict is called, and the one accent it wears. */
export const verdictMeta = {
  safe: { word: "APPROVED", bg: "bg-lime", sub: "Safe to run" },
  review: { word: "HOLD", bg: "bg-sun", sub: "Needs your sign-off" },
  blocked: { word: "KILLED", bg: "bg-tomato", sub: "Blocked by policy" },
  noop: { word: "NO CHANGE", bg: "bg-cream2", sub: "Nothing would change" },
  printed: { word: "SHIPPED", bg: "bg-lime", sub: "Run complete" },
  recalled: { word: "RECALLED", bg: "bg-sky", sub: "Everything restored" },
  stopped: { word: "STOPPED", bg: "bg-tomato", sub: "Guard rolled it back" },
  idle: { word: "NO RUN YET", bg: "bg-transparent", sub: "Give the agent a job" },
} as const;

export function VerdictChip({ v, className = "" }: { v: keyof typeof verdictMeta; className?: string }) {
  const m = verdictMeta[v];
  return <span className={`chip ${m.bg} ${className}`}>{m.word}</span>;
}

export function Tag({ children, tone = "ink" }: { children: ReactNode; tone?: "ink" | "red" | "blue" }) {
  const c = tone === "red" ? "bg-tomato" : tone === "blue" ? "bg-sky" : "bg-cream2";
  return <span className={`chip ${c}`}>{children}</span>;
}

/** A small label. Sentence case: it names a thing, it doesn't shout. */
export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`text-[14.5px] text-muted ${className}`}>{children}</div>;
}

/**
 * The mascot: one of the crowd, promoted to logo. Its eyes follow the cursor through
 * the same --px/--py props the crowd uses.
 */
export function Mascot({ size = 64, className = "", ghost = false }: { size?: number; className?: string; ghost?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden data-look className={`mascot overflow-visible ${className}`} style={{ ["--r" as string]: 0.35 }}>
      <g className="bob" style={{ transformBox: "fill-box", transformOrigin: "50% 100%", animation: "bob 2.6s ease-in-out infinite" }}>
        {ghost ? (
          <path d={GHOST_PATH} fill="var(--ghost)" stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
        ) : (
          <path d={BLOB_PATH} fill="var(--sun)" stroke="var(--ink)" strokeWidth="2.2" />
        )}
        <Eyes />
        <path d="M16 27 Q20 31 24 27" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export const BLOB_PATH = "M20 6 C30 6 35 12 35 22 C35 31 29 36 20 36 C11 36 5 31 5 22 C5 12 10 6 20 6 Z";
export const GHOST_PATH = "M7 21 C7 11 12.5 5.5 20 5.5 C27.5 5.5 33 11 33 21 L33 36 L28.7 32.5 L24.3 36 L20 32.5 L15.7 36 L11.3 32.5 L7 36 Z";

/** Two eyes: whites, pupils and lids. Pupils are the part that moves. */
export function Eyes() {
  return (
    <g className="lids">
      <circle cx="15" cy="19" r="4.2" fill="#fff" stroke="var(--ink)" strokeWidth="1.6" />
      <circle cx="25" cy="19" r="4.2" fill="#fff" stroke="var(--ink)" strokeWidth="1.6" />
      <g className="pupils">
        <circle cx="15" cy="19" r="2.1" fill="var(--ink)" />
        <circle cx="25" cy="19" r="2.1" fill="var(--ink)" />
      </g>
    </g>
  );
}
