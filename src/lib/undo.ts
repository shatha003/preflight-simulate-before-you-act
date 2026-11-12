import { withLock, type Db } from "./db";
import type { Diff, Row } from "./diff";
import { TABLES, type TableName } from "./schema";

/** Before-images captured from the committed run. Enough to reverse it. */
export interface UndoPlan {
  insertedIds: Record<TableName, number[]>;
  updated: Record<TableName, { id: number; before: Row; changed: string[] }[]>;
  deleted: Record<TableName, Row[]>;
}

export interface UndoResult {
  restored: { deleted: number; updated: number; removed: number };
  unrecoverable: { table: TableName; id: number; reason: string }[];
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const ident = (s: string) => {
  if (!IDENT.test(s)) throw new Error(`unsafe identifier: ${s}`);
  return s;
};

// Children before parents when deleting, parents before children when inserting.
const DELETE_ORDER: TableName[] = ["ledger", "trash", "outbox", "payments", "orders", "customers"];
const INSERT_ORDER: TableName[] = ["customers", "orders", "payments", "outbox", "ledger", "trash"];

export function buildUndoPlan(diff: Diff): UndoPlan {
  const insertedIds = {} as UndoPlan["insertedIds"];
  const updated = {} as UndoPlan["updated"];
  const deleted = {} as UndoPlan["deleted"];
  for (const t of TABLES) {
    insertedIds[t] = diff[t].inserted.map((r) => r.id);
    updated[t] = diff[t].updated.map((u) => ({ id: u.id, before: u.before, changed: u.changed }));
    deleted[t] = diff[t].deleted;
  }
  return { insertedIds, updated, deleted };
}

export function undo(db: Db, plan: UndoPlan): Promise<UndoResult> {
  return withLock(async () => {
    const result: UndoResult = { restored: { deleted: 0, updated: 0, removed: 0 }, unrecoverable: [] };
    await db.exec("begin");
    try {
      // 1. Remove what the action created. Delivered emails cannot be recalled.
      for (const t of DELETE_ORDER) {
        let ids = plan.insertedIds[t];
        if (!ids.length) continue;
        if (t === "outbox") {
          const sent = await db.query<{ id: number }>("select id from outbox where id = any($1::int[]) and status = 'sent'", [ids]);
          const sentIds = new Set(sent.rows.map((r) => r.id));
          for (const id of sentIds) result.unrecoverable.push({ table: t, id, reason: "already delivered; an email cannot be unsent" });
          ids = ids.filter((id) => !sentIds.has(id));
        }
        if (!ids.length) continue;
        const res = await db.query(`delete from ${ident(t)} where id = any($1::int[])`, [ids]);
        result.restored.removed += res.affectedRows ?? 0;
      }

      // 2. Put changed columns back.
      for (const t of TABLES) {
        for (const u of plan.updated[t]) {
          const cols = u.changed.map(ident);
          const set = cols.map((c) => `${c} = r.${c}`).join(", ");
          await db.query(
            `update ${ident(t)} set ${set} from jsonb_populate_record(null::${ident(t)}, $1::jsonb) r where ${ident(t)}.id = $2`,
            [JSON.stringify(u.before), u.id],
          );
          result.restored.updated++;
        }
      }

      // 3. Bring back deleted rows, parents first.
      for (const t of INSERT_ORDER) {
        for (const row of plan.deleted[t]) {
          await db.query(`insert into ${ident(t)} select * from jsonb_populate_record(null::${ident(t)}, $1::jsonb)`, [JSON.stringify(row)]);
          result.restored.deleted++;
        }
      }
      await db.exec("commit");
      return result;
    } catch (e) {
      await db.exec("rollback");
      throw e;
    }
  });
}

/** Deliver emails whose hold window has passed. After this they cannot be recalled. */
export function deliverHeld(db: Db, holdSeconds: number): Promise<number> {
  return withLock(async () => {
    const res = await db.query(
      "update outbox set status = 'sent' where status = 'held' and created_at <= now() - make_interval(secs => $1::int)",
      [holdSeconds],
    );
    return res.affectedRows ?? 0;
  });
}
