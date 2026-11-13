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
const DEL = "text-[#c8260b] line-through decoration-2";

/** Row by row: struck rows are deleted, sun rows are added, updates show before → after. */
export function DiffView({ diff }: { diff: Diff }) {
  const active = TABLES.filter((t) => diff[t].inserted.length + diff[t].deleted.length + diff[t].updated.length > 0);
  const [pick, setPick] = useState<TableName | null>(null);
  const table = pick && active.includes(pick) ? pick : active[0];

  if (!table) return <p className="text-muted">No rows change.</p>;
  const d = diff[table];
  const cols = COLS[table];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 font-mono text-[12px]">
        {active.map((t) => {
          const x = diff[t];
          const on = t === table;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setPick(t)}
              aria-pressed={on}
              className={`rounded-full border-2 border-ink px-3 py-1 font-semibold transition ${on ? "bg-ink text-cream" : "bg-cream hover:-rotate-2 hover:bg-cream2"}`}
            >
              {t}{" "}
              {x.deleted.length > 0 && <span className={on ? "text-tomato" : "text-[#c8260b]"}>−{x.deleted.length} </span>}
              {x.inserted.length > 0 && <span className={on ? "text-lime" : ""}>+{x.inserted.length} </span>}
              {x.updated.length > 0 && <span className={on ? "text-sky" : "text-cobalt"}>~{x.updated.length}</span>}
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-2xl border-[2.5px] border-ink bg-white">
        <table className="w-full min-w-[520px] border-collapse font-mono text-[11.5px]">
          <thead>
            <tr className="bg-cream2 text-left">
              <th className="w-6 px-2.5 py-2" />
              {cols.map((c) => (
                <th key={c} className="px-2.5 py-2 font-semibold uppercase tracking-wide text-muted">
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
                <td className="px-2.5 py-1.5 font-bold text-cobalt">~</td>
                <td className="px-2.5 py-1.5">{u.id}</td>
                <td className="px-2.5 py-1.5" colSpan={cols.length - 1}>
                  {u.changed.map((c) => (
                    <span key={c} className="mr-4 inline-block">
                      <span className="text-muted">{c}:</span> <span className={DEL}>{fmt(c, u.before[c])}</span> <span className="text-muted">→</span>{" "}
                      <span className="rounded bg-sun px-1 font-semibold text-ink">{fmt(c, u.after[c])}</span>
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
        <tr key={`${sign}${r.id}`} className={`border-t border-rule ${kind === "del" ? "bg-[#fff0ec]" : "bg-[#fffbe6]"}`}>
          <td className={`px-2.5 py-1.5 font-black ${kind === "del" ? "text-[#c8260b]" : ""}`}>{sign}</td>
          {cols.map((c) => (
            <td key={c} className={`max-w-[260px] truncate px-2.5 py-1.5 ${kind === "del" ? DEL : ""}`}>
              {kind === "add" ? <span className="rounded bg-sun px-1">{fmt(c, r[c])}</span> : fmt(c, r[c])}
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
      <td colSpan={span} className="px-2.5 py-1.5 text-muted">
        …and {n} more rows
      </td>
    </tr>
  );
}
