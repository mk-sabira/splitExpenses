import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connectClient, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { computeBalances } from "../src/ledger/balances";
import { attachRealtime, closeRealtime } from "../src/realtime";
import { cleanup, createGroup, createUsers, rng, uniqueSuffix, type TestUser } from "./helpers";

const app = createApp();
const suffix = uniqueSuffix("mybalances");
let server: Server;
let url: string;
const sockets: Socket[] = [];

let alice: TestUser, bob: TestUser, carol: TestUser, dave: TestUser;

beforeAll(async () => {
  [alice, bob, carol, dave] = await createUsers(suffix, ["Alice", "Bob", "Carol", "Dave"]);
  server = createServer(app);
  attachRealtime(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await closeRealtime();
  await new Promise((resolve) => server.close(resolve));
  await cleanup(suffix);
  await prisma.$disconnect();
});

interface Listed {
  groups: { id: string; currency: string; status: string; myNet: number }[];
  totals: { currency: string; owe: number; owed: number; net: number; groupCount: number }[];
}

async function list(as: TestUser) {
  const res = await request(app).get("/api/groups").set(as.auth);
  expect(res.status).toBe(200);
  return res.body as Listed;
}

async function expense(groupId: string, as: TestUser, paidBy: TestUser, amount: number, participants: TestUser[]) {
  const res = await request(app)
    .post(`/api/groups/${groupId}/expenses`)
    .set(as.auth)
    .send({
      paidById: paidBy.id,
      amount,
      description: "x",
      category: "OTHER",
      date: "2026-09-01",
      split: { type: "EQUAL", participants: participants.map((u) => u.id) },
    });
  expect(res.status).toBe(201);
  return res.body.expense as { id: string };
}

async function repay(groupId: string, from: TestUser, to: TestUser, amount: number, confirm: boolean) {
  const res = await request(app).post(`/api/groups/${groupId}/payments`).set(from.auth).send({ toUserId: to.id, amount });
  expect(res.status).toBe(201);
  if (confirm) {
    expect((await request(app).post(`/api/payments/${res.body.payment.id}/confirm`).set(to.auth)).status).toBe(200);
  }
}

describe("GET /groups: my net per group and combined totals", () => {
  it("sums per currency across groups, closed ones included, without converting currencies", async () => {
    // Alice's groups: two in EUR (owes 10.00 in one, owed 25.00 in the other),
    // one closed group in USD (owed 7.00) and one settled group in KZT.
    const eur1 = await createGroup([bob, alice], { currency: "EUR" });
    const eur2 = await createGroup([alice, carol], { currency: "EUR" });
    const usd = await createGroup([alice, bob], { currency: "USD" });
    const kzt = await createGroup([alice, dave], { currency: "KZT" });
    await expense(eur1.id, bob, bob, 2000, [alice, bob]); // Alice owes 10.00
    await expense(eur2.id, alice, alice, 5000, [alice, carol]); // Alice is owed 25.00
    await expense(usd.id, alice, alice, 1400, [alice, bob]); // Alice is owed 7.00
    expect((await request(app).post(`/api/groups/${usd.id}/close`).set(alice.auth)).status).toBe(200);
    await expense(kzt.id, dave, dave, 1000, [alice, dave]);
    await repay(kzt.id, alice, dave, 500, true); // settled

    const { groups, totals } = await list(alice);
    const net = Object.fromEntries(groups.map((g) => [g.id, g.myNet]));
    expect(net).toEqual({ [eur1.id]: -1000, [eur2.id]: 2500, [usd.id]: 700, [kzt.id]: 0 });
    expect(groups.find((g) => g.id === usd.id)!.status).toBe("CLOSED");
    expect(totals).toEqual([
      { currency: "EUR", owe: 1000, owed: 2500, net: 1500, groupCount: 2 },
      { currency: "KZT", owe: 0, owed: 0, net: 0, groupCount: 1 },
      { currency: "USD", owe: 0, owed: 700, net: 700, groupCount: 1 },
    ]);

    // The other side of the same groups, from Bob's view.
    const bobs = await list(bob);
    expect(bobs.totals).toEqual([
      { currency: "EUR", owe: 0, owed: 1000, net: 1000, groupCount: 1 },
      { currency: "USD", owe: 700, owed: 0, net: -700, groupCount: 1 },
    ]);
  });

  it("ignores deleted expenses and unconfirmed repayments; counts confirmed ones", async () => {
    const g = await createGroup([alice, bob], { currency: "GBP" });
    const e = await expense(g.id, alice, alice, 3000, [alice, bob]); // Bob owes 15.00
    await expense(g.id, alice, alice, 999, [bob]); // Bob owes 9.99 more
    expect((await request(app).delete(`/api/groups/${g.id}/expenses/${e.id}`).set(alice.auth)).status).toBe(200);
    await repay(g.id, bob, alice, 300, false); // pending: doesn't count
    await repay(g.id, bob, alice, 200, true);
    const mine = (await list(bob)).groups.find((x) => x.id === g.id)!;
    expect(mine.myNet).toBe(-799);
  });

  it("a group with nothing in it yet is 0", async () => {
    const g = await createGroup([carol], { currency: "CHF" });
    const { groups, totals } = await list(carol);
    expect(groups.find((x) => x.id === g.id)!.myNet).toBe(0);
    expect(totals.find((t) => t.currency === "CHF")).toEqual({ currency: "CHF", owe: 0, owed: 0, net: 0, groupCount: 1 });
  });

  it("matches the per-group balances on random histories", async () => {
    const r = rng(34);
    const people = [alice, bob, carol, dave];
    const groupIds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const members = r.shuffle(people).slice(0, r.int(2, 4));
      const g = await createGroup(members, { currency: r.pick(["EUR", "USD", "JPY"]) });
      groupIds.push(g.id);
      const expenseIds: string[] = [];
      for (let step = 0; step < 12; step++) {
        const actor = r.pick(members);
        const roll = r.next();
        if (roll < 0.6 || expenseIds.length === 0) {
          expenseIds.push((await expense(g.id, actor, r.pick(members), r.int(1, 100_000), r.subset(members))).id);
        } else if (roll < 0.75) {
          const id = expenseIds.splice(r.int(0, expenseIds.length - 1), 1)[0];
          await request(app).delete(`/api/groups/${g.id}/expenses/${id}`).set(actor.auth);
        } else {
          // A repayment from someone who owes, within the API's cap: what they
          // owe minus their repayments still awaiting confirmation.
          const balances = await computeBalances(prisma, g.id);
          const debtor = balances.find((b) => b.net < 0);
          const creditor = balances.find((b) => b.net > 0);
          if (!debtor || !creditor) continue;
          const pending = await prisma.payment.aggregate({
            where: { groupId: g.id, fromUserId: debtor.userId, status: "PENDING" },
            _sum: { amount: true },
          });
          const room = Math.min(-debtor.net - (pending._sum.amount ?? 0), creditor.net);
          if (room <= 0) continue;
          const from = people.find((p) => p.id === debtor.userId)!;
          const to = people.find((p) => p.id === creditor.userId)!;
          await repay(g.id, from, to, r.int(1, room), r.next() < 0.7);
        }
      }
      if (r.next() < 0.5) await request(app).post(`/api/groups/${g.id}/close`).set(members[0].auth);
    }

    for (const person of people) {
      const { groups, totals } = await list(person);
      for (const g of groups.filter((x) => groupIds.includes(x.id))) {
        const expected = (await computeBalances(prisma, g.id)).find((b) => b.userId === person.id)?.net ?? 0;
        expect(g.myNet, `${person.name} in ${g.id}`).toBe(expected);
      }
      // Totals are exactly the per-group nets summed by currency.
      for (const t of totals) {
        const inCurrency = groups.filter((g) => g.currency === t.currency);
        expect(t.net).toBe(inCurrency.reduce((s, g) => s + g.myNet, 0));
        expect(t.owed - t.owe).toBe(t.net);
        expect(t.groupCount).toBe(inCurrency.length);
      }
    }
  });
});

describe("groups:changed on the user's own socket", () => {
  async function connect(u: TestUser) {
    const socket = connectClient(url, {
      auth: { token: u.auth.Authorization.slice("Bearer ".length) },
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    const events: { groupId: string; type: string }[] = [];
    socket.on("groups:changed", (e: { groupId: string; type: string }) => events.push(e));
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return events;
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function until(check: () => boolean) {
    for (let waited = 0; waited < 5000; waited += 10) {
      if (check()) return;
      await sleep(10);
    }
    throw new Error("timed out");
  }

  it("reaches every member (involved or not, in the group's room or not) and nobody else", async () => {
    const g = await createGroup([alice, bob, carol], { currency: "EUR" });
    const [a, b, c, d] = await Promise.all([alice, bob, carol, dave].map(connect));
    await expense(g.id, alice, alice, 1000, [alice, bob]); // Carol isn't in the split
    await until(() => [a, b, c].every((ev) => ev.some((e) => e.groupId === g.id)));
    expect(c.find((e) => e.groupId === g.id)).toEqual({ groupId: g.id, type: "expense.created" });

    await repay(g.id, bob, alice, 500, true);
    await until(() => c.filter((e) => e.groupId === g.id).length >= 3);
    expect(c.filter((e) => e.groupId === g.id).map((e) => e.type)).toEqual([
      "expense.created",
      "payment.proposed",
      "payment.confirmed",
    ]);
    await sleep(300);
    expect(d.filter((e) => e.groupId === g.id)).toHaveLength(0);
  });
});
