# Preflight: Simulate Before You Act

Entry for the DOO Builders League challenge **Simulate Before You Act**.

An agent that can write to real systems should not be trusted to describe what it is about to do, so Preflight gives every action a **ghost run**: it runs the action first, on a real Postgres, inside a transaction, records every row it touches, rolls it back, and shows the result on a living crowd of your customers. Only then can you approve, tweak, or reject. If reality turns out larger than the preview, the real run rolls itself back before commit.

- **Live demo:** https://preflight-simulate-before-you-act.vercel.app
- **Repo:** https://github.com/shatha003/preflight-simulate-before-you-act
- Everything runs in the browser. No account, no backend database.
- Click **Watch the 90-second demo** in the header for a captioned walkthrough of the whole cycle.

## The cycle

```
intent -> simulate -> present -> approve / tweak / reject -> execute (guarded) -> undo
```

1. **Job order (intent).** Plain English becomes one of three typed actions with parameters. An LLM does this when a gateway is available, otherwise a rule parser does. Neither writes SQL.
2. **Simulate.** The action's SQL runs in a transaction on the live data. Before and after snapshots are diffed row by row, then the transaction is rolled back. Foreign-key cascades and triggers fire for real, so side effects are observed, not narrated.
3. **Present.** The simulation is a ghost run over a living crowd:
   - **The crowd:** every customer is a small creature that bobs, blinks and watches your cursor. Flip from **Reality** to **Ghost run** and a ripple goes through them: accounts that would be deleted turn into ghosts, refunded customers turn gold with a coin, emailed ones get an envelope, and the ones policy is worried about turn red, shake and raise an alarm. After a committed delete, only chalk outlines remain where they stood. Point at anyone for a one-line note; arrow keys move through the grid.
   - **Their side of it:** click any creature and a card shows what that one person would find tomorrow, built from the simulated rows: no account and the orders and payments gone with it, the actual email they would receive, the refund and its receipt. A customer who opted out of marketing gets a red warning. It updates live when you switch to a safer job, so you can watch the consequence disappear.
   - **The verdict sticker:** APPROVED, HOLD or KILLED slaps onto the page, with the numbers counting up beside it, and the **policy checks**: every rule passed or failed from what actually changed.
   - **The receipts:** the row-by-row diff, the exact SQL, the undo plan, and the flight log.
4. **Decide.** Policy can deny the action. Safer plans (a parameter patch each) are simulated ahead of time, so you see the result of a fix before choosing it.
5. **Execute, guarded.** You sign off: press and hold until the button fills. Approval freezes an **envelope**: which rows may change, how many may be created, how much money may move. The real run is measured before `COMMIT`. Outside the envelope means `ROLLBACK`, nothing written.
6. **Undo.** Before-images from the committed run restore the database exactly. Emails are held for 60 seconds and recallable until then; after that they are reported as unrecoverable.

## Two failure tests, built in

Open **Sabotage it**, then sign off on the pending ghost run.

| Fault | What happens | Why the preview was wrong |
|---|---|---|
| **Data drift** | Another writer imports 40 customers mid-review | The data moved after the simulation |
| **Hidden side effect** | A migration ships a trigger the simulator never saw | The simulation under-predicted a side effect |

Both are caught by the same guard: the real effect leaves the approved envelope, the transaction rolls back, and nothing is written. After the hidden-trigger fault, re-simulating **reveals** the trigger ("Writes only what you asked for" fails on the checklist).

## The three gated actions

| Action | Stakes | What the simulation reveals |
|---|---|---|
| Bulk refund | Money out | A trigger writes a ledger entry and queues a receipt email per refund |
| Mass email | Cannot be unsent | Recipients who opted out of marketing, which is a compliance block |
| Delete inactive accounts | Destroys data | A cascade deletes orders and payments, and the archive trigger saves only the customer row |

## Try it by hand

1. Click **Delete accounts that have been inactive for 6 months**. A ripple turns 74 customers into ghosts, 28 of them red and shaking, and the verdict is **KILLED**: those customers have payments inside the 12-month retention window.
2. Click a red ghost to read their side of it. Then tick **Keep accounts with a payment in the last 365 days**. The verdict changes to **HOLD**.
3. Under **Sabotage it**, click **Data drift**, then press and hold **Hold to sign off**. The page shakes, says **Rolled back.**, and nothing is written.
4. **Ghost run again with current data**, sign off (confetti, and chalk outlines where the deleted customers stood), then **Undo everything**. The "Live in this tab's Postgres" counters return to their starting values.
5. Under the **Flight log** tab, **Download log** exports the hash-chained audit log as JSON.

## Run locally

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # 19 tests
pnpm build
```

Optional: copy `.env.example` to `.env.local` and set `AI_GATEWAY_API_KEY` to read intents with an LLM through Vercel AI Gateway. Without it, the rule parser is used and nothing else changes.

## Layout

```
src/lib/schema.ts     schema, triggers, deterministic seed
src/lib/simulate.ts   dry run in a transaction, envelope, effect signature
src/lib/risk.ts       metrics, findings, policy checklist, verdict, side effects, rollback path
src/lib/field.ts      per-customer marks, read from the simulated diff
src/lib/tweaks.ts     safer parameter patches, each pre-simulated
src/lib/execute.ts    guarded commit
src/lib/undo.ts       restore from before-images, email hold window
src/lib/audit.ts      hash-chained audit log
src/lib/chaos.ts      the two fault injections
src/lib/intent.ts     rule-based intent parser (LLM route: src/app/api/intent)
src/components/       Workbench, Crowd (the creatures), Stamp (verdict sticker), SignOff, Notes, ...
tests/                19 tests
docs/                 architecture, failure test, thesis, notes, video script
```

## Honest limits

See [docs/NOTES.md](docs/NOTES.md). In short: the data is a seeded demo back office, not your production system; snapshots are full-table, which suits a small dataset; effects outside the database (real email providers, payment processors) are modeled with a hold-then-release outbox rather than integrated; the LLM intent path has not run successfully yet (the gateway needs a card on file), so the rule parser is what was tested.
