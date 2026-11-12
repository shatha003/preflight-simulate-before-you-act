"use client";

import { useState } from "react";
import type { Diff, Row } from "@/lib/diff";
import { TABLES, type TableName } from "@/lib/schema";
import { usd } from "@/lib/format";

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

/** The redline: struck rows are deleted, highlighted rows are added, blue pencil shows what changed in place. */
export function DiffView({ diff }: { diff: Diff }) {
  const active = TABLES.filter((t) => diff[t].inserted.length + diff[t].deleted.length + diff[t].updated.length > 0);
  const [pick, setPick] = useState<TableName | null>(null);
  const table = pick && active.includes(pick) ? pick : active[0];

  if (!table) return <p className="italic text-muted">No rows change.</p>;
  const d = diff[table];
  const cols = COLS[table];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 font-type text-[13px]">
        {active.map((t) => {
          const x = diff[t];
          const on = t === table;
          return (
            <button key={t} type="button" onClick={() => setPick(t)} className={`pb-0.5 ${on ? "border-b-2 border-ink font-bold" : "border-b-2 border-transparent text-muted hover:text-ink"}`}>
              {t}{" "}
              {x.deleted.length > 0 && <span className="text-red">−{x.deleted.length} </span>}
              {x.inserted.length > 0 && <span>+{x.inserted.length} </span>}
              {x.updated.length > 0 && <span className="text-blue">~{x.updated.length}</span>}
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto border-y border-ink/60">
        <table className="w-full min-w-[520px] border-collapse font-type text-[12.5px]">
          <thead>
            <tr className="text-left text-muted">
              <th className="w-6 px-2 py-1.5" />
              {cols.map((c) => (
                <th key={c} className="px-2 py-1.5 font-normal italic">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Group rows={d.deleted} cols={cols} sign="−" kind="del" />
            <Group rows={d.inserted} cols={cols} sign="+" kind="add" />
            {d.updated.slice(0, LIMIT).map((u) => (
              <tr key={`u${u.id}`} className="border-t border-rule">
                <td className="px-2 py-1.5 text-blue">~</td>
                <td className="px-2 py-1.5">{u.id}</td>
                <td className="px-2 py-1.5" colSpan={cols.length - 1}>
                  {u.changed.map((c) => (
                    <span key={c} className="mr-4">
                      <span className="text-muted">{c}:</span> <span className="text-red line-through decoration-[1.5px]">{fmt(c, u.before[c])}</span> <span className="text-muted">→</span>{" "}
                      <span className="bg-hi px-1 text-ink">{fmt(c, u.after[c])}</span>
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

function Group({ rows, cols, sign, kind }: { rows: Row[]; cols: string[]; sign: string; kind: "del" | "add" }) {
  return (
    <>
      {rows.slice(0, LIMIT).map((r) => (
        <tr key={`${sign}${r.id}`} className="border-t border-rule">
          <td className={`px-2 py-1.5 font-bold ${kind === "del" ? "text-red" : ""}`}>{sign}</td>
          {cols.map((c) => (
            <td key={c} className={`max-w-[260px] truncate px-2 py-1.5 ${kind === "del" ? "text-red line-through decoration-[1.5px]" : ""}`}>
              {kind === "add" ? <span className="bg-hi px-0.5">{fmt(c, r[c])}</span> : fmt(c, r[c])}
            </td>
          ))}
        </tr>
      ))}
      {rows.length > LIMIT && <More n={rows.length - LIMIT} span={cols.length + 1} />}
    </>
  );
}

function More({ n, span }: { n: number; span: number }) {
  return (
    <tr className="border-t border-rule">
      <td colSpan={span} className="px-2 py-1.5 italic text-muted">
        and {n} more rows
      </td>
    </tr>
  );
}
