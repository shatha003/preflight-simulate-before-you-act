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
import { buildSeats, type Roster, type Seat } from "@/lib/field";
import { usd } from "@/lib/format";
import { Button, Label, Mascot, Tag, VerdictChip, verdictMeta } from "./ui";
import { Stamp } from "./Stamp";
import { SignOff } from "./SignOff";
import { Crowd, type FieldMode } from "./Crowd";
import { EyeTracker } from "./EyeTracker";
import { Notes } from "./Notes";
import { TheirSide } from "./TheirSide";
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
  const [pinnedId, setPinnedId] = useState<number | null>(null);

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
  const seatsRef = useRef<Seat[]>([]);

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
      setPinnedId(null);
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
    setPinnedId(null);
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
    setPinnedId(null);
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
    a.download = `preflight-flight-log-${Date.now()}.json`;
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
      await say(2, "I ask the agent to clean up dormant accounts. Preflight gives it a ghost run: for real, on Postgres, inside a transaction that rolls back.", 600);
      await propose(DEMO_TEXT);
      await say(3, "Every creature is a customer. Ghosts are the accounts this would delete. The red ones, shaking, are the danger.", 4200);
      const risky = seatsRef.current.find((x) => x.danger);
      if (risky && window.innerWidth >= 640) {
        setPinnedId(risky.id);
        await say(3, `Click anyone to see their side. ${risky.name.split(" ")[0]} would lose an account and payments we are legally holding. The database found that cascade. No model guessed it.`, 5200);
        setPinnedId(null);
      }
      await say(4, "Policy ran on what actually changed. The retention rule fails, and the verdict is KILLED.", 4200);
      const fix = previewsRef.current.find((p) => p.tweak.patch.keepWithRecentPayments === true);
      if (fix) {
        await say(5, "A safer plan already had its own ghost run. I use it, and the verdict changes from killed to hold.", 600);
        await applyTweak(fix.tweak.patch);
        await sleep(3200);
      }
      await say(6, "Now the failure case. While I review, another writer imports 40 customers. My ghost run is stale.", 600);
      await injectDrift();
      await sleep(2600);
      await say(7, "I sign off anyway. The real run is measured against exactly what I approved. It is bigger, so it rolls back. Nothing is written.", 600);
      await approve();
      await sleep(5200);
      await say(8, "Fresh ghost run, sign off, and if I regret it, one click restores every row.", 600);
      const p = simRef.current?.proposal ?? proposal;
      if (p) await runSim(p, "re-simulated");
      await sleep(3000);
      await approve();
      await sleep(3200);
      await undoLast();
      await sleep(2400);
      await say(9, "Simulate first. Commit second. Every step is in a hash-chained flight log.", 4200);
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
  seatsRef.current = seats;
  const pinnedSeat = pinnedId === null ? null : (seats.find((x) => x.id === pinnedId && !x.vacant) ?? null);
  const m = sim?.report.metrics;
  const recallLeft = Math.max(0, Math.ceil((committedAt + HOLD_SECONDS * 1000 - now) / 1000));
  const verdict = sim?.report.verdict;
  const vKey = (result ? (result.status === "rolled_back" ? "stopped" : undone ? "recalled" : "printed") : (verdict ?? "idle")) as keyof typeof verdictMeta;
  const meta = verdictMeta[vKey];
  const canSign = (verdict === "safe" || verdict === "review") && !result;
  const jobNo = `PF-${String(audit.filter((a) => a.type === "intent").length + 1).padStart(4, "0")}`;
  const staleNote = (stale.drift || stale.trigger) && !result;

  return (
    <>
      <EyeTracker />

      {/* Ticker */}
      <div className="marquee border-b-[2.5px] border-ink bg-ink py-2 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-lime" aria-hidden>
        <div>
          {[0, 1].map((k) => (
            <span key={k} className="flex">
              {TICKER.map((t) => (
                <span key={t}>
                  {t} <span className="text-pink">✺</span>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-[1320px] px-4 pb-52 pt-8 sm:px-8">
        {/* Hero */}
        <header className="mb-8 grid items-end gap-x-8 gap-y-5 lg:grid-cols-[1fr_auto]">
          <div>
            <div className="flex items-end gap-2 sm:gap-4">
              <Mascot size={92} className="mb-2 hidden shrink-0 sm:block" />
              <h1 className="wordmark text-[68px] font-extrabold leading-[0.82] tracking-[-0.025em] text-cream sm:text-[118px] lg:text-[140px]" style={{ fontStretch: "80%" }} aria-label="Preflight">
                {"Preflight".split("").map((ch, i) => (
                  <span key={i} aria-hidden style={{ ["--i" as string]: i }}>
                    {ch}
                  </span>
                ))}
              </h1>
            </div>
            <p className="mt-4 max-w-[640px] text-[19px] font-medium leading-snug text-cream/90 sm:text-[21px]">
              Every action your agent wants to take gets a <span className="rounded-md bg-cream px-1.5 text-ink">ghost run</span> first. See exactly who it hits. <span className="text-sun">Then</span> decide.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full border-2 border-cream/40 px-3.5 py-1.5 font-mono text-[11.5px] font-semibold uppercase tracking-wider text-cream">
              <span className={ready ? "live-dot" : "h-2.5 w-2.5 rounded-full bg-sun"} aria-hidden />
              {ready ? "Postgres live in this tab" : "Starting Postgres…"}
            </span>
            {demo ? (
              <Button variant="danger" onClick={stopDemo} className="px-5 py-2.5 text-[16px]">
                ■ Stop demo
              </Button>
            ) : (
              <Button variant="sun" onClick={() => void runDemo()} disabled={!ready || busy} className="px-5 py-2.5 text-[16px]">
                ▶ Watch the 90-second demo
              </Button>
            )}
          </div>
        </header>

        {error && (
          <div role="alert" className="card wiggle-in mb-6 bg-tomato px-5 py-3 font-bold">
            {error}
          </div>
        )}

        {/* The ask */}
        <section aria-label="Job" className="card relative mb-8 px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-[26px] font-extrabold leading-none tracking-tight sm:text-[30px]">What should the agent do?</h2>
            <span className="eyebrow text-muted">
              Job {jobNo}
              {source ? ` · ${source}` : ""}
            </span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void propose(text);
            }}
            className="mt-4 flex flex-col gap-3 sm:flex-row"
          >
            <label htmlFor="intent" className="sr-only">
              What should the agent do?
            </label>
            <input
              id="intent"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. delete accounts inactive for 6 months"
              className="min-w-0 flex-1 rounded-2xl border-[2.5px] border-ink bg-white px-4 py-3 text-[19px] font-medium shadow-[inset_3px_3px_0_rgba(14,14,22,0.08)] outline-none transition placeholder:text-muted/70 focus:shadow-[0_0_0_4px_var(--sun)]"
            />
            <Button variant="danger" onClick={() => void propose(text)} disabled={!ready || busy || !text.trim()} className="px-6 py-3 text-[18px] sm:min-w-[200px]">
              Ghost run it <span aria-hidden>→</span>
            </Button>
          </form>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="eyebrow mr-1 text-muted">Or try</span>
            {EXAMPLES.map((ex, i) => (
              <button
                key={ex}
                type="button"
                disabled={!ready || busy}
                onClick={() => void propose(ex)}
                className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-cream px-3 py-1 text-left text-[14.5px] font-semibold transition enabled:hover:-translate-y-0.5 enabled:hover:-rotate-1 enabled:hover:bg-white enabled:hover:shadow-[3px_3px_0_var(--ink)] disabled:opacity-40"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-ink" style={{ background: EX_DOTS[i % EX_DOTS.length] }} aria-hidden />
                {ex}
              </button>
            ))}
          </div>

          {proposal && (
            <div className="settle mt-5 grid gap-x-8 gap-y-4 rounded-2xl border-2 border-dashed border-ink/40 bg-cream2/60 p-4 lg:grid-cols-[auto_1fr]">
              <div className="flex flex-wrap gap-1.5 self-start" role="group" aria-label="Type of job">
                {ACTION_LIST.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => chooseAction(a.id)}
                    aria-pressed={proposal.action === a.id}
                    className={`rounded-full border-2 border-ink px-3.5 py-1 text-[15px] font-bold transition ${proposal.action === a.id ? "bg-ink text-cream" : "bg-cream hover:-rotate-1 hover:bg-white"}`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                {ACTIONS[proposal.action].fields.map((f) => {
                  const v = proposal.params[f.key];
                  const id = `p-${f.key}`;
                  if (f.type === "boolean") {
                    return (
                      <label key={f.key} className="flex cursor-pointer items-center gap-2 pb-1.5 text-[15px] font-semibold">
                        <input type="checkbox" checked={Boolean(v)} onChange={(e) => editParam(f.key, e.target.checked)} className="h-5 w-5 accent-[var(--ink)]" />
                        {f.label}
                      </label>
                    );
                  }
                  return (
                    <div key={f.key}>
                      <label htmlFor={id} className="eyebrow mb-1 block text-muted">
                        {f.label}
                      </label>
                      {f.type === "select" ? (
                        <select id={id} value={String(v)} onChange={(e) => editParam(f.key, e.target.value)} className={field}>
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
                          className={`${field} font-mono text-[14px] ${f.type === "number" ? "w-28" : "w-[24rem] max-w-full"}`}
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

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* The crowd */}
          <article className="card relative px-4 py-5 sm:px-7 sm:py-6">
            <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-[34px] font-extrabold leading-none tracking-tight sm:text-[42px]" style={{ fontStretch: "85%" }}>
                  The crowd
                </h2>
                <p className="mt-1 text-[15px] text-muted">
                  {roster.length} customers. Each one is a real row in Postgres{sim ? `, under a ghost run of: ${ACTIONS[sim.proposal.action].label.toLowerCase()}.` : "."}
                </p>
              </div>
              <span className="eyebrow text-muted">{jobNo}</span>
            </header>

            {staleNote && (
              <div role="status" className="wiggle-in mb-4 flex items-start gap-3 rounded-2xl border-[2.5px] border-ink bg-sun px-4 py-3 font-semibold">
                <span className="text-[22px] leading-none" aria-hidden>
                  ⚠
                </span>
                <span>
                  This ghost run is stale. {stale.drift && "Another writer added customers while you were reviewing. "}
                  {stale.trigger && "A migration shipped a trigger the simulator never saw. "}
                  Signing off will compare the real run against what you saw.
                </span>
              </div>
            )}

            <Crowd seats={seats} mode={mode} onMode={setMode} hasSim={Boolean(sim)} pinnedId={pinnedId} onPick={(s) => setPinnedId((p) => (p === s.id ? null : s.id))} />

            <section className="mt-9 border-t-[2.5px] border-ink pt-5" aria-label="Receipts">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <h3 className="text-[24px] font-extrabold leading-none tracking-tight">{sim ? "The receipts" : "Flight log"}</h3>
                {sim && (
                  <div role="tablist" aria-label="Receipts" className="inline-flex flex-wrap gap-1 rounded-full border-[2.5px] border-ink bg-cream2 p-1">
                    {(
                      [
                        ["diff", "Row by row"],
                        ["sql", "SQL"],
                        ["rollback", "Undo plan"],
                        ["box", "Flight log"],
                      ] as const
                    ).map(([k, l]) => (
                      <button
                        key={k}
                        type="button"
                        role="tab"
                        aria-selected={tab === k}
                        onClick={() => setTab(k)}
                        className={`rounded-full px-3.5 py-1 text-[14px] font-bold transition ${tab === k ? "bg-ink text-cream" : "text-muted hover:text-ink"}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-4">
                {!sim ? (
                  <PressLog audit={audit} ok={chainOk} onExport={exportRecord} />
                ) : (
                  <div key={tab} className="settle">
                    {tab === "diff" && (
                      <>
                        <DiffView diff={sim.diff} />
                        {sim.report.sideEffects.length > 0 && (
                          <ul className="mt-4 space-y-1.5">
                            {sim.report.sideEffects.map((s) => (
                              <li key={s.label} className="flex items-center justify-between gap-3 rounded-xl border-2 border-ink bg-white px-3 py-1.5">
                                <span>{s.label}</span>
                                <span className="flex items-center gap-3">
                                  <Tag tone={s.via === "direct" ? "ink" : s.via === "cascade" ? "red" : "blue"}>{s.via}</Tag>
                                  <span className="font-mono font-bold tabular-nums">{s.count}</span>
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
                )}
              </div>
            </section>
          </article>

          {/* Verdict, checks, alternatives, sabotage */}
          <aside className="space-y-7">
            <section aria-label="Verdict" className="card overflow-hidden bg-ink px-5 pb-6 pt-7 text-cream" style={{ background: "var(--ink)" }}>
              <div className="mb-5 flex justify-center">
                <Stamp key={vKey + (sim?.digest ?? "")} verdict={vKey} />
              </div>
              <p className="text-[21px] font-bold leading-tight">{sim ? headline(sim) : "No ghost run yet."}</p>
              <p className="mt-1.5 text-[14.5px] text-cream/65">{sim ? ACTIONS[sim.proposal.action].describe(sim.proposal.params) : "Nothing is written until you sign off."}</p>
              {m && (
                <dl className="mt-5 grid grid-cols-2 gap-2.5">
                  <Tile k="Customers hit" v={m.customersImpacted} of={m.customersTotal} hot={m.customersImpacted / (m.customersTotal || 1) > 0.5} />
                  <Tile k="Rows changed" v={m.rowsTouched} />
                  <Tile k="Money moving" v={m.moneyMovedCents} money hot={m.moneyMovedCents > 200_000} />
                  <Tile k={m.optedOutRecipients ? `Emails (${m.optedOutRecipients} opted out)` : "Emails queued"} v={m.messagesQueued} hot={m.optedOutRecipients > 0} />
                </dl>
              )}
            </section>

            {sim && (
              <section aria-label="Policy checks" className="card px-5 py-5">
                <h3 className="mb-4 text-[22px] font-extrabold leading-none tracking-tight">Policy checks</h3>
                <Notes checks={sim.report.checks} />
              </section>
            )}

            {sim && (previews.length > 0 || previewing) && (
              <section aria-label="Safer plans" className="card px-5 py-5">
                <h3 className="text-[22px] font-extrabold leading-none tracking-tight">Safer plans</h3>
                <p className="mt-1 text-[14px] text-muted">Each one already had its own ghost run.</p>
                {previewing && <Label className="mt-3 animate-pulse">Ghost-running the alternatives…</Label>}
                <ul className="mt-3 space-y-3">
                  {previews.map((p, i) => (
                    <li key={p.tweak.label} className="settle rounded-2xl border-2 border-ink bg-white p-3.5" style={{ animationDelay: `${i * 90}ms` }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-bold leading-snug">{p.tweak.label}</div>
                        <VerdictChip v={p.verdict} className="shrink-0" />
                      </div>
                      <div className="mt-0.5 text-[14px] text-muted">{p.tweak.why}</div>
                      <div className="mt-2.5 flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-muted">{p.headline}</span>
                        <Button variant="secondary" onClick={() => void applyTweak(p.tweak.patch)} disabled={busy} className="shrink-0 px-3 py-1 text-[13.5px]">
                          Use this →
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-label="Sabotage the ghost run" className="hazard rounded-[22px] border-[2.5px] border-ink p-2 shadow-[6px_6px_0_var(--ink)]">
              <div className="rounded-[14px] border-[2.5px] border-ink bg-cream px-4 py-4">
                <h3 className="text-[22px] font-extrabold leading-none tracking-tight">Sabotage it</h3>
                <p className="mt-1.5 text-[14px] text-muted">A ghost run can go stale. Break it on purpose, sign off anyway, and watch the guard refuse to commit.</p>
                <ul className="mt-3 space-y-2">
                  <li>
                    <SabotageButton onClick={() => void injectDrift()} disabled={!ready || busy || !sim || Boolean(result)} title="Data drift" sub="Another writer imports 40 customers mid-review." />
                  </li>
                  <li>
                    <SabotageButton onClick={() => void injectTrigger()} disabled={!ready || busy || !sim || Boolean(result) || triggerActive} title="Hidden side effect" sub="A migration ships a trigger the simulator never saw." />
                  </li>
                </ul>
                {!sim && <div className="mt-2 text-[13.5px] font-semibold text-muted">Ghost run something first.</div>}
                {triggerActive && (
                  <div className="mt-3 rounded-xl border-2 border-ink bg-tomato px-3 py-2 text-[14px] font-semibold">
                    Trigger <span className="font-mono">shadow_copy</span> is live. Ghost run again to reveal it.{" "}
                    <button type="button" onClick={() => void revertTrigger()} className="underline decoration-2 underline-offset-2">
                      Revert it
                    </button>
                  </div>
                )}
              </div>
            </section>
          </aside>
        </div>

        {/* Live database */}
        <footer className="mt-12 rounded-[22px] border-[2.5px] border-ink bg-cobalt-deep px-5 py-5 text-cream shadow-[6px_6px_0_var(--ink)] sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <h2 className="flex items-center gap-2.5 text-[20px] font-extrabold tracking-tight">
              <span className={ready ? "live-dot" : "h-2.5 w-2.5 rounded-full bg-sun"} aria-hidden />
              Live in this tab&rsquo;s Postgres
            </h2>
            <Button variant="secondary" onClick={() => void reset()} disabled={!ready || busy} className="px-3.5 py-1 text-[14px]">
              ↺ Reset everything
            </Button>
          </div>
          {!counts ? (
            <p className="mt-2 text-cream/70">Starting Postgres in your browser…</p>
          ) : (
            <dl className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
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
                <div key={k} className="rounded-xl border-2 border-cream/25 bg-white/5 px-3 py-2">
                  <dt className="eyebrow text-cream/60">{k}</dt>
                  <dd key={String(v)} className="wiggle-in font-mono text-[17px] font-bold tabular-nums">
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </footer>

        {/* Demo narrator: the mascot talks */}
        {demo && (
          <div role="status" aria-live="polite" className="wiggle-in fixed bottom-32 left-4 z-30 flex w-[min(600px,calc(100%-2rem))] items-end gap-2 sm:left-8">
            <Mascot size={70} className="hidden shrink-0 sm:block" />
            <div className="card relative bg-sun px-5 py-3.5" style={{ background: "var(--sun)" }}>
              <div className="mb-1 flex items-center gap-2">
                <span className="eyebrow">Guided demo</span>
                <span className="flex gap-1" aria-label={`Step ${demo.step} of ${demo.total}`}>
                  {Array.from({ length: demo.total }, (_, i) => (
                    <span key={i} className={`h-1.5 w-3.5 rounded-full border border-ink ${i < demo.step ? "bg-ink" : "bg-transparent"}`} />
                  ))}
                </span>
              </div>
              <p key={demo.caption} className="settle text-[17.5px] font-semibold leading-snug">
                {demo.caption}
              </p>
            </div>
          </div>
        )}

        {pinnedSeat && <TheirSide seat={pinnedSeat} hasSim={Boolean(sim)} onClose={() => setPinnedId(null)} />}

        {/* Sign-off dock */}
        {sim && !result && (
          <div className="fixed inset-x-2 bottom-2 z-20 sm:inset-x-4 sm:bottom-4">
            <div className="wiggle-in mx-auto flex max-w-[1288px] flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-[22px] border-[2.5px] border-ink bg-ink px-4 py-3 text-cream shadow-[0_10px_0_rgba(14,14,22,0.35)] sm:px-6">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <VerdictChip v={vKey} className="text-[13px]" />
                  <span className="text-[15px] text-cream/70">{meta.sub}</span>
                </div>
                <div className="mt-1 hidden text-[15px] font-medium sm:block">
                  {verdict === "blocked"
                    ? "Use a safer plan or change the parameters. Policy will not let this one run."
                    : verdict === "noop"
                      ? "Nothing to run."
                      : "Signing runs it for real, inside the limits you just saw. Anything bigger rolls back."}
                </div>
              </div>
              <div className="flex items-center gap-4 sm:gap-5">
                <button type="button" onClick={() => void reject()} disabled={busy} className="whitespace-nowrap text-[15px] font-bold text-cream underline decoration-2 underline-offset-4 transition hover:text-tomato disabled:opacity-40">
                  Kill this job
                </button>
                <SignOff label="Hold to sign off" disabledLabel="Can't sign off" disabled={!canSign} busy={busy} onComplete={() => void approve()} />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

const TICKER = ["Simulate first", "Commit second", "Real Postgres in this tab", "Every action gets a ghost run", "Policy, not vibes", "One-click undo", "Hash-chained flight log"];
const EX_DOTS = ["var(--tomato)", "var(--pink)", "var(--sun)", "var(--lime)"];
const field = "rounded-xl border-[2.5px] border-ink bg-white px-3 py-1.5 text-[15px] font-semibold outline-none focus:shadow-[0_0_0_3px_var(--sun)]";

function headline(sim: Simulation): string {
  const m = sim.report.metrics;
  if (m.rowsTouched === 0) return "This job matches nothing.";
  const bits = [`changes ${m.rowsTouched} rows`];
  if (m.moneyMovedCents) bits.push(`moves ${usd(m.moneyMovedCents)}`);
  if (m.messagesQueued) bits.push(`emails ${m.messagesQueued} people`);
  if (m.destroyedOrders) bits.push(`deletes ${m.destroyedOrders} orders`);
  return `This job ${bits.join(", ")}.`;
}

/** A number that counts up to its value, so new results land with a bit of weight. */
function useCountUp(target: number, ms = 700) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      setV(target);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      const cur = Math.round(start + (target - start) * e);
      setV(cur);
      from.current = cur;
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Tile({ k, v, of, money, hot }: { k: string; v: number; of?: number; money?: boolean; hot?: boolean }) {
  const n = useCountUp(v);
  return (
    <div className={`rounded-2xl border-2 px-3 py-2.5 transition-colors ${hot ? "border-ink bg-tomato text-ink" : "border-cream/20 bg-white/5"}`}>
      <dt className={`eyebrow ${hot ? "text-ink/75" : "text-cream/55"}`}>{k}</dt>
      <dd className="mt-0.5 font-mono text-[22px] font-bold leading-none tabular-nums">
        {money ? usd(n) : n}
        {of !== undefined && <span className={`text-[12px] font-medium ${hot ? "text-ink/70" : "text-cream/50"}`}> / {of}</span>}
      </dd>
    </div>
  );
}

function SabotageButton({ onClick, disabled, title, sub }: { onClick: () => void; disabled: boolean; title: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-start gap-3 rounded-xl border-2 border-ink bg-white px-3 py-2 text-left transition enabled:hover:-rotate-1 enabled:hover:bg-tomato enabled:hover:shadow-[3px_3px_0_var(--ink)] disabled:opacity-45"
    >
      <span className="mt-0.5 text-[18px] leading-none transition group-enabled:group-hover:rotate-12" aria-hidden>
        ↯
      </span>
      <span>
        <span className="block font-extrabold">{title}</span>
        <span className="block text-[13.5px] text-muted group-enabled:group-hover:text-ink">{sub}</span>
      </span>
    </button>
  );
}

const CONFETTI = ["var(--tomato)", "var(--sun)", "var(--lime)", "var(--pink)", "var(--sky)"];

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
      <section ref={ref} role="alert" className="card jolt mb-8 px-6 py-6 sm:px-9 sm:py-7" style={{ background: "var(--tomato)" }}>
        <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <div className="eyebrow">Safety net tripped · nothing was written</div>
            <h2 className="bigword mt-2 text-[54px] font-extrabold leading-[0.85] tracking-[-0.04em] sm:text-[84px]" style={{ fontStretch: "80%" }} aria-label="Rolled back.">
              {"Rolled back.".split("").map((ch, i) => (
                <span key={i} aria-hidden style={{ ["--i" as string]: i }}>
                  {ch === " " ? " " : ch}
                </span>
              ))}
            </h2>
            <p className="mt-4 max-w-[760px] text-[18px] font-medium">
              The ghost run showed <strong className="rounded-md bg-cream px-1.5 font-mono">{result.approvedRows}</strong> row changes. The real run would have made{" "}
              <strong className="rounded-md bg-ink px-1.5 font-mono text-cream">{result.actualRows}</strong>, so the transaction was rolled back before commit.
            </p>
            <ul className="mt-2 space-y-0.5 text-[15.5px] font-semibold">
              {result.violations.map((v, i) => (
                <li key={i}>✕ {v.detail}</li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="secondary" onClick={onResim} disabled={busy} className="px-5 py-2.5 text-[16px]">
              Ghost run again with current data
            </Button>
            <Button variant="ghost" onClick={onDone}>
              Dismiss
            </Button>
          </div>
        </div>
      </section>
    );
  }
  const rows = Object.values(result.diff).reduce((n, d) => n + d.inserted.length + d.deleted.length + d.updated.length, 0);
  const emails = result.diff.outbox.inserted.length;
  const title = undone ? "Everything restored." : `${rows} rows committed.`;
  return (
    <section ref={ref} key={undone ? "undone" : "done"} className="card wiggle-in relative mb-8 overflow-hidden px-6 py-6 sm:px-9" style={{ background: undone ? "var(--sky)" : "var(--lime)" }}>
      {!undone && (
        <div className="confetti" aria-hidden>
          {Array.from({ length: 36 }, (_, i) => (
            <i key={i} style={{ left: `${(i * 37) % 100}%`, background: CONFETTI[i % CONFETTI.length], ["--r" as string]: ((i * 53) % 100) / 100 }} />
          ))}
        </div>
      )}
      <div className="relative flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="eyebrow">{undone ? "Run recalled" : "Run complete"}</div>
          <h2 className="bigword mt-2 text-[44px] font-extrabold leading-[0.9] tracking-[-0.035em] sm:text-[64px]" style={{ fontStretch: "80%" }} aria-label={title}>
            {title.split("").map((ch, i) => (
              <span key={i} aria-hidden style={{ ["--i" as string]: i }}>
                {ch === " " ? " " : ch}
              </span>
            ))}
          </h2>
          <p className="mt-3 text-[17px] font-medium">
            {undone ? (
              <>
                Removed {undone.restored.removed}, restored {undone.restored.updated} updated and {undone.restored.deleted} deleted rows.
                {undone.unrecoverable.length > 0 && <strong> {undone.unrecoverable.length} delivered emails cannot be unsent.</strong>}
              </>
            ) : result.matchedPreview ? (
              "Reality matched the ghost run exactly."
            ) : (
              "Reality stayed inside the approved limits but differed in detail from the ghost run."
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {!undone && (
            <>
              {emails > 0 && (
                <span className="chip bg-cream">{recallLeft > 0 ? `${emails} emails recallable for ${recallLeft}s` : `${emails} emails delivered, no longer recallable`}</span>
              )}
              <Button variant="primary" onClick={onUndo} disabled={busy} className="px-5 py-2.5 text-[16px]">
                ↺ Undo everything
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
