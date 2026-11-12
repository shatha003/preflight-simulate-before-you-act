# Submission notes

## AI tools used
- **Claude Code (Claude Sonnet 5.5)** wrote most of the code and tests in a pair-programming loop, and drafted these docs. The design decisions below were reviewed and chosen with the owner.
- **Claude Haiku 5.5 via Vercel AI Gateway** reads plain-English requests into a typed action. It is optional: without a key the rule parser runs. The LLM never writes SQL, and its output is validated and clamped. **The LLM path has not been exercised in testing because no gateway key was available during development**; the rule-based path is what was tested end to end.

## Key decisions
- **Real Postgres, in the browser (PGlite).** A real engine means real cascades, triggers and transactions, so side effects are observed rather than guessed. Running it client-side means the demo needs no backend and every visitor gets an isolated database.
- **Simulate by executing and rolling back,** not by asking a model to predict. The preview is a measurement.
- **Same SQL for preview and execution.** One code path, so the preview cannot describe a different action than the one that runs.
- **Strict envelope.** Zero tolerance for rows outside the approved ids. A false alarm is cheap, a false negative is not.
- **Verdict from policy, not from the model.** Findings are deterministic rules over the diff.
- **Typed actions, not free-form SQL.** The agent proposes parameters to a fixed catalog.
- **Emails held 60 seconds.** This is what gives "send" a rollback path, and it is stated honestly where it stops.

## Out of scope
- Integration with a real email provider or payment processor. They are modeled by the held/sent outbox.
- Multi-user concurrency. The "concurrent writer" is a deliberate simulation of it, in one browser tab.
- Scaling the diff. Snapshots read whole tables, which suits a few hundred rows. A production version would capture effects with `RETURNING`, triggers or logical decoding.
- Authentication, per-user policy, and persisting the audit log server-side.
- Open-ended actions. Only three actions are gated.

## Known limitations
- The seeded dataset is a demo back office, not a customer's production system. "Real system" here means a real database engine, not a connected live service.
- Policy thresholds (for example $2,000 review, $10,000 block, 12-month retention window) are illustrative.
- Sequence values are not rolled back by Postgres, so ids assigned during a dry run differ from the real run. The effect signature ignores them.
- If IndexedDB is unavailable (private mode), the database falls back to memory and resets on reload.
