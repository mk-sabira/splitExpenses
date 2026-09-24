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
