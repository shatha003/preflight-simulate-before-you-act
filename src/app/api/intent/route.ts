import { generateText, Output } from "ai";
import { z } from "zod";
import { coerceParams } from "@/lib/actions";
import { parseIntentRules, type IntentResult } from "@/lib/intent";

export const maxDuration = 30;

const schema = z.object({
  action: z.enum(["bulk_refund", "send_campaign", "delete_inactive"]),
  plan: z.enum(["any", "free", "pro", "team"]).optional(),
  sinceDays: z.number().optional(),
  maxPerRefundCents: z.number().optional(),
  onlyOptedIn: z.boolean().optional(),
  includeInactive: z.boolean().optional(),
  subject: z.string().optional(),
  inactiveDays: z.number().optional(),
  keepWithRecentPayments: z.boolean().optional(),
  rationale: z.string().describe("One sentence: how you read the request."),
});

const SYSTEM = `You translate a request into one structured action for a back-office system.
Actions: bulk_refund (refund captured payments), send_campaign (email customers), delete_inactive (delete dormant accounts).
Translate literally. Do NOT add safety restrictions the user did not ask for: a separate simulator
measures consequences and decides whether the action is safe. Leave fields unset to use defaults.
Money is in cents. Never write SQL.`;

export async function POST(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  const input = (text ?? "").trim().slice(0, 500);
  if (!input) return Response.json({ error: "Empty request" }, { status: 400 });

  // On Vercel, AI Gateway authenticates with the project's OIDC token automatically.
  const hasGateway = Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL);
  if (hasGateway) {
    try {
      const { output } = await generateText({
        model: "anthropic/claude-haiku-5-5",
        output: Output.object({ schema }),
        system: SYSTEM,
        prompt: input,
      });
      const { action, rationale, ...raw } = output;
      const result: IntentResult = { proposal: { action, params: coerceParams(action, raw) }, source: "llm", rationale };
      return Response.json(result);
    } catch (e) {
      // Fall back to the rule-based parser, and say why so the failure is visible.
      const note = e instanceof Error ? e.message.slice(0, 200) : "LLM call failed";
      console.error("intent LLM failed:", note);
      return Response.json({ ...parseIntentRules(input), note });
    }
  }
  return Response.json(parseIntentRules(input));
}
