# Decision Log

Short entries, newest at the bottom. Each one records what we chose and why.
Times are local (UTC+04:00).

---

### D1 — Stack: Express + Socket.io + Prisma 6 + PostgreSQL 16 — 2026-09-23 20:05
Express was chosen over Fastify because more people know it and we don't need Fastify's extra speed at this scale. Socket.io was chosen over SSE because its rooms map directly onto "everyone viewing group X" and "user Y's notifications", and it reconnects on its own. Prisma is pinned to 6.x because 7.x changes how the client is configured (driver adapters are required), which adds setup work for no benefit here. TypeScript is pinned to 5.x for the same reason: the tooling around it is stable.

### D2 — Money is stored as integer minor units — 2026-09-23 20:05
Every amount is an `Int` of the currency's smallest unit (cents for EUR/USD, whole units for JPY). Floats can't represent money exactly, and `Decimal` would still need its own rounding rules. `Int` caps an amount at about 21M in major units, which is plenty for shared expenses. The API validates amounts against that cap.

### D3 — Balances are calculated from the records, never stored — 2026-09-23 20:05
A member's net balance is `paid − owed + confirmed payments sent − confirmed payments received`, calculated from `Expense`, `ExpenseSplit` and `Payment` rows each time it's needed. With no running total to go stale, editing or deleting an old expense is correct by construction, and repayments already made are still counted. The cost is one aggregate query per balance read, which is trivial at group sizes. If an edit means a repayment covered too much, the balance flips sign and the recipient now owes the difference back. That's the intended behavior.

### D4 — Each money write locks its group row — 2026-09-23 20:05
Every transaction that changes money starts with `SELECT … FROM "Group" WHERE id = $1 FOR UPDATE`, then increments `Group.ledgerVersion`. Concurrent writes to the same group run one after the other, so none is lost and the `owingSince` reminder bookkeeping can't race. Balances sum to zero because each expense is written in a single transaction with splits that add up to its amount. Clients use `ledgerVersion` to ignore stale real-time updates. Different groups never block each other.

### D5 — Rounding: largest remainder, ties broken by join order — 2026-09-23 20:05
Each share is rounded down to whole minor units. The leftover units go one each to the participants whose shares lost the most in rounding. Ties go to whoever joined the group first, then by user ID. For EQUAL splits every share loses the same amount, so the earliest-joined participants get the extra cent (10.00 / 3 → 3.34, 3.33, 3.33). EXACT splits must add up to the total exactly or the request is rejected. The resolved per-person `amount` is stored, so a later change to the rule can't change old expenses.

### D6 — Minimum-transfer settlement: exact for small groups, greedy above that — 2026-09-23 20:05
The true minimum number of transfers is n minus the largest number of groups of people whose balances cancel out exactly. That problem is NP-hard. We solve it exactly with a bitmask search when up to about 15 people have non-zero balances, and fall back to greedy matching (largest debtor pays largest creditor) above that. The greedy result is never more than n−1 transfers.

### D7 — Reminders are tracked per debtor per group, not per pair — 2026-09-23 20:08 (approved)
`GroupMember.owingSince` is set when a member's net balance goes negative and cleared when it returns to zero or above. `lastRemindedAt` limits reminders to one per 7 days. Tracking per debtor–creditor pair was rejected because the suggested transfers can change who owes whom whenever an expense is added, which would cause extra emails. The reminder email lists the current suggested transfers.

### D8 — Closed groups still accept repayments and send reminders — 2026-09-23 20:08 (approved)
Closing a group only blocks creating or editing expenses. Debts still exist after a group closes, so members can still settle them and still get reminded.

### D9 — Soft-delete expenses; the activity log keeps snapshots — 2026-09-23 20:05
Deleted expenses get a `deletedAt` timestamp and are left out of balances, but stay in the database for history. An `Activity` row stores a JSON snapshot of each change, with before and after for edits. The feed can therefore show what changed even after the expense itself has been edited again.

### D10 — Edits to the same expense use an optimistic lock — 2026-09-23 20:05
`Expense.version` must match on update. If two people edit the same expense at once, the second gets a `409 Conflict` instead of silently overwriting the first.

### D11 — Email stub writes to the console and an `EmailOutbox` table — 2026-09-23 20:05
Real delivery is out of scope. Storing each email in a table lets tests check exactly what would have been sent, and lets a dev page show sent emails.

### D12 — Defense-in-depth CHECK constraints in the migration — 2026-09-23 20:11
Prisma's schema language can't express CHECK constraints, so they're added by hand to the init migration. They cover: amounts > 0, split amounts ≥ 0, shares > 0, `reminderDays` ≥ 1, a 3-letter currency code, and no paying yourself. The service layer validates the same rules. The constraints are a backstop against bugs.

### D13 — Fixed category enum — 2026-09-23 20:05
Categories are a fixed Postgres enum rather than free text. This keeps the data clean for any future per-category totals, and the UI can show icons for them. Custom categories are a possible later extension.
