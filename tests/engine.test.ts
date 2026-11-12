import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDb, resetDb, type Db } from "@/lib/db";
import { snapshot, type Snapshot } from "@/lib/diff";
import { simulate, withParams } from "@/lib/simulate";
import { execute } from "@/lib/execute";
import { undo, deliverHeld } from "@/lib/undo";
import { concurrentWriter, shipHiddenTrigger, removeHiddenTrigger } from "@/lib/chaos";
import { ACTIONS, type Proposal } from "@/lib/actions";
import { appendAudit, verifyChain, type AuditEntry } from "@/lib/audit";
import { previewTweaks } from "@/lib/tweaks";

let db: Db;

const plain = (s: Snapshot) => JSON.stringify(Object.fromEntries(Object.entries(s).map(([t, m]) => [t, [...m.values()]])));
const prop = (action: Proposal["action"], patch = {}): Proposal => ({ action, params: { ...ACTIONS[action].defaults, ...patch } });

beforeAll(async () => {
  db = await openDb();
});
beforeEach(async () => {
  await resetDb(db);
});

describe("simulate", () => {
  it("leaves the database exactly as it found it", async () => {
    const before = plain(await snapshot(db));
    for (const a of ["bulk_refund", "send_campaign", "delete_inactive"] as const) await simulate(db, prop(a));
    expect(plain(await snapshot(db))).toBe(before);
  });

  it("reports the same effect the real run produces", async () => {
    const sim = await simulate(db, prop("bulk_refund"));
    expect(sim.report.metrics.rowsTouched).toBeGreaterThan(0);
    const res = await execute(db, sim);
    expect(res.status).toBe("committed");
    if (res.status === "committed") expect(res.matchedPreview).toBe(true);
  });

  it("observes trigger side effects instead of describing them", async () => {
    const sim = await simulate(db, prop("bulk_refund"));
    const n = sim.diff.payments.updated.length;
    expect(n).toBeGreaterThan(0);
    expect(sim.diff.ledger.inserted.length).toBe(n);
    expect(sim.diff.outbox.inserted.filter((m) => m.kind === "refund_receipt").length).toBe(n);
    expect(sim.report.sideEffects.map((s) => s.via)).toContain("trigger");
  });
});

describe("risk decisions", () => {
  it("blocks a campaign that reaches opted-out customers, and the tweak fixes it", async () => {
    const p = prop("send_campaign");
    const sim = await simulate(db, p);
    expect(sim.report.verdict).toBe("blocked");
    expect(sim.report.findings.map((f) => f.id)).toContain("opt-out");

    const previews = await previewTweaks(db, p, sim.report);
    const fix = previews.find((t) => t.tweak.patch.onlyOptedIn === true);
    expect(fix).toBeDefined();
    expect(fix!.verdict).not.toBe("blocked");
    expect(fix!.rowsTouched).toBeLessThan(sim.report.metrics.rowsTouched);
  });

  it("blocks account deletion that cascades into recent payments, and the tweak fixes it", async () => {
    const p = prop("delete_inactive");
    const sim = await simulate(db, p);
    expect(sim.diff.payments.deleted.length).toBeGreaterThan(0);
    expect(sim.diff.trash.inserted.length).toBe(sim.diff.customers.deleted.length);
    expect(sim.report.verdict).toBe("blocked");

    const safer = await simulate(db, withParams(p, { keepWithRecentPayments: true }));
    expect(safer.report.verdict).not.toBe("blocked");
    expect(safer.report.metrics.rowsTouched).toBeLessThan(sim.report.metrics.rowsTouched);
  });

  it("is not blocked or noop for a narrowed refund", async () => {
    const sim = await simulate(db, prop("bulk_refund", { sinceDays: 30, maxPerRefundCents: 5000 }));
    expect(["safe", "review"]).toContain(sim.report.verdict);
  });
});

describe("execute guard", () => {
  it("rolls back and writes nothing when reality outgrows the preview", async () => {
    const p = prop("delete_inactive", { keepWithRecentPayments: true });
    const sim = await simulate(db, p);
    const customersBefore = (await snapshot(db)).customers.size;

    const added = await concurrentWriter(db, 40);
    const res = await execute(db, sim);

    expect(res.status).toBe("rolled_back");
    if (res.status === "rolled_back") {
      expect(res.violations.some((v) => v.kind === "unapproved-delete")).toBe(true);
      expect(res.actualRows).toBeGreaterThan(res.approvedRows);
    }
    expect((await snapshot(db)).customers.size).toBe(customersBefore + added); // only the intruder's rows
  });

  it("also catches drift for emails and refunds", async () => {
    for (const p of [prop("send_campaign", { onlyOptedIn: true }), prop("bulk_refund")]) {
      await resetDb(db);
      const sim = await simulate(db, p);
      await concurrentWriter(db, 40);
      const res = await execute(db, sim);
      expect(res.status, p.action).toBe("rolled_back");
    }
  });
});

describe("under-predicted side effect (hidden trigger)", () => {
  it("is caught for all three actions, and a re-simulation then reveals it", async () => {
    for (const p of [prop("bulk_refund", { sinceDays: 30 }), prop("send_campaign", { onlyOptedIn: true }), prop("delete_inactive", { keepWithRecentPayments: true })]) {
      await resetDb(db);
      const sim = await simulate(db, p);
      expect(sim.report.metrics.unexpectedWrites, p.action).toBe(0);

      await shipHiddenTrigger(db);
      const s0 = plain(await snapshot(db));
      const res = await execute(db, sim);
      expect(res.status, p.action).toBe("rolled_back");
      if (res.status === "rolled_back") expect(res.violations.some((v) => v.table === "trash"), p.action).toBe(true);
      expect(plain(await snapshot(db)), p.action).toBe(s0);

      const again = await simulate(db, p);
      expect(again.report.findings.map((f) => f.id), p.action).toContain("unexpected-writes");
      await removeHiddenTrigger(db);
    }
  });
});

describe("policy checklist", () => {
  it("lists every rule, marking the ones that do not apply", async () => {
    const sim = await simulate(db, prop("send_campaign"));
    const by = Object.fromEntries(sim.report.checks.map((c) => [c.id, c.status]));
    expect(by["opt-out"]).toBe("fail");
    expect(by["retention"]).toBe("na");
    expect(sim.report.checks).toHaveLength(6);
  });
});

describe("undo", () => {
  it("restores a refund exactly", async () => {
    const s0 = plain(await snapshot(db));
    const res = await execute(db, await simulate(db, prop("bulk_refund")));
    if (res.status !== "committed") throw new Error("expected commit");
    expect(plain(await snapshot(db))).not.toBe(s0);
    await undo(db, res.undo);
    expect(plain(await snapshot(db))).toBe(s0);
  });

  it("restores a cascading delete exactly", async () => {
    const s0 = plain(await snapshot(db));
    const res = await execute(db, await simulate(db, prop("delete_inactive")));
    if (res.status !== "committed") throw new Error("expected commit");
    expect((await snapshot(db)).customers.size).toBeLessThan(240);
    await undo(db, res.undo);
    expect(plain(await snapshot(db))).toBe(s0);
  });

  it("cannot recall an email once it has been delivered", async () => {
    const res = await execute(db, await simulate(db, prop("send_campaign", { onlyOptedIn: true })));
    if (res.status !== "committed") throw new Error("expected commit");
    const queued = res.diff.outbox.inserted.length;
    await deliverHeld(db, 0);
    const out = await undo(db, res.undo);
    expect(out.unrecoverable.length).toBe(queued);
    expect((await snapshot(db)).outbox.size).toBe(queued);
  });

  it("recalls held emails completely", async () => {
    const s0 = plain(await snapshot(db));
    const res = await execute(db, await simulate(db, prop("send_campaign", { onlyOptedIn: true })));
    if (res.status !== "committed") throw new Error("expected commit");
    const out = await undo(db, res.undo);
    expect(out.unrecoverable).toHaveLength(0);
    expect(plain(await snapshot(db))).toBe(s0);
  });
});

describe("audit log", () => {
  it("verifies, and detects tampering", async () => {
    let log: AuditEntry[] = [];
    log = await appendAudit(log, "intent", { text: "refund" }, 1);
    log = await appendAudit(log, "simulated", { rows: 10 }, 2);
    log = await appendAudit(log, "executed", { status: "committed" }, 3);
    expect(await verifyChain(log)).toEqual({ ok: true });

    const forged = structuredClone(log);
    (forged[1].data as { rows: number }).rows = 1;
    expect(await verifyChain(forged)).toEqual({ ok: false, brokenAt: 2 });
  });
});
