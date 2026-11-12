import { withLock, type Db } from "./db";
import { diffSnapshots, snapshot, type Diff } from "./diff";
import { TABLES, type TableName } from "./schema";
import { runAction, signature, type Envelope, type Simulation } from "./simulate";
import { buildUndoPlan, type UndoPlan } from "./undo";

export interface Violation {
  table: TableName | "money";
  kind: "unapproved-update" | "unapproved-delete" | "too-many-inserts" | "money-over-cap";
  approved: number;
  actual: number;
  detail: string;
}

export type ExecResult =
  | {
      status: "committed";
      diff: Diff;
      undo: UndoPlan;
      matchedPreview: boolean;
    }
  | {
      status: "rolled_back";
      violations: Violation[];
      approvedRows: number;
      actualRows: number;
    };

const rowsIn = (d: Diff) => TABLES.reduce((n, t) => n + d[t].inserted.length + d[t].deleted.length + d[t].updated.length, 0);

export function checkEnvelope(diff: Diff, env: Envelope): Violation[] {
  const out: Violation[] = [];
  for (const t of TABLES) {
    const stray = diff[t].updated.filter((u) => !env.updatedIds[t].includes(u.id)).length;
    if (stray) {
      out.push({ table: t, kind: "unapproved-update", approved: env.updatedIds[t].length, actual: diff[t].updated.length, detail: `${stray} rows in ${t} would be updated that you never saw in the preview` });
    }
    const strayDel = diff[t].deleted.filter((r) => !env.deletedIds[t].includes(r.id)).length;
    if (strayDel) {
      out.push({ table: t, kind: "unapproved-delete", approved: env.deletedIds[t].length, actual: diff[t].deleted.length, detail: `${strayDel} rows in ${t} would be deleted that you never saw in the preview` });
    }
    if (diff[t].inserted.length > env.maxInserted[t]) {
      out.push({ table: t, kind: "too-many-inserts", approved: env.maxInserted[t], actual: diff[t].inserted.length, detail: `${diff[t].inserted.length} rows in ${t} would be created, you approved ${env.maxInserted[t]}` });
    }
  }
  const money = diff.ledger.inserted.reduce((n, r) => n + Math.abs(Number(r.amount_cents)), 0);
  if (money > env.maxMoneyCents) {
    out.push({ table: "money", kind: "money-over-cap", approved: env.maxMoneyCents, actual: money, detail: `$${(money / 100).toFixed(2)} would move, you approved $${(env.maxMoneyCents / 100).toFixed(2)}` });
  }
  return out;
}

/**
 * Execute an approved simulation. The real run happens in a transaction; the
 * actual effect is measured before COMMIT and compared with the approved
 * envelope. A simulation that under-predicted never reaches the database.
 */
export function execute(db: Db, sim: Simulation): Promise<ExecResult> {
  return withLock(async () => {
    await db.exec("begin");
    try {
      const before = await snapshot(db);
      await runAction(db, sim.proposal);
      const after = await snapshot(db);
      const diff = diffSnapshots(before, after);

      const violations = checkEnvelope(diff, sim.envelope);
      if (violations.length) {
        await db.exec("rollback");
        return {
          status: "rolled_back" as const,
          violations,
          approvedRows: rowsIn(sim.diff),
          actualRows: rowsIn(diff),
        };
      }
      await db.exec("commit");
      return {
        status: "committed" as const,
        diff,
        undo: buildUndoPlan(diff),
        matchedPreview: signature(diff) === sim.signature,
      };
    } catch (e) {
      await db.exec("rollback");
      throw e;
    }
  });
}
