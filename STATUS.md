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
- Balances: `GET /api/groups/:groupId/balances`, derived from expenses and confirmed repayments (D3).
- `npm test`: 51 tests (Vitest + Supertest) against the local database. Each file cleans up its own rows. They include:
  - 20,000 random splits that must sum exactly and round fairly;
  - 80 random create/edit/delete steps with repayments, checking balances after every step;
  - concurrency tests;
  - a create → repay → edit → delete scenario.
- `npm run typecheck` covers `src` and `tests`.

## Partial
- Groups and payments have database tables and are used by the expense code, but have no API yet. Tests create them directly in the database.
- Expense writes record `Activity` rows, but there's no feed endpoint yet.
- The expense list isn't paginated.

## Not done yet (planned)
- Groups: create, invite by link or email, group currency, settings
- Balances combined per currency across groups (per-group balances are done)
- Minimum-transfer settlement algorithm
- Repayments API with recipient confirmation (balances already count confirmed repayments)
- Activity feed
- Real-time sync (Socket.io)
- Notifications when an expense involving you is added or edited
- Receipt upload for expenses
- Debtor reminders (interval job)
- Closing and reopening a group, with the summary email
- Frontend (React + TypeScript + Tailwind)
- Automated tests for settlement, repayments and reminders (expense and balance invariants are covered)

## Deliberately out of scope
- Real email delivery: emails are logged to the console and stored in `EmailOutbox`.
- Real payment processing: repayments are recorded and then confirmed by the recipient.
- File storage beyond local disk: receipts go in `backend/uploads/`.
- **Leaving a group / removing members.** Agreed to skip this (2026-09-23). Members stay in a group permanently.
- Currency conversion: each group has one currency, and combined balances are shown per currency.

## What I'd do next (beyond the current scope)
- Leaving a group or removing a member: allowed only when their balance is zero, or by transferring their balance to someone else. Needs a `leftAt` column on `GroupMember` and filtering in the member and split lists.
- Real email delivery with a background job queue (e.g. BullMQ) instead of the in-process interval job.
- Receipt storage in object storage (S3-compatible).

## Environment notes
- The dev machine's home partition is small, so `backend/node_modules` is a symlink to `/goinfre`. `.gitignore` uses `node_modules` without a trailing slash so the symlink is also ignored.
- `npm audit` reports a high-severity advisory in `deepmerge-ts`, pulled in by the `prisma` CLI (a dev dependency). No fix is available upstream, and it doesn't ship at runtime.
