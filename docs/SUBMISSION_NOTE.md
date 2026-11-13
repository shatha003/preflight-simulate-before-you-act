What to look at (about 3 minutes)
- Click "Watch the 90-second demo" in the header: a captioned walkthrough of the whole cycle.
- "Delete accounts inactive for 6 months": a ripple runs through a crowd of 240 customer creatures: 74 turn into ghosts, 28 of them red and shaking. The verdict is KILLED (those 28 have payments inside the 12-month retention window). Click one to see their side of it.
- Failure test "Data drift": another writer imports 40 customers mid-review. Hold to sign off. The real run would make 238 row changes against the 158 previewed, so it rolls back and nothing is written.
- Failure test "Hidden side effect": a trigger the simulator never saw. Same guard catches it, and re-simulating reveals it.
- Flight log tab: the hash-chained audit log, downloadable as JSON.

How it works
Plain English becomes one of three typed actions (bulk refund, mass email, delete inactive accounts). Each runs on a real Postgres in the browser (PGlite) inside a transaction, the rows it touches are diffed, then it rolls back. A policy checklist gives the verdict (APPROVED, HOLD or KILLED). Approval freezes an envelope of allowed rows and money, the real run is measured before COMMIT, and anything outside it rolls back. Undo restores before-images. 19 tests.

Key decisions
- Simulate by executing and rolling back, not by asking a model to predict.
- Same SQL for preview and execution.
- Zero tolerance outside the approved envelope.
- The verdict comes from deterministic policy, not the model.
- Emails are held 60 seconds so "send" can be recalled.

Known limit
The data is a seeded demo back office, and email and payments are modeled by a hold-then-release outbox, not a real provider. Snapshots read whole tables, which suits a few hundred rows.

AI usage
Built with Claude Code (Sonnet 5.5). It drafted the code, tests and docs. I directed the design, chose the decisions above, and verified with the test suite and browser runs of both failure tests. The optional LLM intent reader (Haiku 5.5 via Vercel AI Gateway) has not run successfully live because the gateway needs a card on file. It falls back to the rule parser, and everything above was tested on that path.
