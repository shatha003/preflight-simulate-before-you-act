import type { Db } from "./db";
import type { Params, Proposal } from "./actions";
import type { RiskReport, Verdict } from "./risk";
import { simulate, withParams } from "./simulate";

export interface Tweak {
  label: string;
  why: string;
  patch: Params;
}

export interface TweakPreview {
  tweak: Tweak;
  verdict: Verdict;
  rowsTouched: number;
  headline: string;
}

/** Parameter changes that address the findings. Each is simulated before it is offered. */
export function suggestTweaks(p: Proposal, report: RiskReport): Tweak[] {
  const has = (id: string) => report.findings.some((f) => f.id === id);
  const out: Tweak[] = [];
  const cur = p.params;

  if (p.action === "send_campaign") {
    if (has("opt-out") && !cur.onlyOptedIn) {
      out.push({ label: "Only opted-in customers", why: "Removes everyone who declined marketing", patch: { onlyOptedIn: true } });
    }
    if (cur.includeInactive && (has("broad") || has("volume") || has("opt-out"))) {
      out.push({ label: "Exclude inactive customers", why: "Shrinks the audience to active accounts", patch: { includeInactive: false } });
    }
  }

  if (p.action === "delete_inactive") {
    if ((has("cascade-financial") || has("cascade")) && !cur.keepWithRecentPayments) {
      out.push({ label: "Keep anyone who paid in the last year", why: "Spares accounts whose payments would cascade away", patch: { keepWithRecentPayments: true } });
    }
    if (Number(cur.inactiveDays) < 365) {
      out.push({ label: "Raise threshold to 365 days", why: "Only the longest-dormant accounts", patch: { inactiveDays: 365 } });
    }
  }

  if (p.action === "bulk_refund") {
    if ((has("money-cap") || has("money-warn")) && Number(cur.maxPerRefundCents) === 0) {
      out.push({ label: "Cap each refund at $50", why: "Limits money out per payment", patch: { maxPerRefundCents: 5000 } });
    }
    if ((has("money-cap") || has("money-warn") || has("broad")) && Number(cur.sinceDays) > 30) {
      out.push({ label: "Only the last 30 days", why: "Narrows the window", patch: { sinceDays: 30 } });
    }
    if (cur.plan === "any" && (has("money-cap") || has("money-warn"))) {
      out.push({ label: "Only pro-plan payments", why: "Limits to one segment", patch: { plan: "pro" } });
    }
  }

  return out;
}

export async function previewTweaks(db: Db, p: Proposal, report: RiskReport): Promise<TweakPreview[]> {
  const out: TweakPreview[] = [];
  for (const tweak of suggestTweaks(p, report)) {
    const sim = await simulate(db, withParams(p, tweak.patch));
    const m = sim.report.metrics;
    out.push({
      tweak,
      verdict: sim.report.verdict,
      rowsTouched: m.rowsTouched,
      headline: `${m.customersImpacted} customers, ${m.rowsTouched} rows`,
    });
  }
  return out;
}
