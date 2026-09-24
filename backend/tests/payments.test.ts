import type { Group } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { cleanup, createGroup, createUsers, uniqueSuffix, type TestUser } from "./helpers";

const app = createApp();
const suffix = uniqueSuffix("payments");

let alice: TestUser, bob: TestUser, carol: TestUser, dave: TestUser, erin: TestUser, frank: TestUser;

beforeAll(async () => {
  [alice, bob, carol, dave, erin, frank] = await createUsers(suffix, ["Alice", "Bob", "Carol", "Dave", "Erin", "Frank"]);
});

afterAll(async () => {
  await cleanup(suffix);
  await prisma.$disconnect();
});

// ---------- helpers ----------

interface Transfer {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

function addExpense(g: Group, payer: TestUser, amount: number, split: object) {
  return request(app)
    .post(`/api/groups/${g.id}/expenses`)
    .set(payer.auth)
    .send({ paidById: payer.id, amount, description: "Dinner", category: "FOOD", date: "2026-09-20", split });
}

// Alice pays 90.00 split three ways: Bob and Carol each owe her 30.00.
async function dinnerGroup(opts: { currency?: string } = {}) {
  const g = await createGroup([alice, bob, carol], opts);
  const res = await addExpense(g, alice, 9000, { type: "EQUAL", participants: [alice.id, bob.id, carol.id] });
  expect(res.status).toBe(201);
  return g;
}

const propose = (as: TestUser, g: Group, to: TestUser, amount: number, note?: string) =>
  request(app).post(`/api/groups/${g.id}/payments`).set(as.auth).send({ toUserId: to.id, amount, note });
const act = (as: TestUser, paymentId: string, action: "confirm" | "reject" | "cancel") =>
  request(app).post(`/api/payments/${paymentId}/${action}`).set(as.auth);

async function balances(g: Group) {
  const res = await request(app).get(`/api/groups/${g.id}/balances`).set(alice.auth);
  expect(res.status).toBe(200);
  const net = Object.fromEntries(res.body.balances.map((b: { userId: string; net: number }) => [b.userId, b.net]));
  return { net, ledgerVersion: res.body.ledgerVersion as number };
}

async function settlement(g: Group, as: TestUser = alice) {
  const res = await request(app).get(`/api/groups/${g.id}/settlement`).set(as.auth);
  expect(res.status).toBe(200);
  return res.body as { transfers: Transfer[]; method: string; ledgerVersion: number; currency: string };
}

const t = (from: TestUser, to: TestUser, amount: number): Transfer => ({ fromUserId: from.id, toUserId: to.id, amount });

async function owing(g: Group) {
  const members = await prisma.groupMember.findMany({ where: { groupId: g.id } });
  return Object.fromEntries(members.map((m) => [m.userId, m.owingSince !== null]));
}

// ---------- settlement endpoint ----------

describe("GET /settlement", () => {
  it("returns who pays whom from current balances", async () => {
    const g = await dinnerGroup();
    const plan = await settlement(g);
    expect(plan.method).toBe("exact");
    expect(plan.currency).toBe("EUR");
    expect(plan.transfers).toHaveLength(2);
    expect(plan.transfers).toEqual(expect.arrayContaining([t(bob, alice, 3000), t(carol, alice, 3000)]));
    expect(plan.ledgerVersion).toBe((await balances(g)).ledgerVersion);
  });

  it("finds the true minimum where greedy matching would need an extra transfer", async () => {
    // Balances −5, +10, +1, +6, −5, −7 (see the settlement unit tests): 4 transfers, not 5.
    const g = await createGroup([alice, bob, carol, dave, erin, frank]);
    const exact = (amounts: [TestUser, number][]) => ({
      type: "EXACT",
      amounts: amounts.map(([u, amount]) => ({ userId: u.id, amount })),
    });
    await addExpense(g, bob, 10, exact([[alice, 5], [erin, 5]]));
    await addExpense(g, carol, 1, exact([[frank, 1]]));
    await addExpense(g, dave, 6, exact([[frank, 6]]));
    expect((await balances(g)).net).toEqual({
      [alice.id]: -5, [bob.id]: 10, [carol.id]: 1, [dave.id]: 6, [erin.id]: -5, [frank.id]: -7,
    });
    const plan = await settlement(g);
    expect(plan.method).toBe("exact");
    expect(plan.transfers).toHaveLength(4);
  });

  it("is hidden from non-members", async () => {
    const g = await dinnerGroup();
    expect((await request(app).get(`/api/groups/${g.id}/settlement`).set(dave.auth)).status).toBe(404);
  });
});

// ---------- repayments ----------

describe("repayments", () => {
  it("confirming a full repayment closes out the debt", async () => {
    const g = await dinnerGroup();
    const before = await balances(g);

    const proposed = await propose(bob, g, alice, 3000, "Bank transfer");
    expect(proposed.status).toBe(201);
    expect(proposed.body.payment).toMatchObject({ status: "PENDING", amount: 3000, note: "Bank transfer" });

    // Pending: nothing changes yet.
    expect(await balances(g)).toEqual(before);
    expect((await owing(g))[bob.id]).toBe(true);

    const confirmed = await act(alice, proposed.body.payment.id, "confirm");
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.payment.status).toBe("CONFIRMED");
    expect(confirmed.body.payment.respondedAt).not.toBeNull();
    expect(confirmed.body.ledgerVersion).toBe(before.ledgerVersion + 1);

    expect((await balances(g)).net).toEqual({ [alice.id]: 3000, [bob.id]: 0, [carol.id]: -3000 });
    expect((await owing(g))[bob.id]).toBe(false); // D7: Bob's debt episode is over
    expect((await settlement(g)).transfers).toEqual([t(carol, alice, 3000)]);

    const activity = await prisma.activity.findMany({
      where: { groupId: g.id, type: { in: ["PAYMENT_CREATED", "PAYMENT_CONFIRMED"] } },
      orderBy: { createdAt: "asc" },
    });
    expect(activity.map((a) => a.type)).toEqual(["PAYMENT_CREATED", "PAYMENT_CONFIRMED"]);
  });

  it("confirming a partial repayment reduces the debt", async () => {
    const g = await dinnerGroup();
    const p = (await propose(carol, g, alice, 1000)).body.payment;
    expect((await act(alice, p.id, "confirm")).status).toBe(200);

    expect((await balances(g)).net).toEqual({ [alice.id]: 5000, [bob.id]: -3000, [carol.id]: -2000 });
    expect((await owing(g))[carol.id]).toBe(true); // still owes
    expect((await settlement(g)).transfers).toEqual(
      expect.arrayContaining([t(bob, alice, 3000), t(carol, alice, 2000)]),
    );

    // Paying off the rest closes it out.
    const rest = (await propose(carol, g, alice, 2000)).body.payment;
    await act(alice, rest.id, "confirm");
    expect((await balances(g)).net[carol.id]).toBe(0);
    expect((await settlement(g)).transfers).toEqual([t(bob, alice, 3000)]);
  });

  it("a rejected repayment leaves balances unchanged", async () => {
    const g = await dinnerGroup();
    const before = await balances(g);
    const planBefore = await settlement(g);

    const p = (await propose(bob, g, alice, 3000)).body.payment;
    const rejected = await act(alice, p.id, "reject");
    expect(rejected.status).toBe(200);
    expect(rejected.body.payment.status).toBe("REJECTED");

    // Exactly as before, including ledgerVersion: a rejection isn't a money write.
    expect(await balances(g)).toEqual(before);
    expect(await settlement(g)).toEqual(planBefore);
    expect((await owing(g))[bob.id]).toBe(true);

    // A rejected payment no longer holds back the amount: Bob can propose the full amount again.
    expect((await propose(bob, g, alice, 3000)).status).toBe(201);
  });

  it("lets the payer cancel a pending payment, which also leaves balances unchanged", async () => {
    const g = await dinnerGroup();
    const before = await balances(g);
    const p = (await propose(bob, g, alice, 3000)).body.payment;

    expect((await act(alice, p.id, "cancel")).status).toBe(403); // only the payer cancels
    const cancelled = await act(bob, p.id, "cancel");
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.payment.status).toBe("CANCELLED");
    expect(await balances(g)).toEqual(before);
    expect((await act(alice, p.id, "confirm")).status).toBe(409);
  });

  it("only the recipient can confirm or reject", async () => {
    const g = await dinnerGroup();
    const p = (await propose(bob, g, alice, 1000)).body.payment;

    expect((await act(bob, p.id, "confirm")).status).toBe(403); // the payer
    expect((await act(bob, p.id, "reject")).status).toBe(403);
    expect((await act(carol, p.id, "confirm")).status).toBe(403); // another member
    expect((await act(dave, p.id, "confirm")).status).toBe(404); // not in the group
    expect((await request(app).post(`/api/payments/${p.id}/confirm`)).status).toBe(401);
    expect((await act(alice, "no-such-payment", "confirm")).status).toBe(404);

    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(stored.status).toBe("PENDING");
  });

  it("decides each payment only once", async () => {
    const g = await dinnerGroup();
    const a = (await propose(bob, g, alice, 1000)).body.payment;
    await act(alice, a.id, "confirm");
    expect((await act(alice, a.id, "confirm")).status).toBe(409);
    expect((await act(alice, a.id, "reject")).status).toBe(409);
    expect((await act(bob, a.id, "cancel")).status).toBe(409);

    const b = (await propose(carol, g, alice, 1000)).body.payment;
    await act(alice, b.id, "reject");
    const late = await act(alice, b.id, "confirm");
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/already rejected/);
  });

  it("when confirm and reject race, exactly one wins and balances count it at most once", async () => {
    for (let trial = 0; trial < 5; trial++) {
      const g = await dinnerGroup();
      const p = (await propose(bob, g, alice, 3000)).body.payment;
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => act(alice, p.id, i % 2 === 0 ? "confirm" : "reject")),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(7);

      const final = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
      expect((await balances(g)).net[bob.id]).toBe(final.status === "CONFIRMED" ? 0 : -3000);
    }
  });

  it("still accepts and confirms repayments in a closed group (D8)", async () => {
    const g = await dinnerGroup();
    await prisma.group.update({ where: { id: g.id }, data: { status: "CLOSED" } });
    const p = await propose(bob, g, alice, 3000);
    expect(p.status).toBe(201);
    expect((await act(alice, p.body.payment.id, "confirm")).status).toBe(200);
    expect((await balances(g)).net[bob.id]).toBe(0);
  });
});

describe("proposing a repayment: validation", () => {
  it("caps the amount at what the payer still owes, counting pending payments", async () => {
    const g = await dinnerGroup();
    const over = await propose(bob, g, alice, 3001);
    expect(over.status).toBe(400);
    expect(over.body.error).toBe("That's more than you owe (€30.00)");

    expect((await propose(bob, g, alice, 2000)).status).toBe(201);
    const second = await propose(bob, g, alice, 1500);
    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/€20\.00 is already awaiting confirmation/);
    expect((await propose(bob, g, alice, 1000)).status).toBe(201);
  });

  it("rejects payments from someone who owes nothing, to yourself, or to a non-member", async () => {
    const g = await dinnerGroup();
    const creditor = await propose(alice, g, bob, 100); // Alice is owed, not owing
    expect(creditor.status).toBe(400);
    expect(creditor.body.error).toBe("You don't owe anything in this group");
    expect((await propose(bob, g, bob, 100)).status).toBe(400);
    expect((await propose(bob, g, dave, 100)).status).toBe(400);
  });

  it("rejects a payment from someone who has just settled up exactly", async () => {
    const g = await dinnerGroup();
    const p = (await propose(bob, g, alice, 3000)).body.payment;
    await act(alice, p.id, "confirm");
    expect((await balances(g)).net[bob.id]).toBe(0);

    const again = await propose(bob, g, alice, 1);
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("You don't owe anything in this group");
  });

  it("validates the body", async () => {
    const g = await dinnerGroup();
    for (const amount of [0, -1, 10.5, 2_147_483_648]) {
      expect((await propose(bob, g, alice, amount)).status).toBe(400);
    }
    expect((await propose(dave, g, alice, 100)).status).toBe(404); // not a member
  });
});

describe("visibility", () => {
  it("shows pending payments to both sides", async () => {
    const g = await dinnerGroup();
    const p = (await propose(bob, g, alice, 1000)).body.payment;

    const mine = async (u: TestUser) =>
      (await request(app).get("/api/payments/pending").set(u.auth)).body.payments.filter(
        (x: { id: string }) => x.id === p.id,
      );
    expect(await mine(bob)).toEqual([expect.objectContaining({ direction: "outgoing", groupName: "Test group", currency: "EUR" })]);
    expect(await mine(alice)).toEqual([expect.objectContaining({ direction: "incoming" })]);
    expect(await mine(carol)).toEqual([]);

    await act(alice, p.id, "confirm");
    expect(await mine(bob)).toEqual([]);
    expect(await mine(alice)).toEqual([]);
  });

  it("lists a group's payments to its members, optionally by status", async () => {
    const g = await dinnerGroup();
    const a = (await propose(bob, g, alice, 1000)).body.payment;
    const b = (await propose(carol, g, alice, 500)).body.payment;
    await act(alice, a.id, "confirm");

    const list = (as: TestUser, query = "") => request(app).get(`/api/groups/${g.id}/payments${query}`).set(as.auth);
    const all = await list(carol);
    expect(all.status).toBe(200);
    expect(all.body.payments.map((x: { id: string }) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect((await list(carol, "?status=PENDING")).body.payments.map((x: { id: string }) => x.id)).toEqual([b.id]);
    expect((await list(carol, "?status=BOGUS")).status).toBe(400);
    expect((await list(dave)).status).toBe(404);
  });
});

// ---------- closing summary email ----------

describe("closing summary email", () => {
  const summaries = async (u: TestUser) =>
    prisma.emailOutbox.findMany({ where: { to: `${u.name.toLowerCase()}${suffix}`, kind: "GROUP_CLOSED_SUMMARY" }, orderBy: { createdAt: "asc" } });
  const close = (as: TestUser, g: Group) => request(app).post(`/api/groups/${g.id}/close`).set(as.auth);

  it("emails every member the settlement plan and their own part in it", async () => {
    const g = await dinnerGroup();
    const p = (await propose(bob, g, alice, 3000)).body.payment;
    await act(alice, p.id, "confirm");
    const [aliceBefore, bobBefore, carolBefore] = [
      (await summaries(alice)).length,
      (await summaries(bob)).length,
      (await summaries(carol)).length,
    ];

    expect((await close(alice, g)).status).toBe(200);

    const [a, b, c] = [(await summaries(alice)).at(-1)!, (await summaries(bob)).at(-1)!, (await summaries(carol)).at(-1)!];
    expect([(await summaries(alice)).length, (await summaries(bob)).length, (await summaries(carol)).length]).toEqual([
      aliceBefore + 1,
      bobBefore + 1,
      carolBefore + 1,
    ]);
    expect(a.subject).toBe('"Test group" was closed: final summary');
    for (const email of [a, b, c]) {
      expect(email.body).toContain("Alice closed \"Test group\".");
      expect(email.body).toContain("  Alice is owed €30.00");
      expect(email.body).toContain("  Bob is settled up");
      expect(email.body).toContain("  Carol owes €30.00");
      expect(email.body).toContain("  Carol pays Alice €30.00");
    }
    expect(a.body).toContain("For you: Carol pays you €30.00.");
    expect(b.body).toContain("For you: you're settled up.");
    expect(c.body).toContain("For you: You pay Alice €30.00.");
  });

  it("says so when everyone is already settled, and formats the group's currency", async () => {
    const g = await dinnerGroup({ currency: "JPY" });
    for (const u of [bob, carol]) {
      const p = (await propose(u, g, alice, 3000)).body.payment;
      await act(alice, p.id, "confirm");
    }
    await close(alice, g);
    const body = (await summaries(carol)).at(-1)!.body;
    expect(body).toContain("Everyone is settled up. Nothing left to pay.");
    expect(body).toContain("  Alice is settled up");
  });

  it("formats amounts in currencies without minor units", async () => {
    const g = await dinnerGroup({ currency: "JPY" });
    await close(alice, g);
    expect((await summaries(bob)).at(-1)!.body).toContain("  Bob pays Alice ¥3,000");
  });

  it("sends nothing when the close fails or on reopen", async () => {
    const g = await dinnerGroup();
    await close(alice, g);
    const count = (await summaries(bob)).length;
    expect((await close(alice, g)).status).toBe(409); // already closed
    expect((await close(bob, g)).status).toBe(403); // not the owner
    expect((await request(app).post(`/api/groups/${g.id}/reopen`).set(alice.auth)).status).toBe(200);
    expect((await summaries(bob)).length).toBe(count);
  });
});
