# Split Expenses App

A shared-expenses app (like Splitwise): groups, expenses with equal, by-shares or exact splits, balances, minimum-transfer settle-up, confirmed repayments, reminders and live updates.

- `DECISIONS.md`: design decisions and why they were made
- `STATUS.md`: what works, what's partial, what's not done, with a timeline

## Local setup

Requirements: Node 22+, Docker.

```bash
docker compose up -d            # PostgreSQL 16 on localhost:5432
cd backend
cp .env.example .env
npm install
npx prisma migrate dev          # apply migrations + generate the client
```
