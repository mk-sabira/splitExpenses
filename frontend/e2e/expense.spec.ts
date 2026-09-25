import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiAs, choose, groupWith, register } from "./helpers";

// Alice (owner, joined first), Bob and Carol in one group; Alice's browser is open on it.
async function threeOfUs(browser: Browser) {
  const pages: Page[] = [];
  for (const name of ["Alice", "Bob", "Carol"]) {
    const p = await (await browser.newContext()).newPage();
    await register(p, name);
    pages.push(p);
  }
  const [alice, bob, carol] = pages;
  const g = await groupWith(alice, [bob, carol], "Trip");
  await alice.goto(`/groups/${g.id}`);
  await expect(alice.getByRole("status").filter({ hasText: "live" })).toHaveText(/^live$/);
  return { alice, bob, carol, g };
}

const form = (page: Page) => page.getByRole("region", { name: "Add an expense" });
const split = (page: Page) => form(page).getByRole("list", { name: "Who's in the split" });
const row = (page: Page, name: string) => split(page).getByRole("listitem").filter({ hasText: name });
const balances = (page: Page) => page.getByRole("region", { name: "Balances" });

async function start(page: Page, description: string, amount: string) {
  await page.getByRole("button", { name: "+ Add an expense" }).click();
  await form(page).getByLabel("What for?").fill(description);
  await form(page).getByLabel("Amount", { exact: true }).fill(amount);
}

test("equal split: the preview rounds like the server, and everyone's balance updates live", async ({ browser }) => {
  const { alice, bob, g } = await threeOfUs(browser);
  await bob.goto(`/groups/${g.id}`);
  await start(alice, "Taxi", "10");

  // 10.00 / 3: the extra cent goes to whoever joined first (Alice).
  await expect(row(alice, "Alice")).toContainText("€3.34");
  await expect(row(alice, "Bob")).toContainText("€3.33");
  await expect(row(alice, "Carol")).toContainText("€3.33");

  await form(alice).getByRole("button", { name: "Add expense" }).click();
  await expect(form(alice)).toHaveCount(0);
  await expect(alice.getByText(/you're owed\s*€6\.66/)).toBeVisible();
  await expect(bob.getByText(/you owe\s*€3\.33/)).toBeVisible();
  await expect(bob.getByRole("region", { name: "What happened" })).toContainText("Alice added Taxi · €10.00");
});

test("leaving someone out, and paying on someone else's behalf", async ({ browser }) => {
  const { alice, g } = await threeOfUs(browser);
  await start(alice, "Groceries", "30");
  await form(alice).getByLabel("Paid by").selectOption({ label: "Bob" });
  await row(alice, "Carol").getByText("Carol").click(); // untick Carol
  await expect(row(alice, "Carol")).toContainText("—");
  await expect(row(alice, "Alice")).toContainText("€15.00");
  await form(alice).getByRole("button", { name: "Add expense" }).click();

  await expect(balances(alice)).toContainText(/Alice\s*\(you\)\s*owes\s*€15\.00/);
  await expect(balances(alice)).toContainText(/Bob\s*is owed\s*€15\.00/);
  await expect(balances(alice)).toContainText(/Carol\s*settled up/);
  void g;
});

test("by shares", async ({ browser }) => {
  const { alice } = await threeOfUs(browser);
  await start(alice, "Cabin", "90");
  await choose(alice, "by shares");
  await row(alice, "Alice").getByLabel("Alice's shares").fill("2");
  await row(alice, "Carol").getByLabel("Carol's shares").fill("0");
  await expect(row(alice, "Alice")).toContainText("€60.00");
  await expect(row(alice, "Bob")).toContainText("€30.00");
  await expect(row(alice, "Carol")).toContainText("—");

  await row(alice, "Bob").getByLabel("Bob's shares").fill("1.5");
  await form(alice).getByRole("button", { name: "Add expense" }).click();
  await expect(row(alice, "Bob").getByRole("alert")).toContainText("A whole number from 0 to 1000.");

  await row(alice, "Bob").getByLabel("Bob's shares").fill("1");
  await form(alice).getByRole("button", { name: "Add expense" }).click();
  await expect(balances(alice)).toContainText(/Bob\s*owes\s*€30\.00/);
});

test("exact amounts must add up before saving", async ({ browser }) => {
  const { alice } = await threeOfUs(browser);
  await start(alice, "Concert", "90");
  await choose(alice, "exact amounts");
  await row(alice, "Alice").getByLabel("Alice's part").fill("40");
  await row(alice, "Bob").getByLabel("Bob's part").fill("45");
  await expect(form(alice)).toContainText("€5.00 left to assign");

  await form(alice).getByRole("button", { name: "Add expense" }).click();
  await expect(form(alice).getByRole("alert")).toContainText("The parts add up to €85.00, not €90.00.");

  await row(alice, "Bob").getByLabel("Bob's part").fill("55");
  await expect(form(alice)).toContainText("€5.00 too much");
  await row(alice, "Bob").getByLabel("Bob's part").fill("50");
  await expect(form(alice)).toContainText("✓ adds up to €90.00");
  await form(alice).getByRole("button", { name: "Add expense" }).click();
  await expect(balances(alice)).toContainText(/Bob\s*owes\s*€50\.00/);
  await expect(balances(alice)).toContainText(/Carol\s*settled up/);
});

test("missing or malformed fields are flagged without saving anything", async ({ browser }) => {
  const { alice } = await threeOfUs(browser);
  await alice.getByRole("button", { name: "+ Add an expense" }).click();
  await form(alice).getByLabel("Amount", { exact: true }).fill("12.345");
  await form(alice).getByRole("button", { name: "Add expense" }).click();
  await expect(form(alice).getByLabel("What for?")).toHaveAttribute("aria-invalid", "true");
  await expect(form(alice)).toContainText("Use at most 2 decimal places.");

  await form(alice).getByLabel("What for?").fill("Snacks");
  await form(alice).getByLabel("Amount", { exact: true }).fill("12");
  await form(alice).getByRole("button", { name: "no one" }).click();
  await form(alice).getByRole("button", { name: "Add expense" }).click();
  await expect(form(alice)).toContainText("Pick at least one person.");

  await form(alice).getByRole("button", { name: "Cancel" }).click();
  await expect(alice.getByRole("region", { name: "What happened" })).not.toContainText("Snacks");
});

test("a closed group has no add button", async ({ browser }) => {
  const { alice, g } = await threeOfUs(browser);
  await (await apiAs(alice)).post(`/groups/${g.id}/close`);
  await expect(alice.getByText("This group is closed, so no new expenses.")).toBeVisible();
  await expect(alice.getByRole("button", { name: "+ Add an expense" })).toHaveCount(0);
});

test("an expense added alone can be edited to include someone who joins later", async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  await register(alice, "Alice");
  const a = await apiAs(alice);
  const { group } = await a.post("/groups", { name: "Solo", currency: "EUR" });
  await alice.goto(`/groups/${group.id}`);
  await expect(alice.getByRole("status").filter({ hasText: "live" })).toHaveText(/^live$/);

  // Alone: the button works, with a hint about who it will be split between.
  await expect(alice.getByText("This will be split only among current members")).toBeVisible();
  await start(alice, "Rent", "100");
  await form(alice).getByRole("button", { name: "Add expense" }).click();
  await expect(form(alice)).toHaveCount(0);

  const bob = await (await browser.newContext()).newPage();
  await register(bob, "Bob");
  await (await apiAs(bob)).post(`/invites/link/${group.inviteToken}/join`);
  await expect(alice.getByText("This will be split only among current members")).toHaveCount(0);

  // Open the expense from the feed; Bob isn't in it yet.
  await alice.getByRole("region", { name: "What happened" }).getByRole("link", { name: "Rent" }).click();
  await expect(alice).toHaveURL(/\/expenses\//);
  await expect(alice.getByRole("list", { name: "Split" })).not.toContainText("Bob");
  await expect(alice.getByText("Not in this split: Bob.")).toBeVisible();

  await alice.getByRole("button", { name: "Edit" }).click();
  const edit = alice.getByRole("region", { name: "Edit expense" });
  const bobRow = edit.getByRole("list", { name: "Who's in the split" }).getByRole("listitem").filter({ hasText: "Bob" });
  await expect(bobRow).toContainText("—");
  await bobRow.getByText("Bob").click(); // tick Bob
  await expect(bobRow).toContainText("€50.00");
  await edit.getByRole("button", { name: "Save changes" }).click();

  await expect(alice.getByRole("list", { name: "Split" })).toContainText(/Bob\s*€50\.00/);
  await expect(alice.getByText(/you're owed\s*€50\.00/)).toBeVisible();
  await expect(alice.getByRole("region", { name: "What happened" })).toContainText("Alice edited Rent");
});
