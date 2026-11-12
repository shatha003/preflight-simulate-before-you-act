"use client";

import { useEffect } from "react";
import type { Seat } from "@/lib/field";
import { HOLD_SECONDS } from "@/lib/risk";
import { usd } from "@/lib/format";

/** A letter as the customer would receive it. Subject and recipient come from the real outbox row. */
function Letter({ to, subject, kind }: { to: string; subject: string; kind: string }) {
  return (
    <div className="border border-ink/60 bg-paper2 px-3 py-2 text-[15px]">
      <div className="font-type text-[12px] text-muted">{kind === "campaign" ? "Marketing email" : "Receipt email"}</div>
      <div>
        <span className="italic text-muted">To:</span> {to}
      </div>
      <div>
        <span className="italic text-muted">Subject:</span> <span className="font-semibold">{subject}</span>
      </div>
    </div>
  );
}

/**
 * Their side of it. Pinned when you click a name: what this one person would actually
 * find tomorrow, built from the simulated rows and nothing else.
 */
export function TheirSide({ seat, hasSim, onClose }: { seat: Seat; hasSim: boolean; onClose: () => void }) {
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const s = seat.story;
  const first = seat.name.split(" ")[0];

  let body: React.ReactNode;
  if (!hasSim || seat.kind === "idle") {
    body = <p className="italic text-muted">Nothing changes for {first}. No sign-in, email or receipt.</p>;
  } else if (seat.kind === "delete") {
    body = (
      <>
        <p>
          Tries to sign in and finds <strong>no account</strong>.
        </p>
        <div>
          <div className="italic text-muted">Gone with it</div>
          <ul className="mt-0.5 space-y-0.5">
            <li>
              {s.orders.n} {s.orders.n === 1 ? "order" : "orders"}
              {s.orders.n > 0 && <span className="font-type text-[13px]"> ({usd(s.orders.cents)})</span>}
            </li>
            <li>
              {s.payments.n} {s.payments.n === 1 ? "payment" : "payments"}
              {s.payments.n > 0 && <span className="font-type text-[13px]"> ({usd(s.payments.cents)})</span>}
            </li>
          </ul>
        </div>
        <p className="text-[15px]">
          <span className="italic text-muted">Kept:</span> {s.archived ? "a copy of the customer row in trash. Orders and payments are not archived." : "nothing."}
        </p>
        {s.payments.recent > 0 && <p className="hand text-[22px]">Paid within the last 12 months. Policy says we have to keep these records.</p>}
      </>
    );
  } else if (seat.kind === "refund") {
    body = (
      <>
        {s.refunds.map((r) => (
          <p key={r.id}>
            <strong className="font-type">{usd(r.cents)}</strong> goes back to the card for payment #{r.id}.
          </p>
        ))}
        {s.emails.map((e, i) => (
          <Letter key={i} to={seat.name} subject={e.subject} kind={e.kind === "campaign" ? "campaign" : "receipt"} />
        ))}
        <p className="text-[15px] italic text-muted">The receipt was written by a database trigger, not by the agent. It is held for {HOLD_SECONDS}s, then delivered.</p>
      </>
    );
  } else {
    const rude = !s.optedIn && s.emails.some((e) => e.kind === "campaign");
    body = (
      <>
        {s.emails.map((e, i) => (
          <Letter key={i} to={seat.name} subject={e.subject} kind={e.kind === "campaign" ? "campaign" : "receipt"} />
        ))}
        <p className="text-[15px] italic text-muted">Held for {HOLD_SECONDS}s, then delivered. After that it cannot be unsent.</p>
        {rude && <p className="hand text-[22px]">{first} opted out of marketing. This email goes to them anyway.</p>}
      </>
    );
  }

  return (
    <aside aria-label={`Their side: ${seat.name}`} className="settle fixed bottom-[8.5rem] right-4 z-30 w-[min(380px,calc(100%-2rem))] border border-ink bg-paper px-4 pb-4 pt-3 shadow-[5px_5px_0_rgba(27,25,21,0.3)] sm:bottom-[7.5rem] sm:right-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-type text-[12px] text-muted">
            {String(seat.id).padStart(3, "0")} · {seat.plan} plan
          </div>
          <h3 className="text-[22px] font-semibold italic leading-tight">Tomorrow morning, {seat.name}&hellip;</h3>
        </div>
        <button type="button" onClick={onClose} className="px-1 text-[15px] underline underline-offset-4 hover:text-blue">
          Close
        </button>
      </div>
      <div className="mt-2 space-y-2.5 text-[16.5px] leading-snug">{body}</div>
    </aside>
  );
}
