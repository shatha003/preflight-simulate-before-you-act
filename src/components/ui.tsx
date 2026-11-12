import type { ReactNode } from "react";
import type { Verdict, Severity } from "@/lib/risk";

export const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function Card({ title, aside, children, className = "" }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</h2>
          {aside}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

const verdictStyle: Record<Verdict, { label: string; cls: string }> = {
  safe: { label: "Safe to approve", cls: "bg-oksoft text-ok border-ok/30" },
  review: { label: "Needs your review", cls: "bg-warnsoft text-warn border-warn/30" },
  blocked: { label: "Blocked by policy", cls: "bg-badsoft text-bad border-bad/30" },
  noop: { label: "Nothing would change", cls: "bg-surface2 text-muted border-line" },
};

export function VerdictPill({ verdict, small }: { verdict: Verdict; small?: boolean }) {
  const s = verdictStyle[verdict];
  return (
    <span className={`inline-flex items-center rounded-full border font-medium ${small ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs"} ${s.cls}`}>
      {s.label}
    </span>
  );
}

export const sevStyle: Record<Severity, string> = {
  block: "border-bad/40 bg-badsoft",
  warn: "border-warn/40 bg-warnsoft",
  info: "border-line bg-surface2",
};

export function Button({
  children,
  onClick,
  disabled,
  variant = "secondary",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  title?: string;
}) {
  const base = "rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-40";
  const v = {
    primary: "bg-ink text-bg hover:opacity-90",
    secondary: "border border-line bg-surface hover:bg-surface2",
    danger: "border border-bad/40 text-bad hover:bg-badsoft",
    ghost: "text-muted hover:text-ink",
  }[variant];
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={`${base} ${v}`}>
      {children}
    </button>
  );
}
