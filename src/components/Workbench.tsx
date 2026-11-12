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
import { Button, CropMarks, Label, Registration, Tag, verdictMeta } from "./ui";
import { Stamp } from "./Stamp";
import { SignOff } from "./SignOff";
import { Ledger, type FieldMode } from "./Ledger";
import { Notes } from "./Notes";
import { DiffView } from "./DiffView";
import { PressLog, Receipts, RollbackPlan } from "./Panels";

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

const underline = "border-b border-ink bg-transparent px-1 py-0.5 outline-none focus:border-b-2";

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

  /** Show the ledger as it stands, then lay the proof over it so the marks draw down the page. */
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
    setSource("chosen by hand");
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
    a.download = `preflight-press-log-${Date.now()}.json`;
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
      await say(2, "I ask the agent to clean up dormant accounts. Preflight runs it for real on a copy, inside a transaction, then marks up the ledger.", 600);
      await propose(DEMO_TEXT);
      await say(3, "Every line is a customer. Struck-through names would be deleted, circled ones are the danger. The database found the cascade into payments. No model guessed it.", 5600);
      await say(4, "Policy ran on what actually changed. The retention rule fails, and the proof is stamped KILLED.", 4200);
      const fix = previewsRef.current.find((p) => p.tweak.patch.keepWithRecentPayments === true);
      if (fix) {
        await say(5, "A safer job was already simulated. I use it, and the stamp changes from killed to hold.", 600);
        await applyTweak(fix.tweak.patch);
        await sleep(3200);
      }
      await say(6, "Now the failure case. While I review, another writer imports 40 customers. My proof is stale.", 600);
      await injectDrift();
      await sleep(2600);
      await say(7, "I sign off anyway. The real run is measured against exactly what I approved. It is bigger, so it rolls back. Nothing is written.", 600);
      await approve();
      await sleep(5200);
      await say(8, "Pull a fresh proof, sign off, and if I regret it, one click restores every row.", 600);
      const p = simRef.current?.proposal ?? proposal;
      if (p) await runSim(p, "re-simulated");
      await sleep(3000);
      await approve();
      await sleep(3200);
      await undoLast();
      await sleep(2400);
      await say(9, "Simulate first. Commit second. Every step is in a hash-chained press log.", 4200);
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
  const m = sim?.report.metrics;
  const recallLeft = Math.max(0, Math.ceil((committedAt + HOLD_SECONDS * 1000 - now) / 1000));
  const verdict = sim?.report.verdict;
  const vKey = (result ? (result.status === "rolled_back" ? "stopped" : undone ? "recalled" : "printed") : (verdict ?? "idle")) as keyof typeof verdictMeta;
  const meta = verdictMeta[vKey];
  const canSign = (verdict === "safe" || verdict === "review") && !result;
  const jobNo = `PF-${String(audit.filter((a) => a.type === "intent").length + 1).padStart(4, "0")}`;
  const staleNote = (stale.drift || stale.trigger) && !result;

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-48 pt-6 sm:px-8">
      {/* Masthead */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex items-start gap-3.5">
          <span className="mt-2"><Registration size={38} /></span>
          <div>
            <h1 className="text-[44px] font-semibold italic leading-none tracking-tight">Preflight</h1>
            <p className="mt-1 text-[16px] text-muted">Pull a proof before the press runs. See who an action hits before it happens.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[15px]">
          <span className="italic text-muted">{ready ? "Postgres is running in this tab" : "Starting Postgres…"}</span>
          {demo ? (
            <Button variant="danger" onClick={stopDemo}>
              Stop demo
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void runDemo()} disabled={!ready || busy}>
              Run the 90-second demo
            </Button>
          )}
        </div>
      </header>

      {error && (
        <div role="alert" className="mb-5 border-2 border-red px-4 py-3 text-red">
          {error}
        </div>
      )}

      {/* Job order */}
      <section aria-label="Job order" className="mb-8 border border-ink/70 bg-paper px-5 py-4 shadow-[3px_3px_0_rgba(27,25,21,0.25)] sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <h2 className="whitespace-nowrap text-[20px] font-semibold italic">Job order</h2>
          <span className="font-type text-[12.5px] text-muted">
            {jobNo}
            {source ? ` · ${source}` : ""}
          </span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void propose(text);
          }}
          className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <label htmlFor="intent" className="sr-only">
            What should the agent do?
          </label>
          <input
            id="intent"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What should the agent do? For example: delete accounts inactive for 6 months"
            className="min-w-0 flex-1 border-b-2 border-ink bg-transparent py-1.5 text-[20px] outline-none placeholder:text-muted/80 focus:border-blue"
          />
          <Button variant="primary" onClick={() => void propose(text)} disabled={!ready || busy || !text.trim()} className="sm:w-40">
            Pull a proof
          </Button>
        </form>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-1 gap-y-1 text-[15px]">
          <span className="italic text-muted">Or pick one up from the spike:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={!ready || busy}
              onClick={() => void propose(ex)}
              className="px-1.5 text-left underline decoration-ink/40 decoration-1 underline-offset-4 enabled:hover:decoration-ink disabled:opacity-40"
            >
              {ex}
            </button>
          ))}
        </div>

        {proposal && (
          <div className="mt-4 grid gap-x-8 gap-y-3 border-t border-rule pt-3 lg:grid-cols-[auto_1fr]">
            <div className="flex flex-wrap gap-x-5 gap-y-1 self-start" role="group" aria-label="Type of job">
              {ACTION_LIST.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => chooseAction(a.id)}
                  aria-pressed={proposal.action === a.id}
                  className={`pb-0.5 text-[17px] ${proposal.action === a.id ? "border-b-2 border-ink font-semibold" : "border-b-2 border-transparent text-muted hover:text-ink"}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              {ACTIONS[proposal.action].fields.map((f) => {
                const v = proposal.params[f.key];
                const id = `p-${f.key}`;
                if (f.type === "boolean") {
                  return (
                    <label key={f.key} className="flex items-center gap-2 pb-0.5 text-[16px]">
                      <input type="checkbox" checked={Boolean(v)} onChange={(e) => editParam(f.key, e.target.checked)} className="h-4 w-4 accent-[var(--ink)]" />
                      {f.label}
                    </label>
                  );
                }
                return (
                  <div key={f.key} className="text-[16px]">
                    <label htmlFor={id} className="block text-[14px] italic text-muted">
                      {f.label}
                    </label>
                    {f.type === "select" ? (
                      <select id={id} value={String(v)} onChange={(e) => editParam(f.key, e.target.value)} className={underline}>
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
                        className={`${underline} font-type text-[15px] ${f.type === "number" ? "w-24" : "w-[24rem] max-w-full"}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {result && (
        <ResultBanner
          result={result}
          undone={undone}
          recallLeft={recallLeft}
          busy={busy}
          onUndo={() => void undoLast()}
          onResim={() => sim && void runSim(sim.proposal)}
          onDone={() => {
            putResult(null);
            putSim(null);
            setProposal(null);
            setMode("reality");
          }}
        />
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* The proof sheet */}
        <article key={sim ? sim.digest : "blank"} className={`sheet relative px-5 py-6 sm:px-9 sm:py-8 ${sim ? "thud" : ""}`}>
          <CropMarks />
          <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[28px] font-semibold italic leading-tight">Customer ledger</h2>
            <span className="font-type text-[12.5px] text-muted">
              {jobNo} · {roster.length} names · proof of {sim ? ACTIONS[sim.proposal.action].label.toLowerCase() : "nothing yet"}
            </span>
          </header>

          {staleNote && (
            <div role="status" className="hand mb-3 text-[22px]">
              This proof is stale.{" "}
              {stale.drift && "Another writer added customers while I was reviewing. "}
              {stale.trigger && "A migration shipped a trigger the simulator never saw. "}
              Signing off will compare the real run against this proof.
            </div>
          )}

          <Ledger seats={seats} mode={mode} onMode={setMode} hasSim={Boolean(sim)} />

          {sim && (
            <section className="mt-9 border-t-2 border-ink pt-3" aria-label="Overleaf">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <h3 className="text-[20px] font-semibold italic">Overleaf: the evidence</h3>
                <div role="tablist" aria-label="Evidence" className="flex flex-wrap gap-x-5">
                  {(
                    [
                      ["diff", "Row by row"],
                      ["sql", "SQL receipt"],
                      ["rollback", "Rollback plan"],
                      ["box", "Press log"],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={tab === k}
                      onClick={() => setTab(k)}
                      className={`pb-0.5 ${tab === k ? "border-b-2 border-ink font-semibold" : "border-b-2 border-transparent text-muted hover:text-ink"}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-4">
                {tab === "diff" && (
                  <>
                    <DiffView diff={sim.diff} />
                    {sim.report.sideEffects.length > 0 && (
                      <ul className="mt-5 border-y border-ink/60">
                        {sim.report.sideEffects.map((s) => (
                          <li key={s.label} className="flex items-baseline justify-between gap-3 border-t border-rule px-1 py-1.5 first:border-t-0">
                            <span>{s.label}</span>
                            <span className="flex items-baseline gap-3">
                              <Tag tone={s.via === "direct" ? "ink" : s.via === "cascade" ? "red" : "blue"}>{s.via}</Tag>
                              <span className="font-type tabular-nums">{s.count}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                {tab === "sql" && <Receipts sim={sim} />}
                {tab === "rollback" && <RollbackPlan sim={sim} />}
                {tab === "box" && <PressLog audit={audit} ok={chainOk} onExport={exportRecord} />}
              </div>
            </section>
          )}

          {!sim && (
            <section className="mt-9 border-t-2 border-ink pt-3" aria-label="Press log">
              <h3 className="mb-3 text-[20px] font-semibold italic">Press log</h3>
              <PressLog audit={audit} ok={chainOk} onExport={exportRecord} />
            </section>
          )}
        </article>

        {/* The desk: verdict, notes, alternatives, sabotage */}
        <aside className="space-y-9">
          <section aria-label="Verdict">
            <div className="mb-4 flex justify-center py-2">
              <Stamp key={vKey + (sim?.digest ?? "")} verdict={vKey} />
            </div>
            <p className="text-[19px] font-medium leading-snug">{sim ? headline(sim) : "Nothing has been simulated yet."}</p>
            <p className="mt-1 text-[15.5px] italic text-muted">{sim ? ACTIONS[sim.proposal.action].describe(sim.proposal.params) : "Nothing is written until you sign off."}</p>
            {m && (
              <dl className="mt-4 space-y-1.5 text-[16px]">
                <Leader k="Customers hit" v={`${m.customersImpacted} of ${m.customersTotal}`} hot={m.customersImpacted / (m.customersTotal || 1) > 0.5} />
                <Leader k="Rows changed" v={String(m.rowsTouched)} />
                <Leader k="Money moving" v={usd(m.moneyMovedCents)} hot={m.moneyMovedCents > 200_000} />
                <Leader k="Emails queued" v={m.optedOutRecipients ? `${m.messagesQueued} (${m.optedOutRecipients} opted out)` : String(m.messagesQueued)} hot={m.optedOutRecipients > 0} />
              </dl>
            )}
          </section>

          {sim && (
            <section aria-label="Proofreader's notes">
              <h3 className="mb-3 border-b border-rule pb-1 text-[20px] font-semibold italic">Proofreader&rsquo;s notes</h3>
              <Notes checks={sim.report.checks} />
            </section>
          )}

          {sim && (previews.length > 0 || previewing) && (
            <section aria-label="Safer jobs">
              <h3 className="mb-1 border-b border-rule pb-1 text-[20px] font-semibold italic">Safer jobs, already proofed</h3>
              {previewing && <Label>Running the alternatives…</Label>}
              <ul className="mt-2 space-y-4">
                {previews.map((p) => (
                  <li key={p.tweak.label}>
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="font-medium">{p.tweak.label}</div>
                      <span className={`font-slab text-[13px] ${verdictMeta[p.verdict].color}`}>{verdictMeta[p.verdict].word}</span>
                    </div>
                    <div className="text-[15px] italic text-muted">{p.tweak.why}</div>
                    <div className="mt-1 flex items-baseline justify-between gap-2">
                      <span className="font-type text-[12.5px] text-muted">{p.headline}</span>
                      <Button variant="secondary" onClick={() => void applyTweak(p.tweak.patch)} disabled={busy}>
                        Use this plan
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Sabotage the proof" className="border border-dashed border-ink/70 p-4">
            <h3 className="text-[20px] font-semibold italic">Sabotage the proof</h3>
            <p className="mt-1 text-[15px] text-muted">A proof can be wrong. Break it on purpose, sign off, and watch the guard refuse to commit.</p>
            <ul className="mt-3 space-y-2.5">
              <li>
                <button type="button" onClick={() => void injectDrift()} disabled={!ready || busy || !sim || Boolean(result)} className="text-left underline decoration-1 underline-offset-4 enabled:hover:text-red disabled:no-underline disabled:opacity-40">
                  Data drift
                </button>
                <div className="text-[14.5px] italic text-muted">Another writer imports 40 customers mid-review.</div>
              </li>
              <li>
                <button type="button" onClick={() => void injectTrigger()} disabled={!ready || busy || !sim || Boolean(result) || triggerActive} className="text-left underline decoration-1 underline-offset-4 enabled:hover:text-red disabled:no-underline disabled:opacity-40">
                  Hidden side effect
                </button>
                <div className="text-[14.5px] italic text-muted">A migration ships a trigger the simulator never saw.</div>
              </li>
            </ul>
            {!sim && <div className="mt-2 text-[14px] italic text-muted">Pull a proof first.</div>}
            {triggerActive && (
              <div className="mt-3 border-t border-rule pt-2 text-[15px] text-red">
                Trigger <span className="font-type">shadow_copy</span> is live. Pull a fresh proof to reveal it.{" "}
                <button type="button" onClick={() => void revertTrigger()} className="underline underline-offset-2">
                  Revert it
                </button>
              </div>
            )}
          </section>
        </aside>
      </div>

      {/* On the press now */}
      <footer className="mt-12 border-t-2 border-ink pt-3 text-[15px]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 className="font-semibold italic">On the press right now</h2>
          <Button variant="ghost" onClick={() => void reset()} disabled={!ready || busy}>
            Reset the shop
          </Button>
        </div>
        {!counts ? (
          <p className="italic text-muted">Starting Postgres in your browser…</p>
        ) : (
          <dl className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1 font-type text-[13px] sm:grid-cols-4 lg:grid-cols-7">
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
              <div key={k}>
                <dt className="font-sans text-[14px] italic text-muted">{k}</dt>
                <dd className="tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </footer>

      {/* Demo caption */}
      {demo && (
        <div role="status" aria-live="polite" className="settle fixed inset-x-0 bottom-28 z-30 mx-auto w-[min(820px,calc(100%-2rem))]">
          <div className="border-2 border-ink bg-hi px-5 py-3 shadow-[4px_4px_0_rgba(27,25,21,0.35)]">
            <div className="font-type text-[12px]">
              Guided demo · {demo.step}/{demo.total}
            </div>
            <p className="text-[18px] leading-snug">{demo.caption}</p>
          </div>
        </div>
      )}

      {/* Sign-off */}
      {sim && !result && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-ink bg-paper shadow-[0_-10px_30px_-12px_rgba(50,36,10,0.5)]">
          <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2 sm:px-8 sm:py-2.5">
            <div className="min-w-0">
              <div className="flex items-baseline gap-3">
                <span className={`font-slab text-[22px] ${meta.color}`}>{meta.word}</span>
                <span className="text-[16px] italic text-muted">{meta.sub}</span>
              </div>
              <div className="hidden text-[15px] sm:block">
                {verdict === "blocked"
                  ? "Use a safer job or change the parameters. Policy will not let this one run."
                  : verdict === "noop"
                    ? "Nothing to run."
                    : "Signing runs it for real, inside the limits you just reviewed. Anything bigger rolls back."}
              </div>
            </div>
            <div className="flex items-end gap-4 sm:gap-6">
              <Button variant="ghost" onClick={() => void reject()} disabled={busy} className="whitespace-nowrap">
                Kill this job
              </Button>
              <SignOff label="Hold to sign off" disabledLabel="Can't sign off" disabled={!canSign} busy={busy} onComplete={() => void approve()} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function headline(sim: Simulation): string {
  const m = sim.report.metrics;
  if (m.rowsTouched === 0) return "This job matches nothing.";
  const bits = [`changes ${m.rowsTouched} rows`];
  if (m.moneyMovedCents) bits.push(`moves ${usd(m.moneyMovedCents)}`);
  if (m.messagesQueued) bits.push(`emails ${m.messagesQueued} people`);
  if (m.destroyedOrders) bits.push(`deletes ${m.destroyedOrders} orders`);
  return `This job ${bits.join(", ")}.`;
}

function Leader({ k, v, hot }: { k: string; v: string; hot?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt>{k}</dt>
      <span className="leader" aria-hidden />
      <dd className={`font-type text-[15px] tabular-nums ${hot ? "font-bold text-red" : ""}`}>{v}</dd>
    </div>
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
      <section ref={ref} role="alert" className="settle mb-8 bg-ink px-6 py-6 text-paper sm:px-9">
        <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <div className="font-type text-[12.5px] text-[#ff9a8e]">Safety net tripped · extra edition</div>
            <h2 className="mt-1 text-[48px] font-semibold italic leading-none sm:text-[60px]">Stop the press.</h2>
            <p className="mt-3 text-[19px]">
              <strong>Nothing was written.</strong> The proof showed <strong className="font-type">{result.approvedRows}</strong> row changes. The real run would have made{" "}
              <strong className="font-type text-[#ff9a8e]">{result.actualRows}</strong>, so the transaction was rolled back before commit.
            </p>
            <ul className="mt-2 space-y-0.5 text-[16px] text-[#ffc2ba]">
              {result.violations.map((v, i) => (
                <li key={i}>– {v.detail}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={onResim} disabled={busy} className="bg-paper px-4 py-2 text-[16px] font-medium text-ink disabled:opacity-40">
              Re-simulate with current data
            </button>
            <button type="button" onClick={onDone} className="text-[16px] underline underline-offset-4">
              Dismiss
            </button>
          </div>
        </div>
      </section>
    );
  }
  const rows = Object.values(result.diff).reduce((n, d) => n + d.inserted.length + d.deleted.length + d.updated.length, 0);
  const emails = result.diff.outbox.inserted.length;
  return (
    <section ref={ref} className="settle mb-8 border-2 border-ink bg-paper px-6 py-5 sm:px-9">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="font-type text-[12.5px] text-muted">{undone ? "Run recalled" : "Run complete"}</div>
          <h2 className="mt-1 text-[40px] font-semibold italic leading-none">{undone ? "Everything restored." : `${rows} rows committed.`}</h2>
          <p className="mt-2 text-[17px]">
            {undone ? (
              <>
                Removed {undone.restored.removed}, restored {undone.restored.updated} updated and {undone.restored.deleted} deleted rows.
                {undone.unrecoverable.length > 0 && <span className="text-red"> {undone.unrecoverable.length} delivered emails cannot be unsent.</span>}
              </>
            ) : result.matchedPreview ? (
              "The real effect matched the proof exactly."
            ) : (
              "The real effect stayed inside the approved limits but differed in detail from the proof."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {!undone && (
            <>
              {emails > 0 && <span className="font-type text-[12.5px]">{recallLeft > 0 ? `${emails} emails can be recalled for ${recallLeft}s` : `${emails} emails delivered, no longer recallable`}</span>}
              <Button variant="secondary" onClick={onUndo} disabled={busy}>
                Undo everything
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    </section>
  );
}
