# Preflight: Simulate Before You Act

Entry for the DOO Builders League challenge **Simulate Before You Act**.

An agent that can write to real systems should not be trusted to describe what it is about to do. Preflight **runs** the action first, on a real Postgres, inside a transaction, records every row it touches, rolls it back, and shows you the result. Only then can you approve, tweak, or reject. If reality turns out larger than the preview, the real run rolls itself back before commit.

- **Live demo:** _add URL after deploy_
- **Video (90s):** _add Loom URL_
- Everything runs in the browser. No account, no backend database.

## The cycle

```
intent  ->  simulate  ->  present  ->  approve / tweak / reject  ->  execute (guarded)  ->  undo
```

1. **Intent.** Plain English becomes one of three typed actions with parameters. An LLM does this when a key is configured, otherwise a rule parser does. Neither writes SQL; the model only fills in a typed form.
2. **Simulate.** The action's SQL runs in a transaction on the live data. Before and after snapshots are diffed row by row, then the transaction is rolled back. Foreign-key cascades and triggers fire for real, so side effects are observed, not narrated.
3. **Present.** Verdict (safe, review, blocked), findings with evidence, a before/after diff per table, the side effects (direct, trigger, cascade), and the rollback path, including what cannot be undone.
4. **Decide.** Findings can block the action. Safer versions (a parameter patch each) are simulated ahead of time, so you see the result of a fix before choosing it.
5. **Execute, guarded.** Approval freezes an **envelope**: which rows may change, how many may be created, how much money may move. The real run is measured before `COMMIT`. Outside the envelope means `ROLLBACK`, nothing written.
6. **Undo.** Before-images from the committed run restore the database exactly. Emails are held for 60 seconds and are recallable until then; after that they are reported as unrecoverable.

## The three gated actions

| Action | Stakes | What the simulation reveals |
|---|---|---|
| Bulk refund | Money out | A trigger writes a ledger entry and queues a receipt email per refund |
| Mass email | Cannot be unsent | Recipients who opted out of marketing, which is a compliance block |
| Delete inactive accounts | Destroys data | A cascade deletes orders and payments, and the archive trigger saves only the customer row |

## Try it

1. Click **Delete accounts that have been inactive for 6 months**. It is blocked: 42 payments inside the 12-month retention window would be destroyed with no archive.
2. Pick **Keep anyone who paid in the last year**. It was already simulated; the verdict drops to "needs your review".
3. Click **Simulate a concurrent writer**, then **Approve & execute**. The guard refuses and writes nothing.
4. **Re-simulate**, approve, then **Undo**. The live-database counters return to their starting values.

## Run locally

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm test         # 17 tests
pnpm build
```

Optional: copy `.env.example` to `.env.local` and set `AI_GATEWAY_API_KEY` to read intents with an LLM through Vercel AI Gateway. Without it, the rule parser is used and nothing else changes.

## Layout

```
src/lib/schema.ts     schema, triggers, deterministic seed
src/lib/simulate.ts   dry run in a transaction, envelope, effect signature
src/lib/risk.ts       metrics, findings, verdict, side effects, rollback path
src/lib/tweaks.ts     safer parameter patches, each pre-simulated
src/lib/execute.ts    guarded commit
src/lib/undo.ts       restore from before-images, email hold window
src/lib/audit.ts      hash-chained audit log
src/lib/chaos.ts      the concurrent-writer failure test
src/lib/intent.ts     rule-based intent parser (LLM route: src/app/api/intent)
tests/                17 tests
docs/                 architecture, failure test, thesis, notes, video script
```

## Honest limits

See [docs/NOTES.md](docs/NOTES.md). In short: the data is a seeded demo back office, not your production system; snapshots are full-table, which suits a small dataset; effects outside the database (real email providers, payment processors) are modeled with a hold-then-release outbox rather than integrated.
