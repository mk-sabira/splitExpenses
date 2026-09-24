import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { cleanup, createGroup, createUsers, uniqueSuffix, type TestUser } from "./helpers";

const app = createApp();
const suffix = uniqueSuffix("activity");

let alice: TestUser, bob: TestUser, carol: TestUser;

beforeAll(async () => {
  [alice, bob, carol] = await createUsers(suffix, ["Alice", "Bob", "Carol"]);
});

afterAll(async () => {
  await cleanup(suffix);
  await prisma.$disconnect();
});

interface Entry {
  id: string;
  type: string;
  actor: { id: string; name: string };
  data: Record<string, unknown>;
  createdAt: string;
}

const list = (as: TestUser, groupId: string, query: Record<string, string | number> = {}) =>
  request(app).get(`/api/groups/${groupId}/activity`).query(query).set(as.auth);

// Follows nextCursor until the end and returns every entry in order.
async function readAll(groupId: string, limit: number) {
  const all: Entry[] = [];
  let before: string | undefined;
  for (let page = 0; page < 1000; page++) {
    const res = await list(alice, groupId, { limit, ...(before && { before }) });
    expect(res.status).toBe(200);
    expect(res.body.activities.length).toBeLessThanOrEqual(limit);
    all.push(...res.body.activities);
    if (res.body.nextCursor === null) return all;
    before = res.body.nextCursor;
  }
  throw new Error("pagination never ended");
}

// Inserts entries directly: all with the same timestamp when `at` is given,
// otherwise one millisecond apart and always later than any earlier seed.
let clock = Date.now();
async function seed(groupId: string, n: number, at?: Date) {
  for (let i = 0; i < n; i++) {
    await prisma.activity.create({
      data: { groupId, actorId: alice.id, type: "MEMBER_JOINED", data: { i }, createdAt: at ?? new Date(clock++) },
    });
  }
}

describe("GET /groups/:id/activity", () => {
  it("lists what happened in the group, newest first, with the actor and the snapshot", async () => {
    const created = await request(app).post("/api/groups").set(alice.auth).send({ name: "Trip", currency: "EUR" });
    const g = created.body.group;
    expect((await request(app).post(`/api/invites/link/${g.inviteToken}/join`).set(bob.auth)).status).toBe(200);

    const expense = {
      paidById: alice.id,
      amount: 4000,
      description: "Dinner",
      category: "FOOD",
      date: "2026-09-20",
      split: { type: "EQUAL", participants: [alice.id, bob.id] },
    };
    const added = await request(app).post(`/api/groups/${g.id}/expenses`).set(alice.auth).send(expense);
    expect(added.status).toBe(201);
    const edited = await request(app)
      .put(`/api/groups/${g.id}/expenses/${added.body.expense.id}`)
      .set(bob.auth)
      .send({ ...expense, amount: 5000, version: added.body.expense.version });
    expect(edited.status).toBe(200);
    const paid = await request(app).post(`/api/groups/${g.id}/payments`).set(bob.auth).send({ toUserId: alice.id, amount: 2500 });
    expect(paid.status).toBe(201);
    expect((await request(app).post(`/api/payments/${paid.body.payment.id}/confirm`).set(alice.auth)).status).toBe(200);
    expect((await request(app).post(`/api/groups/${g.id}/close`).set(alice.auth)).status).toBe(200);

    const res = await list(bob, g.id);
    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeNull();
    const entries: Entry[] = res.body.activities;
    expect(entries.map((e) => [e.type, e.actor.name])).toEqual([
      ["GROUP_CLOSED", "Alice"],
      ["PAYMENT_CONFIRMED", "Alice"],
      ["PAYMENT_CREATED", "Bob"],
      ["EXPENSE_UPDATED", "Bob"],
      ["EXPENSE_CREATED", "Alice"],
      ["MEMBER_JOINED", "Bob"],
      ["GROUP_CREATED", "Alice"],
    ]);
    expect(entries[3].data).toMatchObject({ before: { amount: 4000 }, after: { amount: 5000 } });
    expect(entries[1].data).toMatchObject({ amount: 2500, status: "CONFIRMED", fromUserId: bob.id });
    expect(entries[0].actor).toEqual({ id: alice.id, name: "Alice" });
    const times = entries.map((e) => Date.parse(e.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("returns the 30 most recent by default and pages through the rest with nextCursor", async () => {
    const g = await createGroup([alice, bob]);
    await seed(g.id, 45);

    const first = await list(alice, g.id);
    expect(first.body.activities).toHaveLength(30);
    expect(first.body.activities[0].data).toEqual({ i: 44 });
    expect(first.body.nextCursor).toBe(first.body.activities[29].id);

    const all = await readAll(g.id, 7);
    expect(all.map((e) => e.data.i)).toEqual(Array.from({ length: 45 }, (_, i) => 44 - i));
  });

  it("breaks ties on identical timestamps by id, without skipping or repeating entries", async () => {
    const g = await createGroup([alice, bob]);
    await seed(g.id, 12, new Date("2026-09-01T00:00:00Z"));
    await seed(g.id, 3); // later entries around the tied block

    const all = await readAll(g.id, 5);
    expect(all).toHaveLength(15);
    expect(new Set(all.map((e) => e.id)).size).toBe(15);
    const tied = all.slice(3).map((e) => e.id);
    expect(tied).toEqual([...tied].sort().reverse());
  });

  it("keeps later pages stable when new entries arrive mid-way", async () => {
    const g = await createGroup([alice, bob]);
    await seed(g.id, 10);
    const first = await list(alice, g.id, { limit: 4 });
    await seed(g.id, 5); // newer than everything already seen

    const rest = await list(alice, g.id, { limit: 100, before: first.body.nextCursor });
    const seen = [...first.body.activities, ...rest.body.activities].map((e: Entry) => e.data.i);
    expect(seen).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });

  it("rejects bad limits and cursors that aren't from this group", async () => {
    const g = await createGroup([alice, bob]);
    const other = await createGroup([alice]);
    await seed(g.id, 1);
    await seed(other.id, 1);
    const otherId = (await prisma.activity.findFirstOrThrow({ where: { groupId: other.id } })).id;

    for (const limit of [0, 101, 1.5, "ten"]) {
      expect((await list(alice, g.id, { limit })).status).toBe(400);
    }
    expect((await list(alice, g.id, { before: "nope" })).status).toBe(400);
    expect((await list(alice, g.id, { before: otherId })).status).toBe(400);
    expect((await list(alice, g.id, { limit: 100 })).status).toBe(200);
  });

  it("is only visible to members", async () => {
    const g = await createGroup([alice, bob]);
    expect((await list(carol, g.id)).status).toBe(404);
    expect((await request(app).get(`/api/groups/${g.id}/activity`)).status).toBe(401);
  });
});
