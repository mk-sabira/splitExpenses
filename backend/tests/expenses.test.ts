import type { Group, PaymentStatus } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { cleanup, createGroup, createUsers, rng, uniqueSuffix, type TestUser } from "./helpers";

const app = createApp();
const suffix = uniqueSuffix("expenses");

let alice: TestUser, bob: TestUser, carol: TestUser, dave: TestUser;

beforeAll(async () => {
  [alice, bob, carol, dave] = await createUsers(suffix, ["Alice", "Bob", "Carol", "Dave"]);
});

afterAll(async () => {
  await cleanup(suffix);
  await prisma.$disconnect();
});

// ---------- helpers ----------

type Split =
  | { type: "EQUAL"; participants: string[] }
  | { type: "SHARES"; shares: { userId: string; shares: number }[] }
  | { type: "EXACT"; amounts: { userId: string; amount: number }[] };

interface ApiExpense {
  id: string;
  paidById: string;
  amount: number;
  version: number;
  splitType: string;
  splits: { userId: string; shares: number | null; amount: number }[];
}

function body(paidBy: TestUser, amount: number, split: Split, extra: object = {}) {
  return {
    paidById: paidBy.id,
    amount,
    description: "Dinner",
    category: "FOOD",
    date: "2026-09-20",
    split,
    ...extra,
  };
}

const equal = (...users: TestUser[]): Split => ({ type: "EQUAL", participants: users.map((u) => u.id) });

const url = (g: Group, expenseId?: string) =>
  `/api/groups/${g.id}/expenses${expenseId ? `/${expenseId}` : ""}`;

const create = (as: TestUser, g: Group, payload: object) =>
  request(app).post(url(g)).set(as.auth).send(payload);
const update = (as: TestUser, g: Group, id: string, payload: object) =>
  request(app).put(url(g, id)).set(as.auth).send(payload);
const remove = (as: TestUser, g: Group, id: string) =>
  request(app).delete(url(g, id)).set(as.auth);

async function balances(g: Group, as: TestUser = alice): Promise<Record<string, number>> {
  const res = await request(app).get(`/api/groups/${g.id}/balances`).set(as.auth);
  expect(res.status).toBe(200);
  return Object.fromEntries(res.body.balances.map((b: { userId: string; net: number }) => [b.userId, b.net]));
}

// A repayment the recipient has already confirmed (or not). There is no payments
// API yet, so it's written straight to the database.
function payment(g: Group, from: TestUser, to: TestUser, amount: number, status: PaymentStatus = "CONFIRMED") {
  return prisma.payment.create({
    data: { groupId: g.id, fromUserId: from.id, toUserId: to.id, amount, status },
  });
}

async function owingSince(g: Group) {
  const members = await prisma.groupMember.findMany({ where: { groupId: g.id } });
  return Object.fromEntries(members.map((m) => [m.userId, m.owingSince !== null]));
}

// Database-wide check: every expense's splits add up exactly to its amount.
// Includes soft-deleted expenses, whose splits must also stay intact for history.
async function expensesWithBadSplits(g: Group) {
  return prisma.$queryRaw<{ id: string }[]>`
    SELECT e.id
    FROM "Expense" e
    LEFT JOIN "ExpenseSplit" s ON s."expenseId" = e.id
    WHERE e."groupId" = ${g.id}
    GROUP BY e.id, e.amount
    HAVING COALESCE(SUM(s.amount), 0) <> e.amount`;
}

// Balances computed independently from the expenses the API returned plus the
// confirmed payments, using the formula in D3.
async function expectedBalances(g: Group, live: ApiExpense[]) {
  const net: Record<string, number> = {};
  const add = (userId: string, n: number) => (net[userId] = (net[userId] ?? 0) + n);
  for (const e of live) {
    add(e.paidById, e.amount);
    for (const s of e.splits) add(s.userId, -s.amount);
  }
  const confirmed = await prisma.payment.findMany({ where: { groupId: g.id, status: "CONFIRMED" } });
  for (const p of confirmed) {
    add(p.fromUserId, p.amount);
    add(p.toUserId, -p.amount);
  }
  return net;
}

const total = (b: Record<string, number>) => Object.values(b).reduce((a, n) => a + n, 0);

// ---------- tests ----------

describe("expense CRUD", () => {
  let g: Group;
  beforeAll(async () => {
    g = await createGroup([alice, bob, carol]);
  });

  it("creates an EQUAL expense whose splits sum to the total", async () => {
    const res = await create(alice, g, body(alice, 1000, equal(alice, bob, carol)));
    expect(res.status).toBe(201);
    const e: ApiExpense = res.body.expense;
    expect(e.splitType).toBe("EQUAL");
    expect(e.version).toBe(1);
    // Alice joined first, so she gets the extra cent (D5).
    expect(Object.fromEntries(e.splits.map((s) => [s.userId, s.amount]))).toEqual({
      [alice.id]: 334,
      [bob.id]: 333,
      [carol.id]: 333,
    });
    expect(typeof res.body.ledgerVersion).toBe("number");
  });

  it("creates a SHARES expense", async () => {
    const res = await create(
      bob,
      g,
      body(bob, 1000, {
        type: "SHARES",
        shares: [
          { userId: alice.id, shares: 1 },
          { userId: bob.id, shares: 2 },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const byUser = Object.fromEntries(res.body.expense.splits.map((s: ApiExpense["splits"][0]) => [s.userId, s]));
    expect(byUser[alice.id]).toMatchObject({ shares: 1, amount: 333 });
    expect(byUser[bob.id]).toMatchObject({ shares: 2, amount: 667 });
  });

  it("creates an EXACT expense and stores the amounts as given", async () => {
    const res = await create(
      carol,
      g,
      body(carol, 1000, {
        type: "EXACT",
        amounts: [
          { userId: alice.id, amount: 100 },
          { userId: carol.id, amount: 900 },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const byUser = Object.fromEntries(res.body.expense.splits.map((s: ApiExpense["splits"][0]) => [s.userId, s]));
    expect(byUser[alice.id]).toMatchObject({ shares: null, amount: 100 });
    expect(byUser[carol.id]).toMatchObject({ shares: null, amount: 900 });
  });

  it("lists and fetches expenses", async () => {
    const list = await request(app).get(url(g)).set(bob.auth);
    expect(list.status).toBe(200);
    expect(list.body.expenses).toHaveLength(3);
    const one = await request(app).get(url(g, list.body.expenses[0].id)).set(bob.auth);
    expect(one.status).toBe(200);
    expect(one.body.expense.id).toBe(list.body.expenses[0].id);
    expect(await expensesWithBadSplits(g)).toEqual([]);
  });

  it("pages the list newest first by date, then by when recorded, skipping deleted ones (D35)", async () => {
    const h = await createGroup([alice, bob]);
    const ids: Record<string, string> = {};
    // Recorded out of date order, with two on the same day.
    for (const [label, date] of [["mid", "2026-05-10"], ["old", "2026-01-01"], ["new", "2026-09-01"], ["mid2", "2026-05-10"], ["gone", "2026-06-01"]]) {
      ids[label] = (await create(alice, h, body(alice, 100, equal(alice, bob), { description: label, date }))).body.expense.id;
    }
    expect((await remove(alice, h, ids.gone)).status).toBe(200);

    const pages: string[][] = [];
    let before: string | null = null;
    do {
      const query: Record<string, string | number> = before ? { limit: 2, before } : { limit: 2 };
      const res = await request(app).get(url(h)).query(query).set(bob.auth);
      expect(res.status).toBe(200);
      pages.push(res.body.expenses.map((e: { description: string }) => e.description));
      before = res.body.nextCursor;
    } while (before);
    expect(pages).toEqual([["new", "mid2"], ["mid", "old"]]);

    // A cursor that has since been deleted still continues from where it was.
    const first = await request(app).get(url(h)).query({ limit: 1 }).set(bob.auth);
    expect((await remove(alice, h, ids.new)).status).toBe(200);
    const next = await request(app).get(url(h)).query({ limit: 10, before: first.body.nextCursor }).set(bob.auth);
    expect(next.body.expenses.map((e: { description: string }) => e.description)).toEqual(["mid2", "mid", "old"]);

    expect((await request(app).get(url(h)).query({ before: "nope" }).set(bob.auth)).status).toBe(400);
    expect((await request(app).get(url(g)).query({ before: ids.old }).set(bob.auth)).status).toBe(400); // another group's
  });

  it("updates an expense, replacing its splits and bumping its version", async () => {
    const created = (await create(alice, g, body(alice, 600, equal(alice, bob)))).body.expense;
    const res = await update(bob, g, created.id, {
      ...body(bob, 900, equal(alice, bob, carol), { description: "Taxi", category: "TRANSPORT" }),
      version: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.expense).toMatchObject({ amount: 900, paidById: bob.id, description: "Taxi", version: 2 });
    expect(res.body.expense.splits.map((s: { amount: number }) => s.amount)).toEqual([300, 300, 300]);
    expect(await prisma.expenseSplit.count({ where: { expenseId: created.id } })).toBe(3);
  });

  it("rejects an edit based on a stale version with 409 (D10)", async () => {
    const created = (await create(alice, g, body(alice, 500, equal(alice, bob)))).body.expense;
    expect((await update(alice, g, created.id, { ...body(alice, 400, equal(alice, bob)), version: 1 })).status).toBe(200);
    const stale = await update(bob, g, created.id, { ...body(alice, 700, equal(alice, bob)), version: 1 });
    expect(stale.status).toBe(409);
    const current = await request(app).get(url(g, created.id)).set(alice.auth);
    expect(current.body.expense).toMatchObject({ amount: 400, version: 2 });
  });

  it("soft-deletes an expense (D9)", async () => {
    const created = (await create(alice, g, body(alice, 500, equal(alice, bob)))).body.expense;
    expect((await remove(bob, g, created.id)).status).toBe(200);

    const row = await prisma.expense.findUnique({ where: { id: created.id }, include: { splits: true } });
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.splits).toHaveLength(2); // kept for history
    expect((await request(app).get(url(g, created.id)).set(alice.auth)).status).toBe(404);
    const list = await request(app).get(url(g)).set(alice.auth);
    expect(list.body.expenses.map((e: ApiExpense) => e.id)).not.toContain(created.id);

    expect((await remove(alice, g, created.id)).status).toBe(404);
    expect((await update(alice, g, created.id, { ...body(alice, 500, equal(alice)), version: 1 })).status).toBe(404);
  });

  it("records activity with snapshots, including before/after for edits", async () => {
    const created = (await create(alice, g, body(alice, 200, equal(alice, bob)))).body.expense;
    await update(alice, g, created.id, { ...body(alice, 300, equal(alice, bob)), version: 1 });
    await remove(alice, g, created.id);

    const activity = await prisma.activity.findMany({
      where: { groupId: g.id, data: { path: ["id"], equals: created.id } },
      orderBy: { createdAt: "asc" },
    });
    const updated = await prisma.activity.findFirstOrThrow({
      where: { groupId: g.id, type: "EXPENSE_UPDATED", data: { path: ["after", "id"], equals: created.id } },
    });
    expect(activity.map((a) => a.type)).toEqual(["EXPENSE_CREATED", "EXPENSE_DELETED"]);
    expect(updated.data).toMatchObject({ before: { amount: 200, version: 1 }, after: { amount: 300, version: 2 } });
  });
});

describe("validation and access", () => {
  let g: Group;
  let other: Group;
  beforeAll(async () => {
    g = await createGroup([alice, bob, carol]);
    other = await createGroup([dave, alice]);
  });

  const cases: [string, object][] = [
    ["zero amount", { amount: 0 }],
    ["negative amount", { amount: -5 }],
    ["fractional amount", { amount: 10.5 }],
    ["amount above the INTEGER cap", { amount: 2_147_483_648 }],
    ["empty description", { description: "  " }],
    ["unknown category", { category: "PETS" }],
    ["invalid date", { date: "2026-02-30" }],
    ["no participants", { split: { type: "EQUAL", participants: [] } }],
    ["duplicate participants", { split: { type: "EQUAL", participants: ["x", "x"] } }],
    ["zero shares", { split: { type: "SHARES", shares: [{ userId: "x", shares: 0 }] } }],
    ["unknown split type", { split: { type: "PERCENT", participants: ["x"] } }],
  ];
  for (const [label, override] of cases) {
    it(`rejects ${label} with 400`, async () => {
      const res = await create(alice, g, { ...body(alice, 1000, equal(alice, bob)), ...override });
      expect(res.status).toBe(400);
    });
  }

  it("rejects EXACT amounts that don't add up to the total", async () => {
    const res = await create(
      alice,
      g,
      body(alice, 1000, {
        type: "EXACT",
        amounts: [
          { userId: alice.id, amount: 500 },
          { userId: bob.id, amount: 499 },
        ],
      }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/add up to 999/);
  });

  it("rejects a payer or participant who isn't a member", async () => {
    expect((await create(alice, g, body(dave, 1000, equal(alice, bob)))).status).toBe(400);
    expect((await create(alice, g, body(alice, 1000, equal(alice, dave)))).status).toBe(400);
  });

  it("writes nothing when a request is rejected", async () => {
    const before = await prisma.group.findUniqueOrThrow({ where: { id: g.id } });
    await create(alice, g, body(alice, 1000, equal(alice, dave)));
    const after = await prisma.group.findUniqueOrThrow({ where: { id: g.id } });
    expect(after.ledgerVersion).toBe(before.ledgerVersion);
    expect(await prisma.expense.count({ where: { groupId: g.id } })).toBe(0);
  });

  it("hides the group from non-members with 404", async () => {
    expect((await request(app).get(url(g)).set(dave.auth)).status).toBe(404);
    expect((await create(dave, g, body(dave, 100, equal(dave)))).status).toBe(404);
    expect((await request(app).get(`/api/groups/${g.id}/balances`).set(dave.auth)).status).toBe(404);
  });

  it("requires authentication", async () => {
    expect((await request(app).get(url(g))).status).toBe(401);
  });

  it("doesn't let an expense be reached through a different group's URL", async () => {
    const e = (await create(alice, other, body(alice, 100, equal(alice, dave)))).body.expense;
    expect((await request(app).get(url(g, e.id)).set(alice.auth)).status).toBe(404);
    expect((await update(alice, g, e.id, { ...body(alice, 200, equal(alice)), version: 1 })).status).toBe(404);
    expect((await remove(alice, g, e.id)).status).toBe(404);
  });

  it("blocks expense changes in a closed group but still shows balances (D8)", async () => {
    const e = (await create(alice, g, body(alice, 100, equal(alice, bob)))).body.expense;
    await prisma.group.update({ where: { id: g.id }, data: { status: "CLOSED" } });
    try {
      expect((await create(alice, g, body(alice, 100, equal(alice, bob)))).status).toBe(409);
      expect((await update(alice, g, e.id, { ...body(alice, 200, equal(alice, bob)), version: 1 })).status).toBe(409);
      expect((await remove(alice, g, e.id)).status).toBe(409);
      expect(await balances(g)).toEqual({ [alice.id]: 50, [bob.id]: -50, [carol.id]: 0 });
    } finally {
      await prisma.group.update({ where: { id: g.id }, data: { status: "OPEN" } });
    }
  });
});

describe("balances stay consistent through edits, deletes and repayments", () => {
  it("walks through a create → repay → edit → edit → delete scenario", async () => {
    const g = await createGroup([alice, bob, carol]);

    // Alice pays 90.00 for all three.
    const e = (await create(alice, g, body(alice, 9000, equal(alice, bob, carol)))).body.expense;
    expect(await balances(g)).toEqual({ [alice.id]: 6000, [bob.id]: -3000, [carol.id]: -3000 });
    expect(await owingSince(g)).toEqual({ [alice.id]: false, [bob.id]: true, [carol.id]: true });

    // Bob repays Alice 30.00 and she confirms. Pending and rejected payments don't count.
    await payment(g, bob, alice, 3000);
    await payment(g, carol, alice, 1000, "PENDING");
    await payment(g, carol, alice, 1000, "REJECTED");
    expect(await balances(g)).toEqual({ [alice.id]: 3000, [bob.id]: 0, [carol.id]: -3000 });

    // The expense is corrected down to 60.00. Bob has now paid 10.00 too much,
    // so Alice owes it back to him (D3).
    const e2 = (await update(alice, g, e.id, { ...body(alice, 6000, equal(alice, bob, carol)), version: 1 })).body.expense;
    expect(await balances(g)).toEqual({ [alice.id]: 1000, [bob.id]: 1000, [carol.id]: -2000 });
    expect(await owingSince(g)).toEqual({ [alice.id]: false, [bob.id]: false, [carol.id]: true });

    // Changed to shares 1:1:2.
    const shares: Split = {
      type: "SHARES",
      shares: [
        { userId: alice.id, shares: 1 },
        { userId: bob.id, shares: 1 },
        { userId: carol.id, shares: 2 },
      ],
    };
    await update(alice, g, e.id, { ...body(alice, 6000, shares), version: e2.version });
    expect(await balances(g)).toEqual({ [alice.id]: 1500, [bob.id]: 1500, [carol.id]: -3000 });

    // Deleted entirely. Only Bob's repayment is left, so Alice owes him all 30.00.
    await remove(carol, g, e.id);
    expect(await balances(g)).toEqual({ [alice.id]: -3000, [bob.id]: 3000, [carol.id]: 0 });
    expect(await owingSince(g)).toEqual({ [alice.id]: true, [bob.id]: false, [carol.id]: false });
  });

  it("property: 80 random creates, edits and deletes keep every invariant", async () => {
    const seed = 424242;
    const r = rng(seed);
    const people = [alice, bob, carol];
    const g = await createGroup(people);
    await payment(g, bob, alice, 1234);
    await payment(g, carol, bob, 777);
    const live = new Map<string, ApiExpense>();

    const randomSplit = (amount: number): Split => {
      const who = r.subset(people);
      const kind = r.pick(["EQUAL", "SHARES", "EXACT"] as const);
      if (kind === "EQUAL") return equal(...who);
      if (kind === "SHARES") {
        return { type: "SHARES", shares: who.map((u) => ({ userId: u.id, shares: r.int(1, 7) })) };
      }
      // Random EXACT amounts that add up to the total.
      let left = amount;
      const amounts = who.map((u, i) => {
        const a = i === who.length - 1 ? left : r.int(0, left);
        left -= a;
        return { userId: u.id, amount: a };
      });
      return { type: "EXACT", amounts };
    };

    for (let step = 0; step < 80; step++) {
      const context = `seed ${seed}, step ${step}`;
      const op = live.size === 0 ? "create" : r.pick(["create", "create", "update", "delete"]);
      const amount = r.next() < 0.7 ? r.int(1, 10_000) : r.int(1, 2_000_000_000);

      if (op === "create") {
        const res = await create(r.pick(people), g, body(r.pick(people), amount, randomSplit(amount)));
        expect(res.status, context).toBe(201);
        live.set(res.body.expense.id, res.body.expense);
      } else if (op === "update") {
        const target = r.pick([...live.values()]);
        const res = await update(r.pick(people), g, target.id, {
          ...body(r.pick(people), amount, randomSplit(amount)),
          version: target.version,
        });
        expect(res.status, context).toBe(200);
        live.set(target.id, res.body.expense);
      } else {
        const target = r.pick([...live.values()]);
        expect((await remove(r.pick(people), g, target.id)).status, context).toBe(200);
        live.delete(target.id);
      }

      // Every expense the API returns has splits that add up exactly.
      for (const e of live.values()) {
        expect(e.splits.reduce((a, s) => a + s.amount, 0), context).toBe(e.amount);
      }
      const actual = await balances(g);
      expect(total(actual), context).toBe(0);
      expect(actual, context).toEqual({
        [alice.id]: 0,
        [bob.id]: 0,
        [carol.id]: 0,
        ...(await expectedBalances(g, [...live.values()])),
      });
    }

    expect(await expensesWithBadSplits(g)).toEqual([]);
    const actual = await balances(g);
    const owing = await owingSince(g);
    for (const p of people) expect(owing[p.id]).toBe(actual[p.id] < 0);
  });
});

describe("concurrent writes (D4, D10)", () => {
  it("serializes 20 simultaneous creates without losing any", async () => {
    const g = await createGroup([alice, bob, carol]);
    const start = (await prisma.group.findUniqueOrThrow({ where: { id: g.id } })).ledgerVersion;

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        create([alice, bob, carol][i % 3], g, body([alice, bob, carol][i % 3], 1000 + i, equal(alice, bob, carol))),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(20).fill(201));

    // Each write got its own ledgerVersion, with no gaps or repeats.
    const versions = results.map((r) => r.body.ledgerVersion).sort((a, b) => a - b);
    expect(versions).toEqual(Array.from({ length: 20 }, (_, i) => start + i + 1));

    const expenses = results.map((r) => r.body.expense as ApiExpense);
    expect(await balances(g)).toEqual(await expectedBalances(g, expenses));
    expect(total(await balances(g))).toBe(0);
  });

  it("lets exactly one of several simultaneous edits of the same version win", async () => {
    const g = await createGroup([alice, bob]);
    const e = (await create(alice, g, body(alice, 1000, equal(alice, bob)))).body.expense;

    const results = await Promise.all(
      [200, 300, 400, 500, 600].map((amount) =>
        update(bob, g, e.id, { ...body(alice, amount, equal(alice, bob)), version: 1 }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409]);

    const winner = results.find((r) => r.status === 200)!.body.expense;
    const stored = (await request(app).get(url(g, e.id)).set(alice.auth)).body.expense;
    expect(stored).toMatchObject({ amount: winner.amount, version: 2 });
    expect(await balances(g)).toEqual({ [alice.id]: winner.amount / 2, [bob.id]: -winner.amount / 2 });
  });
});
