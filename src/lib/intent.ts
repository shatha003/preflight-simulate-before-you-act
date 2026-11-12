import { ACTIONS, coerceParams, type ActionId, type Proposal } from "./actions";

export interface IntentResult {
  note?: string;
  proposal: Proposal;
  source: "llm" | "rules";
  rationale: string;
}

const num = (s: string) => Number(s.replace(/[, ]/g, ""));

/** Deterministic parser. Used when no LLM is configured or the call fails. */
export function parseIntentRules(text: string): IntentResult {
  const t = text.toLowerCase();
  const raw: Record<string, unknown> = {};

  const plan = t.match(/\b(free|pro|team)\b(?:[- ]plan)?/)?.[1];
  if (plan) raw.plan = plan;
  else if (/\b(all|every|everyone)\b/.test(t)) raw.plan = "any";

  let action: ActionId = "send_campaign";
  if (/refund|money back|reimburse|pay back/.test(t)) action = "bulk_refund";
  else if (/delete|remove|purge|clean ?up|wipe|drop/.test(t) && /account|customer|user|inactive|dormant/.test(t)) action = "delete_inactive";
  else if (/email|mail|campaign|newsletter|promo|announce|win.?back|blast/.test(t)) action = "send_campaign";

  if (action === "bulk_refund") {
    const days = t.match(/(\d+)\s*(day|week|month)/);
    if (days) raw.sinceDays = num(days[1]) * (days[2] === "week" ? 7 : days[2] === "month" ? 30 : 1);
    const cap = t.match(/(?:under|below|at most|max(?:imum)?|up to|less than)\s*\$?\s*([\d,.]+)/);
    if (cap) raw.maxPerRefundCents = Math.round(parseFloat(cap[1].replace(/,/g, "")) * 100);
    if (!raw.plan) raw.plan = "any";
  }

  if (action === "send_campaign") {
    if (/opted.?in|consent|subscribed|allowed marketing/.test(t)) raw.onlyOptedIn = true;
    if (/\b(active only|only active|exclude inactive|not inactive)\b/.test(t)) raw.includeInactive = false;
    if (/inactive|dormant|lapsed|win.?back|miss you/.test(t)) raw.includeInactive = true;
    const subj = text.match(/["“]([^"”]{3,120})["”]/);
    if (subj) raw.subject = subj[1];
  }

  if (action === "delete_inactive") {
    const d = t.match(/(\d+)\s*(day|week|month|year)/);
    if (d) raw.inactiveDays = num(d[1]) * (d[2] === "year" ? 365 : d[2] === "month" ? 30 : d[2] === "week" ? 7 : 1);
    if (/keep|spare|except|unless|but not/.test(t) && /paid|payment|customer|billing/.test(t)) raw.keepWithRecentPayments = true;
  }

  return {
    proposal: { action, params: coerceParams(action, raw) },
    source: "rules",
    rationale: `Matched keywords for "${ACTIONS[action].label}".`,
  };
}
