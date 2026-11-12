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
        <Label className="mb-1">The statement. This exact one runs again on sign-off.</Label>
        <pre className="overflow-x-auto border border-ink/50 bg-paper2 p-3 font-type text-[12.5px] leading-relaxed">{text.replace(/\n\s+/g, "\n  ")}</pre>
        <div className="mt-1.5 font-type text-[12.5px] text-muted">
          params: <span className="text-ink">{JSON.stringify(params)}</span>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {[
          ["Wrapped in", "BEGIN … ROLLBACK"],
          ["Took", `${sim.ms} ms`],
          ["Rows changed", String(sim.report.metrics.rowsTouched)],
          ["Effect digest", sim.digest],
        ].map(([k, v]) => (
          <div key={k} className="border-t border-rule pt-1">
            <dt className="text-[14px] italic text-muted">{k}</dt>
            <dd className="break-all font-type text-[13px]">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <Label className="mb-1">Fired by the database, not by the agent</Label>
        {triggers.length === 0 ? (
          <p className="italic text-muted">No triggers or cascades fired.</p>
        ) : (
          <ul className="border-y border-ink/60">
            {triggers.map((t) => (
              <li key={t.label} className="flex items-baseline justify-between gap-3 border-t border-rule px-1 py-1.5 first:border-t-0">
                <span>{t.label}</span>
                <span className="flex items-baseline gap-3">
                  <Tag tone={t.via === "cascade" ? "red" : "blue"}>{t.via}</Tag>
                  <span className="font-type tabular-nums">{t.count}</span>
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
        <li key={r.when} className="flex gap-3">
          <span className="font-type text-[13px] text-muted">{i + 1}.</span>
          <div>
            <div className="font-medium">
              {r.when} <span className={`font-normal italic ${r.recoverable ? "text-muted" : "text-red"}`}>{r.recoverable ? "can be recovered" : "partly irreversible"}</span>
            </div>
            <div className="text-muted">{r.note}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The press log: every intent, proof, decision and outcome, each hashed to the one before it. */
export function PressLog({ audit, ok, onExport }: { audit: AuditEntry[]; ok: boolean; onExport: () => void }) {
  const recent = [...audit].slice(-12).reverse();
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className={`italic ${ok ? "text-muted" : "font-semibold text-red"}`}>{ok ? "Hash chain verified: no entry has been altered." : "Chain broken: an entry was altered."}</span>
        <Button variant="secondary" onClick={onExport} disabled={audit.length === 0}>
          Download press log
        </Button>
      </div>
      {recent.length === 0 ? (
        <p className="italic text-muted">Nothing logged yet. Every intent, proof, decision and outcome is written here, each hashed to the entry before it, so history cannot be edited quietly.</p>
      ) : (
        <ol className="border-y border-ink/60 font-type text-[12.5px]">
          {recent.map((e) => (
            <li key={e.seq} className="grid grid-cols-[2.5rem_9rem_minmax(0,1fr)_6rem] items-baseline gap-2 border-t border-rule px-1 py-1 first:border-t-0">
              <span className="text-muted">{String(e.seq).padStart(3, "0")}</span>
              <span className={`font-bold ${e.type.includes("guard") || e.type.includes("drift") || e.type.includes("trigger") ? "text-red" : ""}`}>{e.type}</span>
              <span className="truncate text-muted">{JSON.stringify(e.data)}</span>
              <span className="text-right text-muted">{e.hash.slice(0, 8)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
