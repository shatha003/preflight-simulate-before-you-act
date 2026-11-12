import type { PGlite } from "@electric-sql/pglite";
import { SCHEMA_SQL, seedSql } from "./schema";

export type Db = PGlite;

// PGlite is a single connection. Everything that opens a transaction must be serialized.
let chain: Promise<unknown> = Promise.resolve();
export function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export async function openDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = await PGlite.create(dataDir);
  const exists = await db.query<{ t: string | null }>("select to_regclass('public.customers') as t");
  if (!exists.rows[0].t) await installSchema(db);
  return db;
}

async function installSchema(db: Db) {
  await db.exec(SCHEMA_SQL);
  await db.exec(seedSql());
}

export async function resetDb(db: Db) {
  await withLock(async () => {
    await db.exec("drop schema public cascade; create schema public;");
    await installSchema(db);
  });
}
