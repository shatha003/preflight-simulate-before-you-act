import type { Db } from "./db";
import { TABLES, type TableName } from "./schema";

export type Row = Record<string, unknown> & { id: number };
export type Snapshot = Record<TableName, Map<number, Row>>;

export interface RowChange {
  id: number;
  before: Row;
  after: Row;
  changed: string[];
}
export interface TableDiff {
  inserted: Row[];
  deleted: Row[];
  updated: RowChange[];
}
export type Diff = Record<TableName, TableDiff>;

/** Read every tracked table. The tables are small; a full snapshot is exact and simple. */
export async function snapshot(db: Db): Promise<Snapshot> {
  const out = {} as Snapshot;
  for (const t of TABLES) {
    const res = await db.query<Row>(`select * from ${t} order by id`);
    const m = new Map<number, Row>();
    for (const r of res.rows) m.set(r.id, JSON.parse(JSON.stringify(r)) as Row);
    out[t] = m;
  }
  return out;
}

export function diffSnapshots(a: Snapshot, b: Snapshot): Diff {
  const out = {} as Diff;
  for (const t of TABLES) {
    const d: TableDiff = { inserted: [], deleted: [], updated: [] };
    for (const [id, row] of b[t]) {
      const prev = a[t].get(id);
      if (!prev) {
        d.inserted.push(row);
        continue;
      }
      const changed = Object.keys(row).filter((k) => JSON.stringify(row[k]) !== JSON.stringify(prev[k]));
      if (changed.length) d.updated.push({ id, before: prev, after: row, changed });
    }
    for (const [id, row] of a[t]) if (!b[t].has(id)) d.deleted.push(row);
    out[t] = d;
  }
  return out;
}

export function countRows(diff: Diff): number {
  return TABLES.reduce((n, t) => n + diff[t].inserted.length + diff[t].deleted.length + diff[t].updated.length, 0);
}
