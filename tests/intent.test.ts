import { describe, expect, it } from "vitest";
import { parseIntentRules } from "@/lib/intent";

describe("rule-based intent parser", () => {
  it("reads refunds with a window and a cap", () => {
    const r = parseIntentRules("Refund pro payments from the last 2 weeks under $50");
    expect(r.proposal.action).toBe("bulk_refund");
    expect(r.proposal.params).toMatchObject({ plan: "pro", sinceDays: 14, maxPerRefundCents: 5000 });
  });

  it("reads a campaign and does not add safety the user did not ask for", () => {
    const r = parseIntentRules("Email our pro customers a win-back offer");
    expect(r.proposal.action).toBe("send_campaign");
    expect(r.proposal.params).toMatchObject({ plan: "pro", onlyOptedIn: false, includeInactive: true });
  });

  it("reads deletion thresholds in months", () => {
    const r = parseIntentRules("Delete accounts inactive for 6 months");
    expect(r.proposal.action).toBe("delete_inactive");
    expect(r.proposal.params.inactiveDays).toBe(180);
  });

  it("clamps junk into valid params", () => {
    const r = parseIntentRules("refund everyone from the last 99999999 days");
    expect(Number.isFinite(Number(r.proposal.params.sinceDays))).toBe(true);
  });
});
