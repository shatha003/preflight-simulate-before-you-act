"use client";

import type { Simulation } from "@/lib/simulate";
import type { AuditEntry } from "@/lib/audit";
import { Chip, Button } from "./ui";

export function Receipts({ sim }: { sim: Simulation }) {
  const { text, params } = sim.sql;
  const triggers = sim.report.sideEffects.filter((s) => s.via === "trigger" || s.via === "cascade");
  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-dim">Statement (the same one that runs on approval)</div>
        <pre className="overflow-x-auto rounded-lg border border-line bg-bg/70 p-3 font-mono text-xs leading-relaxed text-ink">{text.replace(/\n\s+/g, "\n  ")}</pre>
        <div className="mt-1.5 font-mono text-xs text-muted">
          params: <span className="text-ink">{JSON.stringify(params)}</span>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Wrapped in", "BEGIN … ROLLBACK"],
          ["Duration", `${sim.ms} ms`],
          ["Rows changed", String(sim.report.metrics.rowsTouched)],
          ["Effect digest", sim.digest],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-bg/60 px-3 py-2">
            <dt className="font-mono text-[10px] uppercase tracking-wider text-dim">{k}</dt>
            <dd className="mt-0.5 break-all font-mono text-xs">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-dim">Fired by the database, not by the agent</div>
        {triggers.length === 0 ? (
          <p className="text-muted">No triggers or cascades fired.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {triggers.map((t) => (
              <li key={t.label} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>{t.label}</span>
                <span className="flex items-center gap-2">
                  <Chip tone={t.via === "cascade" ? "red" : "amber"}>{t.via}</Chip>
                  <span className="font-mono tabular-nums">{t.count}</span>
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
    <ul className="space-y-3">
      {sim.report.rollback.map((r) => (
        <li key={r.when} className="flex gap-3 text-sm">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.recoverable ? "bg-green" : "bg-amber"}`} aria-hidden />
          <div>
            <div className="font-medium">
              {r.when} <span className="font-normal text-muted">· {r.recoverable ? "recoverable" : "partly irreversible"}</span>
            </div>
            <div className="text-muted">{r.note}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

const DOT: Record<string, string> = {
  intent: "bg-cyan",
  simulated: "bg-cyan",
  tweaked: "bg-cyan",
  approved: "bg-amber",
  executed: "bg-green",
  undone: "bg-green",
  guard_tripped: "bg-red",
  drift_injected: "bg-red",
  trigger_shipped: "bg-red",
  rejected: "bg-muted",
  db_reset: "bg-muted",
};

export function BlackBox({ audit, ok, onExport }: { audit: AuditEntry[]; ok: boolean; onExport: () => void }) {
  const recent = [...audit].slice(-12).reverse();
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className={`font-mono text-xs ${ok ? "text-green" : "text-red"}`}>{ok ? "● hash chain verified" : "● chain broken"}</span>
        <Button variant="secondary" onClick={onExport} disabled={audit.length === 0}>
          Download flight record
        </Button>
      </div>
      {recent.length === 0 ? (
        <p className="text-sm text-muted">The black box records every intent, simulation, decision and outcome. Each entry is hashed to the one before it, so history cannot be edited quietly.</p>
      ) : (
        <ol className="relative space-y-0 border-l border-line2 pl-4">
          {recent.map((e) => (
            <li key={e.seq} className="relative pb-3 last:pb-0">
              <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-panel ${DOT[e.type] ?? "bg-muted"}`} aria-hidden />
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-xs">
                <span className="text-dim">#{e.seq}</span>
                <span className="font-semibold">{e.type}</span>
                <span className="ml-auto text-dim">{e.hash.slice(0, 10)}</span>
              </div>
              <div className="truncate font-mono text-[11px] text-muted">{JSON.stringify(e.data)}</div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
