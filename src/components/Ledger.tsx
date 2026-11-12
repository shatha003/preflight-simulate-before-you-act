"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { Seat, SeatKind } from "@/lib/field";

export type FieldMode = "reality" | "sim" | "committed";

const KEY: { kind: Exclude<SeatKind, "idle">; label: string }[] = [
  { kind: "delete", label: "Deleted" },
  { kind: "refund", label: "Refunded" },
  { kind: "email", label: "Emailed" },
];

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/**
 * The customer ledger, typeset, with the proof on tracing paper. The paper is pulled
 * down the page by its tab: a name only carries a mark once the paper has passed it.
 * Every mark is read from the simulated diff. Click a name to see their side of it.
 */
export function Ledger({
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
  const people = useMemo(() => seats.filter((s) => !s.vacant), [seats]);

  // ---- the tracing paper: f is how much of the ledger it covers, 0 to 1 ----
  const [f, setFState] = useState(0);
  const fRef = useRef(0);
  const anim = useRef(0);
  const dragging = useRef(false);
  const olRef = useRef<HTMLOListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [H, setH] = useState(0);
  const [tops, setTops] = useState<number[]>([]);
  const [focusIdx, setFocusIdx] = useState(0);

  const setF = useCallback((v: number) => {
    fRef.current = v;
    setFState(v);
  }, []);

  const animateTo = useCallback(
    (target: number, ms: number) => {
      cancelAnimationFrame(anim.current);
      const from = fRef.current;
      const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced || from === target) return setF(target);
      const t0 = performance.now();
      const step = (t: number) => {
        const p = clamp((t - t0) / ms);
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        setF(from + (target - from) * e);
        if (p < 1) anim.current = requestAnimationFrame(step);
      };
      anim.current = requestAnimationFrame(step);
    },
    [setF],
  );

  const live = mode !== "reality" && hasSim;
  useEffect(() => {
    animateTo(live ? 1 : 0, live ? 1700 : 450);
    return () => cancelAnimationFrame(anim.current);
  }, [live, animateTo]);

  // Measure where every line sits, so the paper knows which names it has passed.
  useLayoutEffect(() => {
    const ol = olRef.current;
    if (!ol) return;
    const measure = () => {
      setH(ol.scrollHeight);
      setTops(itemRefs.current.slice(0, people.length).map((el) => (el ? el.offsetTop + el.offsetHeight / 2 : 0)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ol);
    return () => ro.disconnect();
  }, [people.length]);

  const edge = f * H;
  const covered = useCallback((i: number) => hasSim && (tops[i] ?? Infinity) <= edge, [hasSim, tops, edge]);

  const counts = useMemo(() => {
    const c = { delete: 0, refund: 0, email: 0, idle: 0, danger: 0 };
    people.forEach((s, i) => {
      const on = covered(i);
      c[on ? s.kind : "idle"]++;
      if (on && s.danger) c.danger++;
    });
    return c;
  }, [people, covered]);

  const pct = Math.round(f * 100);
  const summary = hasSim
    ? `Proof on tracing paper over the ledger, ${pct} percent of the way down. Fully laid, it marks ${people.filter((s) => s.kind === "delete").length} deleted, ${people.filter((s) => s.kind === "refund").length} refunded, ${people.filter((s) => s.kind === "email").length} emailed and ${people.filter((s) => s.danger).length} circled as dangerous, out of ${people.length} customers.`
    : `Ledger as it stands. ${people.length} customers, none affected.`;

  // ---- dragging the tab ----
  const onTabDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!hasSim) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    cancelAnimationFrame(anim.current);
  };
  const onTabMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !olRef.current || !H) return;
    const r = olRef.current.getBoundingClientRect();
    setF(clamp((e.clientY - r.top) / H));
  };
  const onTabUp = () => {
    dragging.current = false;
  };
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowDown: 0.05, ArrowRight: 0.05, ArrowUp: -0.05, ArrowLeft: -0.05, PageDown: 0.25, PageUp: -0.25 }[e.key as string];
    if (step !== undefined) {
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      setF(clamp(fRef.current + step));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      setF(e.key === "Home" ? 0 : 1);
    }
  };

  // ---- keyboard through the names ----
  const move = (to: number) => {
    const i = clamp(to, 0, people.length - 1);
    setFocusIdx(i);
    itemRefs.current[i]?.focus();
  };
  const onListKey = (e: KeyboardEvent<HTMLOListElement>) => {
    if (e.key === "ArrowDown") (e.preventDefault(), move(focusIdx + 1));
    else if (e.key === "ArrowUp") (e.preventDefault(), move(focusIdx - 1));
    else if (e.key === "Home") (e.preventDefault(), move(0));
    else if (e.key === "End") (e.preventDefault(), move(people.length - 1));
    else if ((e.key === "Enter" || e.key === " ") && people[focusIdx]) (e.preventDefault(), hasSim && onPick(people[focusIdx]));
  };

  const hoverOn = hover ? covered(people.indexOf(hover)) : false;

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
            const active = (m === "reality") === (f < 0.02);
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

        {/* The key is made of the same marks as the ledger, and counts only what the paper has reached. */}
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

      <div className="line-clamp-3 h-[4.9rem] pt-2 text-[16px]" aria-live="polite">
        {hover ? (
          <span>
            <span className="font-type text-[13px] text-muted">{String(hover.id).padStart(3, "0")}</span> <span className="font-medium">{hover.name}</span> <span className="text-muted">({hover.plan}).</span>{" "}
            {!hasSim ? (
              <span className="italic text-muted">No proof yet.</span>
            ) : !hoverOn ? (
              <span className="italic text-muted">The tracing paper hasn&rsquo;t reached this name. Pull it down by the tab.</span>
            ) : hover.notes.length ? (
              <span className={hover.danger ? "hand text-[21px]" : ""}>{hover.notes.join(". ")}.</span>
            ) : (
              <span className="italic text-muted">Not touched by this job.</span>
            )}
          </span>
        ) : (
          <span className="italic text-muted">
            {hasSim ? "Pull the tracing paper down by the tab on the right. Click any name to see what it is like on their side." : "Give the press a job above. Every line here is a customer; the proof will mark exactly who it touches."}
          </span>
        )}
      </div>

      <div className="relative mt-1 pr-8">
        <ol
          ref={olRef}
          role="listbox"
          aria-label={summary}
          aria-orientation="vertical"
          className="ledger relative"
          onMouseLeave={() => setHover(null)}
          onKeyDown={onListKey}
        >
          {people.map((s, i) => {
            const on = covered(i);
            const k = on ? s.kind : "idle";
            return (
              <li
                key={s.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                role="option"
                aria-selected={pinnedId === s.id}
                tabIndex={i === focusIdx ? 0 : -1}
                onMouseEnter={() => setHover(s)}
                onFocus={(e) => {
                  setHover(s);
                  setFocusIdx(i);
                  // keyboard users get the whole proof, so what they focus is never hidden
                  if (hasSim && fRef.current < 0.99 && e.currentTarget.matches(":focus-visible")) animateTo(1, 500);
                }}
                onClick={() => {
                  setFocusIdx(i);
                  if (hasSim) onPick(s);
                }}
                style={{ "--d": "0ms" } as CSSProperties}
                className={`ln ${hasSim ? "cursor-pointer" : ""} ${k !== "idle" ? `mark-${k}` : ""} ${on && s.danger ? "ringed" : ""} ${pinnedId === s.id ? "pinned" : ""}`}
              >
                <span className="id">{String(s.id).padStart(3, "0")}</span>
                <span className="nm">{s.name}</span>
              </li>
            );
          })}

          {/* the tracing paper itself: a tinted sheet from the top of the ledger to its edge */}
          {hasSim && H > 0 && <div aria-hidden className="vellum" style={{ height: edge + 3 }} />}
        </ol>

        {/* the tab you pull it down by */}
        {hasSim && H > 0 && (
          <div
            role="slider"
            tabIndex={0}
            aria-label="Tracing paper"
            aria-orientation="vertical"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={`Proof laid over ${pct} percent of the ledger`}
            onPointerDown={onTabDown}
            onPointerMove={onTabMove}
            onPointerUp={onTabUp}
            onPointerCancel={onTabUp}
            onKeyDown={onTabKey}
            className="paper-tab"
            style={{ top: edge, touchAction: "none" }}
          >
            <span aria-hidden />
            <span aria-hidden />
            <span aria-hidden />
          </div>
        )}
      </div>
    </div>
  );
}
