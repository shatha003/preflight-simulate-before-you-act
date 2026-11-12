import type { Diff, Snapshot } from "./diff";
import { countRows } from "./diff";
import type { Proposal } from "./actions";
import { TABLES, type TableName } from "./schema";

export const HOLD_SECONDS = 60;
export const MONEY_WARN_CENTS = 200_000; // $2,000
export const MONEY_BLOCK_CENTS = 1_000_000; // $10,000

export type Severity = "info" | "warn" | "block";
export type Verdict = "noop" | "safe" | "review" | "blocked";

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

export interface Metrics {
  rowsTouched: number;
  perTable: Record<TableName, { ins: number; upd: number; del: number }>;
  customersImpacted: number;
  customersTotal: number;
  moneyMovedCents: number;
  messagesQueued: number;
  optedOutRecipients: number;
  destroyedPayments: number;
  destroyedPaymentCents: number;
  destroyedOrders: number;
  unexpectedWrites: number;
}

export interface Check {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail" | "na";
  detail: string;
}

export interface SideEffect {
  label: string;
  count: number;
  via: "direct" | "trigger" | "cascade";
}

export interface RollbackStep {
  when: string;
  recoverable: boolean;
  note: string;
}

export interface RiskReport {
  verdict: Verdict;
  metrics: Metrics;
  findings: Finding[];
  checks: Check[];
  sideEffects: SideEffect[];
  rollback: RollbackStep[];
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function assess(proposal: Proposal, diff: Diff, before: Snapshot): RiskReport {
  const perTable = {} as Metrics["perTable"];
  for (const t of TABLES) perTable[t] = { ins: diff[t].inserted.length, upd: diff[t].updated.length, del: diff[t].deleted.length };

  const impacted = new Set<number>();
  for (const r of diff.customers.deleted) impacted.add(r.id);
  for (const r of diff.orders.deleted) impacted.add(Number(r.customer_id));
  for (const r of diff.payments.deleted) impacted.add(Number(r.customer_id));
  for (const c of diff.payments.updated) impacted.add(Number(c.after.customer_id));
  for (const r of diff.outbox.inserted) if (r.customer_id != null) impacted.add(Number(r.customer_id));

  const moneyMovedCents = diff.ledger.inserted.reduce((n, r) => n + Math.abs(Number(r.amount_cents)), 0);
  const messages = diff.outbox.inserted;
  const optedOutRecipients = messages.filter(
    (m) => m.kind === "campaign" && before.customers.get(Number(m.customer_id))?.marketing_opt_in === false,
  ).length;
  // Captured payments inside the 12-month retention window must never be destroyed.
  const retentionCutoff = Date.now() - 365 * 86_400_000;
  const destroyedCaptured = diff.payments.deleted.filter(
    (p) => p.status === "captured" && Date.parse(String(p.captured_at)) > retentionCutoff,
  );

  // Rows written to `trash` that the requested action does not explain (a trigger the user never heard of).
  const expectedTrash = proposal.action === "delete_inactive" ? diff.customers.deleted.length : 0;
  const unexpectedWrites = Math.max(0, diff.trash.inserted.length - expectedTrash);

  const metrics: Metrics = {
    rowsTouched: countRows(diff),
    perTable,
    customersImpacted: impacted.size,
    customersTotal: before.customers.size,
    moneyMovedCents,
    messagesQueued: messages.length,
    optedOutRecipients,
    destroyedPayments: destroyedCaptured.length,
    destroyedPaymentCents: destroyedCaptured.reduce((n, p) => n + Number(p.amount_cents), 0),
    destroyedOrders: diff.orders.deleted.length,
    unexpectedWrites,
  };

  const findings: Finding[] = [];

  if (metrics.rowsTouched === 0) {
    findings.push({ id: "noop", severity: "info", title: "Nothing would change", detail: "The action matches no rows. Check the filters." });
  }

  if (optedOutRecipients > 0) {
    findings.push({
      id: "opt-out",
      severity: "block",
      title: `${optedOutRecipients} recipients opted out of marketing`,
      detail: `Of ${metrics.messagesQueued} emails queued, ${optedOutRecipients} go to customers who declined marketing. Sending is a compliance violation and cannot be recalled once delivered.`,
    });
  }

  if (metrics.destroyedPayments > 0) {
    findings.push({
      id: "cascade-financial",
      severity: "block",
      title: `Destroys ${metrics.destroyedPayments} payments inside the retention window (${usd(metrics.destroyedPaymentCents)})`,
      detail: `Deleting customers cascades into ${metrics.destroyedOrders} orders and ${metrics.destroyedPayments} payments captured in the last 12 months. The archive trigger only saves the customer row, so these financial records have no copy.`,
    });
  } else if (metrics.destroyedOrders > 0) {
    findings.push({
      id: "cascade",
      severity: "warn",
      title: `Cascades into ${metrics.destroyedOrders} orders`,
      detail: "Rows in other tables are deleted along with the target rows and are not archived.",
    });
  }

  if (moneyMovedCents > MONEY_BLOCK_CENTS) {
    findings.push({
      id: "money-cap",
      severity: "block",
      title: `Moves ${usd(moneyMovedCents)}, over the ${usd(MONEY_BLOCK_CENTS)} hard cap`,
      detail: "Single actions above the hard cap are never auto-approved. Narrow the scope or split the action.",
    });
  } else if (moneyMovedCents > MONEY_WARN_CENTS) {
    findings.push({
      id: "money-warn",
      severity: "warn",
      title: `Moves ${usd(moneyMovedCents)}`,
      detail: `Above the ${usd(MONEY_WARN_CENTS)} review threshold. A human must confirm.`,
    });
  }

  const share = metrics.customersTotal ? metrics.customersImpacted / metrics.customersTotal : 0;
  if (share > 0.5) {
    findings.push({
      id: "broad",
      severity: "warn",
      title: `Touches ${Math.round(share * 100)}% of all customers`,
      detail: `${metrics.customersImpacted} of ${metrics.customersTotal} customers are affected. Broad actions get reviewed.`,
    });
  }

  if (metrics.messagesQueued > 100) {
    findings.push({
      id: "volume",
      severity: "warn",
      title: `${metrics.messagesQueued} emails queued`,
      detail: `Held for ${HOLD_SECONDS}s so they can be recalled, then delivered. After that they cannot be unsent.`,
    });
  }

  if (unexpectedWrites > 0) {
    findings.push({
      id: "unexpected-writes",
      severity: "warn",
      title: `${unexpectedWrites} writes you did not ask for`,
      detail: `A trigger copied ${unexpectedWrites} rows into trash. They are not part of this request, so something else on this database is reacting to it.`,
    });
  }

  const sideEffects: SideEffect[] = [];
  if (proposal.action === "bulk_refund") {
    if (diff.payments.updated.length) sideEffects.push({ label: "Payments marked refunded", count: diff.payments.updated.length, via: "direct" });
    if (diff.ledger.inserted.length) sideEffects.push({ label: "Ledger entries written", count: diff.ledger.inserted.length, via: "trigger" });
    const receipts = messages.filter((m) => m.kind === "refund_receipt").length;
    if (receipts) sideEffects.push({ label: "Receipt emails queued", count: receipts, via: "trigger" });
  }
  if (proposal.action === "send_campaign" && messages.length) {
    sideEffects.push({ label: "Campaign emails queued", count: messages.length, via: "direct" });
  }
  if (proposal.action === "delete_inactive") {
    if (diff.customers.deleted.length) sideEffects.push({ label: "Customers deleted", count: diff.customers.deleted.length, via: "direct" });
    if (diff.trash.inserted.length) sideEffects.push({ label: "Customer rows archived", count: diff.trash.inserted.length, via: "trigger" });
    if (diff.orders.deleted.length) sideEffects.push({ label: "Orders deleted (not archived)", count: diff.orders.deleted.length, via: "cascade" });
    if (diff.payments.deleted.length) sideEffects.push({ label: "Payments deleted (not archived)", count: diff.payments.deleted.length, via: "cascade" });
  }

  if (unexpectedWrites > 0) sideEffects.push({ label: "Unrequested copies written to trash", count: unexpectedWrites, via: "trigger" });

  const deletes = diff.customers.deleted.length + diff.orders.deleted.length + diff.payments.deleted.length > 0;
  const campaignMsgs = messages.filter((m) => m.kind === "campaign").length;
  const checks: Check[] = [
    {
      id: "opt-out",
      label: "Respects marketing opt-outs",
      status: campaignMsgs === 0 ? "na" : optedOutRecipients > 0 ? "fail" : "pass",
      detail: campaignMsgs === 0 ? "No marketing email in this action" : optedOutRecipients > 0 ? `${optedOutRecipients} of ${campaignMsgs} recipients opted out` : `All ${campaignMsgs} recipients opted in`,
    },
    {
      id: "retention",
      label: "Keeps records inside the 12-month retention window",
      status: !deletes ? "na" : metrics.destroyedPayments > 0 ? "fail" : "pass",
      detail: !deletes ? "Nothing is deleted" : metrics.destroyedPayments > 0 ? `${metrics.destroyedPayments} payments (${usd(metrics.destroyedPaymentCents)}) would be destroyed` : "No recent financial records are destroyed",
    },
    {
      id: "money",
      label: `Money moved stays under ${usd(MONEY_WARN_CENTS)} (hard cap ${usd(MONEY_BLOCK_CENTS)})`,
      status: moneyMovedCents === 0 ? "na" : moneyMovedCents > MONEY_BLOCK_CENTS ? "fail" : moneyMovedCents > MONEY_WARN_CENTS ? "warn" : "pass",
      detail: moneyMovedCents === 0 ? "No money moves" : `${usd(moneyMovedCents)} moves`,
    },
    {
      id: "blast",
      label: "Touches at most half of all customers",
      status: metrics.rowsTouched === 0 ? "na" : share > 0.5 ? "warn" : "pass",
      detail: `${metrics.customersImpacted} of ${metrics.customersTotal} customers (${Math.round(share * 100)}%)`,
    },
    {
      id: "recall",
      label: "Emails can be recalled before delivery",
      status: messages.length === 0 ? "na" : messages.length > 100 ? "warn" : "pass",
      detail: messages.length === 0 ? "No email is sent" : `${messages.length} held for ${HOLD_SECONDS}s, then delivered for good`,
    },
    {
      id: "contained",
      label: "Writes only what you asked for",
      status: metrics.rowsTouched === 0 ? "na" : unexpectedWrites > 0 ? "warn" : "pass",
      detail: unexpectedWrites > 0 ? `${unexpectedWrites} unrequested writes from a trigger` : "Every changed row is explained by the request",
    },
  ];

  const rollback: RollbackStep[] = [
    {
      when: "While executing",
      recoverable: true,
      note: "The real run is checked against the rows and totals you approve. If it exceeds them, the whole transaction rolls back and nothing is written.",
    },
    {
      when: "After commit: database rows",
      recoverable: true,
      note: `${metrics.rowsTouched} row changes are saved as before-images, so one click restores them.`,
    },
  ];
  if (metrics.messagesQueued > 0) {
    rollback.push({
      when: "After commit: emails",
      recoverable: false,
      note: `Held for ${HOLD_SECONDS}s and recallable until then. Anything delivered after the hold window cannot be unsent.`,
    });
  }

  const verdict: Verdict = findings.some((f) => f.severity === "block")
    ? "blocked"
    : metrics.rowsTouched === 0
      ? "noop"
      : findings.some((f) => f.severity === "warn")
        ? "review"
        : "safe";

  return { verdict, metrics, findings, checks, sideEffects, rollback };
}
