"use client";

import { useState } from "react";
import type { Diff, Row } from "@/lib/diff";
import { TABLES, type TableName } from "@/lib/schema";
import { usd } from "./ui";

const COLS: Record<TableName, string[]> = {
  customers: ["id", "name", "plan", "status", "marketing_opt_in"],
  orders: ["id", "customer_id", "total_cents", "created_at"],
  payments: ["id", "customer_id", "amount_cents", "status", "captured_at"],
  ledger: ["id", "kind", "amount_cents", "ref"],
  outbox: ["id", "customer_id", "kind", "subject", "status"],
  trash: ["id", "source", "row_data"],
};

function fmt(col: string, v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (col.endsWith("_cents")) return usd(Number(v));
  if (col.endsWith("_at")) return String(v).slice(0, 10);
  if (col === "row_data") return String((v as { name?: string }).name ?? "{…}");
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

const LIMIT = 6;

export function DiffView({ diff }: { diff: Diff }) {
  const active = TABLES.filter((t) => diff[t].inserted.length + diff[t].deleted.length + diff[t].updated.length > 0);
  const [pick, setPick] = useState<TableName | null>(null);
  const table = pick && active.includes(pick) ? pick : active[0];

  if (!table) return <p className="text-sm text-muted">No rows change.</p>;
  const d = diff[table];
  const cols = COLS[table];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {active.map((t) => {
          const n = diff[t].inserted.length + diff[t].deleted.length + diff[t].updated.length;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setPick(t)}
              className={`rounded-md border px-2.5 py-1 font-mono text-xs ${t === table ? "border-ink bg-ink text-bg" : "border-line bg-surface hover:bg-surface2"}`}
            >
              {t} <span className="opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[520px] border-collapse font-mono text-xs">
          <thead>
            <tr className="bg-surface2 text-left text-muted">
              <th className="w-6 px-2 py-1.5" />
              {cols.map((c) => (
                <th key={c} className="px-2 py-1.5 font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Group rows={d.deleted} cols={cols} sign="−" cls="bg-del" />
            <Group rows={d.inserted} cols={cols} sign="+" cls="bg-add" />
            {d.updated.slice(0, LIMIT).map((u) => (
              <tr key={`u${u.id}`} className="border-t border-line">
                <td className="px-2 py-1.5 text-warn">~</td>
                <td className="px-2 py-1.5">{u.id}</td>
                <td className="px-2 py-1.5" colSpan={cols.length - 1}>
                  {u.changed.map((c) => (
                    <span key={c} className="mr-3">
                      {c}: <span className="bg-del px-1 line-through">{fmt(c, u.before[c])}</span> → <span className="bg-add px-1">{fmt(c, u.after[c])}</span>
                    </span>
                  ))}
                </td>
              </tr>
            ))}
            {d.updated.length > LIMIT && <More n={d.updated.length - LIMIT} span={cols.length + 1} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Group({ rows, cols, sign, cls }: { rows: Row[]; cols: string[]; sign: string; cls: string }) {
  return (
    <>
      {rows.slice(0, LIMIT).map((r) => (
        <tr key={`${sign}${r.id}`} className={`border-t border-line ${cls}`}>
          <td className="px-2 py-1.5 font-semibold">{sign}</td>
          {cols.map((c) => (
            <td key={c} className="max-w-[260px] truncate px-2 py-1.5">{fmt(c, r[c])}</td>
          ))}
        </tr>
      ))}
      {rows.length > LIMIT && <More n={rows.length - LIMIT} span={cols.length + 1} />}
    </>
  );
}

function More({ n, span }: { n: number; span: number }) {
  return (
    <tr className="border-t border-line">
      <td colSpan={span} className="px-2 py-1.5 text-muted">+ {n} more rows</td>
    </tr>
  );
}
