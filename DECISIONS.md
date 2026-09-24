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

### D14 — Auth: bcrypt passwords, stateless JWT in a Bearer header — 2026-09-24 09:21
Passwords are hashed with bcrypt (cost 12) using `bcryptjs`, which is pure JS and needs no native build step. Passwords must be 8–72 bytes. bcrypt ignores everything past 72 bytes, so longer passwords are rejected instead of being silently cut short. Login returns the same `401` for a wrong password and an unknown email, and compares against a dummy hash when the email doesn't exist, so response timing doesn't reveal which accounts exist. Registration does reveal it with a `409`; that's the usual trade-off for a clear sign-up error. Tokens are HS256 JWTs (`sub` = user ID) that expire after 7 days and are sent as `Authorization: Bearer …`. The same token will authenticate the Socket.io handshake later. A Bearer header rather than a cookie means no CSRF handling is needed. The cost is that the frontend has to store the token itself. There's no server-side revocation: logout just drops the token on the client. A refresh-token flow isn't worth building for this scope.

### D15 — Expense API shape — 2026-09-24 09:35
- **Split input** is tagged by type: `{type:"EQUAL", participants:[id…]}`, `{type:"SHARES", shares:[{userId, shares}]}` or `{type:"EXACT", amounts:[{userId, amount}]}`. Each person may appear once. Shares are whole numbers from 1 to 1000, and a split can have at most 200 people. These caps keep `amount × shares` well inside the range where JavaScript integers are exact, so the rounding math never loses precision.
- **Edits use `PUT` and replace the whole expense.** The body must include the `version` the client last saw (D10). Partial `PATCH` updates were rejected because a split only makes sense alongside its amount, and merging the two would be error-prone.
- **Closed groups** block deleting expenses as well as creating and editing them (D8). Deleting changes balances just as much as editing does.
- **Non-members** get `404` for everything under `/api/groups/:id`, the same as a group that doesn't exist, so group IDs can't be probed.
- **owingSince (D7)** is already updated inside every locked money write, although the reminder job comes later. That way the later milestone doesn't have to rebuild history.
- **`GET /groups/:id/balances`** reads the balances and `ledgerVersion` in one `REPEATABLE READ` snapshot, so the two always match. Every member is listed, even at 0. Members can't leave a group (agreed 2026-09-23), but if a future change lets them, anyone who's no longer a member but still has a non-zero balance stays listed rather than their balance silently vanishing.

### D16 — Groups, roles and invites — 2026-09-24 09:40
- **Roles.** Only the owner (the group's creator) can change settings, close or reopen the group, or replace the invite link. Any member can invite people, by email or by sharing the link. Owners can't be transferred yet.
- **Two kinds of invite.** The shareable link (`Group.inviteToken`) lets anyone who has it join. The owner can replace it, and the old link then stops working. An email invite (`GroupInvite`) is personal: only the account whose email matches can accept it. It expires after 7 days. Re-inviting the same address issues a new token and expiry and sends a new email, and the old link stops working. A new user registers with the invited email, then accepts. Keeping registration separate from invites keeps the auth code simple.
- **Invite previews are public** (`GET /api/invites/link/:token`, `GET /api/invites/email/:token`), so the page can show the group before the person logs in. The preview shows only what the token holder was already meant to see.
- **Joins are idempotent.** Joining again, or accepting an invite that's already been accepted, succeeds and changes nothing. Joins take the group row lock (D4), so 10 simultaneous joins by one person create one membership.
- **Closed groups** (D8) don't take new members or new email invites. Nobody new has anything to settle.
- **The currency locks** once the group has any expense or payment, including soft-deleted expenses and pending payments. Their history is shown in that currency, so changing it would misrepresent them. The check and the change happen under the group row lock, so a currency change can't race the first expense.
- **Close/reopen don't bump `ledgerVersion`.** No money changes. Clients get the status from the group itself.
- **The closing summary email is deferred** to the settlement milestone, because it should list the suggested transfers.

### D17 — Repayments and the settlement plan — 2026-09-24 10:05
- **Lifecycle.** The payer proposes (`PENDING`). The recipient confirms (`CONFIRMED`) or rejects (`REJECTED`), or the payer cancels (`CANCELLED`). Only a pending payment can change, and the status is re-read under the group row lock, so a confirm racing a reject can't both succeed. Only `CONFIRMED` counts toward balances (D3). Confirming is therefore the only money write here: it bumps `ledgerVersion` and updates `owingSince` (D4, D7). Reject and cancel only take the lock.
- **Cancel was added** (not in the original spec) so a payer can withdraw a mistaken proposal without waiting for the recipient to reject it.
- **Proposal cap.** The payer must currently owe money. The amount can't exceed what they owe, minus their own payments still awaiting confirmation. This catches typos and double submissions. The recipient can be any other member. The cap applies only when proposing: if an expense is later edited so a confirmed payment covers too much, the balance flips sign as intended (D3).
- **Visibility.** Every member sees all of the group's payments (`GET /groups/:id/payments`), since confirmed ones shape everyone's balances. `GET /payments/pending` lists each user's own pending payments across groups, marked incoming or outgoing. Outsiders get `404`.
- **Settlement plan** (`GET /groups/:id/settlement`) comes from confirmed balances only. Pending payments aren't counted, because they might be rejected. The response includes `method: "exact" | "greedy"` (D6). The exact search splits people into the most zero-sum groups, then settles each group greedily. Within a group that can't be split further, greedy's k−1 transfers is already the minimum. Plans are deterministic: the same balances always give the same transfers.
- **Closing summary email** (`GROUP_CLOSED_SUMMARY`), one per member, built in the closing transaction. It lists final balances, the full plan, and that member's own part ("You pay Alice €30.00."). Amounts are formatted with the group currency's minor units (e.g. `¥3,000`, `KWD 0.001`).

### D18 — Real-time sync — 2026-09-24 10:15
- **Rooms.** Clients authenticate the Socket.io handshake with the same JWT as the REST API (D14). They then explicitly join the room for each group they're viewing (`group:join`), and only members may join. A non-member gets the same "Group not found" as a missing group. Joining, rather than auto-subscribing to every group, means a client only receives updates for what's on screen.
- **What triggers a broadcast.** Every committed change that affects what a group's viewers see: expense create/edit/delete, payment proposed/confirmed/rejected/cancelled, settings change, close/reopen, and a member joining. Failed and no-op requests broadcast nothing. Broadcasts are sent after the transaction commits, never from inside it, so clients never see a change that later rolls back.
- **The event carries a snapshot, not a diff.** `group:update` = `{ groupId, change: { type, id?, actorId }, ledgerVersion, group, balances, settlement, pendingPayments }`, read in one `REPEATABLE READ` snapshot. Clients just replace their state. The join ack carries the same snapshot, so a (re)connecting client is current immediately without a separate REST call.
- **Ordering without relying on ledgerVersion.** Rejections, cancellations, settings and close/reopen deliberately don't bump `ledgerVersion` (D16, D17), so two updates can carry the same version, and clients can't use it alone to discard stale events. Instead, the server sends each group's updates strictly one at a time: each snapshot is read only after the previous one has been sent. A client therefore never receives an older state after a newer one. The rule for clients: apply socket events in arrival order; ignore a REST response whose `ledgerVersion` is lower than what's already shown. Different groups don't wait for each other.
- **Single process.** The per-group queue and the room registry live in memory. Running several API instances would need the Socket.io Redis adapter and a shared ordering mechanism; out of scope here.
- **Dev tooling.** `/dev/realtime` (a static test page, not served in production) and `npm run watch` (a terminal client) exist for manual testing.
