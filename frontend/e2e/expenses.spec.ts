import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiAs, groupWith, register } from "./helpers";

async function two(browser: Browser) {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await register(alice, "Alice");
  await register(bob, "Bob");
  const g = await groupWith(alice, [bob], "Trip");
  return { alice, bob, g, aliceId: g.members[0], bobId: g.members[1] };
}

async function addExpense(
  as: Page,
  groupId: string,
  e: { description: string; amount: number; date?: string; paidById?: string; participants: string[]; category?: string },
) {
  const a = await apiAs(as);
  const { expense } = await a.post(`/groups/${groupId}/expenses`, {
    paidById: e.paidById ?? a.me.id,
    amount: e.amount,
    description: e.description,
    category: e.category ?? "FOOD",
    date: e.date ?? "2026-09-20",
    split: { type: "EQUAL", participants: e.participants },
  });
  return expense as { id: string };
}

const list = (page: Page) => page.getByRole("region", { name: "Expenses" });
const rows = (page: Page) => list(page).getByRole("listitem");
const region = (page: Page, name: string) => page.getByRole("region", { name });
const live = (page: Page) => expect(page.getByRole("status").filter({ hasText: "live" })).toHaveText(/^live$/);

test("the expense list: newest first, who paid, your share, show more, and opening one", async ({ browser }) => {
  const { alice, g, aliceId, bobId } = await two(browser);
  // Twelve expenses on different days, recorded out of order.
  for (const day of [3, 11, 7, 1, 12, 5, 9, 2, 10, 4, 8, 6]) {
    await addExpense(alice, g.id, { description: `Day ${day}`, amount: 1000 + day, date: `2026-09-${String(day).padStart(2, "0")}`, participants: [aliceId, bobId] });
  }
  // One Bob paid just for himself: Alice isn't in it.
  await addExpense(alice, g.id, { description: "Bob's book", amount: 1500, date: "2026-08-15", paidById: bobId, participants: [bobId], category: "SHOPPING" });

  await alice.goto(`/groups/${g.id}`);
  await expect(rows(alice)).toHaveCount(10);
  await expect(rows(alice).first()).toContainText("Day 12");
  await expect(rows(alice).first()).toContainText("Alice paid · 12 Sept 2026 · Food & drink");
  await expect(rows(alice).first()).toContainText("€10.12");
  await expect(rows(alice).first()).toContainText("your share €5.06");
  await expect(rows(alice).nth(9)).toContainText("Day 3");

  await list(alice).getByRole("button", { name: "Show more" }).click();
  await expect(rows(alice)).toHaveCount(13);
  await expect(rows(alice).last()).toContainText("Bob's book");
  await expect(rows(alice).last()).toContainText("Bob paid · 15 Aug 2026");
  await expect(rows(alice).last()).toContainText("not in it");
  await expect(list(alice).getByRole("button", { name: "Show more" })).toHaveCount(0);

  await rows(alice).filter({ hasText: "Day 7" }).getByRole("link").click();
  await expect(alice).toHaveURL(new RegExp(`/groups/${g.id}/expenses/[a-z0-9]+$`));
  await expect(alice.getByRole("heading", { name: "Day 7" })).toBeVisible();
  await expect(rows(alice).filter({ hasText: "Day 7" }).getByRole("link")).toHaveAttribute("aria-current", "page");
});

test("deleting asks first, then updates balances, list and feed live for everyone", async ({ browser }) => {
  const { alice, bob, g, aliceId, bobId } = await two(browser);
  const keep = await addExpense(alice, g.id, { description: "Groceries", amount: 1000, participants: [aliceId, bobId] });
  const dinner = await addExpense(alice, g.id, { description: "Dinner", amount: 4000, participants: [aliceId, bobId] });
  void keep;

  // Bob watches the group; Alice opens the dinner.
  await bob.goto(`/groups/${g.id}`);
  await live(bob);
  await expect(bob.getByText(/you owe\s*€25\.00/)).toBeVisible();
  await alice.goto(`/groups/${g.id}/expenses/${dinner.id}`);
  await live(alice);

  await alice.getByRole("button", { name: "Delete" }).click();
  const confirm = alice.getByRole("group", { name: "Confirm delete" });
  await expect(confirm).toContainText("Delete Dinner (€40.00)?");
  await expect(confirm).toContainText("Repayments already made stay as they are");
  await confirm.getByRole("button", { name: "Keep it" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(rows(bob).filter({ hasText: "Dinner" })).toHaveCount(1); // nothing happened

  await alice.getByRole("button", { name: "Delete" }).click();
  await alice.getByRole("group", { name: "Confirm delete" }).getByRole("button", { name: "Yes, delete it" }).click();
  await expect(alice).toHaveURL(new RegExp(`/groups/${g.id}$`));
  await expect(rows(alice).filter({ hasText: "Dinner" })).toHaveCount(0);
  await expect(rows(alice)).toHaveCount(1);

  // Bob's page, without reloading: balance, list and feed.
  await expect(bob.getByText(/you owe\s*€5\.00/)).toBeVisible();
  await expect(rows(bob).filter({ hasText: "Dinner" })).toHaveCount(0);
  await expect(rows(bob).filter({ hasText: "Groceries" })).toHaveCount(1);
  // The feed keeps its record of both the adding and the deleting.
  await expect(region(bob, "What happened")).toContainText("Alice deleted Dinner · €40.00");
  await expect(region(bob, "What happened")).toContainText("Alice added Dinner · €40.00");

  // Someone who had the deleted expense open is told it's gone.
  await bob.goto(`/groups/${g.id}/expenses/${dinner.id}`);
  await expect(bob.getByText("This expense was deleted.")).toBeVisible();
});

test("deleting an expense after its repayment was confirmed keeps the books consistent", async ({ browser }) => {
  const { alice, bob, g, aliceId, bobId } = await two(browser);
  const dinner = await addExpense(alice, g.id, { description: "Dinner", amount: 4000, participants: [aliceId, bobId] });
  // Bob pays his €20.00 back and Alice confirms: settled.
  const { payment } = await (await apiAs(bob)).post(`/groups/${g.id}/payments`, { toUserId: aliceId, amount: 2000 });
  await (await apiAs(alice)).post(`/payments/${payment.id}/confirm`);

  await bob.goto(`/groups/${g.id}`);
  await live(bob);
  await expect(bob.getByText("you're all settled up")).toBeVisible();

  await alice.goto(`/groups/${g.id}/expenses/${dinner.id}`);
  await alice.getByRole("button", { name: "Delete" }).click();
  await alice.getByRole("group", { name: "Confirm delete" }).getByRole("button", { name: "Yes, delete it" }).click();

  // The repayment still stands, so Alice now owes Bob the €20.00 he paid her,
  // and the plan says so. Seen live by Bob, and the same after a reload.
  for (const page of [bob, alice]) {
    const balances = region(page, "Balances");
    await expect(balances).toContainText(/Alice\s*(\(you\))?\s*owes\s*€20\.00/);
    await expect(balances).toContainText(/Bob\s*(\(you\))?\s*is owed\s*€20\.00/);
  }
  await expect(region(bob, "To settle up")).toContainText(/Alice\s*you\s*€20\.00/);
  await expect(region(alice, "To settle up")).toContainText(/You\s*Bob\s*€20\.00/);
  await expect(bob.getByText(/you're owed\s*€20\.00/)).toBeVisible();
  await expect(rows(bob)).toHaveCount(0);
  await expect(list(bob)).toContainText("No expenses right now.");

  // Server-side: balances sum to zero and the confirmed repayment is untouched.
  const { balances } = await (await apiAs(bob)).get(`/groups/${g.id}/balances`);
  expect(balances.reduce((s: number, b: { net: number }) => s + b.net, 0)).toBe(0);
  const { payments } = await (await apiAs(bob)).get(`/groups/${g.id}/payments?status=CONFIRMED`);
  expect(payments).toHaveLength(1);
});

test("a closed group's expenses can be opened but not edited or deleted", async ({ browser }) => {
  const { alice, g, aliceId, bobId } = await two(browser);
  const e = await addExpense(alice, g.id, { description: "Dinner", amount: 4000, participants: [aliceId, bobId] });
  await (await apiAs(alice)).post(`/groups/${g.id}/close`);
  await alice.goto(`/groups/${g.id}`);
  await rows(alice).filter({ hasText: "Dinner" }).getByRole("link").click();
  await expect(alice).toHaveURL(new RegExp(`/expenses/${e.id}$`));
  await expect(alice.getByRole("heading", { name: "Dinner" })).toBeVisible();
  await expect(alice.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(alice.getByRole("button", { name: "Edit" })).toHaveCount(0);
});
