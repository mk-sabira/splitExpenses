import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { prisma } from "../src/db";
import { cleanup, createUsers, uniqueSuffix, type TestUser } from "./helpers";

const app = createApp();
const suffix = uniqueSuffix("groups");

let alice: TestUser, bob: TestUser, carol: TestUser, dave: TestUser;
const emailOf = (u: TestUser) => `${u.name.toLowerCase()}${suffix}`;

beforeAll(async () => {
  [alice, bob, carol, dave] = await createUsers(suffix, ["Alice", "Bob", "Carol", "Dave"]);
});

afterAll(async () => {
  await cleanup(suffix);
  await prisma.$disconnect();
});

// ---------- helpers ----------

interface ApiGroup {
  id: string;
  name: string;
  currency: string;
  currencyLocked: boolean;
  reminderDays: number;
  status: "OPEN" | "CLOSED";
  closedAt: string | null;
  inviteToken: string;
  inviteLink: string;
  members: { userId: string; role: string; email: string }[];
  pendingInvites: { email: string }[];
}

async function newGroup(owner: TestUser, members: TestUser[] = [], extra: object = {}): Promise<ApiGroup> {
  const res = await request(app)
    .post("/api/groups")
    .set(owner.auth)
    .send({ name: "Trip", currency: "EUR", ...extra });
  expect(res.status).toBe(201);
  for (const m of members) {
    expect((await join(m, res.body.group.inviteToken)).status).toBe(200);
  }
  return res.body.group;
}

const get = (as: TestUser, g: { id: string }) => request(app).get(`/api/groups/${g.id}`).set(as.auth);
const join = (as: TestUser, token: string) => request(app).post(`/api/invites/link/${token}/join`).set(as.auth);
const invite = (as: TestUser, g: { id: string }, email: string) =>
  request(app).post(`/api/groups/${g.id}/invites`).set(as.auth).send({ email });
const accept = (auth: Record<string, string>, token: string) =>
  request(app).post(`/api/invites/email/${token}/accept`).set(auth);
const settings = (as: TestUser, g: { id: string }, body: object) =>
  request(app).put(`/api/groups/${g.id}/settings`).set(as.auth).send(body);
const close = (as: TestUser, g: { id: string }) => request(app).post(`/api/groups/${g.id}/close`).set(as.auth);
const reopen = (as: TestUser, g: { id: string }) => request(app).post(`/api/groups/${g.id}/reopen`).set(as.auth);
const addExpense = (as: TestUser, g: { id: string }, participants: TestUser[]) =>
  request(app)
    .post(`/api/groups/${g.id}/expenses`)
    .set(as.auth)
    .send({
      paidById: as.id,
      amount: 1000,
      description: "Lunch",
      category: "FOOD",
      date: "2026-09-20",
      split: { type: "EQUAL", participants: participants.map((p) => p.id) },
    });

const activityTypes = async (groupId: string) =>
  (await prisma.activity.findMany({ where: { groupId }, orderBy: { createdAt: "asc" } })).map((a) => a.type);

const inviteRow = (groupId: string, email: string) =>
  prisma.groupInvite.findUniqueOrThrow({ where: { groupId_email: { groupId, email } } });

// ---------- tests ----------

describe("creating and reading groups", () => {
  it("creates a group with the creator as owner", async () => {
    const res = await request(app)
      .post("/api/groups")
      .set(alice.auth)
      .send({ name: "  Flat 3B  ", currency: "eur" });
    expect(res.status).toBe(201);
    const g: ApiGroup = res.body.group;
    expect(g).toMatchObject({
      name: "Flat 3B",
      currency: "EUR",
      currencyLocked: false,
      reminderDays: 7,
      status: "OPEN",
      closedAt: null,
    });
    expect(g.members).toEqual([expect.objectContaining({ userId: alice.id, role: "OWNER" })]);
    expect(g.inviteLink).toBe(`${config.appUrl}/join/${g.inviteToken}`);
    expect(await activityTypes(g.id)).toEqual(["GROUP_CREATED"]);
  });

  const bad: [string, object][] = [
    ["an unknown currency", { currency: "XYZ" }],
    ["a malformed currency", { currency: "EURO" }],
    ["an empty name", { name: "   " }],
    ["reminderDays of 0", { reminderDays: 0 }],
    ["reminderDays over a year", { reminderDays: 366 }],
    ["fractional reminderDays", { reminderDays: 1.5 }],
  ];
  for (const [label, override] of bad) {
    it(`rejects ${label} with 400`, async () => {
      const res = await request(app)
        .post("/api/groups")
        .set(alice.auth)
        .send({ name: "Trip", currency: "EUR", ...override });
      expect(res.status).toBe(400);
    });
  }

  it("lists only the caller's groups, with their role and member count", async () => {
    const mine = await newGroup(dave, [carol]);
    const notMine = await newGroup(alice);
    const res = await request(app).get("/api/groups").set(carol.auth);
    expect(res.status).toBe(200);
    const ids = res.body.groups.map((g: { id: string }) => g.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(notMine.id);
    expect(res.body.groups.find((g: { id: string }) => g.id === mine.id)).toMatchObject({
      myRole: "MEMBER",
      memberCount: 2,
    });
  });

  it("shows group details to members only", async () => {
    const g = await newGroup(alice, [bob]);
    expect((await get(bob, g)).status).toBe(200);
    expect((await get(carol, g)).status).toBe(404);
    expect((await request(app).get(`/api/groups/${g.id}`)).status).toBe(401);
    expect((await get(alice, { id: "does-not-exist" })).status).toBe(404);
  });
});

describe("joining with the shareable link", () => {
  it("shows a public preview of the group", async () => {
    const g = await newGroup(alice, [], { name: "Ski trip" });
    const res = await request(app).get(`/api/invites/link/${g.inviteToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ groupName: "Ski trip", currency: "EUR", memberCount: 1, closed: false, alreadyMember: false });
  });

  it("tells a logged-in member they're already in, with the group's id; nobody else gets the id", async () => {
    const g = await newGroup(alice, [bob]);
    const preview = (auth?: Record<string, string>) => request(app).get(`/api/invites/link/${g.inviteToken}`).set(auth ?? {});
    expect((await preview(bob.auth)).body).toMatchObject({ alreadyMember: true, groupId: g.id });
    const outsider = (await preview(carol.auth)).body;
    expect(outsider.alreadyMember).toBe(false);
    expect(outsider).not.toHaveProperty("groupId");
    // A bad token is treated as anonymous, not an error.
    const bad = await preview({ authorization: "Bearer nonsense" });
    expect(bad.status).toBe(200);
    expect(bad.body).not.toHaveProperty("groupId");
  });

  it("adds the user as a member after the existing ones, and is idempotent", async () => {
    const g = await newGroup(alice);
    const first = await join(bob, g.inviteToken);
    expect(first.status).toBe(200);
    expect(first.body.group.members.map((m: { userId: string; role: string }) => [m.userId, m.role])).toEqual([
      [alice.id, "OWNER"],
      [bob.id, "MEMBER"],
    ]);
    expect((await join(bob, g.inviteToken)).status).toBe(200);
    expect(await prisma.groupMember.count({ where: { groupId: g.id } })).toBe(2);
    expect(await activityTypes(g.id)).toEqual(["GROUP_CREATED", "MEMBER_JOINED"]);
  });

  it("creates exactly one membership when the same user joins many times at once", async () => {
    const g = await newGroup(alice);
    const results = await Promise.all(Array.from({ length: 10 }, () => join(bob, g.inviteToken)));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(await prisma.groupMember.count({ where: { groupId: g.id, userId: bob.id } })).toBe(1);
    expect((await activityTypes(g.id)).filter((t) => t === "MEMBER_JOINED")).toHaveLength(1);
  });

  it("rejects an unknown token with 404", async () => {
    expect((await join(bob, "not-a-real-token")).status).toBe(404);
    expect((await request(app).get("/api/invites/link/not-a-real-token")).status).toBe(404);
  });

  it("lets only the owner replace the link, and the old one stops working", async () => {
    const g = await newGroup(alice, [bob]);
    expect((await request(app).post(`/api/groups/${g.id}/invite-link`).set(bob.auth)).status).toBe(403);

    const res = await request(app).post(`/api/groups/${g.id}/invite-link`).set(alice.auth);
    expect(res.status).toBe(200);
    expect(res.body.inviteToken).not.toBe(g.inviteToken);
    expect(res.body.inviteLink).toBe(`${config.appUrl}/join/${res.body.inviteToken}`);
    expect((await join(carol, g.inviteToken)).status).toBe(404);
    expect((await join(carol, res.body.inviteToken)).status).toBe(200);
  });

  it("doesn't let new members join a closed group", async () => {
    const g = await newGroup(alice, [bob]);
    await close(alice, g);
    expect((await request(app).get(`/api/invites/link/${g.inviteToken}`)).body.closed).toBe(true);
    expect((await join(carol, g.inviteToken)).status).toBe(409);
    // An existing member following the link again is harmless.
    expect((await join(bob, g.inviteToken)).status).toBe(200);
  });
});

describe("inviting by email", () => {
  it("stores the invite and stub-sends an email with the accept link (D11)", async () => {
    const g = await newGroup(alice, [bob], { name: "Beach house" });
    const res = await invite(bob, g, `  ${emailOf(carol).toUpperCase()} `);
    expect(res.status).toBe(201);
    expect(res.body.invite.email).toBe(emailOf(carol));

    const row = await inviteRow(g.id, emailOf(carol));
    expect(row.invitedById).toBe(bob.id);
    const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);

    const emails = await prisma.emailOutbox.findMany({ where: { to: emailOf(carol) } });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ kind: "INVITE", subject: 'Bob invited you to "Beach house"' });
    expect(emails[0].body).toContain(`${config.appUrl}/invites/${row.token}`);

    expect((await get(alice, g)).body.group.pendingInvites).toEqual([
      expect.objectContaining({ email: emailOf(carol) }),
    ]);
    expect(await activityTypes(g.id)).toContain("MEMBER_INVITED");
  });

  it("shows a public preview of the invite", async () => {
    const g = await newGroup(alice, [], { name: "Book club" });
    await invite(alice, g, emailOf(dave));
    const { token } = await inviteRow(g.id, emailOf(dave));
    const res = await request(app).get(`/api/invites/email/${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email: emailOf(dave),
      groupName: "Book club",
      invitedBy: "Alice",
      expired: false,
      accepted: false,
    });
  });

  it("lets an existing user with the invited email accept, and nobody else", async () => {
    const g = await newGroup(alice);
    await invite(alice, g, emailOf(carol));
    const { token } = await inviteRow(g.id, emailOf(carol));

    expect((await accept(dave.auth, token)).status).toBe(403);
    expect((await accept({}, token)).status).toBe(401);

    const res = await accept(carol.auth, token);
    expect(res.status).toBe(200);
    expect(res.body.group.members.map((m: { userId: string }) => m.userId)).toEqual([alice.id, carol.id]);
    expect(res.body.group.pendingInvites).toEqual([]);
    expect((await inviteRow(g.id, emailOf(carol))).acceptedAt).not.toBeNull();

    // Accepting twice is harmless.
    expect((await accept(carol.auth, token)).status).toBe(200);
    expect(await prisma.groupMember.count({ where: { groupId: g.id } })).toBe(2);
  });

  it("lets a new user register with the invited email and then accept", async () => {
    const g = await newGroup(alice);
    const email = `newcomer${suffix}`;
    await invite(alice, g, email);
    const { token } = await inviteRow(g.id, email);

    const reg = await request(app)
      .post("/api/auth/register")
      .send({ email: email.toUpperCase(), name: "Newcomer", password: "password123" });
    expect(reg.status).toBe(201);

    const res = await accept({ Authorization: `Bearer ${reg.body.token}` }, token);
    expect(res.status).toBe(200);
    expect(res.body.group.members).toContainEqual(expect.objectContaining({ email, role: "MEMBER" }));
  });

  it("re-inviting replaces the token, refreshes the expiry and sends a new email", async () => {
    const g = await newGroup(alice);
    await invite(alice, g, emailOf(dave));
    const first = await inviteRow(g.id, emailOf(dave));
    await prisma.groupInvite.update({ where: { id: first.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await invite(alice, g, emailOf(dave))).status).toBe(201);
    const second = await inviteRow(g.id, emailOf(dave));
    expect(second.id).toBe(first.id);
    expect(second.token).not.toBe(first.token);
    expect(second.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const bodies = (await prisma.emailOutbox.findMany({ where: { to: emailOf(dave) } })).map((e) => e.body);
    expect(bodies.filter((b) => b.includes(second.token))).toHaveLength(1);
    expect((await accept(dave.auth, first.token)).status).toBe(404);
    expect((await accept(dave.auth, second.token)).status).toBe(200);
  });

  it("rejects an expired invite with 410", async () => {
    const g = await newGroup(alice);
    await invite(alice, g, emailOf(bob));
    const row = await inviteRow(g.id, emailOf(bob));
    await prisma.groupInvite.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await request(app).get(`/api/invites/email/${row.token}`)).body.expired).toBe(true);
    expect((await accept(bob.auth, row.token)).status).toBe(410);
    expect(await prisma.groupMember.count({ where: { groupId: g.id } })).toBe(1);
  });

  it("refuses to invite someone who is already a member, and sends nothing", async () => {
    const g = await newGroup(alice, [bob]);
    const before = await prisma.emailOutbox.count({ where: { to: emailOf(bob) } });
    expect((await invite(alice, g, emailOf(bob))).status).toBe(409);
    expect(await prisma.emailOutbox.count({ where: { to: emailOf(bob) } })).toBe(before);
    expect(await prisma.groupInvite.count({ where: { groupId: g.id } })).toBe(0);
  });

  it("validates the email and hides the group from non-members", async () => {
    const g = await newGroup(alice);
    expect((await invite(alice, g, "not-an-email")).status).toBe(400);
    expect((await invite(dave, g, emailOf(carol))).status).toBe(404);
    expect((await accept(bob.auth, "not-a-real-token")).status).toBe(404);
  });

  it("blocks inviting to, and accepting into, a closed group", async () => {
    const g = await newGroup(alice);
    await invite(alice, g, emailOf(carol));
    const { token } = await inviteRow(g.id, emailOf(carol));
    await close(alice, g);
    expect((await invite(alice, g, emailOf(dave))).status).toBe(409);
    expect((await accept(carol.auth, token)).status).toBe(409);
  });
});

describe("group settings", () => {
  it("lets the owner change the name and reminder interval, with activity", async () => {
    const g = await newGroup(alice, [bob]);
    const res = await settings(alice, g, { name: "Renamed", reminderDays: 14 });
    expect(res.status).toBe(200);
    expect(res.body.group).toMatchObject({ name: "Renamed", reminderDays: 14, currency: "EUR" });

    const activity = await prisma.activity.findFirstOrThrow({
      where: { groupId: g.id, type: "GROUP_SETTINGS_UPDATED" },
    });
    expect(activity.data).toEqual({
      before: { name: "Trip", currency: "EUR", reminderDays: 7 },
      after: { name: "Renamed", currency: "EUR", reminderDays: 14 },
    });
  });

  it("doesn't record activity when nothing actually changed", async () => {
    const g = await newGroup(alice);
    expect((await settings(alice, g, { name: "Trip", currency: "eur" })).status).toBe(200);
    expect(await activityTypes(g.id)).toEqual(["GROUP_CREATED"]);
  });

  it("is owner-only and validated", async () => {
    const g = await newGroup(alice, [bob]);
    expect((await settings(bob, g, { reminderDays: 3 })).status).toBe(403);
    expect((await settings(carol, g, { reminderDays: 3 })).status).toBe(404);
    expect((await settings(alice, g, {})).status).toBe(400);
    expect((await settings(alice, g, { reminderDays: 0 })).status).toBe(400);
    expect((await settings(alice, g, { currency: "XYZ" })).status).toBe(400);
  });

  it("allows a currency change until the first expense, then locks it for good", async () => {
    const g = await newGroup(alice, [bob]);
    expect((await settings(alice, g, { currency: "usd" })).body.group).toMatchObject({
      currency: "USD",
      currencyLocked: false,
    });

    const expense = await addExpense(alice, g, [alice, bob]);
    expect(expense.status).toBe(201);
    expect((await get(alice, g)).body.group.currencyLocked).toBe(true);
    const locked = await settings(alice, g, { currency: "EUR" });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toMatch(/currency/);

    // Other settings can still change, and sending the current currency is fine.
    expect((await settings(alice, g, { currency: "USD", reminderDays: 3 })).status).toBe(200);

    // Deleting the expense doesn't unlock it: its history is still in USD.
    await request(app).delete(`/api/groups/${g.id}/expenses/${expense.body.expense.id}`).set(alice.auth);
    expect((await settings(alice, g, { currency: "EUR" })).status).toBe(409);
  });

  it("locks the currency once any payment exists, even a pending one", async () => {
    const g = await newGroup(alice, [bob]);
    await prisma.payment.create({
      data: { groupId: g.id, fromUserId: bob.id, toUserId: alice.id, amount: 100, status: "PENDING" },
    });
    expect((await settings(alice, g, { currency: "USD" })).status).toBe(409);
  });
});

describe("closing and reopening a group (D8)", () => {
  it("lets the owner close the group, which blocks expense changes", async () => {
    const g = await newGroup(alice, [bob]);
    expect((await close(bob, g)).status).toBe(403);

    const res = await close(alice, g);
    expect(res.status).toBe(200);
    expect(res.body.group.status).toBe("CLOSED");
    expect(new Date(res.body.group.closedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);

    expect((await addExpense(alice, g, [alice, bob])).status).toBe(409);
    expect((await request(app).get(`/api/groups/${g.id}/balances`).set(bob.auth)).status).toBe(200);
    expect((await close(alice, g)).status).toBe(409);
    expect(await activityTypes(g.id)).toContain("GROUP_CLOSED");
  });

  it("lets the owner reopen it, which allows expenses again", async () => {
    const g = await newGroup(alice, [bob]);
    await close(alice, g);
    expect((await reopen(bob, g)).status).toBe(403);

    const res = await reopen(alice, g);
    expect(res.status).toBe(200);
    expect(res.body.group).toMatchObject({ status: "OPEN", closedAt: null });
    expect((await addExpense(alice, g, [alice, bob])).status).toBe(201);
    expect((await reopen(alice, g)).status).toBe(409);
    expect(await activityTypes(g.id)).toEqual(
      expect.arrayContaining(["GROUP_CLOSED", "GROUP_REOPENED", "EXPENSE_CREATED"]),
    );
  });

  it("shows the status in the group list", async () => {
    const g = await newGroup(alice);
    await close(alice, g);
    const list = await request(app).get("/api/groups").set(alice.auth);
    expect(list.body.groups.find((x: { id: string }) => x.id === g.id).status).toBe("CLOSED");
  });
});
