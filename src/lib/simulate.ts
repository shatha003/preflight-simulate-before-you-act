import { withLock, type Db } from "./db";
import { ACTIONS, type Params, type Proposal } from "./actions";
import { diffSnapshots, snapshot, type Diff, type Row, type Snapshot } from "./diff";
import { assess, type RiskReport } from "./risk";
import { TABLES, type TableName } from "./schema";

/** What the human approves. Execution must stay inside it or it rolls back. */
export interface Envelope {
  updatedIds: Record<TableName, number[]>;
  deletedIds: Record<TableName, number[]>;
  maxInserted: Record<TableName, number>;
  maxMoneyCents: number;
}

export interface Simulation {
  proposal: Proposal;
  diff: Diff;
  report: RiskReport;
  envelope: Envelope;
  signature: string;
  at: number;
}

export async function runAction(db: Db, proposal: Proposal) {
  const { text, params } = ACTIONS[proposal.action].sql(proposal.params);
  await db.query(text, params);
}

export function buildEnvelope(diff: Diff): Envelope {
  const updatedIds = {} as Envelope["updatedIds"];
  const deletedIds = {} as Envelope["deletedIds"];
  const maxInserted = {} as Envelope["maxInserted"];
  for (const t of TABLES) {
    updatedIds[t] = diff[t].updated.map((u) => u.id);
    deletedIds[t] = diff[t].deleted.map((r) => r.id);
    maxInserted[t] = diff[t].inserted.length;
  }
  const maxMoneyCents = diff.ledger.inserted.reduce((n, r) => n + Math.abs(Number(r.amount_cents)), 0);
  return { updatedIds, deletedIds, maxInserted, maxMoneyCents };
}

const VOLATILE = new Set(["id", "created_at", "deleted_at"]);
const strip = (r: Row) => JSON.stringify(Object.entries(r).filter(([k]) => !VOLATILE.has(k)).sort(([a], [b]) => (a < b ? -1 : 1)));

/**
 * A fingerprint of an action's effect. Sequence values are not rolled back by
 * Postgres, so inserted ids differ between a dry run and the real run; they are
 * excluded. Everything else must match for the preview to count as faithful.
 */
export function signature(diff: Diff): string {
  const parts: string[] = [];
  for (const t of TABLES) {
    const d = diff[t];
    parts.push(`${t}:ins:${d.inserted.map(strip).sort().join("|")}`);
    parts.push(`${t}:del:${d.deleted.map((r) => r.id).sort((a, b) => a - b).join(",")}`);
    parts.push(`${t}:upd:${d.updated.map((u) => `${u.id}>${u.changed.join("+")}`).sort().join(",")}`);
  }
  return parts.join("\n");
}

/**
 * Run the real action in a transaction, capture exactly what changed, then roll
 * everything back. Cascades and triggers execute for real, so side effects are
 * observed rather than described.
 */
export function simulate(db: Db, proposal: Proposal): Promise<Simulation> {
  return withLock(async () => {
    await db.exec("begin");
    try {
      const before: Snapshot = await snapshot(db);
      await runAction(db, proposal);
      const after = await snapshot(db);
      const diff = diffSnapshots(before, after);
      return {
        proposal,
        diff,
        report: assess(proposal, diff, before),
        envelope: buildEnvelope(diff),
        signature: signature(diff),
        at: Date.now(),
      };
    } finally {
      await db.exec("rollback");
    }
  });
}

export function withParams(p: Proposal, patch: Params): Proposal {
  return { action: p.action, params: { ...p.params, ...patch } };
}
