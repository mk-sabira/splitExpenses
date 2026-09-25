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

## Works
- `docker compose up -d` starts PostgreSQL 16. The data volume persists between restarts.
- Prisma schema for all entities: users, groups, members, invites, expenses, splits, payments, activity, notifications, email outbox.
- The init migration is applied, including hand-written CHECK constraints (see D12).
- Express 5 API with a central error handler: `400` for validation errors and malformed JSON, `404` for unknown routes.
- Auth (see D14): `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`. Emails are trimmed and lowercased. The password hash is never returned.
- `requireAuth` middleware for protected routes (Bearer JWT → `req.userId`).
- Expenses: `GET/POST /api/groups/:groupId/expenses`, `GET/PUT/DELETE /api/groups/:groupId/expenses/:expenseId`.
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
- Debtor reminders (D19): an hourly in-process job emails anyone who has owed money for the group's `reminderDays`, then repeats at that interval but never more than once a week. Settled debts are never reminded, and debtors whose pending payments cover the whole debt are skipped. Closed groups are included (D8). Interval: `REMINDER_INTERVAL_MS`.
- `npm test`: 148 tests (Vitest + Supertest) against the local database. Each file cleans up its own rows. They include:
  - 20,000 random splits that must sum exactly and round fairly;
  - 80 random create/edit/delete steps with repayments, checking balances after every step;
  - concurrency tests;
  - a create → repay → edit → delete scenario;
  - 3,000 random settlement cases checked against an independent brute-force minimum;
  - full, partial, rejected and racing repayments;
  - real Socket.io clients: room isolation between groups, every change type, and update ordering;
  - activity paging: newest first, ties on identical timestamps, and entries arriving mid-scroll;
  - reminders over simulated weeks of hourly runs (no real waiting), including the weekly cap, settling before and between reminders, a settlement racing the job, and overlapping runs.
- `npm run typecheck` covers `src` and `tests`.
- Frontend `npm run e2e`: Playwright end-to-end tests in the system Chrome against a real backend (started automatically on port 3100; needs the database running). Test users are deleted afterwards. Current coverage: sign up, log in, wrong password, taken email, reload, log out, return to `?next=`, the open-redirect guard; groups list empty state, create group, red/green balances per user, the confirmation strip, and server validation errors; the group view in two browsers side by side (live balances, plan and feed; propose → confirm; reject; withdraw; overpaying; close/reopen seen live; a member joining; feed paging with live inserts; REST fallback with the socket blocked; non-members); adding expenses (equal split rounding shown and saved, leaving someone out, paying for someone else, shares, exact amounts that must add up, client validation, closed groups); the how-to guide on the front page and at `/help`. Frontend `npm test`: unit tests for money parsing and formatting, and the split preview checked against the backend's own `resolveSplit` on 5,000 random splits.

- Frontend skeleton (D20, D21, D23): every route exists. Log in and sign up work against the API (D24): the session survives reloads, protected pages redirect to `/login?next=…` and return afterwards, and API errors are shown next to the right field. The groups list (D25) shows each group with your balance in red or green, flags repayments waiting for your confirmation, and creates groups. The group view (D26) updates live over Socket.io, falls back to REST when the socket is down, and covers balances, the settle-up plan, the whole repayment flow, the activity feed, members with the invite link, and close/reopen. Its layout (D28) puts adding an expense first, keeps balances and the settle-up plan in one card, and folds the member list and invite link away. Adding an expense (D27) supports all three split types with a live per-person preview. The front page shows a five-step "How it works" guide as a path of sticky notes, in place of the old sample group and feature cards; logged-in users get a longer version at `/help`, linked from the header (not on `/design`, which is dev-only). Still placeholders: the expense detail/edit page, and the join/invite pages. The base components are Card (sticky-note tones, washi tape), Button (primary / default / quiet), TextField, SelectField, Checkbox, Choice (split-type picker), Balance (red owes / green owed), Money, Avatar, Wordmark, Highlight, Divider, Arrow and Stamp, all drawn with rough.js. They can be reviewed at http://localhost:5173/design. Typecheck and production build pass, and the layout was checked at 1280 px and 390 px.

## Partial
- No endpoint to revoke a pending email invite or transfer ownership.
- The expense list isn't paginated.

## Not done yet (planned)
- Balances combined per currency across groups (per-group balances are done)
- Notifications when an expense involving you is added or edited, and for payment requests and responses (planned as a per-user Socket.io room plus stored `Notification` rows)
- Receipt upload for expenses
- Frontend screens: login/register, groups list, group view with live updates, expense detail/edit, invites, repayments. The skeleton and design system are done.

## Deliberately out of scope
- Real email delivery: emails are logged to the console and stored in `EmailOutbox`.
- Real payment processing: repayments are recorded and then confirmed by the recipient.
- File storage beyond local disk: receipts go in `backend/uploads/`.
- **Leaving a group / removing members.** Agreed to skip this (2026-09-23). Members stay in a group permanently.
- Currency conversion: each group has one currency, and combined balances are shown per currency.

## What I'd do next (beyond the current scope)
- Leaving a group or removing a member: allowed only when their balance is zero, or by transferring their balance to someone else. Needs a `leftAt` column on `GroupMember` and filtering in the member and split lists.
- Real email delivery with a background job queue (e.g. BullMQ) instead of the in-process interval job. This also matters for running several API instances, which would each scan for due reminders (still correct because of the row lock, just wasteful).
- Receipt storage in object storage (S3-compatible).
- Groups list balances in one request: the page currently makes one `GET /groups/:id/balances` call per group (an N+1 pattern, D25). Fine for a handful of groups, but adding the caller's `myNet` to `GET /groups` (computed for all their groups in one grouped query) would make it a single request.

## Environment notes
- The dev machine's home partition is small, so `frontend/node_modules` is a symlink to `/goinfre`. (`backend/node_modules` was meant to be one too, but it's currently a regular directory on the home partition.) `.gitignore` uses `node_modules` without a trailing slash so the symlink is also ignored.
- `npm audit` reports a high-severity advisory in `deepmerge-ts`, pulled in by the `prisma` CLI (a dev dependency). No fix is available upstream, and it doesn't ship at runtime.
