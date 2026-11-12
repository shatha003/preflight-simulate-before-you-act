# 90-second video script

Record at 1280×800 or larger, light theme, browser zoom 100%. Open the live demo in a fresh tab first so the database is at its starting state (click **Reset** if not). Mouse moves slowly; pause on the key lines for a beat.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:08 | Empty state | "Agents are starting to write to real systems, and 'are you sure?' is not a safety story. Preflight runs the action first, for real, and shows you what it did." |
| 0:08–0:22 | Click **Delete accounts that have been inactive for 6 months**. Report appears, blocked. Point at the BLOCK finding. | "I ask the agent to clean up dormant accounts. It runs this on a real Postgres inside a transaction, then rolls it back. Blocked: it would destroy 42 payments from the last year, because deleting a customer cascades into orders and payments, and only the customer row is archived. No model guessed that; the database did it." |
| 0:22–0:34 | Scroll to **Before → after** and the side-effects list. | "Here is the real diff, row by row, and the cascade I did not ask for." |
| 0:34–0:46 | **Safer versions**: click **Keep anyone who paid in the last year**. Verdict changes to review. | "The safer version was already simulated, so I can see its effect before I choose it. Now it needs my review, not a block." |
| 0:46–0:58 | Click **Simulate a concurrent writer**. Banner appears. | "Now the failure case. While I'm reviewing, another writer adds 40 customers. My preview is wrong." |
| 0:58–1:12 | Click **Approve & execute**. Red card: Safety net tripped. | "I approve anyway. The real run is measured against exactly what I approved, and it's bigger. It rolls back before commit. Nothing was written." |
| 1:12–1:24 | **Re-simulate with current data**, approve, then **Undo**. Show the live counters returning. | "Re-simulate on the current data, approve, and if I regret it, one click restores every row from before-images." |
| 1:24–1:30 | Audit trail. | "Every step is in a hash-chained audit log. Simulate first, then commit. That's the pattern." |

## Checklist before recording
- Fresh tab, **Reset** clicked.
- Do a dry run once, then Reset again.
- Close other tabs and notifications.
- Keep it to one take; under 90 seconds.
- Paste the Loom URL into the README and the submission form.
