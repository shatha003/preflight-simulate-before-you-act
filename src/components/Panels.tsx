"use client";

import type { Simulation } from "@/lib/simulate";
import type { AuditEntry } from "@/lib/audit";
import { Button, Label, Tag } from "./ui";

export function Receipts({ sim }: { sim: Simulation }) {
  const { text, params } = sim.sql;
  const triggers = sim.report.sideEffects.filter((s) => s.via === "trigger" || s.via === "cascade");
  return (
    <div className="space-y-5">
      <div>
        <Label className="mb-1.5">The statement. This exact one runs again when you sign off.</Label>
        <pre className="overflow-x-auto rounded-2xl border-[2.5px] border-ink bg-ink p-4 font-mono text-[12px] leading-relaxed text-lime">{text.replace(/\n\s+/g, "\n  ")}</pre>
        <div className="mt-1.5 font-mono text-[11.5px] text-muted">
          params: <span className="text-ink">{JSON.stringify(params)}</span>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          ["Wrapped in", "BEGIN … ROLLBACK"],
          ["Took", `${sim.ms} ms`],
          ["Rows changed", String(sim.report.metrics.rowsTouched)],
          ["Effect digest", sim.digest],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border-2 border-ink bg-cream2 px-3 py-2">
            <dt className="eyebrow text-muted">{k}</dt>
            <dd className="break-all font-mono text-[12.5px] font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <Label className="mb-1.5">Fired by the database, not by the agent</Label>
        {triggers.length === 0 ? (
          <p className="text-muted">No triggers or cascades fired.</p>
        ) : (
          <ul className="space-y-1.5">
            {triggers.map((t) => (
              <li key={t.label} className="flex items-center justify-between gap-3 rounded-xl border-2 border-ink bg-white px-3 py-1.5">
                <span>{t.label}</span>
                <span className="flex items-center gap-3">
                  <Tag tone={t.via === "cascade" ? "red" : "blue"}>{t.via}</Tag>
                  <span className="font-mono font-bold tabular-nums">{t.count}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function RollbackPlan({ sim }: { sim: Simulation }) {
  return (
    <ol className="space-y-3">
      {sim.report.rollback.map((r, i) => (
        <li key={r.when} className="settle flex gap-3" style={{ animationDelay: `${i * 80}ms` }}>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-[2.5px] border-ink bg-sky font-mono text-[13px] font-bold">{i + 1}</span>
          <div>
            <div className="font-bold">
              {r.when} <span className={`chip ml-1 ${r.recoverable ? "bg-lime" : "bg-tomato"}`}>{r.recoverable ? "recoverable" : "partly irreversible"}</span>
            </div>
            <div className="text-muted">{r.note}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The flight log: every intent, run, decision and outcome, each hashed to the one before it. */
export function PressLog({ audit, ok, onExport }: { audit: AuditEntry[]; ok: boolean; onExport: () => void }) {
  const recent = [...audit].slice(-12).reverse();
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className={`chip ${ok ? "bg-lime" : "bg-tomato"}`}>{ok ? "✓ Hash chain verified" : "✕ Chain broken: an entry was altered"}</span>
        <Button variant="secondary" onClick={onExport} disabled={audit.length === 0}>
          ↓ Download log
        </Button>
      </div>
      {recent.length === 0 ? (
        <p className="text-muted">Nothing logged yet. Every intent, ghost run, decision and outcome is written here, each hashed to the entry before it, so history cannot be edited quietly.</p>
      ) : (
        <ol className="overflow-hidden rounded-2xl border-[2.5px] border-ink bg-ink font-mono text-[11.5px] text-cream">
          {recent.map((e) => {
            const hot = e.type.includes("guard") || e.type.includes("drift") || e.type.includes("trigger");
            return (
              <li key={e.seq} className="grid grid-cols-[2.4rem_8.5rem_minmax(0,1fr)_5rem] items-baseline gap-2 border-t border-white/10 px-3 py-1.5 first:border-t-0">
                <span className="text-cream/50">{String(e.seq).padStart(3, "0")}</span>
                <span className={`font-bold ${hot ? "text-tomato" : "text-lime"}`}>{e.type}</span>
                <span className="truncate text-cream/60">{JSON.stringify(e.data)}</span>
                <span className="text-right text-sun">{e.hash.slice(0, 8)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
