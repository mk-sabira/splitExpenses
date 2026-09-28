# Project Status

An honest record of what works, what's partial, what isn't done and why. It's updated at each milestone, not only at the end. Times are local (UTC+04:00).

**As of 2026-09-28:** the required features are implemented and covered by automated tests; the gaps are listed under [Partial](#partial) and [Not done](#not-done-and-why). Backend: 186 tests. Frontend: 34 unit tests and 51 end-to-end tests in real browsers. All pass, including on a fresh clone with an empty database (checked 2026-09-28).

## Timeline

From `git log` (commit times), plus two review steps from the agent session that have no commit of their own (marked *session*). Earlier versions of this table had hand-written times, some of which didn't match the commits.

| When | What |
|---|---|
| 2026-09-23 19:56 | Initial commit: README and .gitignore |
| 2026-09-23 20:02 | *session:* schema design proposed for review |
| 2026-09-23 20:08 | *session:* schema approved; open questions settled (reminder unit, closed-group rules, no leaving groups, rounding rule) |
| 2026-09-23 20:12 | Database schema, docker-compose Postgres, decision log and status file |
| 2026-09-24 09:20 | Express app and auth (register, login, JWT), first tests |
| 2026-09-24 09:30 | Expenses with equal / shares / exact splits, rounding, balances |
| 2026-09-24 09:38 | Groups, roles, invites by link and by email |
| 2026-09-24 09:59 | Repayments, minimum-transfer settlement, closing summary email |
| 2026-09-24 10:13 | Real-time sync (Socket.io room per group) |
| 2026-09-24 10:39 | Debtor reminder job with a weekly cap |
| 2026-09-24 12:24 | Frontend skeleton and hand-drawn design system |
| 2026-09-24 12:27 | Activity feed endpoint |
| 2026-09-24 12:41 | Design revision after review (name, colours, front page) |
| 2026-09-24 12:48 | Log in and sign up, with Playwright end-to-end tests |
| 2026-09-24 12:51 | Groups list and create group |
| 2026-09-24 12:59 | Live group view: balances, settle-up, repayments, activity |
| 2026-09-24 13:02 | Add-expense form with live split preview |
| 2026-09-25 10:12 | Front page "how it works" guide |
| 2026-09-25 10:43 | Group view layout and header |
| 2026-09-25 11:18 | Expense view and edit |
| 2026-09-25 11:45 | Join-by-link page |
| 2026-09-25 12:12 | Email-invite page; client cancelled-request race fixed; "Invite by email" panel (three commits in the same minute) |
| 2026-09-28 10:58 | In-app expense notifications, pushed live |
| 2026-09-28 11:10 | Combined balances per currency; groups list refreshed live, one request |
| 2026-09-28 11:22 | Expense list and deleting expenses in the UI |
| 2026-09-28 11:37 | Receipt upload with members-only download |
| 2026-09-28 | Documentation pass: README, this file |

## The task, point by point

| Requirement | Status | Where it's proven |
|---|---|---|
| Groups with members; invite by link or email | Done | `groups.test.ts`; `join.spec.ts`, `invites.spec.ts` |
| Group currency | Done: chosen at creation, locked after the first expense or payment | `groups.test.ts` ("allows a currency change until the first expense…") |
| Expense: who paid, how much, split equally / by shares / by exact amounts | Done | `expenses.test.ts`, `split.test.ts`; `expense.spec.ts` |
| Category, date, comment, receipt file | Done | `receipts.test.ts`; `receipts.spec.ts` |
| Balances per group and across all groups | Done: across groups, one total per currency, no conversion | `myBalances.test.ts`; `groups.spec.ts` |
| Repayment, full or partial, confirmed by the recipient | Done | `payments.test.ts`; `group.spec.ts` |
| Group activity feed | Done | `activity.test.ts`; `group.spec.ts` |
| Reminders to debtors | Done: email (stubbed) | `reminders.test.ts` |
| Closing a group with a final report | Done: report emailed to everyone (stubbed); can be reopened | `payments.test.ts` ("closing summary email"), `groups.test.ts` |
| Balances recalculated and updated for everyone immediately | Done: Socket.io push after every committed change | `realtime.test.ts`; two-browser tests in `group.spec.ts`, `expenses.spec.ts` |
| Minimum set of transfers, not "everyone pays everyone" | Done: exact search up to 15 people with a balance, greedy above | `settlement.test.ts` (3,000 random cases against brute force) |
| Notification when an expense involving you is added or edited | Done: in-app, live (also on delete) | `notifications.test.ts`; `notifications.spec.ts` |
| No lost cents; a fixed rule for who gets the extra cent | Done: largest remainder, ties to whoever joined first (D5) | `split.test.ts` (20,000 random splits) |
| Editing or deleting an old expense recalculates everything, including repayments | Done: balances are always derived from records (D3) | `expenses.test.ts` (80 random steps with repayments); `expenses.spec.ts` (delete after a confirmed repayment) |
| Repayment counts only after confirmation; pending is visible to both | Done | `payments.test.ts` ("shows pending payments to both sides") |
| Unpaid debt past the group's deadline: email with amount and recipient, at most weekly, not once paid | Done | `reminders.test.ts` (simulated weeks) |
| Two people add expenses at once: both counted, balances sum to zero | Done: group row lock (D4) | `expenses.test.ts` ("serializes 20 simultaneous creates…") |
| Closing: no new expenses, everyone emailed the summary, can be reopened | Done | `groups.test.ts`, `payments.test.ts`; `expense.spec.ts` |
| Works with two clients open at once | Done | every `*.spec.ts` that opens two browsers |

## Works

**Backend** (Node + TypeScript, Express 5, Prisma 6, PostgreSQL 16)
- Auth (D14): register, log in, `GET /api/auth/me`. bcrypt passwords, JWT in a Bearer header.
- Groups (D16): create, list (with your balance and per-currency totals, D34), details. Owner-only settings (name, currency, reminder days), close, reopen and replacing the invite link. The currency locks once there's money in the group.
- Invites (D16): shareable link with a public preview; personal email invite that only the invited address can accept, expires after 7 days.
- Expenses (D15, D35, D36): create, list (paged, newest first by date), view, edit (optimistic lock, D10), soft delete (D9). EQUAL, SHARES and EXACT splits with largest-remainder rounding (D5). Optional receipt (JPEG, PNG, WebP or PDF, 5 MB, type detected from content), downloadable by group members only.
- Balances and settlement (D3, D6): always calculated from the records, never stored; the fewest transfers that settle everyone.
- Repayments (D17): propose (full or partial, capped at what's owed), confirm or reject (recipient only), cancel (payer only). Allowed in closed groups (D8).
- Every money write locks the group row and bumps `ledgerVersion` (D4), so concurrent writes are serialized and clients can drop stale updates.
- Activity feed (D22): every change with a snapshot, newest first, keyset-paged.
- Notifications (D33): a stored row per person involved in an expense change (never the person who made it), pushed live.
- Real-time (D18, D33, D34): Socket.io. One room per group with snapshots after every committed change, in commit order. One room per user for notifications and "something changed in one of your groups".
- Emails (D11), all stubbed to the console and the `EmailOutbox` table: invites, debtor reminders (D19: hourly job, per-group delay, at most weekly, skipped once settled or fully covered by pending repayments), and the closing summary.
- CHECK constraints in the database as a backstop (D12, D36).

**Frontend** (React 19, Vite, Tailwind 4, rough.js)
- Front page with a "how it works" guide; log in / sign up; `/help`.
- Groups list: your balance in each group (red owes, green owed), totals per currency across all groups, repayments waiting for your confirmation, create group. Refreshes live.
- Group view, live over Socket.io with a REST fallback: balances and the settle-up plan in one card, the full repayment flow, pending repayments, expense list with "show more", activity feed, members and invites (link and email), close / reopen.
- Expense form (add and edit): three split types with a live per-person preview that rounds exactly like the server, receipt field with immediate type and size errors.
- Expense view: details, each person's part, the receipt (thumbnail for photos, link for PDFs), edit, delete with a confirmation that explains what happens to repayments.
- Notifications: header button with unread count, list, mark as read, synced across tabs.
- Join-by-link and email-invite pages that work for logged-out visitors too.
- Layout checked at 1280 px and 390 px. Style guide at `/design` (dev only).

**Tests** (how to run them: see the README)
- Backend, `npm test` (186 tests, Vitest + Supertest, against the local database). Highlights: 20,000 random splits; 80 random create/edit/delete steps with repayments, checking every invariant after each step; concurrent creates and edits; 3,000 random settlement cases against brute force; racing repayment decisions; reminders over simulated weeks; real Socket.io clients for room isolation and ordering; notifications; combined totals against per-group balances on random histories; receipts (content sniffing, size limit, access, nothing left on disk after a failed write).
- Frontend unit, `npm test` (34): money parsing and formatting; the split preview against the backend's own `resolveSplit` on 5,000 random splits; the API client's abort handling.
- End-to-end, `npm run e2e` (51, Playwright in the system Chrome against a real backend): most scenarios use two or three separate browser sessions side by side and check that each sees the other's changes live.
- `npm run typecheck` (backend `src` and `tests`) and the frontend production build both pass.

## Partial
- **Group settings after creation.** Name, currency and reminder days can be changed through the API (owner only, tested), but the UI only sets them when the group is created.
- **Closing report.** Sent to every member by email (stubbed); there's no in-app report page. The group page still shows the final balances and settle-up plan.
- **Notifications** are in-app only, and only for expenses. Repayment requests and responses show up live in the group view and in "Waiting for you" on the groups list, but don't create notifications. Reminders are emails only.
- **A deleted expense's receipt** is kept and the API serves it to members, but nothing in the UI links to it.
- **Invites and ownership:** no way to revoke a pending email invite or transfer group ownership.

## Known issue: rare intermittent e2e failures in the live-update path — likely fixed, not proven
First seen on 2026-09-25, running the full e2e suite in parallel (39 tests at the time, one local backend): **3 failures in 10 full runs**. Each time a single test waited 5 s for something that never appeared. Running the affected test alone (20 repeats) never failed, so load is part of it.

Two failure modes were seen:
1. **"an expense added alone can be edited to include someone who joins later"** (1 of 10 runs, plus once the day before). The trace showed React Router's error screen: `Cannot read properties of null (reading 'expense')` in `ExpenseView`.
   - **Root cause (found and fixed).** `useApi` cancels a request when it re-fetches. When the cancel landed while the response body was being read, `res.json()` failed with an AbortError, `api()` swallowed it and returned `null` as a success, and `useApi` stored it without checking whether the request had been cancelled.
   - **Fix.** `api()` rethrows aborts during the body read (unit test in `src/lib/api.test.ts`). `useApi`, the activity feed and the groups list ignore results of superseded requests.
2. **"equal split: … everyone's balance updates live"** (2 of 10 runs): a balance line never appeared. No trace was kept, so the cause is **not confirmed**. The same abort race is the likely explanation (the feed reloads on every live update and a cancelled load could crash the page), but that's an inference, not something seen in a trace.

**Safety net added at the same time:** after a change made on the page, the client skips the REST read-back only once the socket has actually joined the group's room, not merely connected.

**Runs since the fix:** 8 of 8 full runs passed on 2026-09-25. On 2026-09-28, as the suite grew from 42 to 51 tests, 8 more full runs whose result was read all passed (one further run's summary was lost in log output, so its result is unknown). That's 16 of 16 known runs, against 3 failures in the 10 runs before the fix. That's encouraging but it isn't proof, since failure mode 2 was never traced.

**If it shows up again:** run `npx playwright test --output=<dir>` in a loop so the failing test's trace is kept, then check its error snapshot and network log.

## Not done, and why
- **Leaving a group / removing members.** Agreed on 2026-09-23 to leave it out: it needs a rule for what happens to that person's balance (see the next steps). Members stay in a group permanently.
- **Notifications for repayments and reminders.** Expense notifications were what the task asked for. Repayments already surface live in the group view and on the groups list.
- **Group settings screen, revoking invites, transferring ownership.** The task didn't require them, and each came after the required features in priority. The settings API exists and is tested.

## Deliberately out of scope
- **Real email delivery.** Emails are printed in the API console and stored in the `EmailOutbox` table (the task allows stubs).
- **Real payment processing.** A repayment is recorded by the payer and confirmed by the recipient.
- **File storage beyond local disk.** Receipts go in `backend/uploads/` (or `UPLOADS_DIR`).
- **Currency conversion.** Each group has one currency; totals across groups are shown per currency.

## What I'd do next
- Leaving a group or removing a member: allowed only at a zero balance, or by moving the balance to someone else. Needs a `leftAt` column on `GroupMember` and filtering in member and split lists.
- A group settings screen (the API is done), revoking email invites, transferring ownership.
- Notifications for repayment requests, confirmations and rejections, using the same per-user room.
- An in-app closing report page, and a link from a deleted expense's feed entry to its receipt.
- Real email delivery through a job queue (e.g. BullMQ) instead of the in-process interval, which also suits running several API instances.
- Receipts in S3-compatible storage with short-lived signed URLs.
- A periodic REST poll on the group page as a last line of defence for missed socket updates, and more full e2e runs (with traces kept) to settle the known issue above.

## Environment notes
- The dev machine's home partition is small, so `frontend/node_modules` is a symlink to `/goinfre`. `.gitignore` uses `node_modules` without a trailing slash so the symlink is ignored too. A normal clone doesn't need this.
- `npm audit` in `backend` reports a high-severity advisory in `deepmerge-ts`, pulled in by the `prisma` CLI (a dev dependency). No fix is available within Prisma 6, and it doesn't ship at runtime. The frontend reports none.
