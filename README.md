# Esep: shared expenses

A shared-expenses app for a trip or a shared flat: who paid for whom, and who owes whom. Groups with invites by link or email, expenses split equally, by shares or by exact amounts (with category, date, comment and a receipt), balances per group and across all groups, the fewest transfers to settle up, repayments confirmed by the recipient, an activity feed, notifications, debtor reminders, and closing a group with a final report. Everything updates live for everyone in the group.

- **[STATUS.md](STATUS.md)**: what works, what's partial, what isn't done and why, each task requirement mapped to the tests that prove it, and the timeline.
- **[DECISIONS.md](DECISIONS.md)**: the decision log, D1–D36, each with the reason.

## Run it from a fresh clone

**Prerequisites**
- **Node.js 22** or newer (developed on 22.23), with npm.
- **Docker** with Compose v2, for PostgreSQL 16.
- **Google Chrome**, only for the end-to-end tests (Playwright drives the installed Chrome; nothing else is downloaded).
- Free ports 5432 (Postgres), 3000 (API) and 5173 (web). If 5432 is already taken, change the host port in `docker-compose.yml` (e.g. `"5433:5432"`) and use the same port in `DATABASE_URL` in `backend/.env`.

**1. Database**
```bash
git clone <repo-url> esep && cd esep
docker compose up -d --wait     # PostgreSQL 16 on localhost:5432, data kept in a Docker volume
```

**2. Backend**
```bash
cd backend
cp .env.example .env
# Set JWT_SECRET in .env to a random string of 32+ characters, for example:
#   sed -i "s|^JWT_SECRET=.*|JWT_SECRET=\"$(openssl rand -hex 32)\"|" .env
npm install
npx prisma migrate dev          # creates the tables (3 migrations) and generates the Prisma client
npm run dev                     # API on http://localhost:3000; check with: curl localhost:3000/api/health
```
The other settings in `.env.example` work as they are. Receipt files are stored in `backend/uploads/` (ignored by git); set `UPLOADS_DIR` to put them elsewhere.

**3. Frontend** (in a second terminal)
```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173
```
Vite proxies `/api` and `/socket.io` to the API, so the browser only talks to one origin. Set `API_URL` if the API isn't on `http://localhost:3000`.

Open http://localhost:5173 and sign up. To stop: `Ctrl+C` both servers, then `docker compose down` (add `-v` to also delete the data).

*Verified on 2026-09-28 from a fresh clone against an empty database, following exactly these steps: migrations applied, API healthy, sign-up through the proxy, backend tests 186/186, frontend unit tests 34/34, production build, and end-to-end tests 51/51.*

## Tests: how to run them and what they prove

All test suites need the database running (step 1) and `backend/.env` in place (step 2). The API and web dev servers don't need to be running. Each suite creates its own users and deletes them, and any uploaded files, afterwards.

```bash
cd backend  && npm test          # 186 tests, ~5 s
cd backend  && npm run typecheck
cd frontend && npm test          # 34 unit tests, <1 s
cd frontend && npm run e2e       # 51 end-to-end tests, ~40 s; starts its own API (port 3100) and web server (port 5199)
```

**Backend** (Vitest + Supertest, real HTTP against the real database). The claims the task cares about are tested directly:
- **No lost cents:** 20,000 random splits always add up exactly to the total, and the extra cent always goes by the documented rule: largest remainder, ties to whoever joined first (`split.test.ts`, D5).
- **Edits and deletes recalculate everything, repayments included:** 80 random create / edit / delete steps with repayments in between, checking balances and invariants after every step, plus a scripted create → repay → edit → delete case (`expenses.test.ts`, D3).
- **Concurrent writes:** 20 simultaneous expenses are all counted and balances sum to zero; of several simultaneous edits to one expense, exactly one wins (`expenses.test.ts`, D4, D10).
- **Minimum transfers:** 3,000 random groups checked against an independent brute-force minimum (`settlement.test.ts`, D6).
- **Repayments count only once confirmed:** full, partial, rejected, cancelled, and confirm and reject racing each other (`payments.test.ts`).
- **Reminders:** weeks simulated with hourly runs and no real waiting. They respect the group's delay, never go out twice in a week, stop once the debt is settled (including a settlement that races the job), and each email names the amount and the recipient (`reminders.test.ts`).
- **Live updates:** real Socket.io clients. Each group's room only gets its own updates, in commit order, never an older state after a newer one (`realtime.test.ts`).
- Also: notifications go to exactly the people involved (`notifications.test.ts`); totals across groups match the per-group balances on random histories (`myBalances.test.ts`); receipts are checked by content, capped at 5 MB, and visible to members only (`receipts.test.ts`); invites, roles, closing and the closing email (`groups.test.ts`, `payments.test.ts`).

**Frontend unit** (Vitest): money parsing and formatting, and the form's split preview checked against the backend's own `resolveSplit` on 5,000 random splits, so what you see before saving is what gets saved.

**End-to-end** (Playwright in Chrome): the app used the way people use it, mostly with **two or three separate browser sessions side by side**. For example: Alice adds an expense and Bob's balance, settle-up plan, feed and notification badge change without a reload; Bob proposes a repayment and Alice confirms it; an expense is deleted after its repayment was confirmed and both screens stay consistent; a receipt uploaded by one person opens in the other's browser. The full list is under "Tests" in [STATUS.md](STATUS.md).

## Demo walkthrough (about 5 minutes)

With the database, API and frontend running (steps 1–3). Use two browser profiles, or a normal and a private window, so you can be logged in as two people at once.

1. **Alice** (window 1): sign up at http://localhost:5173 as `alice@example.com`, then click **New group**, e.g. "Lisbon trip", currency EUR.
2. **Invite Bob by email**: open **Members & invite**, enter `bob@example.com` and send. The email isn't really sent. It's printed in the **API terminal**, including the accept link:
   ```
   [email:INVITE] to=bob@example.com subject="Alice invited you to \"Lisbon trip\""
   ...
   Accept the invite: http://localhost:5173/invites/<token>
   ```
   (Or copy the shareable invite link from the same panel.)
3. **Bob** (window 2): open that link, choose **Sign up** (the email is filled in and locked), then **Accept and join**. Alice's page shows Bob joining, without a reload.
4. **An expense**: Alice clicks **+ Add an expense**: "Dinner", 40.00, split equally, optionally with a photo of the receipt. Bob's window updates at once: *you owe €20.00*, the settle-up plan says *You → Alice €20.00*, the feed shows the expense, and the 🔔 badge shows a notification.
5. **A repayment**: Bob clicks **I paid this** on the plan, then **Record it** (lower the amount first for a partial repayment). Both windows show it as **pending**, and balances don't change yet. Alice clicks **Confirm**: both are settled. **Reject** would leave the debt as it was.
6. **Combined balances**: **my groups** shows each group with your balance and a total per currency across all your groups.
7. **Closing**: Alice (the owner) clicks **Close group**. No new expenses can be added, and every member gets a summary email in the API terminal. **Reopen group** undoes it.
8. **Stubbed emails**: besides the API terminal, every email is stored in the `EmailOutbox` table:
   ```bash
   docker compose exec db psql -U splitexpenses -c 'SELECT "createdAt", kind, "to", subject FROM "EmailOutbox" ORDER BY "createdAt" DESC LIMIT 10;'
   ```
   (`cd backend && npx prisma studio` shows the same table in a browser.) Kinds: `INVITE`, `DEBT_REMINDER`, `GROUP_CLOSED_SUMMARY`. Reminders need someone to have owed money for the group's reminder days. The job runs hourly (`REMINDER_INTERVAL_MS`) and once at startup (see [Debtor reminders](#debtor-reminders)).

## Stack and why

| Part | Choice | Why |
|---|---|---|
| Backend language | Node.js + TypeScript | One language across server and client; the frontend's split preview literally imports the backend's rounding code in a test, so they can't drift apart. |
| HTTP | Express 5 | The most widely known Node framework; Express 5 forwards errors from async handlers on its own, and Fastify's extra speed isn't needed at this scale (D1). |
| Database | PostgreSQL 16 | Relational, as the task asks; row locks (`SELECT … FOR UPDATE`) serialize money writes per group, and CHECK constraints back up the validation (D4, D12). |
| Data access | Prisma 6 | Typed queries and versioned migrations from one schema file; raw SQL where needed (the row lock, the one-query balances). Pinned to 6.x because 7.x adds setup work for no gain here (D1). |
| Real time | Socket.io | Its rooms map directly onto "everyone looking at group X" and "user Y's notifications", and it reconnects by itself (D1, D18). |
| Frontend | React 19 + Vite | React as the task asks; Vite for a fast dev server and a proxy so the browser sees one origin (D20). |
| Styling | Tailwind CSS 4 + rough.js | Tailwind keeps styling next to the markup with no config file; rough.js draws the hand-drawn look (D20, D21). |
| Validation | zod | One schema per request body gives both the type and the `400` field messages. |
| Tests | Vitest, Supertest, Playwright | Vitest runs TypeScript directly; Supertest tests the real HTTP API; Playwright drives real browsers, several at once, for the two-client behaviour. |
| Uploads | multer | The standard Express multipart parser, and it enforces the 5 MB limit while the upload is still arriving (D36). |

## How it was built: model and tool

The project was built with **Claude Opus 5.5**, used through **Claude Code** (Anthropic's command-line coding agent), throughout the whole project: design, code, tests and these documents.

> I used Claude Code because it works directly inside the repository: it edits files, runs the tests and makes git commits as it goes, so the commit history and DECISIONS.md were produced during the work instead of written afterwards. I used Claude Opus 5.5 because it is the model Claude Code ran for me, and on this project it kept earlier decisions consistent across many files and checked its own tests by deliberately breaking the code to see them fail. I also used a separate Claude chat on claude.ai to plan the work and review each result before approving it.

**Who did what**
- **Me:**
  - Set the scope and the order of milestones from the task. Reviewed and approved the schema and the open design questions before any code was written (2026-09-23; for example, leaving groups was agreed to be out of scope).
  - Tested the app by hand in two browsers, and found that the join page and the email-invite form were missing from the UI.
  - Asked for an audit against the task text, which found that expense notifications, receipts, combined balances and deleting expenses were missing.
  - Directed the design: the hand-drawn style, the name Esep, red for debt, decluttering the group view, and the "how it works" guide (D21, D23, D28).
  - Used a separate Claude chat on claude.ai to plan, draft prompts for the agent and review its results. Pushed to GitHub myself.
- **The agent** (Claude Code): proposed the design and wrote the code, database migrations, tests and documentation (DECISIONS.md, STATUS.md, this README), and ran the tests. Until 2026-09-24 it committed at each milestone, as instructed at the start. From 2026-09-25 I asked it to show me each result and wait for my approval before committing. 26 of the 28 commits before this documentation pass carry a `Co-Authored-By: Claude Opus 5.5` line; the two that don't are the initial commit (`228ddbf`) and `2505ed7` (front page "how it works" guide).

## Third-party base

I didn't use a template, starter kit or code generator. The only generated files are the npm lockfiles and the Prisma migrations produced by `prisma migrate dev` from the schema (the CHECK constraints in them were written by hand). The libraries used are the ones listed in the two `package.json` files.

## What I'd do next

In short: leaving a group or removing a member (balance-safe), a group settings screen (the API exists), notifications for repayments, an in-app closing report, real email delivery through a job queue, receipts in S3-compatible storage, and more full e2e runs to settle the one known intermittent failure. Details and reasons are in [STATUS.md](STATUS.md#what-id-do-next).

## Decision log and timeline

- **Decisions:** [DECISIONS.md](DECISIONS.md), 36 short entries (D1–D36), each saying what was chosen and why, with a timestamp.
- **Timeline:** from the first commit on **2026-09-23 19:56** to the last feature commit on **2026-09-28 11:37** (UTC+04:00), across four working days (23, 24, 25 and 28 September). The milestone-by-milestone table is in [STATUS.md](STATUS.md#timeline), and `git log` has every step.

---

## Real-time sync: manual testing

Clients connect to Socket.io with their JWT (`io(url, { auth: { token } })`), then join a group's room with `group:join` (ack: `{ ok, update }`, where `update` is the current snapshot). After every change to that group, the room gets a `group:update` event with fresh balances, the settlement plan, group status and pending payments. Each socket is also in its user's own room, which gets `notification:new`, `notification:read` and `groups:changed`. See D18, D33 and D34 in `DECISIONS.md`.

**In the browser (two tabs = two users).** Start the API with `npm run dev` and open http://localhost:3000/dev/realtime in two tabs. Login is kept per tab.
1. Tab 1: register Alice and click *Create group*. Copy the invite token shown under *Live*.
2. Tab 2: register Bob, paste the token and click *Join by invite token*. Tab 1 updates (`member.joined`).
3. Add an expense in either tab. Both tabs update their balances and settlement.
4. In Bob's tab, click *Record I paid this* on the settlement line. Alice's tab shows *Confirm* / *Reject*, and both tabs update after each click.
5. *Close group* / *Reopen group* update the status in both tabs.

The page is only served when `NODE_ENV` isn't `production`.

**In two terminals.** Each terminal watches one group as one user:
```bash
cd backend
npm run watch -- alice@example.com password123 <groupId>
npm run watch -- bob@example.com   password123 <groupId>
```
Then make changes with curl (token from `POST /api/auth/login`). For example:
```bash
curl -X POST localhost:3000/api/groups/<groupId>/expenses \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"paidById":"<aliceId>","amount":4000,"description":"Dinner","category":"FOOD","date":"2026-09-24","split":{"type":"EQUAL","participants":["<aliceId>","<bobId>"]}}'
```
Watch a different group in a third terminal to check that it gets nothing.

## Debtor reminders

The API process checks for due reminders every hour (`REMINDER_INTERVAL_MS`) and once at startup. A member who owes money gets a `DEBT_REMINDER` email after owing for the group's `reminderDays`, then again every `reminderDays`, but never more than once a week. The email names the amount and who to pay. Emails are stubbed, so they show up in the API console and the `EmailOutbox` table. See D19 in `DECISIONS.md`.

## Style guide

Every base component is shown at http://localhost:5173/design (dev builds only). See D20 and D21 in `DECISIONS.md`.
