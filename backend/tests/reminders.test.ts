import type { Group } from "@prisma/client";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { prisma } from "../src/db";
import { startReminderScheduler } from "../src/reminders/scheduler";
import { isReminderDue, sendDueReminders } from "../src/reminders/service";
import { cleanup, createGroup, createUsers, uniqueSuffix, type TestUser } from "./helpers";

// Reminders never wait for real time: every run takes an explicit `now`, and
// the simulated clock is anchored to the debtor's real owingSince.

const app = createApp();
const suffix = uniqueSuffix("reminders");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let alice: TestUser, bob: TestUser, carol: TestUser;

beforeAll(async () => {
  [alice, bob, carol] = await createUsers(suffix, ["Alice", "Bob", "Carol"]);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await cleanup(suffix);
  await prisma.$disconnect();
});

// ---------- helpers ----------

const email = (u: TestUser) => `${u.name.toLowerCase()}${suffix}`;

function addExpense(g: Group, payer: TestUser, amount: number, participants: TestUser[]) {
  return request(app)
    .post(`/api/groups/${g.id}/expenses`)
    .set(payer.auth)
    .send({
      paidById: payer.id,
      amount,
      description: "Dinner",
      category: "FOOD",
      date: "2026-09-20",
      split: { type: "EQUAL", participants: participants.map((p) => p.id) },
    });
}

// Alice pays 90.00 split three ways: Bob and Carol each owe her 30.00.
async function dinnerGroup(reminderDays: number, opts: { status?: "CLOSED" } = {}) {
  const g = await createGroup([alice, bob, carol]);
  expect((await addExpense(g, alice, 9000, [alice, bob, carol])).status).toBe(201);
  await prisma.group.update({ where: { id: g.id }, data: { reminderDays, ...opts } });
  return g;
}

async function member(g: Group, u: TestUser) {
  return prisma.groupMember.findUniqueOrThrow({ where: { groupId_userId: { groupId: g.id, userId: u.id } } });
}

// When Bob started owing; the simulated clock counts from here.
async function debtStart(g: Group) {
  const m = await member(g, bob);
  expect(m.owingSince).not.toBeNull();
  return m.owingSince!.getTime();
}

async function repay(g: Group, from: TestUser, to: TestUser, amount: number, confirm = true) {
  const res = await request(app).post(`/api/groups/${g.id}/payments`).set(from.auth).send({ toUserId: to.id, amount });
  expect(res.status).toBe(201);
  if (confirm) {
    expect((await request(app).post(`/api/payments/${res.body.payment.id}/confirm`).set(to.auth)).status).toBe(200);
  }
  return res.body.payment.id as string;
}

// Runs the job at every hour from `fromDay` to `toDay` (inclusive) and records
// the simulated day each email was sent on, per recipient.
async function simulate(g: Group, start: number, fromDay: number, toDay: number) {
  const log: Record<string, number[]> = {};
  for (let t = start + fromDay * DAY; t <= start + toDay * DAY; t += HOUR) {
    for (const e of await sendDueReminders(new Date(t), { groupIds: [g.id] })) {
      (log[e.to] ??= []).push((t - start) / DAY);
    }
  }
  return log;
}

// ---------- the due rule ----------

describe("isReminderDue", () => {
  const t0 = new Date("2026-09-01T12:00:00Z");
  const at = (days: number) => new Date(t0.getTime() + days * DAY);

  it.each([
    ["not owing", { owingSince: null, lastRemindedAt: null }, 3, 100, false],
    ["owing less than reminderDays", { owingSince: t0, lastRemindedAt: null }, 3, 2.99, false],
    ["owing exactly reminderDays", { owingSince: t0, lastRemindedAt: null }, 3, 3, true],
    ["reminded 6.99 days ago, reminderDays 1", { owingSince: t0, lastRemindedAt: at(1) }, 1, 7.99, false],
    ["reminded 7 days ago, reminderDays 1", { owingSince: t0, lastRemindedAt: at(1) }, 1, 8, true],
    ["reminded 13 days ago, reminderDays 14", { owingSince: t0, lastRemindedAt: at(14) }, 14, 27, false],
    ["reminded 14 days ago, reminderDays 14", { owingSince: t0, lastRemindedAt: at(14) }, 14, 28, true],
  ])("%s", (_label, state, reminderDays, day, due) => {
    expect(isReminderDue(state, reminderDays, at(day))).toBe(due);
  });
});

// ---------- simulated time ----------

describe("sendDueReminders over simulated weeks", () => {
  it("never reminds the same debtor twice within a week, even with reminderDays = 1", async () => {
    const g = await dinnerGroup(1);
    const start = await debtStart(g);
    // 36 simulated days, checked every hour: 864 runs.
    const log = await simulate(g, start, 0, 35);

    // First reminder once reminderDays has passed, then exactly weekly; without
    // the weekly cap this would be daily.
    expect(log[email(bob)]).toEqual([1, 8, 15, 22, 29]);
    expect(log[email(carol)]).toEqual([1, 8, 15, 22, 29]);
    expect(log[email(alice)]).toBeUndefined(); // the creditor
    for (const days of [log[email(bob)], log[email(carol)]]) {
      for (let i = 1; i < days.length; i++) expect(days[i] - days[i - 1]).toBeGreaterThanOrEqual(7);
    }
    expect((await member(g, bob)).lastRemindedAt!.getTime()).toBe(start + 29 * DAY);
  });

  it("waits reminderDays before the first reminder and repeats at that interval when it's over a week", async () => {
    const g = await dinnerGroup(10);
    const log = await simulate(g, await debtStart(g), 0, 35);
    expect(log[email(bob)]).toEqual([10, 20, 30]);
  });

  it("drives the real scheduler with a fake interval timer and a simulated clock", async () => {
    const g = await dinnerGroup(3);
    const start = await debtStart(g);
    let clock = start;
    const bobReminders = () => prisma.emailOutbox.count({ where: { to: email(bob), kind: "DEBT_REMINDER" } });
    const before = await bobReminders();
    // Only the interval is faked: Prisma's own timeouts keep using real timers.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const scheduler = startReminderScheduler({ intervalMs: HOUR, now: () => new Date(clock), groupIds: [g.id] });
    try {
      await scheduler.idle(); // the run at start-up
      for (let h = 1; h <= 20 * 24; h++) {
        clock += HOUR;
        vi.advanceTimersByTime(HOUR); // fires exactly one tick
        await scheduler.idle();
      }
    } finally {
      scheduler.stop();
    }
    // Days 3, 10 and 17 in 20 simulated days (481 runs).
    expect((await bobReminders()) - before).toBe(3);
    expect(((await member(g, bob)).lastRemindedAt!.getTime() - start) / DAY).toBe(17);
  });
});

// ---------- settling ----------

describe("settling up", () => {
  it("sends nothing if the debt is settled before the first reminder would fire", async () => {
    const g = await dinnerGroup(3);
    const start = await debtStart(g);
    await repay(g, bob, alice, 3000);
    expect((await member(g, bob)).owingSince).toBeNull();

    const log = await simulate(g, start, 0, 30);
    expect(log[email(bob)]).toBeUndefined();
    expect(log[email(carol)]).toEqual([3, 10, 17, 24]); // Carol still owes
  });

  it("stops reminding once the debt is settled between reminders", async () => {
    const g = await dinnerGroup(1);
    const start = await debtStart(g);
    expect((await simulate(g, start, 0, 5))[email(bob)]).toEqual([1]);
    await repay(g, bob, alice, 3000);
    expect((await simulate(g, start, 5, 30))[email(bob)]).toBeUndefined();
  });

  it("re-checks under the lock: a debt settled after the job picked its candidates gets no reminder", async () => {
    const g = await dinnerGroup(1);
    const now = new Date((await debtStart(g)) + 2 * DAY);
    // Let the candidate query run, then settle Bob's debt before the job locks the group.
    const findMany = prisma.groupMember.findMany.bind(prisma.groupMember);
    const spy = vi.spyOn(prisma.groupMember, "findMany").mockImplementationOnce((async (args: never) => {
      const candidates = await findMany(args);
      await repay(g, bob, alice, 3000);
      return candidates;
    }) as never);
    try {
      const sent = await sendDueReminders(now, { groupIds: [g.id] });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(sent.map((e) => e.to)).toEqual([email(carol)]);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps reminding after a partial repayment, on the same schedule and for what's left", async () => {
    const g = await dinnerGroup(2);
    const start = await debtStart(g);
    await repay(g, bob, alice, 1000);
    expect((await member(g, bob)).owingSince!.getTime()).toBe(start); // same debt, same clock

    const sent = await sendDueReminders(new Date(start + 2 * DAY), { groupIds: [g.id] });
    const toBob = sent.find((e) => e.to === email(bob))!;
    expect(toBob.subject).toContain("you owe €20.00");
    expect(toBob.body).toContain("Pay Alice €20.00");
  });

  it("skips a debtor whose pending payments cover the whole debt, and resumes if one is rejected", async () => {
    const g = await dinnerGroup(1);
    const start = await debtStart(g);
    const paymentId = await repay(g, bob, alice, 3000, false);
    expect((await simulate(g, start, 0, 3))[email(bob)]).toBeUndefined();

    expect((await request(app).post(`/api/payments/${paymentId}/reject`).set(alice.auth)).status).toBe(200);
    expect((await simulate(g, start, 3, 4))[email(bob)]).toEqual([3]);
  });

  it("keeps the weekly cap across a debt that is settled and then starts again", async () => {
    const g = await dinnerGroup(1);
    const start = await debtStart(g);
    expect((await simulate(g, start, 0, 1))[email(bob)]).toEqual([1]);
    await repay(g, bob, alice, 3000);
    expect((await addExpense(g, alice, 2000, [alice, bob])).status).toBe(201); // Bob owes again
    expect((await member(g, bob)).owingSince).not.toBeNull();

    expect((await simulate(g, start, 1, 10))[email(bob)]).toEqual([8]);
  });
});

// ---------- other rules ----------

describe("other rules", () => {
  it("still reminds debtors in a closed group (D8)", async () => {
    const g = await dinnerGroup(1, { status: "CLOSED" });
    expect((await simulate(g, await debtStart(g), 0, 1))[email(bob)]).toEqual([1]);
  });

  it("uses the group's current reminderDays", async () => {
    const g = await dinnerGroup(7);
    const start = await debtStart(g);
    expect((await simulate(g, start, 0, 2))[email(bob)]).toBeUndefined();
    const res = await request(app).put(`/api/groups/${g.id}/settings`).set(alice.auth).send({ reminderDays: 2 });
    expect(res.status).toBe(200);
    expect((await simulate(g, start, 2, 3))[email(bob)]).toEqual([2]);
  });

  it("sends each due reminder once when runs overlap", async () => {
    const g = await dinnerGroup(1);
    const now = new Date((await debtStart(g)) + 2 * DAY);
    const runs = await Promise.all(Array.from({ length: 6 }, () => sendDueReminders(now, { groupIds: [g.id] })));
    const recipients = runs.flat().map((e) => e.to).sort();
    expect(recipients).toEqual([email(bob), email(carol)].sort());
  });

  it("stores the email in the outbox with the amount owed, the transfers and a link", async () => {
    const g = await dinnerGroup(1);
    const now = new Date((await debtStart(g)) + 4 * DAY);
    await sendDueReminders(now, { groupIds: [g.id] });

    const stored = await prisma.emailOutbox.findFirstOrThrow({
      where: { to: email(carol), kind: "DEBT_REMINDER" },
      orderBy: { createdAt: "desc" },
    });
    expect(stored.subject).toBe(`Reminder: you owe €30.00 in "${g.name}"`);
    expect(stored.body).toContain("for 4 days");
    expect(stored.body).toContain("Pay Alice €30.00");
    expect(stored.body).toContain(`/groups/${g.id}`);
  });
});
