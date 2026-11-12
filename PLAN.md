# Implementation Plan: Simulate Before You Act

DOO Builders League challenge. Prize: $500 + World Model Builder badge.
Deadline: **Nov 15, 2026** (site banner says ~3 days left; confirm the real cutoff).

## Challenge in one line

An agent that acts on real systems must simulate the consequences first, show the human what is about to happen, and let them approve, tweak, or reject in one step.

## Core idea

Every action is real SQL running on a real Postgres (PGlite, in the browser).

- **Simulate:** run the action inside a transaction, capture a row-level before/after diff (including FK cascades and trigger side effects), then `ROLLBACK`.
- **Review:** show projected effects, side effects, who is impacted, and the rollback path. Risk findings come from the diff, not from narration.
- **Execute:** run the same SQL again behind a guard. If the real effect exceeds the approved envelope, `ROLLBACK` automatically.
- **Undo:** after commit, replay before-images to restore state. Emails already delivered are reported as unrecoverable.

Why this is not an "are you sure?" dialog: the simulation changes the decision. A finding can block the action, and suggested tweaks are pre-simulated so the user sees the effect before clicking.

## Actions gated (high-stakes)

| Action | Stakes | Trap the simulation reveals |
|---|---|---|
| Bulk refund | Sends money out | A trigger writes the ledger and queues a receipt email per refund |
| Mass email | Cannot be unsent | The segment includes opted-out customers (compliance block) |
| Delete inactive accounts | Destroys data | FK cascade deletes orders and payments, and only the customer row is archived |

## Status

- [x] Next.js project, config, dependencies
- [x] `schema.ts` : schema, triggers, deterministic seed (240 customers)
- [x] `db.ts` : PGlite open/reset, lock
- [x] `diff.ts` : snapshot and row-level diff
- [x] `actions.ts` : action catalog
- [x] `simulate.ts`, `risk.ts`, `execute.ts`, `undo.ts`, `tweaks.ts`, `audit.ts`, `chaos.ts`, `intent.ts`
- [x] `/api/intent`, full UI (Workbench, Report, DiffView)
- [x] 17 tests passing; production build verified end-to-end in a real browser (all 3 actions, tweak, drift safety net, undo)
- [x] README, docs/ARCHITECTURE, FAILURE_TEST, THESIS (under 300 words), NOTES, VIDEO_SCRIPT
- [ ] Deploy (Vercel), public GitHub repo, record video, fill URLs in README, submit

## Phases

### 1. Engine (`src/lib`)
- `simulate.ts` : begin, snapshot, run action, snapshot, diff, rollback.
- `risk.ts` : metrics (rows touched, money moved, messages, opted-out recipients, cascaded financial records) and findings with severity `info | warn | block`. Verdict: `safe | review | blocked`.
- `execute.ts` : guarded commit. Envelope = affected ids per table, max inserts per table, max money moved. Any violation causes rollback with a reason.
- `undo.ts` : inverse plan built from before-images (delete inserted, restore updated, reinsert deleted, parents first).
- Outbox hold window: messages stay `held` for N seconds, then become `sent` and cannot be recalled.
- `audit.ts` : hash-chained log (SHA-256) of intent, simulation digest, decision, envelope, outcome.

**Done when:** tests pass (see Test plan).

### 2. Tweaks
- Each blocking or warning finding yields a parameter patch (for example `onlyOptedIn: true`, `keepWithRecentPayments: true`, a refund cap).
- Each patch is simulated immediately so the UI shows the resulting verdict and row count.

### 3. Intent (`/api/intent`)
- LLM path: AI SDK `generateText` with `Output.object` and a zod schema, model string `anthropic/claude-haiku-5-5` through AI Gateway.
- Fallback: rule-based parser when there is no key or the call fails.
- Output is validated and coerced by `coerceParams`. The model never writes SQL.

### 4. UI (`src/app`, `src/components`)
- Intent bar with example chips.
- Pipeline strip: Intent, Simulate, Review, Execute.
- Simulation report: verdict banner, stat tiles, findings with evidence.
- Per-table before/after diff (collapsible, first rows plus counts).
- Rollback card: what can be undone and what cannot.
- Actions: Approve and execute, Apply tweak, Reject.
- Audit log panel, database reset button.
- Failure-test panel.

### 5. Failure test (required deliverable)
- "Concurrent writer" button inserts rows that match the current filter while the user reviews.
- On approve, the guard sees ids and counts outside the envelope, rolls back, and explains: approved N rows, actual M rows.
- The user is prompted to re-simulate.

### 6. Verify
- `pnpm test`, `pnpm build`.
- Browser run through all 3 actions and the failure test.
- Confirm PGlite WASM loads in the production build.

### 7. Ship
- Public GitHub repo, clean-clone check (`pnpm install && pnpm dev`).
- Deploy to Vercel, confirm the live URL opens for anyone.
- `.env.example` present; the app works with no key.

### 8. Deliverables
- `README.md` : what it is, how to run, architecture, limits.
- Architecture snapshot: intent, simulate, present, execute/rollback (diagram or one-pager).
- Failure test write-up.
- Two-year thesis, 300 words or fewer.
- Notes: AI tools used, key decisions, out of scope.
- 90-second video script: simulate, review, execute on a real action, plus the safety net tripping.

### 9. Submit (build.doo.ooo)
- Repo URL, live demo URL, Loom URL, notes.
- Sign in at build.doo.ooo/auth first.

## Test plan (vitest, in Node with in-memory PGlite)

1. Simulation leaves the database unchanged.
2. Preview diff equals the diff of the real execution.
3. Mass email to opted-out customers is blocked.
4. Delete inactive shows the cascade into orders and payments, and is blocked.
5. Refund shows ledger and outbox side effects.
6. Drift beyond the envelope causes rollback and nothing is committed.
7. Undo restores the original snapshot exactly.
8. Sent emails are reported as unrecoverable by undo.
9. Audit chain verifies, and tampering is detected.

## Scoring map (100 points)

| Points | Criterion | How this build earns it |
|---|---|---|
| 25 | Conceptual clarity | Simulation changes the decision: blocks, tweaks, envelope |
| 25 | Technical depth | Real Postgres dry run, real cascades and triggers, real rollback |
| 20 | Demo quality | One cycle in 90 seconds, diff view builds trust |
| 15 | Failure thinking | Drift between review and execute is caught by the guard |
| 15 | Future thesis | Simulation as the default for agent writes |

Bonus targeted: diff-style before/after, real system rather than a mock.
Disqualifiers avoided: no confirm-dialog dressing, a real action is gated, live demo included.

## Timeline

| Day | Work |
|---|---|
| Nov 13 | Phases 1 to 5 |
| Nov 14 | Phases 6 to 8, record the video |
| Nov 15 | Phase 9, submit, buffer |

## Needs from the owner

1. Record the 90-second Loom (script provided).
2. GitHub login so the public repo can be pushed.
3. Vercel CLI install and login for the live demo.
4. Builders League account sign-in for submission.
5. Optional: AI Gateway key for LLM intent parsing.

## Next challenges (only if time remains)

Same template, each in its own sibling folder and repo: **The Decision Engine**, then **The Agent That Earns Trust**.
