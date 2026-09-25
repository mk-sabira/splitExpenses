import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiAs, groupWith, register } from "./helpers";

// Two people, each in their own browser, looking at the same group.
async function aliceAndBob(browser: Browser, name = "Trip") {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await register(alice, "Alice");
  await register(bob, "Bob");
  const g = await groupWith(alice, [bob], name);
  return { alice, bob, g, a: await apiAs(alice), b: await apiAs(bob) };
}

const dinner = (paidById: string, members: string[], amount = 4000, description = "Dinner") => ({
  paidById,
  amount,
  description,
  category: "FOOD",
  date: "2026-09-20",
  split: { type: "EQUAL", participants: members },
});

async function open(page: Page, groupId: string) {
  await page.goto(`/groups/${groupId}`);
  await expect(page.getByRole("status").filter({ hasText: "live" })).toHaveText(/^live$/);
}

const region = (page: Page, name: string) => page.getByRole("region", { name });

test("balances, settle-up plan and activity update live in the other person's browser", async ({ browser }) => {
  const { alice, bob, g, a } = await aliceAndBob(browser);
  await open(alice, g.id);
  await open(bob, g.id);
  // Nothing has happened yet: just the prompt, no balances and no "settled up".
  await expect(bob.getByText("Add your first expense to get started.")).toBeVisible();
  await expect(region(bob, "Balances")).toHaveCount(0);
  await expect(bob.getByText("you're all settled up")).toHaveCount(0);

  // Alice adds an expense (through the API); Bob's page updates without a reload.
  await a.post(`/groups/${g.id}/expenses`, dinner(a.me.id, g.members));
  await expect(bob.getByText(/you owe\s*€20\.00/)).toBeVisible();
  await expect(bob.getByText("Add your first expense to get started.")).toHaveCount(0);
  await expect(region(bob, "Balances")).toContainText(/Alice\s*is owed\s*€20\.00/);
  await expect(region(bob, "Balances")).toContainText(/Bob\s*\(you\)\s*owes\s*€20\.00/);
  await expect(region(bob, "To settle up")).toContainText(/You\s*Alice\s*€20\.00/);
  await expect(region(bob, "What happened")).toContainText("Alice added Dinner · €40.00");
  await expect(alice.getByText(/you're owed\s*€20\.00/)).toBeVisible();
});

test("repaying: propose from the plan, the recipient confirms, both are settled", async ({ browser }) => {
  const { alice, bob, g, a } = await aliceAndBob(browser);
  await a.post(`/groups/${g.id}/expenses`, dinner(a.me.id, g.members));
  await open(alice, g.id);
  await open(bob, g.id);

  await region(bob, "To settle up").getByRole("button", { name: "I paid this" }).click();
  const form = region(bob, "Record a repayment");
  await expect(form.getByLabel("You paid")).toHaveValue(a.me.id);
  await expect(form.getByLabel("Amount", { exact: true })).toHaveValue("20.00");
  await expect(form.getByLabel("Amount", { exact: true })).toBeFocused();
  await form.getByLabel("Note (optional)").fill("Cash");
  await form.getByRole("button", { name: "Record it" }).click();
  await expect(form).toHaveCount(0);

  // Pending: nothing has changed in the balances yet.
  const pending = region(alice, "Waiting for confirmation");
  await expect(pending).toContainText(/Bob says they paid you\s*€20\.00/);
  await expect(pending).toContainText("“Cash”");
  await expect(region(bob, "Waiting for confirmation")).toContainText("waiting for Alice to confirm");
  await expect(bob.getByText(/you owe\s*€20\.00/)).toBeVisible();
  await expect(bob.getByText("Add your first expense to get started.")).toHaveCount(0);
  await expect(bob.getByText("€20.00 of that is waiting for confirmation.")).toBeVisible();
  await expect(bob.getByRole("button", { name: "Record a repayment" })).toHaveCount(0); // nothing left to propose

  await pending.getByRole("button", { name: "Confirm I got €20.00" }).click();
  await expect(bob.getByText("you're all settled up")).toBeVisible();
  await expect(alice.getByText("you're all settled up")).toBeVisible();
  await expect(region(bob, "Waiting for confirmation")).toHaveCount(0);
  // Settled: one message, no balance list or plan repeating it.
  await expect(region(bob, "To settle up")).toHaveCount(0);
  await expect(region(bob, "Balances").getByRole("list")).toHaveCount(0);
  await expect(region(bob, "What happened")).toContainText("Alice confirmed getting €20.00 from Bob");
});

test("a repayment can be rejected by the recipient or withdrawn by the payer", async ({ browser }) => {
  const { alice, bob, g, a, b } = await aliceAndBob(browser);
  await a.post(`/groups/${g.id}/expenses`, dinner(a.me.id, g.members));
  await open(alice, g.id);
  await open(bob, g.id);

  await b.post(`/groups/${g.id}/payments`, { toUserId: a.me.id, amount: 2000 });
  await region(alice, "Waiting for confirmation").getByRole("button", { name: "I didn't get it" }).click();
  await expect(region(bob, "Waiting for confirmation")).toHaveCount(0);
  await expect(region(bob, "What happened")).toContainText("Alice said they didn't get €20.00 from Bob");

  await b.post(`/groups/${g.id}/payments`, { toUserId: a.me.id, amount: 500 });
  await expect(region(alice, "Waiting for confirmation")).toContainText("€5.00");
  await region(bob, "Waiting for confirmation").getByRole("button", { name: "Withdraw" }).click();
  await expect(region(alice, "Waiting for confirmation")).toHaveCount(0);
  await expect(bob.getByText(/you owe\s*€20\.00/)).toBeVisible();
  await expect(bob.getByText("Add your first expense to get started.")).toHaveCount(0);
});

test("the repayment form shows the server's limit when you overpay", async ({ browser }) => {
  const { bob, g, a } = await aliceAndBob(browser);
  await a.post(`/groups/${g.id}/expenses`, dinner(a.me.id, g.members));
  await open(bob, g.id);
  await bob.getByRole("button", { name: "Record a repayment" }).click();
  const form = region(bob, "Record a repayment");
  await form.getByLabel("Amount", { exact: true }).fill("25");
  await form.getByRole("button", { name: "Record it" }).click();
  await expect(form.getByRole("alert")).toContainText("That's more than you owe (€20.00)");
  await form.getByLabel("Amount", { exact: true }).fill("12.345");
  await form.getByRole("button", { name: "Record it" }).click();
  await expect(form.getByLabel("Amount", { exact: true })).toHaveAttribute("aria-invalid", "true");
});

test("only the owner can close; everyone sees it closed, live", async ({ browser }) => {
  const { alice, bob, g } = await aliceAndBob(browser);
  await open(alice, g.id);
  await open(bob, g.id);
  await expect(bob.getByRole("button", { name: "Close group" })).toHaveCount(0);

  await alice.getByRole("button", { name: "Close group" }).click();
  await alice.getByRole("button", { name: "Yes, close it" }).click();
  await expect(bob.getByText("Closed", { exact: true })).toBeVisible();
  await expect(bob.getByText("Invite with this link")).toHaveCount(0);

  await alice.getByRole("button", { name: "Reopen group" }).click();
  await expect(bob.getByText("Closed", { exact: true })).toHaveCount(0);
  await expect(region(bob, "What happened")).toContainText("Alice reopened the group");
});

test("a new member appears for everyone watching", async ({ browser }) => {
  const { alice, g } = await aliceAndBob(browser);
  await open(alice, g.id);
  const carol = await (await browser.newContext()).newPage();
  await register(carol, "Carol");
  const inviteToken = (await (await apiAs(alice)).get(`/groups/${g.id}`)).group.inviteToken;
  await (await apiAs(carol)).post(`/invites/link/${inviteToken}/join`);
  // Members are folded away until asked for.
  await expect(alice.getByText("Invite with this link")).toBeHidden();
  await alice.getByText("Members & invite").click();
  await expect(alice.getByRole("list", { name: "Members" })).toContainText("Carol");
  await expect(alice.getByText(/3 members/)).toBeVisible();
});

test("the feed pages back through older entries", async ({ browser }) => {
  const { alice, g, a } = await aliceAndBob(browser);
  for (let i = 1; i <= 20; i++) await a.post(`/groups/${g.id}/expenses`, dinner(a.me.id, g.members, 100 * i, `Coffee ${i}`));
  await open(alice, g.id);
  const feed = region(alice, "What happened");
  await expect(feed.getByRole("listitem")).toHaveCount(15);
  await expect(feed.getByRole("listitem").first()).toContainText("Coffee 20");
  await feed.getByRole("button", { name: "Show older" }).click();
  // 20 expenses + Bob joining = 21 entries; creating the group isn't shown.
  await expect(feed.getByRole("listitem")).toHaveCount(21);
  await expect(feed.getByRole("listitem").last()).toContainText("Bob joined");
  await expect(feed.getByRole("button", { name: "Show older" })).toHaveCount(0);

  // A live update adds the new entry on top and keeps the older pages.
  await a.post(`/groups/${g.id}/expenses`, dinner(a.me.id, g.members, 999, "Late snack"));
  await expect(feed.getByRole("listitem").first()).toContainText("Late snack");
  await expect(feed.getByRole("listitem")).toHaveCount(22);
});

test("without a socket connection the page still loads and updates over REST", async ({ browser }) => {
  const { bob, g, a } = await aliceAndBob(browser);
  await a.post(`/groups/${g.id}/expenses`, dinner(a.me.id, g.members));
  await bob.context().route("**/socket.io/**", (route) => route.abort());
  await bob.context().routeWebSocket(/socket\.io/, (ws) => ws.close());

  await bob.goto(`/groups/${g.id}`);
  await expect(bob.getByText(/you owe\s*€20\.00/)).toBeVisible({ timeout: 10_000 });
  await expect(bob.getByRole("status").filter({ hasText: "offline" })).toBeVisible();

  await bob.getByRole("button", { name: "Record a repayment" }).click();
  await region(bob, "Record a repayment").getByLabel("Amount", { exact: true }).fill("5");
  await region(bob, "Record a repayment").getByRole("button", { name: "Record it" }).click();
  await expect(region(bob, "Waiting for confirmation")).toContainText("You say you paid Alice €5.00");
});

test("a group you're not in looks the same as one that doesn't exist", async ({ browser }) => {
  const { g } = await aliceAndBob(browser);
  const eve = await (await browser.newContext()).newPage();
  await register(eve, "Eve");
  await eve.goto(`/groups/${g.id}`);
  await expect(eve.getByText("Group not found")).toBeVisible();
  await eve.goto("/groups/does-not-exist");
  await expect(eve.getByText("Group not found")).toBeVisible();
});
