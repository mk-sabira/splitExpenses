import { expect, test, type Page } from "@playwright/test";
import { apiAs, groupWith, register } from "./helpers";

const bell = (page: Page) => page.getByRole("button", { name: /^notifications/ });
const panel = (page: Page) => page.getByRole("region", { name: "Notifications" });
const unread = (page: Page) => page.getByTestId("unread-count");

test("an expense involving you shows up live in your header; the actor and people outside the split get nothing", async ({ browser }) => {
  const pages: Page[] = [];
  for (const name of ["Alice", "Bob", "Dave"]) {
    const p = await (await browser.newContext()).newPage();
    await register(p, name);
    pages.push(p);
  }
  const [alice, bob, dave] = pages;
  const g = await groupWith(alice, [bob, dave], "Trip");
  const [aliceId, bobId] = g.members;

  // Bob and Dave are on their groups list, not in the group's room.
  await bob.goto("/groups");
  await dave.goto("/groups");
  await alice.goto(`/groups/${g.id}`);
  await expect(bell(bob)).toHaveAccessibleName("notifications");

  // Alice adds an expense for herself and Bob in her browser, leaving Dave out.
  await alice.getByRole("button", { name: "+ Add an expense" }).click();
  const form = alice.getByRole("region", { name: "Add an expense" });
  await form.getByLabel("What for?").fill("Taxi");
  await form.getByLabel("Amount", { exact: true }).fill("30");
  await form.getByRole("list", { name: "Who's in the split" }).getByRole("listitem").filter({ hasText: "Dave" }).getByText("Dave").click();
  await form.getByRole("button", { name: "Add expense" }).click();

  await expect(unread(bob)).toHaveText("1");
  await expect(bell(bob)).toHaveAccessibleName("notifications, 1 unread");
  await expect(unread(alice)).toHaveCount(0);
  await expect(unread(dave)).toHaveCount(0);
  await dave.reload(); // not just missed live: nothing stored either
  await bell(dave).click();
  await expect(panel(dave)).toContainText("Nothing yet.");

  // Bob opens it: who, what, which group, his share; clicking goes to the expense and marks it read.
  await bell(bob).click();
  const item = panel(bob).getByRole("link", { name: /Alice added Taxi/ });
  await expect(item).toContainText("Alice added Taxi · €30.00, your share €15.00");
  await expect(item).toContainText("Unread:");
  await expect(item).toContainText("Trip");
  await item.click();
  await expect(bob).toHaveURL(new RegExp(`/groups/${g.id}/expenses/`));
  await expect(unread(bob)).toHaveCount(0);

  // An edit that changes Bob's share, made through the API by Alice.
  const a = await apiAs(alice);
  const { expenses } = await a.get(`/groups/${g.id}/expenses`);
  const e = expenses[0];
  const res = await alice.request.put(`/api/groups/${g.id}/expenses/${e.id}`, {
    headers: { authorization: `Bearer ${await alice.evaluate(() => localStorage.getItem("esep.token"))}` },
    data: {
      paidById: aliceId,
      amount: 6000,
      description: "Taxi",
      category: "TRANSPORT",
      date: e.date,
      split: { type: "EQUAL", participants: [aliceId, bobId] },
      version: e.version,
    },
  });
  expect(res.ok()).toBe(true);

  await expect(unread(bob)).toHaveText("1");
  await bell(bob).click();
  await expect(panel(bob).getByRole("link").first()).toContainText("Alice edited Taxi, your share €15.00 → €30.00");
  await panel(bob).getByRole("button", { name: "mark all as read" }).click();
  await expect(unread(bob)).toHaveCount(0);
  await expect(panel(bob).getByText("Unread:")).toHaveCount(0);
});

test("marking as read in one tab clears the count in your other tab", async ({ browser }) => {
  const aliceCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  await register(alice, "Alice");
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await register(bob, "Bob");
  const bob2 = await bobCtx.newPage(); // same login, second tab
  const g = await groupWith(alice, [bob], "Flat");
  await bob.goto("/groups");
  await bob2.goto("/help");

  const a = await apiAs(alice);
  await a.post(`/groups/${g.id}/expenses`, {
    paidById: a.me.id,
    amount: 1000,
    description: "Milk",
    category: "GROCERIES",
    date: "2026-09-01",
    split: { type: "EQUAL", participants: g.members },
  });
  await expect(unread(bob)).toHaveText("1");
  await expect(unread(bob2)).toHaveText("1");

  await bell(bob).click();
  await panel(bob).getByRole("button", { name: "mark all as read" }).click();
  await expect(unread(bob2)).toHaveCount(0);
});
