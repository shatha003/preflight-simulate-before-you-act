"use client";

import { useEffect } from "react";
import type { Seat } from "@/lib/field";
import { HOLD_SECONDS } from "@/lib/risk";
import { usd } from "@/lib/format";
import { BLOB_PATH, Eyes, GHOST_PATH } from "./ui";

/** A letter as the customer would receive it. Subject and recipient come from the real outbox row. */
function Letter({ to, subject, kind }: { to: string; subject: string; kind: string }) {
  return (
    <div className="rounded-xl border-2 border-ink bg-white px-3 py-2 text-[14.5px] shadow-[3px_3px_0_var(--ink)]">
      <div className="eyebrow mb-0.5 text-muted">{kind === "campaign" ? "✉ Marketing email" : "✉ Receipt email"}</div>
      <div>
        <span className="text-muted">To:</span> {to}
      </div>
      <div>
        <span className="text-muted">Subject:</span> <span className="font-bold">{subject}</span>
      </div>
    </div>
  );
}

const PLAN_FILL: Record<string, string> = { free: "var(--idle-free)", pro: "var(--idle-pro)", team: "var(--idle-team)" };

/** Their avatar, in the state the ghost run leaves them in. */
function Avatar({ seat }: { seat: Seat }) {
  const ghost = seat.kind === "delete";
  const fill = seat.danger ? "var(--tomato)" : ghost ? "var(--ghost)" : seat.kind === "refund" ? "var(--sun)" : seat.kind === "email" ? "var(--pink)" : PLAN_FILL[seat.plan] ?? "var(--idle-free)";
  return (
    <svg viewBox="0 0 40 40" width="64" height="64" aria-hidden data-look className="mascot shrink-0 overflow-visible" style={{ ["--r" as string]: 0.6 }}>
      <g className="bob" style={{ transformBox: "fill-box", transformOrigin: "50% 100%", animation: "bob 2.2s ease-in-out infinite" }}>
        <path d={ghost ? GHOST_PATH : BLOB_PATH} fill={fill} stroke="var(--ink)" strokeWidth="2.2" strokeLinejoin="round" />
        <Eyes />
        {seat.danger ? (
          <path d="M15.5 29 Q17.5 26.5 20 28.5 Q22.5 30.5 24.5 28" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
        ) : ghost ? (
          <ellipse cx="20" cy="28.2" rx="2" ry="2.5" fill="none" stroke="var(--ink)" strokeWidth="2" />
        ) : (
          <path d="M16.5 27 Q20 30 23.5 27" fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />
        )}
      </g>
    </svg>
  );
}

/**
 * Their side of it. Pinned when you click a creature: what this one person would
 * actually find tomorrow, built from the simulated rows and nothing else.
 */
export function TheirSide({ seat, hasSim, onClose }: { seat: Seat; hasSim: boolean; onClose: () => void }) {
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const s = seat.story;
  const first = seat.name.split(" ")[0];
  const warn = (t: string) => <p className="rounded-xl border-2 border-ink bg-tomato px-3 py-2 text-[15px] font-bold">{t}</p>;

  let body: React.ReactNode;
  if (!hasSim || seat.kind === "idle") {
    body = <p className="text-muted">Nothing changes for {first}. No sign-in surprise, no email, no receipt.</p>;
  } else if (seat.kind === "delete") {
    body = (
      <>
        <p>
          Tries to sign in and finds <strong>no account</strong>.
        </p>
        <div>
          <div className="eyebrow text-muted">Gone with it</div>
          <ul className="mt-1 space-y-0.5">
            <li>
              {s.orders.n} {s.orders.n === 1 ? "order" : "orders"}
              {s.orders.n > 0 && <span className="font-mono text-[12.5px]"> ({usd(s.orders.cents)})</span>}
            </li>
            <li>
              {s.payments.n} {s.payments.n === 1 ? "payment" : "payments"}
              {s.payments.n > 0 && <span className="font-mono text-[12.5px]"> ({usd(s.payments.cents)})</span>}
            </li>
          </ul>
        </div>
        <p className="text-[14.5px]">
          <span className="text-muted">Kept:</span> {s.archived ? "a copy of the customer row in trash. Orders and payments are not archived." : "nothing."}
        </p>
        {s.payments.recent > 0 && warn("Paid within the last 12 months. Policy says we have to keep these records.")}
      </>
    );
  } else if (seat.kind === "refund") {
    body = (
      <>
        {s.refunds.map((r) => (
          <p key={r.id}>
            <strong className="rounded-md bg-sun px-1 font-mono">{usd(r.cents)}</strong> goes back to the card for payment #{r.id}.
          </p>
        ))}
        {s.emails.map((e, i) => (
          <Letter key={i} to={seat.name} subject={e.subject} kind={e.kind === "campaign" ? "campaign" : "receipt"} />
        ))}
        <p className="text-[14px] text-muted">The receipt was written by a database trigger, not by the agent. It is held for {HOLD_SECONDS}s, then delivered.</p>
      </>
    );
  } else {
    const rude = !s.optedIn && s.emails.some((e) => e.kind === "campaign");
    body = (
      <>
        {s.emails.map((e, i) => (
          <Letter key={i} to={seat.name} subject={e.subject} kind={e.kind === "campaign" ? "campaign" : "receipt"} />
        ))}
        <p className="text-[14px] text-muted">Held for {HOLD_SECONDS}s, then delivered. After that it cannot be unsent.</p>
        {rude && warn(`${first} opted out of marketing. This email goes to them anyway.`)}
      </>
    );
  }

  return (
    <aside
      aria-label={`Their side: ${seat.name}`}
      className="card wiggle-in fixed bottom-[9rem] right-4 z-30 w-[min(390px,calc(100%-2rem))] px-5 pb-5 pt-4 sm:bottom-[8rem] sm:right-8"
    >
      <div className="flex items-start gap-3">
        <Avatar seat={seat} />
        <div className="min-w-0 flex-1">
          <div className="eyebrow text-muted">
            #{String(seat.id).padStart(3, "0")} · {seat.plan} plan
          </div>
          <h3 className="text-[22px] font-extrabold leading-[1.05] tracking-tight">Tomorrow morning, {seat.name}&hellip;</h3>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="btn grid h-8 w-8 shrink-0 place-items-center bg-cream text-[15px]">
          ✕
        </button>
      </div>
      <div className="mt-3 space-y-2.5 text-[15.5px] leading-snug">{body}</div>
    </aside>
  );
}
