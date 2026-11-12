"use client";

import { useMemo, useState, type CSSProperties } from "react";
import type { Seat, SeatKind } from "@/lib/field";

export type FieldMode = "reality" | "sim" | "committed";

const KEY: { kind: Exclude<SeatKind, "idle">; label: string }[] = [
  { kind: "delete", label: "Deleted" },
  { kind: "refund", label: "Refunded" },
  { kind: "email", label: "Emailed" },
];

/**
 * The customer ledger, typeset. The simulation is laid over it as proofreader's marks,
 * drawn down the page in order. Every mark is read from the simulated diff.
 */
export function Ledger({ seats, mode, onMode, hasSim }: { seats: Seat[]; mode: FieldMode; onMode: (m: FieldMode) => void; hasSim: boolean }) {
  const [hover, setHover] = useState<Seat | null>(null);
  const live = mode !== "reality";
  const people = useMemo(() => seats.filter((s) => !s.vacant), [seats]);

  const counts = useMemo(() => {
    const c = { delete: 0, refund: 0, email: 0, idle: 0, danger: 0 };
    for (const s of people) {
      c[live ? s.kind : "idle"]++;
      if (live && s.danger) c.danger++;
    }
    return c;
  }, [people, live]);

  const summary = live
    ? `Proof laid over the ledger. ${counts.delete} deleted, ${counts.refund} refunded, ${counts.email} emailed, ${counts.danger} circled as dangerous, out of ${people.length} customers.`
    : `Ledger as it stands. ${people.length} customers, none affected.`;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-rule pb-2">
        <div role="radiogroup" aria-label="View" className="flex gap-5 text-[16px]">
          {(
            [
              ["reality", "As it stands"],
              ["sim", mode === "committed" ? "As committed" : "Proof laid over it"],
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
                className={`pb-0.5 italic transition disabled:opacity-40 ${active ? "border-b-2 border-ink font-medium text-ink" : "border-b-2 border-transparent text-muted enabled:hover:text-ink"}`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* The key is made of the same marks as the ledger. */}
        <ul className="key flex flex-wrap items-center gap-x-5 gap-y-1 font-type text-[12.5px]" aria-label="Key">
          {KEY.map((k) => (
            <li key={k.kind} className={`ln mark-${k.kind}`} style={{ gap: "0.5em" }}>
              <span className="nm">{k.label}</span>
              <span>{counts[k.kind]}</span>
            </li>
          ))}
          <li className={`ln ${counts.danger > 0 ? "ringed" : ""}`} style={{ gap: "0.5em" }}>
            <span className="nm">Circled</span>
            <span>{counts.danger}</span>
          </li>
        </ul>
      </div>

      <div className="min-h-[2.4rem] pt-2 text-[16px]" aria-live="polite">
        {hover ? (
          <span>
            <span className="font-type text-[13px] text-muted">{String(hover.id).padStart(3, "0")}</span> <span className="font-medium">{hover.name}</span>{" "}
            <span className="text-muted">({hover.plan}).</span>{" "}
            {live && hover.notes.length ? <span className={hover.danger ? "hand text-[21px]" : ""}>{hover.notes.join(". ")}.</span> : <span className="italic text-muted">Not touched by this job.</span>}
          </span>
        ) : (
          <span className="italic text-muted">
            {hasSim ? "Point at any name to read its margin note." : "Give the press a job above. Every line here is a customer; the proof will mark exactly who it touches."}
          </span>
        )}
      </div>

      <ol role="img" aria-label={summary} className="ledger mt-1" onMouseLeave={() => setHover(null)}>
        {people.map((s, i) => {
          const k = live ? s.kind : "idle";
          return (
            <li
              key={s.id}
              onMouseEnter={() => setHover(s)}
              onPointerDown={() => setHover(s)}
              style={{ "--d": `${Math.min(i * 5, 1100)}ms` } as CSSProperties}
              className={`ln ${k !== "idle" ? `mark-${k}` : ""} ${live && s.danger ? "ringed" : ""}`}
            >
              <span className="id">{String(s.id).padStart(3, "0")}</span>
              <span className="nm">{s.name}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
