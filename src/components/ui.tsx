import type { ReactNode } from "react";

export { usd } from "@/lib/format";

/** A panel with a small engraved label, like an instrument cluster. */
export function Panel({
  label,
  aside,
  children,
  className = "",
  tone,
}: {
  label?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: "red" | "green" | "amber";
}) {
  const edge = tone === "red" ? "border-red/50" : tone === "green" ? "border-green/50" : tone === "amber" ? "border-amber/50" : "border-line";
  return (
    <section className={`rounded-xl border ${edge} bg-panel/90 backdrop-blur-sm ${className}`}>
      {label && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-2">
          <h2 className="font-display text-[13px] font-semibold uppercase tracking-[0.16em] text-muted">{label}</h2>
          {aside}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

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
  const base = "rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-35";
  const v = {
    primary: "bg-amber text-black hover:brightness-110",
    secondary: "border border-line2 bg-panel2 text-ink hover:border-muted",
    danger: "border border-red/50 text-red hover:bg-red/10",
    ghost: "text-muted hover:text-ink",
  }[variant];
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`${base} ${v} ${className}`}>
      {children}
    </button>
  );
}

export const verdictMeta = {
  safe: { word: "CLEARED", color: "text-green", ring: "border-green/50", glow: "shadow-[0_0_40px_-12px_var(--green)]", sub: "Safe to approve" },
  review: { word: "HOLD", color: "text-amber", ring: "border-amber/50", glow: "shadow-[0_0_40px_-12px_var(--amber)]", sub: "Needs your call" },
  blocked: { word: "DENIED", color: "text-red", ring: "border-red/50", glow: "shadow-[0_0_40px_-12px_var(--red)]", sub: "Blocked by policy" },
  noop: { word: "NO CHANGE", color: "text-muted", ring: "border-line2", glow: "", sub: "Nothing would change" },
  idle: { word: "STANDBY", color: "text-dim", ring: "border-line2", glow: "", sub: "Choose a flight plan" },
} as const;

export function Chip({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "green" | "amber" | "red" | "cyan" }) {
  const t = {
    muted: "border-line2 text-muted",
    green: "border-green/40 text-green bg-green/10",
    amber: "border-amber/40 text-amber bg-amber/10",
    red: "border-red/40 text-red bg-red/10",
    cyan: "border-cyan/40 text-cyan bg-cyan/10",
  }[tone];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[11px] ${t}`}>{children}</span>;
}
