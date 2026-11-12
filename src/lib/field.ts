import type { Simulation } from "./simulate";
import { usd } from "./format";

export type SeatKind = "idle" | "email" | "refund" | "delete";

export interface Roster {
  id: number;
  name: string;
  plan: string;
  optIn: boolean;
}

/** What this customer would actually experience, read from the simulated diff. */
export interface Story {
  orders: { n: number; cents: number };
  payments: { n: number; cents: number; recent: number };
  refunds: { id: number; cents: number }[];
  emails: { kind: string; subject: string }[];
  archived: boolean;
  optedIn: boolean;
}

export interface Seat {
  id: number;
  vacant: boolean;
  name: string;
  plan: string;
  kind: SeatKind;
  danger: boolean;
  notes: string[];
  story: Story;
}

const emptyStory = (optedIn = false): Story => ({ orders: { n: 0, cents: 0 }, payments: { n: 0, cents: 0, recent: 0 }, refunds: [], emails: [], archived: false, optedIn });

const RETENTION_MS = 365 * 86_400_000;

/**
 * One seat per customer id. `sim` null means reality: nobody is affected.
 * Everything here is read from the simulated diff, nothing is guessed.
 */
export function buildSeats(roster: Roster[], sim: Simulation | null): Seat[] {
  const byId = new Map(roster.map((r) => [r.id, r]));
  const max = roster.reduce((m, r) => Math.max(m, r.id), 0);
  const d = sim?.diff;

  const deleted = new Set(d?.customers.deleted.map((r) => r.id));
  const cascadeOrders = new Map<number, number>();
  const orderCents = new Map<number, number>();
  const cascadePay = new Map<number, { n: number; cents: number; recent: number }>();
  const refunds = new Map<number, number>();
  const refundRows = new Map<number, { id: number; cents: number }[]>();
  const mails = new Map<number, string[]>();
  const mailRows = new Map<number, { kind: string; subject: string }[]>();
  const archived = new Set<number>();
  const now = Date.now();

  for (const t of d?.trash.inserted ?? []) {
    if (t.source === "customers") archived.add(Number((t.row_data as { id?: number }).id));
  }
  for (const o of d?.orders.deleted ?? []) {
    const k = Number(o.customer_id);
    cascadeOrders.set(k, (cascadeOrders.get(k) ?? 0) + 1);
    orderCents.set(k, (orderCents.get(k) ?? 0) + Number(o.total_cents));
  }
  for (const p of d?.payments.deleted ?? []) {
    const k = Number(p.customer_id);
    const cur = cascadePay.get(k) ?? { n: 0, cents: 0, recent: 0 };
    cur.n++;
    cur.cents += Number(p.amount_cents);
    if (p.status === "captured" && now - Date.parse(String(p.captured_at)) < RETENTION_MS) cur.recent++;
    cascadePay.set(k, cur);
  }
  for (const u of d?.payments.updated ?? []) {
    const k = Number(u.after.customer_id);
    refunds.set(k, (refunds.get(k) ?? 0) + Number(u.after.refunded_cents));
    refundRows.set(k, [...(refundRows.get(k) ?? []), { id: u.id, cents: Number(u.after.refunded_cents) }]);
  }
  for (const m of d?.outbox.inserted ?? []) {
    const k = Number(m.customer_id);
    mails.set(k, [...(mails.get(k) ?? []), String(m.kind)]);
    mailRows.set(k, [...(mailRows.get(k) ?? []), { kind: String(m.kind), subject: String(m.subject) }]);
  }

  const seats: Seat[] = [];
  for (let id = 1; id <= max; id++) {
    const r = byId.get(id);
    if (!r) {
      seats.push({ id, vacant: true, name: "", plan: "", kind: "idle", danger: false, notes: [], story: emptyStory() });
      continue;
    }
    const notes: string[] = [];
    let kind: SeatKind = "idle";
    let danger = false;

    if (deleted.has(id)) {
      kind = "delete";
      notes.push("Account deleted");
      const o = cascadeOrders.get(id);
      const p = cascadePay.get(id);
      if (o) notes.push(`Cascades into ${o} order${o > 1 ? "s" : ""}`);
      if (p) notes.push(`${p.n} payment${p.n > 1 ? "s" : ""} destroyed (${usd(p.cents)}), no archive`);
      if (p?.recent) {
        danger = true;
        notes.push("Inside the 12-month retention window");
      }
    } else if (refunds.has(id)) {
      kind = "refund";
      notes.push(`Refund of ${usd(refunds.get(id)!)}`);
      if (mails.get(id)?.includes("refund_receipt")) notes.push("Receipt email queued by trigger");
    } else if (mails.has(id)) {
      kind = "email";
      notes.push("Email queued");
      if (!r.optIn && mails.get(id)!.includes("campaign")) {
        danger = true;
        notes.push("Opted out of marketing");
      }
    }
    const pay = cascadePay.get(id);
    const story: Story = {
      orders: { n: cascadeOrders.get(id) ?? 0, cents: orderCents.get(id) ?? 0 },
      payments: { n: pay?.n ?? 0, cents: pay?.cents ?? 0, recent: pay?.recent ?? 0 },
      refunds: refundRows.get(id) ?? [],
      emails: mailRows.get(id) ?? [],
      archived: archived.has(id),
      optedIn: r.optIn,
    };
    seats.push({ id, vacant: false, name: r.name, plan: r.plan, kind, danger, notes, story });
  }
  return seats;
}
