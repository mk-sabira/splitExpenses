import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { io as connectClient, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { attachRealtime, closeRealtime } from "../src/realtime";
import { cleanup, createGroup, createUsers, uniqueSuffix, type TestUser } from "./helpers";

const app = createApp();
const suffix = uniqueSuffix("notifications");
let server: Server;
let url: string;
const sockets: Socket[] = [];

let alice: TestUser, bob: TestUser, carol: TestUser, dave: TestUser, erin: TestUser;
let groupId: string;

beforeAll(async () => {
  [alice, bob, carol, dave, erin] = await createUsers(suffix, ["Alice", "Bob", "Carol", "Dave", "Erin"]);
  // Erin is not in the group at all.
  groupId = (await createGroup([alice, bob, carol, dave])).id;
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

interface N {
  id: string;
  type: string;
  group: { id: string; name: string; currency: string } | null;
  data: { actor: { id: string; name: string }; expenseId: string; description: string; share: number | null; previousShare?: number | null };
  readAt: string | null;
  createdAt: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const expenseBody = (paidBy: TestUser, participants: TestUser[], description = "Dinner", amount = 3000) => ({
  paidById: paidBy.id,
  amount,
  description,
  category: "FOOD",
  date: "2026-09-01",
  split: { type: "EQUAL", participants: participants.map((u) => u.id) },
});

async function addExpense(as: TestUser, body: ReturnType<typeof expenseBody>) {
  const res = await request(app).post(`/api/groups/${groupId}/expenses`).set(as.auth).send(body);
  expect(res.status).toBe(201);
  return res.body.expense as { id: string; version: number };
}

async function inbox(as: TestUser) {
  const res = await request(app).get("/api/notifications").set(as.auth);
  expect(res.status).toBe(200);
  return res.body as { notifications: N[]; unreadCount: number; nextCursor: string | null };
}

// Notifications about one expense, for each user, keyed by name.
async function aboutExpense(expenseId: string) {
  const out: Record<string, N[]> = {};
  for (const u of [alice, bob, carol, dave, erin]) {
    out[u.name] = (await inbox(u)).notifications.filter((n) => n.data.expenseId === expenseId);
  }
  return out;
}

describe("expense notifications", () => {
  it("on create: everyone in the split and the payer, never the actor or anyone outside", async () => {
    // Alice records that Bob paid for Bob and Carol. Dave isn't involved; Erin isn't a member.
    const e = await addExpense(alice, expenseBody(bob, [bob, carol]));
    const got = await aboutExpense(e.id);
    expect(got.Alice).toHaveLength(0);
    expect(got.Dave).toHaveLength(0);
    expect(got.Erin).toHaveLength(0);
    expect(got.Bob).toHaveLength(1);
    expect(got.Carol).toHaveLength(1);

    const n = got.Carol[0];
    expect(n.type).toBe("EXPENSE_ADDED");
    expect(n.group).toEqual({ id: groupId, name: "Test group", currency: "EUR" });
    expect(n.data).toMatchObject({ actor: { id: alice.id, name: "Alice" }, description: "Dinner", amount: 3000, share: 1500 });
    expect(n.readAt).toBeNull();
  });

  it("the actor isn't notified even when they're in the split", async () => {
    const e = await addExpense(bob, expenseBody(bob, [alice, bob]));
    const got = await aboutExpense(e.id);
    expect(got.Bob).toHaveLength(0);
    expect(got.Alice.map((n) => n.type)).toEqual(["EXPENSE_ADDED"]);
    expect(got.Carol).toHaveLength(0);
  });

  it("on edit: old and new participants, with their share before and after", async () => {
    const e = await addExpense(alice, expenseBody(alice, [alice, bob], "Taxi", 2000));
    // Carol edits it: Bob is taken out, Dave is added.
    const res = await request(app)
      .put(`/api/groups/${groupId}/expenses/${e.id}`)
      .set(carol.auth)
      .send({ ...expenseBody(alice, [alice, dave], "Taxi", 2000), version: e.version });
    expect(res.status).toBe(200);

    const got = await aboutExpense(e.id);
    expect(got.Carol).toHaveLength(0); // the actor
    expect(got.Erin).toHaveLength(0);
    expect(got.Alice.map((n) => n.type)).toEqual(["EXPENSE_UPDATED"]); // created by herself
    expect(got.Bob.map((n) => n.type)).toEqual(["EXPENSE_UPDATED", "EXPENSE_ADDED"]);
    expect(got.Bob[0].data).toMatchObject({ share: null, previousShare: 1000 });
    expect(got.Dave.map((n) => n.type)).toEqual(["EXPENSE_UPDATED"]);
    expect(got.Dave[0].data).toMatchObject({ share: 1000, previousShare: null });
  });

  it("on delete: everyone who was involved", async () => {
    const e = await addExpense(alice, expenseBody(alice, [alice, bob, carol]));
    const res = await request(app).delete(`/api/groups/${groupId}/expenses/${e.id}`).set(bob.auth);
    expect(res.status).toBe(200);
    const got = await aboutExpense(e.id);
    expect(got.Bob.map((n) => n.type)).toEqual(["EXPENSE_ADDED"]); // not for his own delete
    expect(got.Alice.map((n) => n.type)).toEqual(["EXPENSE_DELETED"]);
    expect(got.Carol.map((n) => n.type)).toEqual(["EXPENSE_DELETED", "EXPENSE_ADDED"]);
    expect(got.Dave).toHaveLength(0);
  });

  it("a failed change notifies nobody", async () => {
    const before = (await inbox(bob)).notifications.length;
    const res = await request(app)
      .post(`/api/groups/${groupId}/expenses`)
      .set(alice.auth)
      .send(expenseBody(alice, [bob, erin])); // Erin isn't a member
    expect(res.status).toBe(400);
    expect((await inbox(bob)).notifications.length).toBe(before);
  });
});

describe("GET /notifications and marking as read", () => {
  it("lists only your own, newest first, with an unread count and paging", async () => {
    const all = await inbox(carol);
    expect(all.unreadCount).toBe(all.notifications.length);
    expect(all.notifications.length).toBeGreaterThanOrEqual(3);
    const times = all.notifications.map((n) => n.createdAt);
    expect([...times].sort().reverse()).toEqual(times);

    const first = await request(app).get("/api/notifications").query({ limit: 2 }).set(carol.auth);
    expect(first.body.notifications).toHaveLength(2);
    const second = await request(app)
      .get("/api/notifications")
      .query({ limit: 2, before: first.body.nextCursor })
      .set(carol.auth);
    expect([...first.body.notifications, ...second.body.notifications].map((n: N) => n.id)).toEqual(
      all.notifications.slice(0, 4).map((n) => n.id),
    );
  });

  it("marks one as read; someone else's is a 404", async () => {
    const { notifications, unreadCount } = await inbox(carol);
    const target = notifications[0];
    const other = await request(app).post(`/api/notifications/${target.id}/read`).set(bob.auth);
    expect(other.status).toBe(404);

    const res = await request(app).post(`/api/notifications/${target.id}/read`).set(carol.auth);
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(unreadCount - 1);
    // Again is fine and changes nothing.
    const again = await request(app).post(`/api/notifications/${target.id}/read`).set(carol.auth);
    expect(again.body.unreadCount).toBe(unreadCount - 1);
    expect((await inbox(carol)).notifications.find((n) => n.id === target.id)!.readAt).not.toBeNull();
  });

  it("marks all as read, without touching anyone else's", async () => {
    const bobUnread = (await inbox(bob)).unreadCount;
    const res = await request(app).post("/api/notifications/read-all").set(carol.auth);
    expect(res.body.unreadCount).toBe(0);
    expect((await inbox(carol)).notifications.every((n) => n.readAt !== null)).toBe(true);
    expect((await inbox(bob)).unreadCount).toBe(bobUnread);
  });

  it("needs a login", async () => {
    expect((await request(app).get("/api/notifications")).status).toBe(401);
  });
});

describe("live delivery", () => {
  async function connect(u: TestUser) {
    const socket = connectClient(url, {
      auth: { token: u.auth.Authorization.slice("Bearer ".length) },
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    const received: N[] = [];
    const reads: unknown[] = [];
    socket.on("notification:new", (n: N) => received.push(n));
    socket.on("notification:read", (r: unknown) => reads.push(r));
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    return { received, reads };
  }

  async function until(check: () => boolean) {
    for (let waited = 0; waited < 5000; waited += 10) {
      if (check()) return;
      await sleep(10);
    }
    throw new Error("timed out");
  }

  it("pushes to each recipient's own room without joining any group, and nobody else's", async () => {
    const [a, b, c, d, e] = await Promise.all([alice, bob, carol, dave, erin].map(connect));
    const exp = await addExpense(alice, expenseBody(alice, [alice, bob, carol], "Museum"));
    await until(() => b.received.length > 0 && c.received.length > 0);
    expect(b.received.map((n) => [n.type, n.data.expenseId])).toEqual([["EXPENSE_ADDED", exp.id]]);
    expect(c.received[0].data.share).toBe(1000);
    expect(c.received[0].group?.name).toBe("Test group");
    // Same shape as the REST list.
    const listed = (await inbox(bob)).notifications.find((n) => n.id === b.received[0].id);
    expect(b.received[0]).toEqual(listed);

    await sleep(300); // the push to Bob and Carol already went out
    expect(a.received).toHaveLength(0);
    expect(d.received).toHaveLength(0);
    expect(e.received).toHaveLength(0);
  });

  it("tells your other tabs when you mark notifications as read", async () => {
    const tab1 = await connect(bob);
    const tab2 = await connect(bob);
    await request(app).post("/api/notifications/read-all").set(bob.auth);
    await until(() => tab1.reads.length > 0 && tab2.reads.length > 0);
    expect(tab2.reads[0]).toEqual({ id: null, unreadCount: 0 });
  });

  it("rejects a socket without a valid token", async () => {
    const socket = connectClient(url, { auth: { token: "nope" }, transports: ["websocket"], reconnection: false, forceNew: true });
    sockets.push(socket);
    const err = await new Promise<Error>((resolve) => socket.once("connect_error", resolve));
    expect(err.message).toBe("Authentication required");
  });
});
