"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { Seat } from "@/lib/field";
import { BLOB_PATH, Eyes, GHOST_PATH } from "./ui";

export type FieldMode = "reality" | "sim" | "committed";

/** Stable pseudo-random 0..1 per customer, so each creature has its own rhythm. */
const rand = (id: number) => {
  const x = Math.sin(id * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * The crowd: one creature per customer. In reality they just live there. Switch to the
 * ghost run and a ripple goes through them: ghosts for deleted accounts, coins for
 * refunds, envelopes for emails, red alarms for the ones policy is worried about.
 * Every mark is read from the simulated diff. Click a creature to see their side.
 */
export function Crowd({
  seats,
  mode,
  onMode,
  hasSim,
  pinnedId,
  onPick,
}: {
  seats: Seat[];
  mode: FieldMode;
  onMode: (m: FieldMode) => void;
  hasSim: boolean;
  pinnedId: number | null;
  onPick: (s: Seat) => void;
}) {
  const [hover, setHover] = useState<Seat | null>(null);
  const [cols, setCols] = useState(20);
  const [focusId, setFocusId] = useState<number | null>(null);
  const olRef = useRef<HTMLOListElement>(null);
  const live = mode !== "reality" && hasSim;
  const people = useMemo(() => seats.filter((s) => !s.vacant), [seats]);

  // How many creatures fit in a row, so the ripple and arrow keys follow the grid.
  useLayoutEffect(() => {
    const ol = olRef.current;
    if (!ol) return;
    const measure = () => {
      const kids = ol.children;
      if (kids.length < 2) return;
      const top = (kids[0] as HTMLElement).offsetTop;
      let n = 0;
      while (n < kids.length && (kids[n] as HTMLElement).offsetTop === top) n++;
      setCols(Math.max(1, n));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ol);
    return () => ro.disconnect();
  }, [seats.length]);

  // A new sweep every time the ghost run lands.
  const [sweepKey, setSweepKey] = useState(0);
  useEffect(() => {
    if (live) setSweepKey((k) => k + 1);
  }, [live]);

  const counts = useMemo(() => {
    const c = { delete: 0, refund: 0, email: 0, danger: 0 };
    if (live) people.forEach((s) => {
      if (s.kind !== "idle") c[s.kind]++;
      if (s.danger) c.danger++;
    });
    // after a committed delete those rows really are gone, so count the empty outlines they left
    if (live && mode === "committed") c.delete += seats.filter((s) => s.vacant).length;
    return c;
  }, [people, seats, live, mode]);

  const summary = hasSim
    ? `Crowd of ${people.length} customers, ${live ? "showing the ghost run" : "as they are now"}. The ghost run deletes ${people.filter((s) => s.kind === "delete").length}, refunds ${people.filter((s) => s.kind === "refund").length}, emails ${people.filter((s) => s.kind === "email").length}, and flags ${people.filter((s) => s.danger).length} as dangerous.`
    : `Crowd of ${people.length} customers, none affected.`;

  // ---- keyboard through the crowd ----
  const focusable = people.length ? (focusId ?? people[0].id) : null;
  const move = (delta: number) => {
    const idx = people.findIndex((p) => p.id === focusable);
    const next = people[Math.min(people.length - 1, Math.max(0, idx + delta))];
    if (!next) return;
    setFocusId(next.id);
    (olRef.current?.querySelector(`[data-id="${next.id}"]`) as HTMLElement | null)?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLOListElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -1e6, End: 1e6 }[e.key as string];
    if (step !== undefined) {
      e.preventDefault();
      move(step);
    } else if (e.key === "Enter" || e.key === " ") {
      const s = people.find((p) => p.id === focusable);
      if (s && hasSim) (e.preventDefault(), onPick(s));
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div role="radiogroup" aria-label="Which universe" className="inline-flex rounded-full border-[2.5px] border-ink bg-cream2 p-1">
          {(
            [
              ["reality", "Reality"],
              ["sim", mode === "committed" ? "After the run" : "Ghost run"],
            ] as const
          ).map(([m, label]) => {
            const active = (m === "reality") === !live;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={m === "sim" && !hasSim}
                onClick={() => onMode(m === "sim" ? (mode === "committed" ? "committed" : "sim") : "reality")}
                className={`rounded-full px-4 py-1 text-[15px] font-bold transition disabled:opacity-40 ${active ? (m === "sim" ? "bg-ink text-cream" : "bg-cream text-ink shadow-[0_0_0_2px_var(--ink)]") : "text-muted enabled:hover:text-ink"}`}
              >
                {m === "sim" && (
                  <svg viewBox="0 0 40 40" width="18" height="18" aria-hidden className="mr-1.5 inline-block -translate-y-px">
                    <path d={GHOST_PATH} fill="var(--ghost)" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
                    <circle cx="15" cy="19" r="2.6" fill="var(--ink)" />
                    <circle cx="25" cy="19" r="2.6" fill="var(--ink)" />
                  </svg>
                )}
                {label}
              </button>
            );
          })}
        </div>

        <ul className="flex flex-wrap items-center gap-2" aria-label="Key">
          <KeyChip color="var(--ghost)" label="Deleted" n={counts.delete} icon="" />
          <KeyChip color="var(--sun)" label="Refunded" n={counts.refund} icon="$" />
          <KeyChip color="var(--pink)" label="Emailed" n={counts.email} icon="✉" />
          <KeyChip color="var(--tomato)" label="Danger" n={counts.danger} icon="!" />
        </ul>
      </div>

      {/* what the creature you point at would go through */}
      <div className="mt-3 flex min-h-[3.4rem] items-center rounded-2xl border-2 border-dashed border-ink/30 px-4 py-2 text-[15.5px] leading-snug" aria-live="polite">
        {hover ? (
          <span>
            <span className="font-mono text-[12px] text-muted">#{String(hover.id).padStart(3, "0")}</span> <span className="font-bold">{hover.name}</span>{" "}
            <span className="chip ml-1 bg-cream2">{hover.plan}</span>{" "}
            {!hasSim ? (
              <span className="text-muted">Just living their life. No ghost run yet.</span>
            ) : !live ? (
              <span className="text-muted">This is reality. Flip to the ghost run to see what happens to them.</span>
            ) : hover.notes.length ? (
              <span className={hover.danger ? "font-bold text-[#d22d10]" : ""}>{hover.notes.join(". ")}.</span>
            ) : (
              <span className="text-muted">Not touched by this job.</span>
            )}
          </span>
        ) : (
          <span className="text-muted">
            {hasSim ? "Point at anyone to see what the ghost run does to them. Click to see their side of the story." : "Every creature here is a real customer row. Give the agent a job and watch what it would do to them."}
          </span>
        )}
      </div>

      <div className="relative mt-4">
        {live && <div key={sweepKey} className="sweep" aria-hidden />}
        <ol ref={olRef} role="listbox" aria-label={summary} className="crowd" onMouseLeave={() => setHover(null)} onKeyDown={onKey}>
          {seats.map((s, i) => {
            const d = Math.min(1400, ((i % cols) + Math.floor(i / cols)) * 22);
            const style = { "--d": `${d}ms`, "--r": rand(s.id).toFixed(3) } as CSSProperties;
            if (s.vacant) {
              return (
                <li key={s.id} aria-hidden className="critter gone" style={style}>
                  <Body />
                </li>
              );
            }
            const k = live ? s.kind : "idle";
            const danger = live && s.danger;
            const gone = mode === "committed" && live && s.kind === "delete";
            return (
              <li
                key={s.id}
                data-id={s.id}
                data-look
                role="option"
                aria-selected={pinnedId === s.id}
                aria-label={`${s.name}, ${s.plan} plan${live && s.notes.length ? `. ${s.notes.join(". ")}` : ""}`}
                tabIndex={s.id === focusable ? 0 : -1}
                onMouseEnter={() => setHover(s)}
                onFocus={() => {
                  setHover(s);
                  setFocusId(s.id);
                }}
                onClick={() => {
                  setFocusId(s.id);
                  if (hasSim) onPick(s);
                }}
                style={style}
                className={`critter plan-${s.plan} k-${k} ${danger ? "danger" : ""} ${gone ? "gone" : ""} ${pinnedId === s.id ? "pinned" : ""} ${hasSim ? "cursor-pointer" : ""}`}
              >
                <Body />
                {live && !gone && (danger ? <Badge kind="alarm" /> : k === "refund" ? <Badge kind="coin" /> : k === "email" ? <Badge kind="mail" /> : null)}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function Body() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden>
      <path className="chalk" d={BLOB_PATH} />
      <g className="bob">
        <path className="blob" d={BLOB_PATH} />
        <path className="ghostbody" d={GHOST_PATH} strokeLinejoin="round" />
        <Eyes />
        <path className="mouth m-smile" d="M16.5 27 Q20 30 23.5 27" />
        <ellipse className="mouth m-o" cx="20" cy="28.2" rx="2" ry="2.5" />
        <path className="mouth m-grin" d="M15 26 Q20 32.5 25 26 Z" />
        <path className="mouth m-worry" d="M15.5 29 Q17.5 26.5 20 28.5 Q22.5 30.5 24.5 28" />
      </g>
    </svg>
  );
}

function Badge({ kind }: { kind: "coin" | "mail" | "alarm" }) {
  return (
    <span className={`badge b-${kind}`} aria-hidden>
      <svg viewBox="0 0 20 20">
        {kind === "coin" && (
          <>
            <circle cx="10" cy="10" r="8" fill="var(--sun)" stroke="var(--ink)" strokeWidth="1.8" />
            <text x="10" y="14" textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--ink)">$</text>
          </>
        )}
        {kind === "mail" && (
          <>
            <rect x="2" y="4.5" width="16" height="11" rx="1.5" fill="#fff" stroke="var(--ink)" strokeWidth="1.8" />
            <path d="M2.8 5.5 L10 11 L17.2 5.5" fill="none" stroke="var(--ink)" strokeWidth="1.6" strokeLinejoin="round" />
          </>
        )}
        {kind === "alarm" && (
          <>
            <circle cx="10" cy="10" r="8" fill="var(--tomato)" stroke="var(--ink)" strokeWidth="1.8" />
            <text x="10" y="14.5" textAnchor="middle" fontSize="13" fontWeight="900" fill="var(--ink)">!</text>
          </>
        )}
      </svg>
    </span>
  );
}

function KeyChip({ color, label, n, icon }: { color: string; label: string; n: number; icon: string }) {
  return (
    <li className="chip bg-cream" style={{ fontSize: 11.5 }}>
      <span className="grid h-[18px] w-[18px] place-items-center rounded-full border-2 border-ink text-[10px] font-black leading-none" style={{ background: color }} aria-hidden>
        {icon}
      </span>
      {label}
      <span key={n} className="wiggle-in inline-block min-w-[1.6em] rounded-full bg-ink px-1.5 text-center text-cream">
        {n}
      </span>
    </li>
  );
}
