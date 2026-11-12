// The catalog of high-stakes actions the agent may propose. Each one is real SQL
// that the simulator and the executor both run, so the preview is not a narration.

export type ActionId = "bulk_refund" | "send_campaign" | "delete_inactive";

export type Params = Record<string, string | number | boolean>;

export interface Field {
  key: string;
  label: string;
  type: "select" | "number" | "boolean" | "text";
  options?: string[];
  hint?: string;
}

export interface ActionDef {
  id: ActionId;
  label: string;
  stakes: string; // plain-language label for what can go wrong
  tag: "money" | "email" | "data";
  defaults: Params;
  fields: Field[];
  describe(p: Params): string;
  sql(p: Params): { text: string; params: unknown[] };
}

const plans = ["any", "free", "pro", "team"];

export const ACTIONS: Record<ActionId, ActionDef> = {
  bulk_refund: {
    id: "bulk_refund",
    label: "Bulk refund",
    stakes: "Sends money out",
    tag: "money",
    defaults: { plan: "any", sinceDays: 90, maxPerRefundCents: 0 },
    fields: [
      { key: "plan", label: "Plan", type: "select", options: plans },
      { key: "sinceDays", label: "Captured in last (days)", type: "number" },
      { key: "maxPerRefundCents", label: "Max per refund (cents, 0 = no cap)", type: "number" },
    ],
    describe: (p) =>
      `Refund every captured ${p.plan === "any" ? "" : p.plan + "-plan "}payment from the last ${p.sinceDays} days` +
      (Number(p.maxPerRefundCents) > 0 ? `, each at most $${(Number(p.maxPerRefundCents) / 100).toFixed(2)}` : ""),
    sql: (p) => ({
      text: `update payments set status = 'refunded', refunded_cents = amount_cents
             where status = 'captured'
               and captured_at > now() - make_interval(days => $2::int)
               and ($1 = 'any' or customer_id in (select id from customers where plan = $1))
               and ($3::int = 0 or amount_cents <= $3::int)`,
      params: [p.plan, p.sinceDays, p.maxPerRefundCents],
    }),
  },

  send_campaign: {
    id: "send_campaign",
    label: "Mass email",
    stakes: "Can't be unsent once delivered",
    tag: "email",
    defaults: { plan: "pro", onlyOptedIn: false, includeInactive: true, subject: "We miss you: 30% off for 48 hours" },
    fields: [
      { key: "plan", label: "Segment (plan)", type: "select", options: plans },
      { key: "onlyOptedIn", label: "Only people who opted in to marketing", type: "boolean" },
      { key: "includeInactive", label: "Include inactive customers", type: "boolean" },
      { key: "subject", label: "Subject", type: "text" },
    ],
    describe: (p) =>
      `Email "${p.subject}" to ${p.plan === "any" ? "all" : p.plan + "-plan"} customers` +
      (p.includeInactive ? " including inactive ones" : "") +
      (p.onlyOptedIn ? ", opted-in only" : ""),
    sql: (p) => ({
      text: `insert into outbox(customer_id, kind, subject)
             select id, 'campaign', $4 from customers
             where ($1 = 'any' or plan = $1)
               and (not $2::boolean or marketing_opt_in)
               and ($3::boolean or status = 'active')`,
      params: [p.plan, p.onlyOptedIn, p.includeInactive, p.subject],
    }),
  },

  delete_inactive: {
    id: "delete_inactive",
    label: "Delete inactive accounts",
    stakes: "Destroys data",
    tag: "data",
    defaults: { inactiveDays: 180, keepWithRecentPayments: false },
    fields: [
      { key: "inactiveDays", label: "Inactive for at least (days)", type: "number" },
      { key: "keepWithRecentPayments", label: "Keep accounts with a payment in the last 365 days", type: "boolean" },
    ],
    describe: (p) =>
      `Delete customers inactive for ${p.inactiveDays}+ days` +
      (p.keepWithRecentPayments ? ", keeping anyone who paid in the last year" : ""),
    sql: (p) => ({
      text: `delete from customers
             where last_active_at < now() - make_interval(days => $1::int)
               and (not $2::boolean or not exists (
                     select 1 from payments p
                     where p.customer_id = customers.id and p.status = 'captured'
                       and p.captured_at > now() - interval '365 days'))`,
      params: [p.inactiveDays, p.keepWithRecentPayments],
    }),
  },
};

export const ACTION_LIST = Object.values(ACTIONS);

export interface Proposal {
  action: ActionId;
  params: Params;
}

export function coerceParams(action: ActionId, raw: Record<string, unknown> | undefined): Params {
  const def = ACTIONS[action];
  const out: Params = { ...def.defaults };
  for (const f of def.fields) {
    const v = raw?.[f.key];
    if (v === undefined || v === null) continue;
    if (f.type === "number") {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[f.key] = Math.round(n);
    } else if (f.type === "boolean") out[f.key] = v === true || v === "true";
    else if (f.type === "select") {
      if (f.options?.includes(String(v))) out[f.key] = String(v);
    } else out[f.key] = String(v).slice(0, 120);
  }
  return out;
}
