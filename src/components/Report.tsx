"use client";

import type { Simulation } from "@/lib/simulate";
import type { TweakPreview } from "@/lib/tweaks";
import type { Params } from "@/lib/actions";
import { ACTIONS } from "@/lib/actions";
import { Button, Card, VerdictPill, sevStyle, usd } from "./ui";
import { DiffView } from "./DiffView";

function headline(sim: Simulation): string {
  const m = sim.report.metrics;
  if (m.rowsTouched === 0) return "This action matches nothing.";
  const bits = [`changes ${m.rowsTouched} rows`];
  if (m.moneyMovedCents) bits.push(`moves ${usd(m.moneyMovedCents)}`);
  if (m.messagesQueued) bits.push(`emails ${m.messagesQueued} people`);
  if (m.destroyedOrders) bits.push(`deletes ${m.destroyedOrders} orders`);
  return `This ${bits.join(", ")}.`;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" | "warn" }) {
  const c = tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink";
  return (
    <div className="rounded-lg border border-line bg-surface2 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${c}`}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Report({
  sim,
  previews,
  previewing,
  drifted,
  busy,
  onApply,
  onApprove,
  onReject,
}: {
  sim: Simulation;
  previews: TweakPreview[];
  previewing: boolean;
  drifted: boolean;
  busy: boolean;
  onApply: (patch: Params) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { report } = sim;
  const m = report.metrics;
  const def = ACTIONS[sim.proposal.action];
  const canApprove = report.verdict === "safe" || report.verdict === "review";

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">{def.label} · simulated just now</div>
            <p className="mt-1 text-lg font-semibold leading-snug">{headline(sim)}</p>
            <p className="mt-0.5 text-sm text-muted">{def.describe(sim.proposal.params)}</p>
          </div>
          <VerdictPill verdict={report.verdict} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Stat label="Customers" value={String(m.customersImpacted)} sub={`of ${m.customersTotal}`} tone={m.customersImpacted / (m.customersTotal || 1) > 0.5 ? "warn" : undefined} />
          <Stat label="Rows changed" value={String(m.rowsTouched)} />
          <Stat label="Money moved" value={usd(m.moneyMovedCents)} tone={m.moneyMovedCents > 200_000 ? "warn" : undefined} />
          <Stat label="Emails queued" value={String(m.messagesQueued)} sub={m.optedOutRecipients ? `${m.optedOutRecipients} opted out` : undefined} tone={m.optedOutRecipients ? "bad" : undefined} />
        </div>
      </Card>

      {report.findings.length > 0 && (
        <Card title="What the simulation found">
          <ul className="space-y-2">
            {report.findings.map((f) => (
              <li key={f.id} className={`rounded-lg border px-3 py-2.5 ${sevStyle[f.severity]}`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] font-semibold uppercase text-bg">{f.severity}</span>
                  {f.title}
                </div>
                <p className="mt-1 text-sm text-muted">{f.detail}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(previews.length > 0 || previewing) && (
        <Card title="Safer versions, already simulated" aside={previewing ? <span className="text-xs text-muted">simulating…</span> : undefined}>
          <ul className="space-y-2">
            {previews.map((p) => (
              <li key={p.tweak.label} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface2 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{p.tweak.label}</div>
                  <div className="text-xs text-muted">{p.tweak.why} · {p.headline}</div>
                </div>
                <div className="flex items-center gap-2">
                  <VerdictPill verdict={p.verdict} small />
                  <Button onClick={() => onApply(p.tweak.patch)} disabled={busy}>Use this</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Before → after">
        <DiffView diff={sim.diff} />
        {report.sideEffects.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Side effects the simulator observed</div>
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {report.sideEffects.map((s) => (
                <li key={s.label} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span>{s.label}</span>
                  <span className="flex items-center gap-2">
                    <span className="rounded border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">{s.via}</span>
                    <span className="font-mono tabular-nums">{s.count}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card title="Rollback path">
        <ul className="space-y-2">
          {report.rollback.map((r) => (
            <li key={r.when} className="flex gap-3 text-sm">
              <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${r.recoverable ? "bg-ok" : "bg-warn"}`} aria-hidden />
              <div>
                <div className="font-medium">{r.when} <span className="font-normal text-muted">· {r.recoverable ? "recoverable" : "partly irreversible"}</span></div>
                <div className="text-muted">{r.note}</div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {drifted && (
        <div role="status" className="rounded-xl border border-warn/40 bg-warnsoft px-4 py-3 text-sm">
          <strong>The data changed after this preview.</strong> Another writer added customers while you were reviewing. If you approve, the guard compares the real effect with this preview.
        </div>
      )}

      <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 shadow-lg">
        <p className="text-sm text-muted">
          {report.verdict === "blocked"
            ? "Blocked. Pick a safer version above or change the parameters."
            : report.verdict === "noop"
              ? "Nothing to execute."
              : "Approving runs it for real, inside the limits shown above."}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onReject} disabled={busy}>Reject</Button>
          <Button variant="primary" onClick={onApprove} disabled={!canApprove || busy}>
            {busy ? "Working…" : "Approve & execute"}
          </Button>
        </div>
      </div>
    </div>
  );
}
