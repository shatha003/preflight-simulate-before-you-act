"use client";

import { useMemo, useState } from "react";
import type { Seat, SeatKind } from "@/lib/field";

export type FieldMode = "reality" | "sim" | "committed";

const KIND: Record<SeatKind, { label: string; cls: string }> = {
  idle: { label: "Unaffected", cls: "bg-line2/70" },
  email: { label: "Emailed", cls: "bg-cyan" },
  refund: { label: "Refunded", cls: "bg-amber" },
  delete: { label: "Deleted", cls: "bg-red" },
};

/**
 * The manifest. One square per customer. Switching to the simulation lights up
 * exactly who the action would hit, wave by wave, read from the simulated diff.
 */
export function Field({ seats, mode, onMode, hasSim }: { seats: Seat[]; mode: FieldMode; onMode: (m: FieldMode) => void; hasSim: boolean }) {
  const [hover, setHover] = useState<Seat | null>(null);
  const live = mode !== "reality";

  const counts = useMemo(() => {
    const c: Record<SeatKind, number> = { idle: 0, email: 0, refund: 0, delete: 0 };
    let danger = 0;
    let vacant = 0;
    for (const s of seats) {
      if (s.vacant) vacant++;
      else {
        c[live ? s.kind : "idle"]++;
        if (live && s.danger) danger++;
      }
    }
    return { c, danger, vacant };
  }, [seats, live]);

  const summary = live
    ? `Simulation. ${counts.c.delete} deleted, ${counts.c.refund} refunded, ${counts.c.email} emailed, ${counts.danger} flagged dangerous, out of ${seats.length - counts.vacant} customers.`
    : `Reality. ${seats.length - counts.vacant} customers, none affected.`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="View" className="inline-flex overflow-hidden rounded-lg border border-line2 text-sm">
          {(
            [
              ["reality", "Reality"],
              ["sim", mode === "committed" ? "Committed" : "Simulation"],
            ] as const
          ).map(([m, label]) => {
            const active = (m === "reality") === (mode === "reality");
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={m === "sim" && !hasSim}
                onClick={() => onMode(m === "sim" ? (mode === "committed" ? "committed" : "sim") : "reality")}
                className={`px-4 py-1.5 font-display text-[15px] font-semibold uppercase tracking-[0.12em] transition disabled:opacity-35 ${active ? (m === "sim" ? "bg-amber text-black" : "bg-panel2 text-ink") : "text-muted hover:text-ink"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-muted" aria-label="Legend">
          {(Object.keys(KIND) as SeatKind[]).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className={`inline-block h-2.5 w-2.5 rounded-[3px] ${KIND[k].cls}`} aria-hidden />
              {KIND[k].label} <span className="text-ink">{counts.c[k]}</span>
            </li>
          ))}
          {live && counts.danger > 0 && (
            <li className="flex items-center gap-1.5 text-red">
              <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-transparent ring-2 ring-red" aria-hidden />
              Flagged <span>{counts.danger}</span>
            </li>
          )}
        </ul>
      </div>

      <div
        role="img"
        aria-label={summary}
        className="grid gap-[5px]"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(17px, 1fr))" }}
        onMouseLeave={() => setHover(null)}
      >
        {seats.map((s, i) => {
          const k = live ? s.kind : "idle";
          return (
            <span
              key={s.id}
              onMouseEnter={() => setHover(s)}
              onPointerDown={() => setHover(s)}
              style={{ transitionDelay: `${Math.min(i * 3, 700)}ms` }}
              className={`aspect-square rounded-[4px] transition-[background-color,transform,box-shadow] duration-300 ${
                s.vacant ? "border border-dashed border-line2/80 bg-transparent" : `${KIND[k].cls} ${k !== "idle" ? "scale-110" : ""}`
              } ${live && s.danger ? "seat-danger ring-2 ring-red" : ""} ${hover?.id === s.id ? "outline outline-2 outline-ink" : ""}`}
            />
          );
        })}
      </div>

      <div className="mt-3 min-h-[3.25rem] rounded-lg border border-line bg-bg/60 px-3 py-2 text-sm" aria-live="polite">
        {hover ? (
          hover.vacant ? (
            <span className="text-muted">
              <span className="font-mono text-dim">#{hover.id}</span> · vacant seat. This customer no longer exists.
            </span>
          ) : (
            <div>
              <div>
                <span className="font-mono text-dim">#{hover.id}</span> <span className="font-medium">{hover.name}</span>{" "}
                <span className="text-muted">· {hover.plan} plan</span>
              </div>
              <div className={live && hover.notes.length ? (hover.danger ? "text-red" : "text-ink") : "text-muted"}>
                {live && hover.notes.length ? hover.notes.join(" · ") : "Not affected by this action."}
              </div>
            </div>
          )
        ) : (
          <span className="text-muted">
            {hasSim ? "Hover a square to see exactly what happens to that customer." : "Pick a flight plan above. Each square is a customer, and the simulation will light up who it hits."}
          </span>
        )}
      </div>
    </div>
  );
}
