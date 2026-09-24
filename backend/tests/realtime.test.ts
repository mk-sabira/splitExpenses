import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Group } from "@prisma/client";
import { io as connectClient, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { attachRealtime, closeRealtime, type GroupUpdate } from "../src/realtime";
import { cleanup, createGroup, createUsers, uniqueSuffix, type TestUser } from "./helpers";

const app = createApp();
const suffix = uniqueSuffix("realtime");
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

// ---------- helpers ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// How long to wait before concluding an event is NOT coming. Only used after a
// positive check on another client has shown the broadcast already went out.
const QUIET_MS = 300;

interface Client {
  socket: Socket;
  events: GroupUpdate[];
  join(groupId: string): Promise<{ ok: boolean; error?: string; update?: GroupUpdate }>;
  leave(groupId: string): Promise<unknown>;
  // Resolves with the n-th update (0-based) received, waiting up to 5s for it.
  nth(n: number): Promise<GroupUpdate>;
}

function openSocket(token: string | undefined) {
  const socket = connectClient(url, {
    auth: token === undefined ? {} : { token },
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  return socket;
}

async function connect(u: TestUser): Promise<Client> {
  const socket = openSocket(u.auth.Authorization.slice("Bearer ".length));
  const events: GroupUpdate[] = [];
  socket.on("group:update", (e: GroupUpdate) => events.push(e));
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return {
    socket,
    events,
    join: (groupId) => socket.timeout(5000).emitWithAck("group:join", groupId),
    leave: (groupId) => socket.timeout(5000).emitWithAck("group:leave", groupId),
    async nth(n) {
      for (let waited = 0; waited < 5000; waited += 10) {
        if (events.length > n) return events[n];
        await sleep(10);
      }
      throw new Error(`Timed out waiting for update #${n}; got ${JSON.stringify(events.map((e) => e.change))}`);
    },
  };
}

const net = (u: GroupUpdate, user: TestUser) => u.balances.find((b) => b.userId === user.id)?.net;

const expenseBody = (payer: TestUser, amount: number, participants: TestUser[]) => ({
  paidById: payer.id,
  amount,
  description: "Dinner",
  category: "FOOD",
  date: "2026-09-20",
  split: { type: "EQUAL", participants: participants.map((p) => p.id) },
});

const addExpense = (as: TestUser, g: Group, participants: TestUser[], amount = 1000) =>
  request(app).post(`/api/groups/${g.id}/expenses`).set(as.auth).send(expenseBody(as, amount, participants));

async function restBalances(g: Group, as: TestUser) {
  return (await request(app).get(`/api/groups/${g.id}/balances`).set(as.auth)).body;
}

// ---------- tests ----------

describe("connecting and joining", () => {
  it("rejects a connection without a valid token", async () => {
    for (const token of [undefined, "garbage"]) {
      const socket = openSocket(token);
      const err = await new Promise<Error>((resolve) => socket.once("connect_error", resolve));
      expect(err.message).toBe("Authentication required");
    }
  });

  it("lets a member join and immediately sends the current snapshot", async () => {
    const g = await createGroup([alice, bob]);
    await addExpense(alice, g, [alice, bob]);
    const client = await connect(bob);

    const res = await client.join(g.id);
    expect(res.ok).toBe(true);
    const rest = await restBalances(g, bob);
    expect(res.update).toMatchObject({
      groupId: g.id,
      change: null,
      ledgerVersion: rest.ledgerVersion,
      balances: rest.balances,
      settlement: { method: "exact", transfers: [{ fromUserId: bob.id, toUserId: alice.id, amount: 500 }] },
      group: { name: "Test group", currency: "EUR", status: "OPEN" },
      pendingPayments: [],
    });
  });

  it("refuses to let a non-member join, with the same answer as a missing group", async () => {
    const g = await createGroup([alice, bob]);
    const client = await connect(carol);
    expect(await client.join(g.id)).toEqual({ ok: false, error: "Group not found" });
    expect(await client.join("no-such-group")).toEqual({ ok: false, error: "Group not found" });
    expect((await client.join(42 as unknown as string)).ok).toBe(false);
  });
});

describe("routing: each group's room gets only its own updates", () => {
  it("delivers to the changed group's room and not to another group's room", async () => {
    const g1 = await createGroup([alice, bob]);
    const g2 = await createGroup([carol, dave]);
    const bobClient = await connect(bob);
    const carolClient = await connect(carol);
    await bobClient.join(g1.id);
    await carolClient.join(g2.id);

    const created = await addExpense(alice, g1, [alice, bob]);
    const update = await bobClient.nth(0);
    expect(update).toMatchObject({
      groupId: g1.id,
      change: { type: "expense.created", id: created.body.expense.id, actorId: alice.id },
      ledgerVersion: created.body.ledgerVersion,
    });
    expect(net(update, bob)).toBe(-500);
    await sleep(QUIET_MS);
    expect(carolClient.events).toEqual([]);

    // And the other way round.
    await addExpense(dave, g2, [carol, dave], 3000);
    const other = await carolClient.nth(0);
    expect(other.groupId).toBe(g2.id);
    expect(net(other, carol)).toBe(-1500);
    await sleep(QUIET_MS);
    expect(bobClient.events).toHaveLength(1);
  });

  it("delivers each group's updates, correctly labelled, to someone watching both", async () => {
    const g1 = await createGroup([alice, bob]);
    const g2 = await createGroup([alice, carol]);
    const client = await connect(alice);
    await client.join(g1.id);
    await client.join(g2.id);

    await addExpense(bob, g1, [alice, bob], 1000);
    await addExpense(carol, g2, [alice, carol], 3000);
    const [first, second] = [await client.nth(0), await client.nth(1)];
    expect([first.groupId, net(first, alice)]).toEqual([g1.id, -500]);
    expect([second.groupId, net(second, alice)]).toEqual([g2.id, -1500]);
  });

  it("sends nothing to a member who hasn't joined the room, or has left it", async () => {
    const g = await createGroup([alice, bob, carol]);
    const watcher = await connect(alice);
    const notJoined = await connect(bob);
    const leaver = await connect(carol);
    await watcher.join(g.id);
    await leaver.join(g.id);
    await leaver.leave(g.id);

    await addExpense(alice, g, [alice, bob, carol], 900);
    await watcher.nth(0);
    await sleep(QUIET_MS);
    expect(notJoined.events).toEqual([]);
    expect(leaver.events).toEqual([]);
  });
});

describe("every kind of change is broadcast with fresh state", () => {
  it("covers expenses, payments, settings, close/reopen and joins", async () => {
    const g = await createGroup([alice, bob]);
    const client = await connect(bob);
    const joined = await client.join(g.id);
    let v = joined.update!.ledgerVersion;
    let n = 0;
    const next = async (type: string, actor: TestUser) => {
      const u = await client.nth(n++);
      expect(u.change).toMatchObject({ type, actorId: actor.id });
      expect(u.groupId).toBe(g.id);
      return u;
    };
    const pay = (from: TestUser, amount: number) =>
      request(app).post(`/api/groups/${g.id}/payments`).set(from.auth).send({ toUserId: alice.id, amount });
    const act = (as: TestUser, id: string, action: string) =>
      request(app).post(`/api/payments/${id}/${action}`).set(as.auth);

    // Expenses: each one bumps ledgerVersion.
    const e = (await addExpense(alice, g, [alice, bob], 1000)).body.expense;
    let u = await next("expense.created", alice);
    expect([u.ledgerVersion, net(u, bob)]).toEqual([++v, -500]);

    await request(app).put(`/api/groups/${g.id}/expenses/${e.id}`).set(alice.auth).send({ ...expenseBody(alice, 2000, [alice, bob]), version: 1 });
    u = await next("expense.updated", alice);
    expect([u.ledgerVersion, net(u, bob)]).toEqual([++v, -1000]);

    // A proposed payment shows up as pending; balances and ledgerVersion don't change.
    const p1 = (await pay(bob, 1000)).body.payment;
    u = await next("payment.proposed", bob);
    expect([u.ledgerVersion, net(u, bob), u.pendingPayments.map((p) => p.id)]).toEqual([v, -1000, [p1.id]]);

    // Rejected: no longer pending, balances unchanged, ledgerVersion unchanged (D17).
    await act(alice, p1.id, "reject");
    u = await next("payment.rejected", alice);
    expect([u.ledgerVersion, net(u, bob), u.pendingPayments]).toEqual([v, -1000, []]);

    // Cancelled by the payer: same.
    const p2 = (await pay(bob, 1000)).body.payment;
    await next("payment.proposed", bob);
    await act(bob, p2.id, "cancel");
    u = await next("payment.cancelled", bob);
    expect([u.ledgerVersion, net(u, bob), u.pendingPayments]).toEqual([v, -1000, []]);

    // Confirmed: reduces the debt and bumps ledgerVersion.
    const p3 = (await pay(bob, 400)).body.payment;
    await next("payment.proposed", bob);
    await act(alice, p3.id, "confirm");
    u = await next("payment.confirmed", alice);
    expect([u.ledgerVersion, net(u, bob), u.pendingPayments]).toEqual([++v, -600, []]);
    expect(u.settlement.transfers).toEqual([{ fromUserId: bob.id, toUserId: alice.id, amount: 600 }]);

    // Deleting the expense leaves only the repayment: Alice now owes Bob 4.00.
    await request(app).delete(`/api/groups/${g.id}/expenses/${e.id}`).set(bob.auth);
    u = await next("expense.deleted", bob);
    expect([u.ledgerVersion, net(u, bob), net(u, alice)]).toEqual([++v, 400, -400]);

    // Group changes: no money moves, so ledgerVersion stays the same.
    await request(app).put(`/api/groups/${g.id}/settings`).set(alice.auth).send({ reminderDays: 3, name: "Renamed" });
    u = await next("group.settings_updated", alice);
    expect([u.ledgerVersion, u.group.reminderDays, u.group.name]).toEqual([v, 3, "Renamed"]);

    await request(app).post(`/api/groups/${g.id}/close`).set(alice.auth);
    u = await next("group.closed", alice);
    expect([u.ledgerVersion, u.group.status]).toEqual([v, "CLOSED"]);
    expect(u.group.closedAt).not.toBeNull();

    await request(app).post(`/api/groups/${g.id}/reopen`).set(alice.auth);
    u = await next("group.reopened", alice);
    expect([u.group.status, u.group.closedAt]).toEqual(["OPEN", null]);

    // A new member appears in the balances.
    const { inviteToken } = await prisma.group.findUniqueOrThrow({ where: { id: g.id } });
    await request(app).post(`/api/invites/link/${inviteToken}/join`).set(carol.auth);
    u = await next("member.joined", carol);
    expect(net(u, carol)).toBe(0);

    await request(app).post(`/api/groups/${g.id}/invites`).set(alice.auth).send({ email: `dave${suffix}` });
    const invite = await prisma.groupInvite.findFirstOrThrow({ where: { groupId: g.id, email: `dave${suffix}` } });
    await request(app).post(`/api/invites/email/${invite.token}/accept`).set(dave.auth);
    u = await next("member.joined", dave);
    expect(net(u, dave)).toBe(0);

    await sleep(QUIET_MS);
    expect(client.events).toHaveLength(n); // nothing extra
  });

  it("sends nothing for failed or no-op requests", async () => {
    const g = await createGroup([alice, bob]);
    const e = (await addExpense(alice, g, [alice, bob])).body.expense;
    const client = await connect(bob);
    await client.join(g.id);

    const rejected = [
      await request(app).put(`/api/groups/${g.id}/expenses/${e.id}`).set(bob.auth).send({ ...expenseBody(alice, 5, [alice]), version: 99 }), // stale version
      await addExpense(alice, g, [alice, carol]), // non-member participant
      await request(app).put(`/api/groups/${g.id}/settings`).set(bob.auth).send({ reminderDays: 2 }), // not the owner
      await request(app).post(`/api/groups/${g.id}/payments`).set(alice.auth).send({ toUserId: bob.id, amount: 1 }), // owes nothing
      await request(app).put(`/api/groups/${g.id}/settings`).set(alice.auth).send({ name: "Test group" }), // no change
    ];
    expect(rejected.map((r) => r.status)).toEqual([409, 400, 403, 400, 200]);
    await sleep(QUIET_MS);
    expect(client.events).toEqual([]);
  });
});

describe("ordering", () => {
  it("delivers updates in commit order even when an earlier snapshot read is slow", async () => {
    const g = await createGroup([alice, bob]);
    const client = await connect(bob);
    await client.join(g.id);

    // Make the next snapshot read (for the first expense) come back 500ms late,
    // after the second expense has committed. Without per-group queueing, the
    // second update would be sent first and the stale first one would arrive
    // last, leaving clients showing old balances.
    const original = prisma.$transaction.bind(prisma);
    let delayed = false;
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(((...args: Parameters<typeof original>) => {
      const opts = args[1] as { isolationLevel?: string } | undefined;
      const result = original(...args);
      if (delayed || opts?.isolationLevel !== "RepeatableRead") return result;
      delayed = true;
      return result.then(async (r: unknown) => {
        await sleep(500);
        return r;
      });
    }) as typeof prisma.$transaction);

    try {
      const first = await addExpense(alice, g, [alice, bob], 1000);
      const second = await addExpense(alice, g, [alice, bob], 1000);
      const [a, b] = [await client.nth(0), await client.nth(1)];
      expect(delayed).toBe(true);
      expect([a.ledgerVersion, net(a, bob)]).toEqual([first.body.ledgerVersion, -500]);
      expect([b.ledgerVersion, net(b, bob)]).toEqual([second.body.ledgerVersion, -1000]);
    } finally {
      spy.mockRestore();
    }
  });

  it("never delivers an older state after a newer one, even under concurrent writes", async () => {
    const g = await createGroup([alice, bob]);
    const client = await connect(bob);
    await client.join(g.id);

    const results = await Promise.all(Array.from({ length: 12 }, () => addExpense(alice, g, [alice, bob], 1000)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    const final = await restBalances(g, bob);

    const last = await client.nth(11);
    const versions = client.events.map((e) => e.ledgerVersion);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions); // non-decreasing
    expect(last.ledgerVersion).toBe(final.ledgerVersion);
    expect(last.balances).toEqual(final.balances);
    expect(net(last, bob)).toBe(-6000);
  });
});
