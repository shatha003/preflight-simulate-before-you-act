import type { Check } from "@/lib/risk";

const MARK: Record<Check["status"], { glyph: string; bg: string; label: string }> = {
  pass: { glyph: "✓", bg: "bg-lime", label: "Pass" },
  warn: { glyph: "?", bg: "bg-sun", label: "Warning" },
  fail: { glyph: "✕", bg: "bg-tomato", label: "Fail" },
  na: { glyph: "–", bg: "bg-cream2", label: "Not applicable" },
};

/** Every policy rule, passed or failed from what actually changed in the ghost run. */
export function Notes({ checks }: { checks: Check[] }) {
  return (
    <ul className="space-y-3">
      {checks.map((c, i) => {
        const m = MARK[c.status];
        return (
          <li key={c.id} className={`settle flex items-start gap-3 ${c.status === "na" ? "opacity-50" : ""}`} style={{ animationDelay: `${i * 70}ms` }}>
            <span role="img" aria-label={m.label} className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border-[2.5px] border-ink text-[15px] font-black leading-none ${m.bg} ${c.status === "fail" ? "-rotate-12" : ""}`}>
              {m.glyph}
            </span>
            <div className="min-w-0">
              <div className={`text-[15.5px] leading-snug ${c.status === "fail" ? "font-extrabold" : "font-semibold"}`}>{c.label}</div>
              <div className={`text-[14px] leading-snug ${c.status === "fail" ? "font-semibold text-[#c8260b]" : "text-muted"}`}>{c.detail}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
