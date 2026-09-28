# Project Status

Honest record of what works, what's partial, and what isn't done.
It's updated at each milestone, not only at the end. Times are local (UTC+04:00).

## Timeline

| When | Checkpoint |
|---|---|
| 2026-09-23 19:56 | Initial commit: README + .gitignore |
| 2026-09-23 20:02 | **Work started.** Schema design proposed for review |
| 2026-09-23 20:08 | Schema approved. Open questions resolved (reminder unit, closed-group rules, leaving a group, rounding) |
| 2026-09-23 20:11 | Milestone 1: docker-compose Postgres, Prisma schema, init migration applied |
| 2026-09-24 09:21 | Milestone 2: Express app skeleton, auth (register, login, JWT, `/me`), first automated tests |
| 2026-09-24 09:35 | Milestone 3: expense CRUD with EQUAL / SHARES / EXACT splits, largest-remainder rounding, balances endpoint, invariant tests |
| 2026-09-24 09:40 | Milestone 4: groups, owner/member roles, invite by link and by email, settings with currency lock, close/reopen |
| 2026-09-24 10:05 | Milestone 5: repayments (propose / confirm / reject / cancel), minimum-transfer settlement, closing summary email |
| 2026-09-24 10:15 | Milestone 6: real-time sync (Socket.io rooms per group, snapshot broadcasts), dev test page and terminal watcher |
| 2026-09-24 10:40 | Milestone 7: debtor reminder job (per-group `reminderDays`, at most weekly, re-checked under the group lock) |
| 2026-09-24 12:30 | Frontend milestone 1: Vite + React + Tailwind skeleton, routes, hand-drawn design system and `/design` style guide, for visual review |
| 2026-09-24 12:50 | Activity feed endpoint (keyset-paginated, newest first), ahead of the group view |
| 2026-09-24 13:20 | Design revision after review: "Esep" wordmark, red/green balances, sticky-note colours, avatars, front page |
| 2026-09-24 14:00 | Frontend: log in / sign up wired to the API, session handling, protected routes, Playwright end-to-end tests |
| 2026-09-24 14:30 | Frontend: groups list with per-group balance, repayments awaiting confirmation, create group |
| 2026-09-24 15:20 | Frontend: group view with live updates: balances, settle-up plan, repayments (propose / confirm / reject / withdraw), activity feed, members and invite link, close/reopen |
| 2026-09-24 15:50 | Frontend: add-expense form with equal / shares / exact splits and a live preview that rounds like the server |
| 2026-09-28 11:00 | Expense notifications: stored per recipient, pushed live to a per-user socket room, header indicator with unread count and mark-as-read |
| 2026-09-28 11:30 | Groups list: balances and per-currency totals across all groups from one request, refreshed live |
| 2026-09-28 12:00 | Group view: paginated expense list (newest first, your share), delete from the expense view with a confirmation |
| 2026-09-28 13:00 | Receipts: one per expense (JPEG / PNG / WebP / PDF, 5 MB, type checked by content), members-only download, replace or remove on edit |

## Works
- `docker compose up -d` starts PostgreSQL 16. The data volume persists between restarts.
- Prisma schema for all entities: users, groups, members, invites, expenses, splits, payments, activity, notifications, email outbox.
- The init migration is applied, including hand-written CHECK constraints (see D12).
- Express 5 API with a central error handler: `400` for validation errors and malformed JSON, `404` for unknown routes.
- Auth (see D14): `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`. Emails are trimmed and lowercased. The password hash is never returned.
- `requireAuth` middleware for protected routes (Bearer JWT → `req.userId`).
- Expenses: `GET/POST /api/groups/:groupId/expenses` (the list is keyset-paged, newest first by date, D35), `GET/PUT/DELETE /api/groups/:groupId/expenses/:expenseId`.
  - EQUAL, SHARES and EXACT splits. Largest-remainder rounding with ties broken by join order (D5). EXACT amounts must add up exactly.
  - Every write takes the group row lock, bumps `ledgerVersion` and updates `owingSince` in the same transaction (D4, D7).
  - Optimistic lock on edits: a stale `version` gets `409` (D10). Deletes are soft deletes with activity snapshots (D9). Closed groups block expense changes (D8).
- Groups (see D16): `POST /api/groups`, `GET /api/groups` (mine), `GET /api/groups/:id` (members, pending invites, invite link, `currencyLocked`).
  - Owner-only: `PUT /api/groups/:id/settings` (name, currency, reminderDays), `POST …/close`, `POST …/reopen`, `POST …/invite-link` (replace the link).
  - The currency locks once there's any expense or payment. Closed groups block expense changes, new members and new invites.
- Invites:
  - Shareable link: `GET /api/invites/link/:token` (public preview), `POST …/join`.
  - By email: `POST /api/groups/:id/invites` stores the invite and stub-sends an email (console + `EmailOutbox`). `GET /api/invites/email/:token` (public preview), `POST …/accept` (the invited email only; new users register first). Expires after 7 days; re-inviting issues a new token.
- Balances: `GET /api/groups/:groupId/balances`, derived from expenses and confirmed repayments (D3).
- Settlement (D6, D17): `GET /api/groups/:groupId/settlement` returns the fewest transfers that settle everyone. It uses an exact bitmask search for ≤ 15 non-zero balances and greedy matching above that.
- Repayments (D17):
  - `POST /api/groups/:groupId/payments` proposes a full or partial repayment, capped at what's still owed.
  - `POST /api/payments/:id/confirm` and `…/reject` are recipient only; `…/cancel` is payer only.
  - `GET /api/groups/:groupId/payments` (`?status=`) lists a group's payments; `GET /api/payments/pending` lists yours across groups. Allowed in closed groups (D8).
- Closing a group emails every member a summary: final balances, the settlement plan and their own part in it.
- Real-time sync (D18): Socket.io with JWT handshake, one room per group joined via `group:join`. Every committed change broadcasts `group:update` with fresh balances, settlement, status and pending payments, in order per group. Manual testing: `/dev/realtime` page or `npm run watch` (see README).
- Activity feed (D22): `GET /api/groups/:groupId/activity`, newest first, `?limit=` (default 30, max 100) and `?before=` cursor paging; each entry has its actor and the stored snapshot.
- Expense notifications (D33): adding, editing or deleting an expense notifies everyone it involves (split and payer, before and after an edit) except whoever made the change. Stored in `Notification`, pushed live to a per-user Socket.io room, listed at `GET /api/notifications` with an unread count, and marked read one by one or all at once. In the UI: a header button with the unread count and a panel linking to each expense.
- Receipts (D36): an optional file sent with the expense as multipart (JPEG, PNG, WebP or PDF up to 5 MB; the type is detected from the content). Stored in `backend/uploads/` (git-ignored) under random names, and downloaded only by group members through `GET …/expenses/:id/receipt`. Editing can replace or remove it. Deleting the expense keeps the file (members only). In the UI: a file field in the add and edit form with immediate type and size errors, and a thumbnail (photos) or link (PDFs) on the expense view.
- Groups list (D34): `GET /api/groups` returns your balance in each group and totals per currency across all of them (closed groups included) from one query. The page shows the totals card at the top and refreshes live on `groups:changed`, sent to every member's own socket room on any change.
- Debtor reminders (D19): an hourly in-process job emails anyone who has owed money for the group's `reminderDays`, then repeats at that interval but never more than once a week. Settled debts are never reminded, and debtors whose pending payments cover the whole debt are skipped. Closed groups are included (D8). Interval: `REMINDER_INTERVAL_MS`.
- `npm test`: 186 tests (Vitest + Supertest) against the local database. Each file cleans up its own rows. They include:
  - 20,000 random splits that must sum exactly and round fairly;
  - 80 random create/edit/delete steps with repayments, checking balances after every step;
  - concurrency tests;
  - a create → repay → edit → delete scenario;
  - 3,000 random settlement cases checked against an independent brute-force minimum;
  - full, partial, rejected and racing repayments;
  - real Socket.io clients: room isolation between groups, every change type, and update ordering;
  - activity paging: newest first, ties on identical timestamps, and entries arriving mid-scroll;
  - notifications: the right recipients on create, edit and delete (never the actor, never anyone uninvolved), read state, paging, and live delivery only to the recipients' sockets;
  - per-group balances and currency totals from the single query, checked against the per-group balances on random histories;
  - receipts: each accepted format detected by content, renamed or disguised files refused, the 5 MB limit (exactly 5 MB passes), nothing left on disk after a rejected or failed write, non-members and other groups' URLs get 404, no static access, replace / remove / keep on edit, deleted expenses keep the file, and the test cleanup deleting files;
  - reminders over simulated weeks of hourly runs (no real waiting), including the weekly cap, settling before and between reminders, a settlement racing the job, and overlapping runs.
- `npm run typecheck` covers `src` and `tests`.
- Frontend `npm run e2e`: Playwright end-to-end tests in the system Chrome against a real backend (started automatically on port 3100; needs the database running). Test users are deleted afterwards. Current coverage: sign up, log in, wrong password, taken email, reload, log out, return to `?next=`, the open-redirect guard; groups list empty state, create group, red/green balances per user, the confirmation strip, and server validation errors; the group view in two browsers side by side (live balances, plan and feed; propose → confirm; reject; withdraw; overpaying; close/reopen seen live; a member joining; feed paging with live inserts; REST fallback with the socket blocked; non-members); adding expenses (equal split rounding shown and saved, leaving someone out, paying for someone else, shares, exact amounts that must add up, client validation, closed groups); the how-to guide on the front page and at `/help`; notifications arriving live in another browser (not for the actor or someone left out), opening one, mark-all-as-read, and the read state syncing across two tabs; totals across groups in two currencies with a closed group; the groups list and totals updating live from another browser (expense, pending and confirmed repayment, someone joining); the expense list (order, your share, show more, opening a row), deleting with a confirmation seen live in a second browser, deleting after a confirmed repayment (the repayment stands and is shown as owed back, balances sum to zero), and no edit or delete in a closed group; receipts added with an expense and opened by the other member in a second browser (thumbnail and new tab), a non-member refused, wrong type and oversize files refused (in the browser, and by the server for a disguised file) with nothing saved, and replacing and removing a receipt seen live. Frontend `npm test`: unit tests for money parsing and formatting, and the split preview checked against the backend's own `resolveSplit` on 5,000 random splits.

- Frontend skeleton (D20, D21, D23): every route exists. Log in and sign up work against the API (D24): the session survives reloads, protected pages redirect to `/login?next=…` and return afterwards, and API errors are shown next to the right field. The groups list (D25) shows each group with your balance in red or green, flags repayments waiting for your confirmation, and creates groups. The group view (D26) updates live over Socket.io, falls back to REST when the socket is down, and covers balances, the settle-up plan, the whole repayment flow, the activity feed, members with the invite link, and close/reopen. Its layout (D28) puts adding an expense first, keeps balances and the settle-up plan in one card, and folds the member list and invite link away. Adding an expense (D27) supports all three split types with a live per-person preview. The front page shows a five-step "How it works" guide as a path of sticky notes, in place of the old sample group and feature cards; logged-in users get a longer version at `/help`, linked from the header (not on `/design`, which is dev-only). Opening an expense from the activity feed shows it above the group's balances, with an Edit button; the edit form lists everyone in the group now, so people who joined later can be added to an old expense's split (D29). The join-by-link page (D30) previews the group, sends logged-out visitors through log in or sign up and back, and joins on confirmation. The email-invite page (D31) works the same way but only for the invited address: sign-up locks that email, and a different logged-in account is told who the invite is for. Invites are sent from the group's "Members & invite" panel (D32), which also lists who's been invited and hasn't joined. An "Expenses" card lists the group's expenses newest first with your share, 10 at a time, each opening the expense view, and the expense view has a Delete button with a confirmation (D35), hidden in closed groups. The base components are Card (sticky-note tones, washi tape), Button (primary / default / quiet), TextField, SelectField, Checkbox, Choice (split-type picker), Balance (red owes / green owed), Money, Avatar, Wordmark, Highlight, Divider, Arrow and Stamp, all drawn with rough.js. They can be reviewed at http://localhost:5173/design. Typecheck and production build pass, and the layout was checked at 1280 px and 390 px.

## Partial
- No endpoint to revoke a pending email invite or transfer ownership.

## Known issue: rare intermittent e2e failures in the live-update path (2026-09-25)
Seen while running the full frontend e2e suite in parallel (39 tests, one local backend). Before the fixes below it failed **3 times in 10 full runs**. Each time a single test waited 5 s for something that never appeared, and the test took 13–15 s instead of about 3 s. Running the affected test alone (20 repeats) never failed, so load is part of it.

Two failure modes were seen:
1. **"an expense added alone can be edited to include someone who joins later"** (1 of 10 runs, plus once the day before). The trace showed the whole page replaced by React Router's error screen: `Cannot read properties of null (reading 'expense')` in `ExpenseView`.
   - **Root cause (found and fixed).** `useApi` cancels a request when it re-fetches, and `ExpenseView` re-fetches twice right after a save. When the cancel landed while the response body was being read, `res.json()` failed with an AbortError. `api()` swallowed that with `.catch(() => null)` and returned `null` as a success, and `useApi` stored it without checking whether the request had been cancelled.
   - **Fix.** `api()` now rethrows aborts during the body read (unit test in `src/lib/api.test.ts`). `useApi`, the activity feed and the groups list ignore results of superseded requests.
2. **"equal split: … everyone's balance updates live"** (2 of 10 runs): a balance line never appeared. No trace was kept for these runs, so the cause is **not confirmed**. The same abort race is the likely explanation. The activity feed reloads on every live update and cancels its previous load, and before the fix a cancelled load could resolve as `null` and crash while rendering. That takes down the whole page, balances included. This is an inference, not something seen in a trace.

After the fix: 6 full runs, then 2 more after the safety net below, all passed (8 of 8). That's fewer runs than it took to see the problem at first, so treat it as likely fixed rather than proven.

**Safety net added at the same time.** After a change made on the page, the client used to skip the REST read-back whenever the socket was *connected*. It now does so only once the socket has actually *joined* the group's room. If the join failed (for example the server timed out under load) or hasn't finished, the page reads the new state over REST, and the activity feed reloads with it. Changes made by *other* people while the socket is connected but not joined still wait for the join, and there's no periodic REST poll.

**If it shows up again:** run `npx playwright test --output=<dir>` in a loop so the failing test's trace is kept (a normal run clears the previous one), then check the trace's error snapshot and network log.

## Not done yet (planned)
- Notifications for payment requests and responses, and for reminders (expense notifications are done, D33)

## Deliberately out of scope
- Real email delivery: emails are logged to the console and stored in `EmailOutbox`.
- Real payment processing: repayments are recorded and then confirmed by the recipient.
- File storage beyond local disk: receipts go in `backend/uploads/` (or `UPLOADS_DIR`).
- **Leaving a group / removing members.** Agreed to skip this (2026-09-23). Members stay in a group permanently.
- Currency conversion: each group has one currency, and combined balances are shown per currency.

## What I'd do next (beyond the current scope)
- Leaving a group or removing a member: allowed only when their balance is zero, or by transferring their balance to someone else. Needs a `leftAt` column on `GroupMember` and filtering in the member and split lists.
- Real email delivery with a background job queue (e.g. BullMQ) instead of the in-process interval job. This also matters for running several API instances, which would each scan for due reminders (still correct because of the row lock, just wasteful).
- Receipt storage in object storage (S3-compatible), with short-lived signed URLs instead of blob downloads.
- A link to a deleted expense's receipt from its feed entry (the API already serves it to members).

## Environment notes
- The dev machine's home partition is small, so `frontend/node_modules` is a symlink to `/goinfre`. (`backend/node_modules` was meant to be one too, but it's currently a regular directory on the home partition.) `.gitignore` uses `node_modules` without a trailing slash so the symlink is also ignored.
- `npm audit` reports a high-severity advisory in `deepmerge-ts`, pulled in by the `prisma` CLI (a dev dependency). No fix is available upstream, and it doesn't ship at runtime.
