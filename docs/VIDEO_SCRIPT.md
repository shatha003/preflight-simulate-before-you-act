# 90-second video script

Two options. **Option A is the easiest and the most reliable.**

## Option A: record the built-in guided demo
1. Open the live demo in a fresh tab at 1280x800 or larger. Close other tabs and notifications.
2. Start Loom, then click **Watch the 90-second demo** in the header.
3. The app resets itself, runs the whole cycle, and shows a caption for each step (9 steps, about 75 seconds). Talk over it using the lines below, or just let the captions carry it.
4. Stop recording when the caption reads "Simulate first. Commit second."

## Option B: drive it by hand (narration)

| Time | On screen | Say |
|---|---|---|
| 0:00-0:08 | Empty page | "Agents are starting to write to real systems, and 'are you sure?' is not a safety story. Preflight runs the action first, for real, and shows who it would hit." |
| 0:08-0:22 | Click **Delete accounts that have been inactive for 6 months**. A ripple turns customers into ghosts, the dangerous ones red, and the KILLED sticker slaps down. | "I ask the agent to clean up dormant accounts. It runs this on a real Postgres inside a transaction, then rolls it back. Every creature is a customer. Ghosts would be deleted, the red ones are the danger. Killed: the cascade would destroy payments inside the retention window. The database found that, nobody guessed." |
| 0:22-0:34 | Flip between Reality and Ghost run. Click a red ghost: a card shows their side. | "I can flip between reality and the ghost run. Click any customer and I see their side: this one wakes up to no account, and payments we are legally required to keep. The policy checks show which rule failed and why." |
| 0:32-0:44 | Tick 'Keep accounts with a payment in the last 365 days'. The sticker changes to HOLD. | "The safer plan was already simulated, so I can see its effect before I choose it." |
| 0:44-0:56 | Under Sabotage it click **Data drift**. A yellow banner: this ghost run is stale. | "Now the failure case. While I'm reviewing, another writer imports 40 customers. My preview is wrong." |
| 0:56-1:10 | Press and hold **Hold to sign off**. The page shakes: Rolled back. | "I approve anyway. The real run is measured against exactly what I approved, it's bigger, so it rolls back before commit. Nothing was written." |
| 1:10-1:22 | **Ghost run again with current data**, sign off, then **Undo everything**. | "Re-simulate, execute, and if I regret it, one click restores every row from before-images." |
| 1:22-1:30 | Flight log tab. | "Every step is in a hash-chained flight log. Simulate first, commit second." |

If you have time, also show **Hidden side effect**: a trigger shipped mid-review that the preview never saw, caught by the same guard.

## Before recording
- Fresh tab, or click **Reset everything** in the Live database panel.
- Do one dry run, then Reset again.
- Keep it under 90 seconds. Paste the Loom URL into the README and the submission form.
