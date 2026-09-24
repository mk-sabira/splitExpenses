# Split Expenses App

A shared-expenses app (like Splitwise): groups, expenses with equal, by-shares or exact splits, balances, minimum-transfer settle-up, confirmed repayments, reminders and live updates.

- `DECISIONS.md`: design decisions and why they were made
- `STATUS.md`: what works, what's partial, what's not done, with a timeline

## Local setup

Requirements: Node 22+, Docker.

```bash
docker compose up -d            # PostgreSQL 16 on localhost:5432
cd backend
cp .env.example .env            # then set JWT_SECRET (openssl rand -hex 32)
npm install
npx prisma migrate dev          # apply migrations + generate the client
npm run dev                     # API on http://localhost:3000
npm test                        # needs the database running
```

## Frontend

```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173, proxies /api and /socket.io to :3000
```
Set `API_URL` if the backend isn't on `http://localhost:3000`. The style guide with every base component is at http://localhost:5173/design (dev only). See D20 and D21 in `DECISIONS.md`.

## Real-time sync: manual testing

Clients connect to Socket.io with their JWT (`io(url, { auth: { token } })`), then join a group's room with `group:join` (ack: `{ ok, update }`, where `update` is the current snapshot). After every change to that group, the room gets a `group:update` event with fresh balances, the settlement plan, group status and pending payments. See D18 in `DECISIONS.md`.

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

The API process checks for due reminders every hour (`REMINDER_INTERVAL_MS`) and once at startup. A member who owes money gets a `DEBT_REMINDER` email after owing for the group's `reminderDays`, then again every `reminderDays`, but never more than once a week. Emails are stubbed, so they show up in the API console and the `EmailOutbox` table. See D19 in `DECISIONS.md`.
