import { expect, test, type Browser } from "@playwright/test";
import { apiAs, newEmail, PASSWORD, register } from "./helpers";

// Alice owns "Ski trip"; returns its id and shareable link token.
async function aliceGroup(browser: Browser) {
  const alice = await (await browser.newContext()).newPage();
  await register(alice, "Alice");
  const a = await apiAs(alice);
  const { group } = await a.post("/groups", { name: "Ski trip", currency: "EUR" });
  return { alice, a, id: group.id as string, token: group.inviteToken as string };
}

const card = (page: import("@playwright/test").Page) => page.getByRole("region", { name: "Ski trip" });

test("joining while logged in: see the group first, then join and land in it", async ({ browser }) => {
  const { id, token } = await aliceGroup(browser);
  const bob = await (await browser.newContext()).newPage();
  await register(bob, "Bob");

  await bob.goto(`/join/${token}`);
  await expect(card(bob)).toContainText("EUR (Euro) · 1 member");
  await bob.getByRole("button", { name: "Join group" }).click();

  await expect(bob).toHaveURL(new RegExp(`/groups/${id}$`));
  await expect(bob.getByText(/2 members/)).toBeVisible();
});

test("joining while logged out: sign up, come back to the join page, then join", async ({ browser }) => {
  const { id, token } = await aliceGroup(browser);
  const carol = await (await browser.newContext()).newPage();

  await carol.goto(`/join/${token}`);
  await expect(card(carol)).toContainText("EUR (Euro) · 1 member");
  await expect(carol.getByRole("button", { name: "Join group" })).toHaveCount(0);
  await carol.getByRole("link", { name: "Sign up" }).click();

  await expect(carol).toHaveURL(new RegExp(`/register\\?next=%2Fjoin%2F${token}$`));
  await expect(carol.getByText("You've been invited!")).toBeVisible();
  await carol.getByLabel("Your name").fill("Carol");
  await carol.getByLabel("Email").fill(newEmail("Carol"));
  await carol.getByLabel("Password").fill(PASSWORD);
  await carol.getByRole("button", { name: "Create my account" }).click();

  // Back on the join page, still asked to confirm.
  await expect(carol).toHaveURL(new RegExp(`/join/${token}$`));
  await carol.getByRole("button", { name: "Join group" }).click();
  await expect(carol).toHaveURL(new RegExp(`/groups/${id}$`));
});

test("joining while logged out with an existing account: log in, come back, join", async ({ browser }) => {
  const { id, token } = await aliceGroup(browser);
  const dana = await (await browser.newContext()).newPage();
  const { email } = await register(dana, "Dana");
  await dana.getByRole("button", { name: "log out" }).click();

  await dana.goto(`/join/${token}`);
  await dana.getByRole("button", { name: "Log in to join" }).click();
  await expect(dana).toHaveURL(new RegExp(`/login\\?next=%2Fjoin%2F${token}$`));
  await dana.getByLabel("Email").fill(email);
  await dana.getByLabel("Password").fill(PASSWORD);
  await dana.getByRole("button", { name: "Log in" }).click();

  await expect(dana).toHaveURL(new RegExp(`/join/${token}$`));
  await dana.getByRole("button", { name: "Join group" }).click();
  await expect(dana).toHaveURL(new RegExp(`/groups/${id}$`));
});

test("already a member: the link goes straight into the group", async ({ browser }) => {
  const { alice, id, token } = await aliceGroup(browser);
  await alice.goto(`/join/${token}`);
  await expect(alice).toHaveURL(new RegExp(`/groups/${id}$`));
  await expect(alice.getByText(/1 member\b/)).toBeVisible();
});

test("an invalid link says so, whether or not you're logged in", async ({ browser }) => {
  const anon = await (await browser.newContext()).newPage();
  await anon.goto("/join/not-a-real-token");
  await expect(anon.getByRole("heading", { name: "This invite link doesn't work" })).toBeVisible();
  await expect(anon.getByRole("link", { name: "Go to the front page" })).toBeVisible();

  const bob = await (await browser.newContext()).newPage();
  await register(bob, "Bob");
  await bob.goto("/join/not-a-real-token");
  await expect(bob.getByRole("heading", { name: "This invite link doesn't work" })).toBeVisible();
  await expect(bob.getByRole("link", { name: "Go to my groups" })).toBeVisible();
});

test("a closed group's link shows the group but can't be joined", async ({ browser }) => {
  const { a, id, token } = await aliceGroup(browser);
  await a.post(`/groups/${id}/close`);
  const bob = await (await browser.newContext()).newPage();
  await register(bob, "Bob");
  await bob.goto(`/join/${token}`);
  await expect(card(bob)).toContainText("isn't taking new members");
  await expect(bob.getByRole("button", { name: "Join group" })).toHaveCount(0);
});
