import type { Check } from "@/lib/risk";

const ICON: Record<Check["status"], { glyph: string; cls: string; label: string }> = {
  pass: { glyph: "✓", cls: "border-green/50 bg-green/10 text-green", label: "Pass" },
  warn: { glyph: "!", cls: "border-amber/50 bg-amber/10 text-amber", label: "Warning" },
  fail: { glyph: "✕", cls: "border-red/50 bg-red/10 text-red", label: "Fail" },
  na: { glyph: "–", cls: "border-line2 text-dim", label: "Not applicable" },
};

/** The pre-flight checklist: every policy rule, evaluated on what actually changed. */
export function Checklist({ checks }: { checks: Check[] }) {
  return (
    <ul className="divide-y divide-line">
      {checks.map((c) => {
        const i = ICON[c.status];
        return (
          <li key={c.id} className={`flex items-start gap-3 py-2.5 ${c.status === "na" ? "opacity-50" : ""}`}>
            <span role="img" aria-label={i.label} className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold ${i.cls}`}>
              {i.glyph}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium leading-snug">{c.label}</div>
              <div className={`text-xs ${c.status === "fail" ? "text-red" : c.status === "warn" ? "text-amber" : "text-muted"}`}>{c.detail}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
