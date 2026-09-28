import { expect, test } from "@playwright/test";
import { apiAs, groupWith, register } from "./helpers";

test("an empty list invites you to start a group; creating one opens it", async ({ page }) => {
  await register(page, "Aigerim");
  await expect(page.getByText("No groups yet")).toBeVisible();

  await page.getByRole("button", { name: "Start a group" }).click();
  await page.getByLabel("Name").fill("Flat 4B");
  await page.getByLabel("Currency").selectOption("KGS");
  await page.getByLabel("Remind debtors after").fill("3");
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page).toHaveURL(/\/groups\/[a-z0-9]+$/);
  // A new group: just the prompt to add an expense, no balances or feed yet,
  // and the invite link open since you're alone.
  await expect(page.getByText("Add your first expense to get started.")).toBeVisible();
  await expect(page.getByText("you're all settled up")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "What happened" })).toHaveCount(0);
  await expect(page.getByText("Invite with this link")).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "my groups", exact: true })).toHaveAttribute("aria-current", "page");

  await page.goto("/groups");
  const card = page.getByRole("link", { name: /Flat 4B/ });
  await expect(card).toContainText("KGS · 1 member · you're the owner");
  await expect(card).toContainText("settled up");
});

test("each card shows your own balance: red when you owe, green when you're owed", async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await register(alice, "Alice");
  await register(bob, "Bob");
  const g = await groupWith(alice, [bob], "Dinner club");
  const a = await apiAs(alice);
  await a.post(`/groups/${g.id}/expenses`, {
    paidById: a.me.id,
    amount: 4000,
    description: "Dinner",
    category: "FOOD",
    date: "2026-09-20",
    split: { type: "EQUAL", participants: g.members },
  });

  await alice.goto("/groups");
  const owed = alice.getByRole("link", { name: /Dinner club/ }).getByText("you're owed");
  await expect(owed.locator("..")).toContainText("€20.00");
  await expect(owed.locator("..")).toHaveClass(/text-owed/);

  await bob.goto("/groups");
  const owes = bob.getByRole("link", { name: /Dinner club/ }).getByText("you owe");
  await expect(owes.locator("..")).toContainText("€20.00");
  await expect(owes.locator("..")).toHaveClass(/text-owe(\s|$)/);
  await expect(bob.getByRole("link", { name: /Dinner club/ })).toContainText("2 members");
});

test("a repayment waiting for your confirmation is flagged at the top", async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await register(alice, "Alice");
  await register(bob, "Bob");
  const g = await groupWith(alice, [bob], "Rent");
  const a = await apiAs(alice);
  await a.post(`/groups/${g.id}/expenses`, {
    paidById: a.me.id,
    amount: 10000,
    description: "Rent",
    category: "RENT",
    date: "2026-09-01",
    split: { type: "EQUAL", participants: g.members },
  });
  await (await apiAs(bob)).post(`/groups/${g.id}/payments`, { toUserId: a.me.id, amount: 5000 });

  await alice.goto("/groups");
  const waiting = alice.getByRole("region", { name: "Waiting for you" });
  await expect(waiting).toContainText("A repayment of €50.00 in Rent needs your confirmation.");
  await waiting.getByRole("link", { name: "review" }).click();
  await expect(alice).toHaveURL(new RegExp(`/groups/${g.id}$`));

  await bob.goto("/groups"); // the payer has nothing to confirm
  await expect(bob.getByRole("region", { name: "Waiting for you" })).toHaveCount(0);
});

test("server-side validation shows up next to the field", async ({ page }) => {
  await register(page, "Chen");
  await page.getByRole("button", { name: "Start a group" }).click();
  await page.getByLabel("Name").fill("   "); // passes the browser's `required`, the API trims it
  await page.getByRole("button", { name: "Create group" }).click();
  await expect(page.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
});

// Minimal expense through the API, split equally between `participants`.
async function addExpense(page: Parameters<typeof apiAs>[0], groupId: string, amount: number, participants: string[]) {
  const a = await apiAs(page);
  await a.post(`/groups/${groupId}/expenses`, {
    paidById: a.me.id,
    amount,
    description: "Something",
    category: "OTHER",
    date: "2026-09-20",
    split: { type: "EQUAL", participants },
  });
}

test("totals across all groups: one line per currency, closed groups included", async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await register(alice, "Alice");
  await register(bob, "Bob");
  // Bob owes €20.00 in one EUR group and is owed €5.00 in another; is owed $30.00 in a closed USD group.
  const eur1 = await groupWith(alice, [bob], "Dinner club", "EUR");
  const eur2 = await groupWith(bob, [alice], "Cinema", "EUR");
  const usd = await groupWith(bob, [alice], "NYC", "USD");
  await addExpense(alice, eur1.id, 4000, eur1.members);
  await addExpense(bob, eur2.id, 1000, eur2.members);
  await addExpense(bob, usd.id, 6000, usd.members);
  await (await apiAs(bob)).post(`/groups/${usd.id}/close`);

  await bob.goto("/groups");
  const totals = bob.getByRole("region", { name: "Across all your groups" });
  await expect(totals.getByTestId("total-EUR")).toContainText(/you owe\s*€15\.00/);
  await expect(totals.getByTestId("total-EUR")).toContainText("you owe €20.00 and you're owed €5.00, in 2 EUR groups");
  await expect(totals.getByTestId("total-USD")).toContainText(/you're owed\s*\$30\.00/);
  await expect(bob.getByRole("link", { name: /NYC/ })).toContainText("Closed");
  await expect(bob.getByRole("link", { name: /NYC/ })).toContainText(/you're owed\s*\$30\.00/);
});

test("the list and the totals update live when something changes in another browser", async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await register(alice, "Alice");
  await register(bob, "Bob");
  const g = await groupWith(alice, [bob], "Dinner club");
  const card = bob.getByRole("link", { name: /Dinner club/ });
  const totals = bob.getByRole("region", { name: "Across all your groups" });

  await bob.goto("/groups");
  await expect(card).toContainText("settled up");
  await expect(totals).toContainText("settled up");

  // Alice adds an expense in her own browser; Bob's page isn't reloaded.
  await addExpense(alice, g.id, 4000, g.members);
  await expect(card).toContainText(/you owe\s*€20\.00/);
  await expect(totals.getByTestId("total-EUR")).toContainText(/you owe\s*€20\.00/);

  // A repayment waiting for Alice appears on her list live, and her balance
  // only changes once she confirms it.
  await alice.goto("/groups");
  const aliceCard = alice.getByRole("link", { name: /Dinner club/ });
  await expect(aliceCard).toContainText(/you're owed\s*€20\.00/);
  const { payment } = await (await apiAs(bob)).post(`/groups/${g.id}/payments`, { toUserId: g.members[0], amount: 2000 });
  await expect(alice.getByRole("region", { name: "Waiting for you" })).toContainText("€20.00 in Dinner club");
  await expect(aliceCard).toContainText(/you're owed\s*€20\.00/);
  await (await apiAs(alice)).post(`/payments/${payment.id}/confirm`);
  await expect(card).toContainText("settled up");
  await expect(aliceCard).toContainText("settled up");
  await expect(alice.getByRole("region", { name: "Waiting for you" })).toHaveCount(0);

  // Someone joining changes the member count on the owner's card.
  const { group: ski } = await (await apiAs(alice)).post("/groups", { name: "Ski trip", currency: "EUR" });
  const skiCard = alice.getByRole("link", { name: /Ski trip/ });
  await alice.reload();
  await expect(skiCard).toContainText("1 member");
  await (await apiAs(bob)).post(`/invites/link/${ski.inviteToken}/join`);
  await expect(skiCard).toContainText("2 members");
});
