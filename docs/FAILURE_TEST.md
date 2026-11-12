# Failure test: the simulation under-predicts

**Scenario.** A human reviews a preview. While they read it, another writer imports 40 customers that match the same filters. The preview is now wrong: it describes a world that no longer exists. The human approves it anyway, in good faith.

This is the realistic way a simulation fails. The simulator is not buggy; the data moved between simulate and execute.

## Reproduce

In the app:

1. Run **Delete accounts that have been inactive for 6 months**, choose **Keep anyone who paid in the last year**.
2. Click **Simulate a concurrent writer** (adds 40 customers; half have old payments, so they match this filter).
3. Click **Approve & execute**.

Observed in a real browser run (production build):

```
Safety net tripped. Nothing was written.
The preview showed 158 row changes. The real run would have made 238.
- 20 rows in customers would be deleted that you never saw in the preview
- 20 rows in orders would be deleted that you never saw in the preview
- 20 rows in payments would be deleted that you never saw in the preview
- 66 rows in trash would be created, you approved 46
```

The live-database counters show only the 40 imported customers; nothing was deleted.

## Why it is caught

Approval produces an **envelope** from the preview: the exact row ids that may be updated or deleted, the maximum rows that may be created per table, and the maximum money that may move. Execution runs in a transaction and measures the real diff **before** `COMMIT`. Rows outside the approved id sets, or more inserts than approved, mean `ROLLBACK`.

The check is deliberately strict (zero tolerance). A false alarm costs one re-simulation. A false negative costs data.

## Covered by tests

`tests/engine.test.ts`:

- `rolls back and writes nothing when reality outgrows the preview` (delete)
- `also catches drift for emails and refunds` (campaign and refund)

## What this does not catch

- **A wrong rule, not wrong data.** If the policy thresholds are bad, the preview is accurate and the verdict is still wrong. The envelope protects against drift, not against bad policy.
- **Effects outside the transaction.** A real payment processor or email provider cannot be rolled back by a database `ROLLBACK`. Preflight models them with a hold-then-release outbox, so they only leave after the hold window. That pattern is demonstrated, not integrated with a real provider.
- **Preview and execution disagreeing in a way inside the envelope.** The UI reports whether the effect signature matched, but a mismatch that stays inside the envelope still commits (and is flagged, and undoable).


## Failure test #2: a side effect the simulator never saw

**Scenario.** Another team ships a migration while you review: triggers on `payments`, `outbox` and `customers` that copy every changed row into `trash`. The preview was taken before they existed, so it under-predicts the effect. This is the brief's "simulation under-predicts a side effect" case in its purest form.

**Reproduce.** Run any action, click **Hidden side effect** under Fault injection, then press and hold **Hold to execute**.

**Result.** The real run writes rows the preview never listed (`N rows in trash would be created, you approved M`). The guard rolls back and nothing is written. Clicking **Re-simulate with current data** now shows the trigger's effect, and the checklist item **Writes only what you asked for** fails with "N unrequested writes from a trigger".

**Covered by tests.** `tests/engine.test.ts` runs this for refund, email and delete: the execution is rolled back, the database is byte-identical afterward, and a fresh simulation reports `unexpected-writes`.
