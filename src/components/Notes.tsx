import type { Check } from "@/lib/risk";

const MARK: Record<Check["status"], { glyph: string; cls: string; label: string }> = {
  pass: { glyph: "✓", cls: "text-ink", label: "Pass" },
  warn: { glyph: "?", cls: "text-blue", label: "Warning" },
  fail: { glyph: "✗", cls: "text-red", label: "Fail" },
  na: { glyph: "–", cls: "text-muted", label: "Not applicable" },
};

/** The proofreader's notes: every policy rule, ticked or crossed in the margin from what actually changed. */
export function Notes({ checks }: { checks: Check[] }) {
  return (
    <ul className="space-y-2.5">
      {checks.map((c) => {
        const m = MARK[c.status];
        return (
          <li key={c.id} className={`flex items-start gap-3 ${c.status === "na" ? "opacity-55" : ""}`}>
            <span role="img" aria-label={m.label} className={`hand w-5 shrink-0 text-center text-[28px] font-bold leading-[1.05] ${m.cls}`} style={{ color: undefined }}>
              {m.glyph}
            </span>
            <div className="min-w-0">
              <div className={`text-[16px] leading-snug ${c.status === "fail" ? "font-semibold" : ""}`}>{c.label}</div>
              {c.status === "fail" ? <div className="hand text-[20px]">{c.detail}</div> : <div className={`text-[14.5px] italic ${c.status === "warn" ? "text-blue" : "text-muted"}`}>{c.detail}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
