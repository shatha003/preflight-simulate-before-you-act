"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { openDb, resetDb, type Db } from "@/lib/db";
import { ACTION_LIST, ACTIONS, coerceParams, type ActionId, type Params, type Proposal } from "@/lib/actions";
import { simulate, type Simulation } from "@/lib/simulate";
import { execute, type ExecResult } from "@/lib/execute";
import { undo, deliverHeld, type UndoResult } from "@/lib/undo";
import { previewTweaks, type TweakPreview } from "@/lib/tweaks";
import { concurrentWriter } from "@/lib/chaos";
import { appendAudit, verifyChain, type AuditEntry } from "@/lib/audit";
import { HOLD_SECONDS } from "@/lib/risk";
import { parseIntentRules } from "@/lib/intent";
import { Button, Card, usd } from "./ui";
import { Report } from "./Report";

const EXAMPLES = [
  "Refund everyone who paid in the last 90 days",
  "Email our pro customers a win-back offer",
  "Delete accounts that have been inactive for 6 months",
  "Refund payments from the last month under $50",
];

interface Counts {
  customers: number;
  orders: number;
  captured: number;
  refunded: number;
  held: number;
  sent: number;
  ledger: number;
}

const COUNTS_SQL = `select
  (select count(*) from customers)::int as customers,
  (select count(*) from orders)::int as orders,
  (select count(*) from payments where status = 'captured')::int as captured,
  (select count(*) from payments where status = 'refunded')::int as refunded,
  (select count(*) from outbox where status = 'held')::int as held,
  (select count(*) from outbox where status = 'sent')::int as sent,
  (select coalesce(sum(amount_cents), 0) from ledger)::int as ledger`;

const AUDIT_KEY = "preflight-audit-v1";

export function Workbench() {
  const dbRef = useRef<Db | null>(null);
  const [ready, setReady] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);

  const [text, setText] = useState("");
  const [source, setSource] = useState<string>("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [previews, setPreviews] = useState<TweakPreview[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [drifted, setDrifted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [result, setResult] = useState<ExecResult | null>(null);
  const [committedAt, setCommittedAt] = useState(0);
  const [undone, setUndone] = useState<UndoResult | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [chainOk, setChainOk] = useState(true);
  const auditRef = useRef<AuditEntry[]>([]);
  const token = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    const r = await db.query<Counts>(COUNTS_SQL);
    setCounts(r.rows[0]);
  }, []);

  const log = useCallback(async (type: string, data: unknown) => {
    auditRef.current = await appendAudit(auditRef.current, type, data);
    setAudit(auditRef.current);
    setChainOk((await verifyChain(auditRef.current)).ok);
    try {
      localStorage.setItem(AUDIT_KEY, JSON.stringify(auditRef.current.slice(-200)));
    } catch {}
  }, []);

  // Open the database once. It is real Postgres, running in this tab.
  useEffect(() => {
    let cancelled = false;
    try {
      const saved = localStorage.getItem(AUDIT_KEY);
      if (saved) {
        auditRef.current = JSON.parse(saved) as AuditEntry[];
        setAudit(auditRef.current);
      }
    } catch {}
    openDb("idb://preflight-v1")
      .catch(() => openDb()) // private mode: fall back to memory
      .then(async (db) => {
        if (cancelled) return;
        dbRef.current = db;
        setReady(true);
        await refresh();
      })
      .catch((e) => setError(`Could not start the database: ${e instanceof Error ? e.message : e}`));
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  // Emails leave the hold window on a timer. After that they cannot be recalled.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(async () => {
      setNow(Date.now());
      const db = dbRef.current;
      if (db && (await deliverHeld(db, HOLD_SECONDS)) > 0) await refresh();
    }, 1000);
    return () => clearInterval(id);
  }, [ready, refresh]);

  const runSim = useCallback(
    async (p: Proposal, why = "simulated") => {
      const db = dbRef.current;
      if (!db) return;
      const mine = ++token.current;
      setBusy(true);
      setError("");
      setResult(null);
      setUndone(null);
      try {
        const s = await simulate(db, p);
        if (mine !== token.current) return;
        setSim(s);
        setDrifted(false);
        setPreviews([]);
        setPreviewing(true);
        await log(why, {
          action: p.action,
          params: p.params,
          verdict: s.report.verdict,
          rows: s.report.metrics.rowsTouched,
          findings: s.report.findings.map((f) => f.id),
        });
        const pv = await previewTweaks(db, p, s.report);
        if (mine === token.current) setPreviews(pv);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mine === token.current) {
          setBusy(false);
          setPreviewing(false);
        }
      }
    },
    [log],
  );

  async function propose(input: string) {
    const t = input.trim();
    if (!t || !ready) return;
    setBusy(true);
    setError("");
    let parsed;
    try {
      const res = await fetch("/api/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t }),
      });
      if (!res.ok) throw new Error("intent failed");
      parsed = await res.json();
    } catch {
      parsed = parseIntentRules(t);
    }
    setSource(parsed.source === "llm" ? "Read by an LLM" : "Read by the built-in rule parser");
    setProposal(parsed.proposal);
    await log("intent", { text: t, source: parsed.source, action: parsed.proposal.action, params: parsed.proposal.params });
    await runSim(parsed.proposal);
  }

  function chooseAction(id: ActionId) {
    const p: Proposal = { action: id, params: { ...ACTIONS[id].defaults } };
    setProposal(p);
    setSource("Chosen manually");
    void runSim(p);
  }

  function editParam(key: string, value: string | number | boolean) {
    if (!proposal) return;
    const p = { action: proposal.action, params: coerceParams(proposal.action, { ...proposal.params, [key]: value }) };
    setProposal(p);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void runSim(p), 400);
  }

  function applyTweak(patch: Params) {
    if (!proposal) return;
    const p = { action: proposal.action, params: coerceParams(proposal.action, { ...proposal.params, ...patch }) };
    setProposal(p);
    void runSim(p, "tweaked");
  }

  async function approve() {
    const db = dbRef.current;
    if (!db || !sim) return;
    setBusy(true);
    try {
      await log("approved", { action: sim.proposal.action, verdict: sim.report.verdict, approvedRows: sim.report.metrics.rowsTouched });
      const res = await execute(db, sim);
      setResult(res);
      if (res.status === "committed") {
        setCommittedAt(Date.now());
        await log("executed", { status: "committed", matchedPreview: res.matchedPreview });
      } else {
        await log("guard_tripped", {
          approvedRows: res.approvedRows,
          actualRows: res.actualRows,
          violations: res.violations.map((v) => v.detail),
        });
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    token.current++;
    await log("rejected", { action: sim?.proposal.action });
    setSim(null);
    setProposal(null);
    setResult(null);
    setPreviews([]);
  }

  async function undoLast() {
    const db = dbRef.current;
    if (!db || result?.status !== "committed") return;
    setBusy(true);
    try {
      const r = await undo(db, result.undo);
      setUndone(r);
      await log("undone", { ...r.restored, unrecoverable: r.unrecoverable.length });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function drift() {
    const db = dbRef.current;
    if (!db) return;
    const n = await concurrentWriter(db, 40);
    setDrifted(true);
    await log("drift_injected", { customersAdded: n });
    await refresh();
  }

  async function reset() {
    const db = dbRef.current;
    if (!db) return;
    token.current++;
    setBusy(true);
    await resetDb(db);
    setSim(null);
    setProposal(null);
    setResult(null);
    setPreviews([]);
    setDrifted(false);
    await log("db_reset", {});
    await refresh();
    setBusy(false);
  }

  const step = result ? 3 : sim ? 2 : proposal ? 1 : 0;
  const recallLeft = Math.max(0, Math.ceil((committedAt + HOLD_SECONDS * 1000 - now) / 1000));

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-24 pt-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Preflight</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Every write is run for real on a copy first. You see exactly what changes, who is hit, and how to get it back, before anything is committed.
          </p>
        </div>
        <ol className="flex flex-wrap gap-1.5 text-xs" aria-label="Progress">
          {["Intent", "Simulate", "Review", "Execute"].map((s, i) => (
            <li
              key={s}
              className={`rounded-full border px-3 py-1 ${i === step ? "border-ink bg-ink text-bg" : i < step ? "border-line bg-surface2 text-ink" : "border-line text-muted"}`}
            >
              {i + 1} · {s}
            </li>
          ))}
        </ol>
      </header>

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-bad/40 bg-badsoft px-4 py-3 text-sm text-bad">
          {error}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card title="Ask the agent">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void propose(text);
              }}
            >
              <label htmlFor="intent" className="sr-only">
                What should the agent do?
              </label>
              <textarea
                id="intent"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Delete accounts inactive for 6 months"
                rows={3}
                className="w-full resize-none rounded-lg border border-line bg-surface2 px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-xs text-muted">{source}</span>
                <Button variant="primary" onClick={() => void propose(text)} disabled={!ready || busy || !text.trim()}>
                  Simulate
                </Button>
              </div>
            </form>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  disabled={!ready || busy}
                  onClick={() => {
                    setText(ex);
                    void propose(ex);
                  }}
                  className="rounded-full border border-line bg-surface px-2.5 py-1 text-left text-xs hover:bg-surface2 disabled:opacity-40"
                >
                  {ex}
                </button>
              ))}
            </div>
          </Card>

          {proposal && (
            <Card title="Parameters" aside={<span className="text-xs text-muted">re-simulates as you type</span>}>
              <div className="mb-3 grid grid-cols-3 gap-1.5">
                {ACTION_LIST.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => chooseAction(a.id)}
                    aria-pressed={proposal.action === a.id}
                    className={`rounded-lg border px-2 py-1.5 text-xs font-medium ${proposal.action === a.id ? "border-ink bg-ink text-bg" : "border-line bg-surface hover:bg-surface2"}`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              <div className="space-y-2.5">
                {ACTIONS[proposal.action].fields.map((f) => {
                  const v = proposal.params[f.key];
                  const id = `p-${f.key}`;
                  return (
                    <div key={f.key} className="text-sm">
                      {f.type === "boolean" ? (
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={Boolean(v)} onChange={(e) => editParam(f.key, e.target.checked)} />
                          <span>{f.label}</span>
                        </label>
                      ) : (
                        <>
                          <label htmlFor={id} className="mb-1 block text-xs text-muted">
                            {f.label}
                          </label>
                          {f.type === "select" ? (
                            <select
                              id={id}
                              value={String(v)}
                              onChange={(e) => editParam(f.key, e.target.value)}
                              className="w-full rounded-lg border border-line bg-surface2 px-2.5 py-1.5"
                            >
                              {f.options!.map((o) => (
                                <option key={o}>{o}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id={id}
                              type={f.type === "number" ? "number" : "text"}
                              min={0}
                              value={String(v)}
                              onChange={(e) => editParam(f.key, f.type === "number" ? Number(e.target.value) : e.target.value)}
                              className="w-full rounded-lg border border-line bg-surface2 px-2.5 py-1.5"
                            />
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card
            title="Live database"
            aside={
              <Button variant="ghost" onClick={() => void reset()} disabled={!ready || busy}>
                Reset
              </Button>
            }
          >
            {!counts ? (
              <p className="text-sm text-muted">Starting Postgres in your browser…</p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                {(
                  [
                    ["Customers", counts.customers],
                    ["Orders", counts.orders],
                    ["Payments captured", counts.captured],
                    ["Payments refunded", counts.refunded],
                    ["Ledger net", usd(counts.ledger)],
                    ["Emails held", counts.held],
                    ["Emails sent", counts.sent],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 border-b border-line py-1">
                    <dt className="text-muted">{k}</dt>
                    <dd className="font-mono tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          <Card title="Failure test">
            <p className="text-sm text-muted">
              A simulation can be wrong if the world moves while you review. Add 40 customers now, then approve the pending preview and watch the guard refuse to commit.
            </p>
            <div className="mt-3">
              <Button
                onClick={() => void drift()}
                disabled={!ready || busy || !sim || Boolean(result)}
                title={!sim ? "Run a simulation first" : undefined}
              >
                Simulate a concurrent writer
              </Button>
            </div>
          </Card>
        </aside>

        <main className="min-w-0 space-y-4">
          {!sim && !result && <EmptyState ready={ready} />}

          {result && (
            <ResultCard
              result={result}
              undone={undone}
              recallLeft={recallLeft}
              busy={busy}
              onUndo={() => void undoLast()}
              onResim={() => proposal && void runSim(proposal)}
              onDone={() => {
                setResult(null);
                setSim(null);
                setProposal(null);
              }}
            />
          )}

          {sim && !result && (
            <Report
              sim={sim}
              previews={previews}
              previewing={previewing}
              drifted={drifted}
              busy={busy}
              onApply={applyTweak}
              onApprove={() => void approve()}
              onReject={() => void reject()}
            />
          )}

          <AuditPanel audit={audit} ok={chainOk} />
        </main>
      </div>
    </div>
  );
}

function EmptyState({ ready }: { ready: boolean }) {
  return (
    <Card>
      <h2 className="text-lg font-semibold">Ask for something risky. See it before it happens.</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Pick an example on the left. The agent turns it into an action, runs that action on a real Postgres inside a transaction, records every row it touches, including cascades and trigger side effects, and rolls it back. Nothing is written until you approve.
      </p>
      <ul className="mt-4 grid gap-2.5 text-sm sm:grid-cols-3">
        {[
          ["Simulate", "A real dry run, not a description."],
          ["Decide", "Findings can block it, and safer versions are pre-simulated."],
          ["Execute", "Guarded by what you approved. Drift means rollback."],
        ].map(([t, d]) => (
          <li key={t} className="rounded-lg border border-line bg-surface2 p-3">
            <div className="font-medium">{t}</div>
            <div className="text-muted">{d}</div>
          </li>
        ))}
      </ul>
      {!ready && <p className="mt-4 text-xs text-muted">Starting the database…</p>}
    </Card>
  );
}

function ResultCard({
  result,
  undone,
  recallLeft,
  busy,
  onUndo,
  onResim,
  onDone,
}: {
  result: ExecResult;
  undone: UndoResult | null;
  recallLeft: number;
  busy: boolean;
  onUndo: () => void;
  onResim: () => void;
  onDone: () => void;
}) {
  if (result.status === "rolled_back") {
    return (
      <section role="alert" className="rounded-xl border border-bad/40 bg-badsoft p-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-bad">Safety net tripped</div>
        <h2 className="mt-1 text-xl font-semibold">Nothing was written.</h2>
        <p className="mt-1 text-sm">
          The preview showed <strong>{result.approvedRows}</strong> row changes. The real run would have made <strong>{result.actualRows}</strong>. The transaction was rolled back before commit.
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {result.violations.map((v, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden>•</span>
              <span>{v.detail}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <Button variant="primary" onClick={onResim} disabled={busy}>
            Re-simulate with current data
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Dismiss
          </Button>
        </div>
      </section>
    );
  }

  const rows = Object.values(result.diff).reduce((n, d) => n + d.inserted.length + d.deleted.length + d.updated.length, 0);
  const emails = result.diff.outbox.inserted.length;
  return (
    <section className="rounded-xl border border-ok/40 bg-oksoft p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-ok">Executed</div>
      <h2 className="mt-1 text-xl font-semibold">{rows} rows committed.</h2>
      <p className="mt-1 text-sm">
        {result.matchedPreview
          ? "The real effect matched the preview exactly."
          : "The real effect stayed inside the approved limits but differed in detail from the preview."}
      </p>
      {undone ? (
        <>
          <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
            <strong>Undone.</strong> Removed {undone.restored.removed}, restored {undone.restored.updated} updated and {undone.restored.deleted} deleted rows.
            {undone.unrecoverable.length > 0 && (
              <span className="text-bad"> {undone.unrecoverable.length} delivered emails cannot be unsent.</span>
            )}
          </div>
          <div className="mt-3">
            <Button variant="ghost" onClick={onDone}>
              Done
            </Button>
          </div>
        </>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={onUndo} disabled={busy}>
            Undo
          </Button>
          {emails > 0 && (
            <span className="text-sm">
              {recallLeft > 0 ? `${emails} emails recallable for ${recallLeft}s` : `${emails} emails delivered, can no longer be recalled`}
            </span>
          )}
          <Button variant="ghost" onClick={onDone}>
            Done
          </Button>
        </div>
      )}
    </section>
  );
}

function AuditPanel({ audit, ok }: { audit: AuditEntry[]; ok: boolean }) {
  const recent = [...audit].slice(-8).reverse();
  return (
    <Card title="Audit trail" aside={<span className={`text-xs ${ok ? "text-ok" : "text-bad"}`}>{ok ? "hash chain verified" : "chain broken"}</span>}>
      {recent.length === 0 ? (
        <p className="text-sm text-muted">Every intent, simulation, decision and outcome is recorded here, each entry hashed to the one before it.</p>
      ) : (
        <ol className="space-y-1 font-mono text-xs">
          {recent.map((e) => (
            <li key={e.seq} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line py-1 last:border-0">
              <span className="w-6 text-muted">#{e.seq}</span>
              <span className="w-28 font-semibold">{e.type}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{JSON.stringify(e.data)}</span>
              <span className="text-muted">{e.hash.slice(0, 8)}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
