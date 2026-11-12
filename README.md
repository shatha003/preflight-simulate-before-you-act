# Preflight: Simulate Before You Act

Entry for the DOO Builders League challenge **Simulate Before You Act**.

An agent that can write to real systems should not be trusted to describe what it is about to do. Preflight **runs** the action first, on a real Postgres, inside a transaction, records every row it touches, rolls it back, and shows you who it would hit. Only then can you approve, tweak, or reject. If reality turns out larger than the preview, the real run rolls itself back before commit.

- **Live demo:** https://preflight-simulate-before-you-act.vercel.app
- **Repo:** https://github.com/shatha003/preflight-simulate-before-you-act
- Everything runs in the browser. No account, no backend database.
- Click **Run the 90-second demo** in the header for a captioned walkthrough of the whole cycle.

## The cycle

```
intent -> simulate -> present -> approve / tweak / reject -> execute (guarded) -> undo
```

1. **Flight plan (intent).** Plain English becomes one of three typed actions with parameters. An LLM does this when a gateway is available, otherwise a rule parser does. Neither writes SQL.
2. **Simulate.** The action's SQL runs in a transaction on the live data. Before and after snapshots are diffed row by row, then the transaction is rolled back. Foreign-key cascades and triggers fire for real, so side effects are observed, not narrated.
3. **Present.**
   - **Manifest:** one square per customer. Switch Reality to Simulation and the blast radius lights up. Hover any square to see exactly what happens to that customer.
   - **Clearance:** a departure board (CLEARED, HOLD, DENIED) plus a pre-flight checklist. Every policy rule is evaluated on what actually changed, and shown with its evidence.
   - **Evidence:** the row-level before/after diff, the exact SQL receipt, the rollback plan, and the flight record.
4. **Decide.** Policy can deny the action. Safer plans (a parameter patch each) are simulated ahead of time, so you see the result of a fix before choosing it.
5. **Execute, guarded.** You press and hold to confirm. Approval freezes an **envelope**: which rows may change, how many may be created, how much money may move. The real run is measured before `COMMIT`. Outside the envelope means `ROLLBACK`, nothing written.
6. **Undo.** Before-images from the committed run restore the database exactly. Emails are held for 60 seconds and recallable until then; after that they are reported as unrecoverable.

## Two failure tests, built in

Open **Fault injection**, then approve the pending preview.

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

1. Click **Delete accounts that have been inactive for 6 months**. The board reads **DENIED** and 28 squares pulse red: those customers have payments inside the 12-month retention window.
2. Use the safer plan **Keep anyone who paid in the last year**. It was already simulated; the board drops to **HOLD**.
3. Under Fault injection, click **Data drift**, then press and hold **Hold to execute**. The safety net trips and nothing is written.
4. **Re-simulate with current data**, hold to execute, then **Undo everything**. The live-database counters return to their starting values.
5. Under the **Flight record** tab, **Download flight record** exports the hash-chained audit log as JSON.

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
src/lib/field.ts      per-customer seat model read from the simulated diff
src/lib/tweaks.ts     safer parameter patches, each pre-simulated
src/lib/execute.ts    guarded commit
src/lib/undo.ts       restore from before-images, email hold window
src/lib/audit.ts      hash-chained audit log
src/lib/chaos.ts      the two fault injections
src/lib/intent.ts     rule-based intent parser (LLM route: src/app/api/intent)
src/components/       Workbench, Field (manifest), Flap (departure board), HoldButton, ...
tests/                19 tests
docs/                 architecture, failure test, thesis, notes, video script
```

## Honest limits

See [docs/NOTES.md](docs/NOTES.md). In short: the data is a seeded demo back office, not your production system; snapshots are full-table, which suits a small dataset; effects outside the database (real email providers, payment processors) are modeled with a hold-then-release outbox rather than integrated; the LLM intent path has not run successfully yet (the gateway needs a card on file), so the rule parser is what was tested.
