"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openDb, resetDb, type Db } from "@/lib/db";
import { ACTION_LIST, ACTIONS, coerceParams, type ActionId, type Params, type Proposal } from "@/lib/actions";
import { simulate, type Simulation } from "@/lib/simulate";
import { execute, type ExecResult } from "@/lib/execute";
import { undo, deliverHeld, type UndoResult } from "@/lib/undo";
import { previewTweaks, type TweakPreview } from "@/lib/tweaks";
import { concurrentWriter, removeHiddenTrigger, shipHiddenTrigger } from "@/lib/chaos";
import { appendAudit, verifyChain, type AuditEntry } from "@/lib/audit";
import { HOLD_SECONDS } from "@/lib/risk";
import { parseIntentRules } from "@/lib/intent";
import { buildSeats, type Roster } from "@/lib/field";
import { usd } from "@/lib/format";
import { Button, Chip, Panel, verdictMeta } from "./ui";
import { Flap } from "./Flap";
import { HoldButton } from "./HoldButton";
import { Field, type FieldMode } from "./Field";
import { Checklist } from "./Checklist";
import { DiffView } from "./DiffView";
import { BlackBox, Receipts, RollbackPlan } from "./Panels";

const EXAMPLES = [
  "Delete accounts that have been inactive for 6 months",
  "Email our pro customers a win-back offer",
  "Refund everyone who paid in the last 90 days",
  "Refund payments from the last month under $50",
];

const DEMO_TEXT = EXAMPLES[0];

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

const ROSTER_SQL = `select id, name, plan, marketing_opt_in as "optIn" from customers order by id`;

const AUDIT_KEY = "preflight-audit-v2";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Tab = "diff" | "sql" | "rollback" | "box";
type Stale = { drift: boolean; trigger: boolean };

export function Workbench() {
  const dbRef = useRef<Db | null>(null);
  const [ready, setReady] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [roster, setRoster] = useState<Roster[]>([]);

  const [text, setText] = useState("");
  const [source, setSource] = useState<string>("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [previews, setPreviews] = useState<TweakPreview[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [stale, setStale] = useState<Stale>({ drift: false, trigger: false });
  const [triggerActive, setTriggerActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("diff");
  const [mode, setMode] = useState<FieldMode>("reality");

  const [result, setResult] = useState<ExecResult | null>(null);
  const [committedAt, setCommittedAt] = useState(0);
  const [undone, setUndone] = useState<UndoResult | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [chainOk, setChainOk] = useState(true);

  const [demo, setDemo] = useState<{ step: number; total: number; caption: string } | null>(null);

  const auditRef = useRef<AuditEntry[]>([]);
  const token = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simRef = useRef<Simulation | null>(null);
  const previewsRef = useRef<TweakPreview[]>([]);
  const resultRef = useRef<ExecResult | null>(null);
  const cancelDemo = useRef(false);

  const refresh = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    const [c, r] = await Promise.all([db.query<Counts>(COUNTS_SQL), db.query<Roster>(ROSTER_SQL)]);
    setCounts(c.rows[0]);
    setRoster(r.rows);
  }, []);

  const log = useCallback(async (type: string, data: unknown) => {
    auditRef.current = await appendAudit(auditRef.current, type, data);
    setAudit(auditRef.current);
    setChainOk((await verifyChain(auditRef.current)).ok);
    try {
      localStorage.setItem(AUDIT_KEY, JSON.stringify(auditRef.current.slice(-200)));
    } catch {}
  }, []);

  const putSim = (s: Simulation | null) => {
    simRef.current = s;
    setSim(s);
  };
  const putPreviews = (p: TweakPreview[]) => {
    previewsRef.current = p;
    setPreviews(p);
  };
  const putResult = (r: ExecResult | null) => {
    resultRef.current = r;
    setResult(r);
  };

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
    openDb("idb://preflight-v2")
      .catch(() => openDb())
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

  /** Show reality first, then flip to the simulation so the blast radius ripples out. */
  const reveal = useCallback(() => {
    if (modeTimer.current) clearTimeout(modeTimer.current);
    setMode("reality");
    modeTimer.current = setTimeout(() => setMode("sim"), 450);
  }, []);

  const runSim = useCallback(
    async (p: Proposal, why = "simulated") => {
      const db = dbRef.current;
      if (!db) return;
      const mine = ++token.current;
      setBusy(true);
      setError("");
      putResult(null);
      setUndone(null);
      try {
        const s = await simulate(db, p);
        if (mine !== token.current) return;
        putSim(s);
        setStale({ drift: false, trigger: false });
        putPreviews([]);
        setPreviewing(true);
        reveal();
        await log(why, {
          action: p.action,
          params: p.params,
          verdict: s.report.verdict,
          rows: s.report.metrics.rowsTouched,
          digest: s.digest,
          findings: s.report.findings.map((f) => f.id),
        });
        const pv = await previewTweaks(db, p, s.report);
        if (mine === token.current) putPreviews(pv);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mine === token.current) {
          setBusy(false);
          setPreviewing(false);
        }
      }
    },
    [log, reveal],
  );

  async function propose(input: string) {
    const t = input.trim();
    if (!t || !dbRef.current) return;
    setBusy(true);
    setError("");
    let parsed;
    try {
      const res = await fetch("/api/intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t }) });
      if (!res.ok) throw new Error("intent failed");
      parsed = await res.json();
    } catch {
      parsed = parseIntentRules(t);
    }
    setText(t);
    setSource(parsed.source === "llm" ? "read by an LLM" : "read by the rule parser");
    setProposal(parsed.proposal);
    await log("intent", { text: t, source: parsed.source, action: parsed.proposal.action, params: parsed.proposal.params });
    await runSim(parsed.proposal);
  }

  function chooseAction(id: ActionId) {
    const p: Proposal = { action: id, params: { ...ACTIONS[id].defaults } };
    setProposal(p);
    setSource("chosen manually");
    void runSim(p);
  }

  function editParam(key: string, value: string | number | boolean) {
    if (!proposal) return;
    const p = { action: proposal.action, params: coerceParams(proposal.action, { ...proposal.params, [key]: value }) };
    setProposal(p);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void runSim(p), 400);
  }

  async function applyTweak(patch: Params) {
    if (!proposal) return;
    const p = { action: proposal.action, params: coerceParams(proposal.action, { ...proposal.params, ...patch }) };
    setProposal(p);
    await runSim(p, "tweaked");
  }

  async function approve() {
    const db = dbRef.current;
    const s = simRef.current;
    if (!db || !s) return;
    setBusy(true);
    try {
      await log("approved", { action: s.proposal.action, verdict: s.report.verdict, approvedRows: s.report.metrics.rowsTouched, digest: s.digest });
      const res = await execute(db, s);
      putResult(res);
      if (res.status === "committed") {
        setCommittedAt(Date.now());
        setMode("committed");
        await log("executed", { status: "committed", matchedPreview: res.matchedPreview });
      } else {
        setMode("reality");
        await log("guard_tripped", { approvedRows: res.approvedRows, actualRows: res.actualRows, violations: res.violations.map((v) => v.detail) });
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
    await log("rejected", { action: simRef.current?.proposal.action });
    putSim(null);
    setProposal(null);
    putResult(null);
    putPreviews([]);
    setMode("reality");
  }

  async function undoLast() {
    const db = dbRef.current;
    const r = resultRef.current;
    if (!db || r?.status !== "committed") return;
    setBusy(true);
    try {
      const u = await undo(db, r.undo);
      setUndone(u);
      setMode("reality");
      await log("undone", { ...u.restored, unrecoverable: u.unrecoverable.length });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function injectDrift() {
    const db = dbRef.current;
    if (!db) return;
    const n = await concurrentWriter(db, 40);
    setStale((s) => ({ ...s, drift: true }));
    await log("drift_injected", { customersAdded: n });
    await refresh();
  }

  async function injectTrigger() {
    const db = dbRef.current;
    if (!db) return;
    await shipHiddenTrigger(db);
    setTriggerActive(true);
    setStale((s) => ({ ...s, trigger: true }));
    await log("trigger_shipped", { name: "shadow_copy", on: ["payments", "outbox", "customers"] });
  }

  async function revertTrigger() {
    const db = dbRef.current;
    if (!db) return;
    await removeHiddenTrigger(db);
    setTriggerActive(false);
    await log("trigger_reverted", {});
  }

  async function reset() {
    const db = dbRef.current;
    if (!db) return;
    token.current++;
    setBusy(true);
    await resetDb(db);
    putSim(null);
    setProposal(null);
    putResult(null);
    putPreviews([]);
    setStale({ drift: false, trigger: false });
    setTriggerActive(false);
    setMode("reality");
    await log("db_reset", {});
    await refresh();
    setBusy(false);
  }

  function exportRecord() {
    const s = simRef.current;
    const doc = {
      exportedAt: new Date().toISOString(),
      app: "Preflight",
      chainVerified: chainOk,
      lastSimulation: s && { proposal: s.proposal, verdict: s.report.verdict, metrics: s.report.metrics, checks: s.report.checks, digest: s.digest, sql: s.sql },
      auditChain: auditRef.current,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `preflight-flight-record-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** A scripted walkthrough of the whole cycle, narrated by captions. */
  async function runDemo() {
    if (!ready || demo) return;
    cancelDemo.current = false;
    const total = 9;
    const say = async (step: number, caption: string, ms: number) => {
      if (cancelDemo.current) throw new Error("stopped");
      setDemo({ step, total, caption });
      await sleep(ms);
      if (cancelDemo.current) throw new Error("stopped");
    };
    try {
      await reset();
      setTab("diff");
      await say(1, "Agents are starting to write to real systems. “Are you sure?” is not a safety story. Watch what happens before it happens.", 4200);
      setText(DEMO_TEXT);
      await say(2, "I ask the agent to clean up dormant accounts. Preflight runs it for real on a copy, inside a transaction.", 600);
      await propose(DEMO_TEXT);
      await say(3, "Every square is a customer. Red ones would be deleted. The database found the cascade into payments. No model guessed it.", 5200);
      await say(4, "Policy runs on what actually changed. The retention rule fails. Takeoff is denied.", 4200);
      const fix = previewsRef.current.find((p) => p.tweak.patch.keepWithRecentPayments === true);
      if (fix) {
        await say(5, "A safer plan was already simulated. I use it, and the verdict drops from denied to hold.", 600);
        await applyTweak(fix.tweak.patch);
        await sleep(3200);
      }
      await say(6, "Now the failure case. While I review, another writer imports 40 customers. My preview is stale.", 600);
      await injectDrift();
      await sleep(2600);
      await say(7, "I approve anyway. The real run is measured against exactly what I approved. It is bigger, so it rolls back. Nothing is written.", 600);
      await approve();
      await sleep(5200);
      await say(8, "Re-simulate on current data, execute, and if I regret it, one click restores every row.", 600);
      if (proposal || simRef.current) {
        const p = simRef.current?.proposal ?? proposal;
        if (p) await runSim(p, "re-simulated");
      }
      await sleep(3000);
      await approve();
      await sleep(3200);
      await undoLast();
      await sleep(2400);
      await say(9, "Simulate first. Commit second. Every step is in a hash-chained flight record.", 4200);
    } catch {
      // stopped by the user
    } finally {
      setDemo(null);
    }
  }

  const stopDemo = () => {
    cancelDemo.current = true;
    setDemo(null);
  };

  const seats = useMemo(() => buildSeats(roster, sim), [roster, sim]);
  const meta = verdictMeta[sim ? sim.report.verdict : "idle"];
  const m = sim?.report.metrics;
  const recallLeft = Math.max(0, Math.ceil((committedAt + HOLD_SECONDS * 1000 - now) / 1000));
  const flightNo = `PF-${String(audit.filter((a) => a.type === "intent").length + 1).padStart(4, "0")}`;
  const verdict = sim?.report.verdict;
  const canTakeoff = (verdict === "safe" || verdict === "review") && !result;

  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-40 pt-5 sm:px-6">
      {/* Header */}
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden className="text-amber">
            <rect x="1" y="1" width="32" height="32" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M17 6v22" stroke="currentColor" strokeWidth="2" strokeDasharray="3 3" />
            <path d="M11 28l6-22 6 22" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          <div>
            <h1 className="font-display text-[28px] font-bold uppercase leading-none tracking-[0.12em]">Preflight</h1>
            <p className="mt-0.5 text-xs text-muted">Simulate before you act. See who an action hits before it happens.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={ready ? "green" : "amber"}>{ready ? "● Postgres online, in this tab" : "○ starting Postgres…"}</Chip>
          <Chip>{flightNo}</Chip>
          {demo ? (
            <Button variant="danger" onClick={stopDemo}>■ Stop demo</Button>
          ) : (
            <Button variant="primary" onClick={() => void runDemo()} disabled={!ready || busy}>▶ Run the 90-second demo</Button>
          )}
        </div>
      </header>

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red/50 bg-red/10 px-4 py-3 text-sm text-red">
          {error}
        </div>
      )}

      {/* Flight plan */}
      <Panel label="Flight plan" aside={<span className="font-mono text-[11px] text-dim">{source}</span>} className="mb-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void propose(text);
          }}
          className="flex flex-col gap-2 sm:flex-row"
        >
          <label htmlFor="intent" className="sr-only">What should the agent do?</label>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-line2 bg-bg/70 px-3 focus-within:border-amber">
            <span className="font-mono text-amber" aria-hidden>›</span>
            <input
              id="intent"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Tell the agent what to do, e.g. “Delete accounts inactive for 6 months”"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-[15px] outline-none placeholder:text-dim"
            />
          </div>
          <Button variant="primary" onClick={() => void propose(text)} disabled={!ready || busy || !text.trim()} className="sm:w-36">
            Simulate
          </Button>
        </form>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={!ready || busy}
              onClick={() => void propose(ex)}
              className="rounded-full border border-line2 px-3 py-1 text-left text-xs text-muted transition hover:border-amber hover:text-ink disabled:opacity-40"
            >
              {ex}
            </button>
          ))}
        </div>

        {proposal && (
          <div className="mt-4 grid gap-3 border-t border-line pt-4 lg:grid-cols-[auto_1fr]">
            <div className="flex gap-1.5 self-start" role="group" aria-label="Action">
              {ACTION_LIST.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => chooseAction(a.id)}
                  aria-pressed={proposal.action === a.id}
                  className={`rounded-lg border px-3 py-1.5 font-display text-[15px] font-semibold uppercase tracking-wider transition ${proposal.action === a.id ? "border-amber bg-amber text-black" : "border-line2 text-muted hover:text-ink"}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-x-5 gap-y-2.5">
              {ACTIONS[proposal.action].fields.map((f) => {
                const v = proposal.params[f.key];
                const id = `p-${f.key}`;
                if (f.type === "boolean") {
                  return (
                    <label key={f.key} className="flex items-center gap-2 pb-1.5 text-sm">
                      <input type="checkbox" checked={Boolean(v)} onChange={(e) => editParam(f.key, e.target.checked)} className="h-4 w-4 accent-[var(--amber)]" />
                      {f.label}
                    </label>
                  );
                }
                return (
                  <div key={f.key} className="text-sm">
                    <label htmlFor={id} className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-dim">{f.label}</label>
                    {f.type === "select" ? (
                      <select id={id} value={String(v)} onChange={(e) => editParam(f.key, e.target.value)} className="rounded-lg border border-line2 bg-bg/70 px-2.5 py-1.5">
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
                        className={`rounded-lg border border-line2 bg-bg/70 px-2.5 py-1.5 ${f.type === "number" ? "w-28" : "w-64"}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Panel>

      {/* Outcome banner */}
      {result && <ResultBanner result={result} undone={undone} recallLeft={recallLeft} busy={busy} onUndo={() => void undoLast()} onResim={() => sim && void runSim(sim.proposal)} onDone={() => { putResult(null); putSim(null); setProposal(null); setMode("reality"); }} />}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Left: manifest + tabs */}
        <div className="space-y-5">
          <Panel label={`Manifest · ${roster.length} customers`}>
            <Field seats={seats} mode={mode} onMode={setMode} hasSim={Boolean(sim)} />
            {(stale.drift || stale.trigger) && !result && (
              <div role="status" className="mt-3 rounded-lg border border-amber/50 bg-amber/10 px-3 py-2 text-sm text-amber">
                <strong>This preview is stale.</strong>{" "}
                {stale.drift && "Another writer added customers while you were reviewing. "}
                {stale.trigger && "A migration shipped a trigger the simulator never saw. "}
                Approving will compare the real effect with this preview.
              </div>
            )}
          </Panel>

          {sim && (
            <Panel
              label="Evidence"
              aside={
                <div role="tablist" className="flex gap-1" aria-label="Evidence">
                  {(
                    [
                      ["diff", "Before → after"],
                      ["sql", "SQL receipt"],
                      ["rollback", "Rollback plan"],
                      ["box", "Flight record"],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={tab === k}
                      onClick={() => setTab(k)}
                      className={`rounded-md px-2.5 py-1 font-display text-[13px] font-semibold uppercase tracking-wider ${tab === k ? "bg-panel2 text-amber" : "text-dim hover:text-ink"}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              }
            >
              {tab === "diff" && (
                <>
                  <DiffView diff={sim.diff} />
                  {sim.report.sideEffects.length > 0 && (
                    <ul className="mt-4 divide-y divide-line rounded-lg border border-line text-sm">
                      {sim.report.sideEffects.map((s) => (
                        <li key={s.label} className="flex items-center justify-between gap-3 px-3 py-2">
                          <span>{s.label}</span>
                          <span className="flex items-center gap-2">
                            <Chip tone={s.via === "direct" ? "muted" : s.via === "cascade" ? "red" : "amber"}>{s.via}</Chip>
                            <span className="font-mono tabular-nums">{s.count}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
              {tab === "sql" && <Receipts sim={sim} />}
              {tab === "rollback" && <RollbackPlan sim={sim} />}
              {tab === "box" && <BlackBox audit={audit} ok={chainOk} onExport={exportRecord} />}
            </Panel>
          )}
          {!sim && (
            <Panel label="Flight record" aside={<span className={`font-mono text-[11px] ${chainOk ? "text-green" : "text-red"}`}>{chainOk ? "● chain verified" : "● chain broken"}</span>}>
              <BlackBox audit={audit} ok={chainOk} onExport={exportRecord} />
            </Panel>
          )}
        </div>

        {/* Right: clearance */}
        <div className="space-y-5">
          <Panel label="Clearance" tone={verdict === "blocked" ? "red" : verdict === "safe" ? "green" : verdict === "review" ? "amber" : undefined} className={sim ? meta.glow : ""}>
            <Flap text={meta.word} className={meta.color} />
            <p className="mt-3 text-sm font-medium">{sim ? headline(sim) : "Pick a flight plan. Nothing has been simulated yet."}</p>
            <p className="mt-0.5 text-xs text-muted">{sim ? ACTIONS[sim.proposal.action].describe(sim.proposal.params) : "Nothing is written until you approve."}</p>
            {m && (
              <dl className="mt-4 grid grid-cols-2 gap-2">
                {[
                  ["Customers hit", `${m.customersImpacted}`, `of ${m.customersTotal}`, m.customersImpacted / (m.customersTotal || 1) > 0.5],
                  ["Rows changed", `${m.rowsTouched}`, "", false],
                  ["Money moved", usd(m.moneyMovedCents), "", m.moneyMovedCents > 200_000],
                  ["Emails queued", `${m.messagesQueued}`, m.optedOutRecipients ? `${m.optedOutRecipients} opted out` : "", m.optedOutRecipients > 0],
                ].map(([k, v, sub, hot]) => (
                  <div key={String(k)} className="rounded-lg border border-line bg-bg/60 px-3 py-2">
                    <dt className="font-mono text-[10px] uppercase tracking-wider text-dim">{k}</dt>
                    <dd className={`font-mono text-xl tabular-nums ${hot ? "text-amber" : ""}`}>{v}</dd>
                    {sub && <div className={`text-[11px] ${hot ? "text-amber" : "text-muted"}`}>{sub}</div>}
                  </div>
                ))}
              </dl>
            )}
          </Panel>

          {sim && (
            <Panel label="Pre-flight checklist">
              <Checklist checks={sim.report.checks} />
            </Panel>
          )}

          {sim && (previews.length > 0 || previewing) && (
            <Panel label="Safer plans, already simulated" aside={previewing ? <span className="font-mono text-[11px] text-dim">simulating…</span> : undefined}>
              <ul className="space-y-2">
                {previews.map((p) => (
                  <li key={p.tweak.label} className="rounded-lg border border-line bg-bg/60 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{p.tweak.label}</div>
                        <div className="text-xs text-muted">{p.tweak.why}</div>
                      </div>
                      <Chip tone={p.verdict === "safe" ? "green" : p.verdict === "review" ? "amber" : p.verdict === "blocked" ? "red" : "muted"}>{verdictMeta[p.verdict].word}</Chip>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-muted">{p.headline}</span>
                      <Button onClick={() => void applyTweak(p.tweak.patch)} disabled={busy}>Use this plan</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel
            label="Fault injection"
            aside={<span className="rounded bg-amber px-1.5 py-0.5 font-mono text-[10px] font-semibold text-black">TEST</span>}
          >
            <div className="hazard mb-3 h-1.5 rounded-full" aria-hidden />
            <p className="text-xs text-muted">A preview can be wrong. Break it on purpose, approve, and watch the guard refuse to commit.</p>
            <div className="mt-3 space-y-2">
              <FaultButton title="Data drift" note="Another writer imports 40 customers mid-review" onClick={() => void injectDrift()} disabled={!ready || busy || !sim || Boolean(result)} />
              <FaultButton title="Hidden side effect" note="A migration ships a trigger the simulator never saw" onClick={() => void injectTrigger()} disabled={!ready || busy || !sim || Boolean(result) || triggerActive} />
              {triggerActive && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-red/40 bg-red/10 px-3 py-2 text-xs text-red">
                  <span>Trigger <span className="font-mono">shadow_copy</span> is live. Re-simulate to reveal it.</span>
                  <button type="button" onClick={() => void revertTrigger()} className="underline">Revert</button>
                </div>
              )}
            </div>
          </Panel>

          <Panel label="Live database" aside={<Button variant="ghost" onClick={() => void reset()} disabled={!ready || busy}>Reset</Button>}>
            {!counts ? (
              <p className="text-sm text-muted">Starting Postgres in your browser…</p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {(
                  [
                    ["Customers", counts.customers],
                    ["Orders", counts.orders],
                    ["Captured", counts.captured],
                    ["Refunded", counts.refunded],
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
          </Panel>
        </div>
      </div>

      {/* Demo caption */}
      {demo && (
        <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-24 z-30 mx-auto w-[min(860px,calc(100%-2rem))] rise">
          <div className="rounded-xl border border-amber/60 bg-[#120e05]/95 px-5 py-3.5 shadow-2xl backdrop-blur">
            <div className="mb-1 font-mono text-[11px] uppercase tracking-widest text-amber">Guided demo · {demo.step}/{demo.total}</div>
            <p className="text-[15px] leading-snug">{demo.caption}</p>
          </div>
        </div>
      )}

      {/* Takeoff bar */}
      {sim && !result && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line2 bg-bg/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <div className={`font-display text-xl font-semibold uppercase tracking-[0.1em] ${meta.color}`}>{meta.word} · {meta.sub}</div>
              <div className="text-xs text-muted">
                {verdict === "blocked"
                  ? "Use a safer plan or change the parameters. Policy will not let this one fly."
                  : verdict === "noop"
                    ? "Nothing to execute."
                    : "Executing runs it for real, inside the limits you just reviewed. Anything bigger rolls back."}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={() => void reject()} disabled={busy}>Reject</Button>
              <HoldButton label={canTakeoff ? "Hold to execute" : "Denied"} disabled={!canTakeoff} busy={busy} onComplete={() => void approve()} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function headline(sim: Simulation): string {
  const m = sim.report.metrics;
  if (m.rowsTouched === 0) return "This action matches nothing.";
  const bits = [`changes ${m.rowsTouched} rows`];
  if (m.moneyMovedCents) bits.push(`moves ${usd(m.moneyMovedCents)}`);
  if (m.messagesQueued) bits.push(`emails ${m.messagesQueued} people`);
  if (m.destroyedOrders) bits.push(`deletes ${m.destroyedOrders} orders`);
  return `This ${bits.join(", ")}.`;
}

function FaultButton({ title, note, onClick, disabled }: { title: string; note: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Run a simulation first" : undefined}
      className="w-full rounded-lg border border-line2 bg-panel2 px-3 py-2 text-left transition enabled:hover:border-red/60 disabled:opacity-35"
    >
      <div className="font-display text-[15px] font-semibold uppercase tracking-wider">{title}</div>
      <div className="text-xs text-muted">{note}</div>
    </button>
  );
}

function ResultBanner({
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
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [result]);

  if (result.status === "rolled_back") {
    return (
      <section ref={ref} role="alert" className="rise mb-5 overflow-hidden rounded-xl border border-red/60 bg-red/10">
        <div className="hazard h-1.5" aria-hidden />
        <div className="grid gap-4 p-5 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-red">Safety net tripped · takeoff rejected</div>
            <h2 className="mt-1 font-display text-3xl font-bold uppercase tracking-wide">Nothing was written.</h2>
            <p className="mt-1 text-sm">
              The preview showed <strong className="font-mono">{result.approvedRows}</strong> row changes. The real run would have made <strong className="font-mono text-red">{result.actualRows}</strong>. The transaction was rolled back before commit.
            </p>
            <ul className="mt-2 space-y-0.5 text-sm text-red">
              {result.violations.map((v, i) => (
                <li key={i}>▸ {v.detail}</li>
              ))}
            </ul>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={onResim} disabled={busy}>Re-simulate with current data</Button>
            <Button variant="ghost" onClick={onDone}>Dismiss</Button>
          </div>
        </div>
      </section>
    );
  }
  const rows = Object.values(result.diff).reduce((n, d) => n + d.inserted.length + d.deleted.length + d.updated.length, 0);
  const emails = result.diff.outbox.inserted.length;
  return (
    <section ref={ref} className="rise mb-5 rounded-xl border border-green/60 bg-green/10 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-green">{undone ? "Recovered" : "Executed"}</div>
          <h2 className="mt-1 font-display text-3xl font-bold uppercase tracking-wide">{undone ? "Everything restored." : `${rows} rows committed.`}</h2>
          <p className="mt-1 text-sm">
            {undone ? (
              <>
                Removed {undone.restored.removed}, restored {undone.restored.updated} updated and {undone.restored.deleted} deleted rows.
                {undone.unrecoverable.length > 0 && <span className="text-red"> {undone.unrecoverable.length} delivered emails cannot be unsent.</span>}
              </>
            ) : result.matchedPreview ? (
              "The real effect matched the preview exactly."
            ) : (
              "The real effect stayed inside the approved limits but differed in detail from the preview."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!undone && (
            <>
              {emails > 0 && <span className="font-mono text-xs">{recallLeft > 0 ? `${emails} emails recallable for ${recallLeft}s` : `${emails} emails delivered, no longer recallable`}</span>}
              <Button onClick={onUndo} disabled={busy}>Undo everything</Button>
            </>
          )}
          <Button variant="ghost" onClick={onDone}>Done</Button>
        </div>
      </div>
    </section>
  );
}
