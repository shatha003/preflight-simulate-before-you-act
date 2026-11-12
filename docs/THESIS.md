# Two-year thesis: simulation is the default for agent writes

In two years, no serious team will let an agent write to a production system without a rehearsal. Confirm dialogs will look as dated as running unreviewed SQL against production.

Undo cannot keep up with agents. A person who deletes the wrong thing notices within minutes. An agent can do it a thousand times before anyone looks, and some consequences, like a sent email or a paid refund, have no inverse. The only reliable defense is to learn the consequence before the write.

Three shifts follow.

**Simulation moves from a feature into the write path.** Databases already have transactions, dry runs and savepoints. The next layer is a standard way to return what a write would do, as structured effects: rows, money, messages, people. Agent frameworks will call that before every mutation, the way they call a type checker today.

**Approval becomes a bounded contract.** Today a human clicks "yes" to an English sentence. In two years they approve an envelope: these rows, this much money, these recipients. Execution that exceeds it fails closed. This turns drift between review and execution into an ordinary, logged rollback.

**Policy runs on measured consequences.** Rules like "never email people who opted out" or "never destroy records inside the retention window" are checked against the simulated diff, not against the model's intent. A model can misread a request without the system being fooled, because the system judges what the action does, not what it was called.

What will not change is the limit: effects outside your own database. The industry will respond with hold-then-release patterns and provider-side dry-run APIs, because irreversible actions need a window before they leave the building.

Whoever makes "show me what this will do" cheap, honest and standard will own the safety story for autonomous systems.
