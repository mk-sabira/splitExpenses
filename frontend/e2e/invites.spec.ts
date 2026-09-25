import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiAs, inviteToken, newEmail, PASSWORD, register } from "./helpers";

// Alice owns "Book club" and invites `email`; returns the group id and invite token.
async function aliceInvites(browser: Browser, email: string) {
  const alice = await (await browser.newContext()).newPage();
  await register(alice, "Alice");
  const a = await apiAs(alice);
  const { group } = await a.post("/groups", { name: "Book club", currency: "EUR" });
  await a.post(`/groups/${group.id}/invites`, { email });
  return { a, id: group.id as string, token: inviteToken(email) };
}

const card = (page: Page) => page.getByRole("region", { name: "Book club" });
const newPage = async (browser: Browser) => (await browser.newContext()).newPage();

test("logged in with the invited email: see the group, accept, land in it", async ({ browser }) => {
  const dave = await newPage(browser);
  const { email } = await register(dave, "Dave");
  const { id, token } = await aliceInvites(browser, email);

  await dave.goto(`/invites/${token}`);
  await expect(card(dave)).toContainText("EUR (Euro) · 1 member");
  await expect(card(dave)).toContainText(`Alice invited ${email}.`);
  await dave.getByRole("button", { name: "Accept and join" }).click();
  await expect(dave).toHaveURL(new RegExp(`/groups/${id}$`));
  await expect(dave.getByText(/2 members/)).toBeVisible();

  // Following the invite again just opens the group.
  await dave.goto(`/invites/${token}`);
  await expect(dave).toHaveURL(new RegExp(`/groups/${id}$`));
});

test("logged out, new to Esep: sign up with the invited email (locked), come back, accept", async ({ browser }) => {
  const email = newEmail("Erin");
  const { id, token } = await aliceInvites(browser, email);
  const erin = await newPage(browser);

  await erin.goto(`/invites/${token}`);
  await expect(card(erin)).toContainText(`Log in or sign up as ${email} to accept.`);
  await erin.getByRole("button", { name: "Sign up" }).click();

  await expect(erin).toHaveURL(/\/register\?next=%2Finvites%2F/);
  await expect(erin.getByText("You've been invited!")).toBeVisible();
  await expect(erin.getByLabel("Email")).toHaveValue(email);
  await expect(erin.getByLabel("Email")).toHaveAttribute("readonly", "");
  await erin.getByLabel("Your name").fill("Erin");
  await erin.getByLabel("Password").fill(PASSWORD);
  await erin.getByRole("button", { name: "Create my account" }).click();

  await expect(erin).toHaveURL(new RegExp(`/invites/${token}$`));
  await erin.getByRole("button", { name: "Accept and join" }).click();
  await expect(erin).toHaveURL(new RegExp(`/groups/${id}$`));
});

test("logged out with an existing account: log in (email filled in), come back, accept", async ({ browser }) => {
  const fay = await newPage(browser);
  const { email } = await register(fay, "Fay");
  await fay.getByRole("button", { name: "log out" }).click();
  const { id, token } = await aliceInvites(browser, email);

  await fay.goto(`/invites/${token}`);
  await fay.getByRole("button", { name: "Log in to accept" }).click();
  await expect(fay.getByLabel("Email")).toHaveValue(email);
  await fay.getByLabel("Password").fill(PASSWORD);
  await fay.getByRole("button", { name: "Log in" }).click();

  await expect(fay).toHaveURL(new RegExp(`/invites/${token}$`));
  await fay.getByRole("button", { name: "Accept and join" }).click();
  await expect(fay).toHaveURL(new RegExp(`/groups/${id}$`));
});

test("logged in as someone else: explains only the invited email can accept", async ({ browser }) => {
  const email = newEmail("Gus");
  const { token } = await aliceInvites(browser, email);
  const bob = await newPage(browser);
  const { email: bobEmail } = await register(bob, "Bob");

  await bob.goto(`/invites/${token}`);
  await expect(card(bob)).toContainText(`This invite is for ${email}, and you're logged in as ${bobEmail}.`);
  await expect(bob.getByRole("button", { name: "Accept and join" })).toHaveCount(0);

  await bob.getByRole("button", { name: "Log out and switch" }).click();
  await expect(bob).toHaveURL(/\/login\?next=%2Finvites%2F/);
  await expect(bob.getByLabel("Email")).toHaveValue(email);
});

test("an expired invite and an invalid one each say so", async ({ browser }) => {
  const email = newEmail("Hana");
  const { token } = await aliceInvites(browser, email);
  inviteToken(email, { expire: true });
  const hana = await newPage(browser);

  await hana.goto(`/invites/${token}`);
  await expect(hana.getByRole("heading", { name: "This invite has expired" })).toBeVisible();
  await expect(hana.getByText("Ask Alice to send you a new one.")).toBeVisible();

  await hana.goto("/invites/not-a-real-token");
  await expect(hana.getByRole("heading", { name: "This invite doesn't work" })).toBeVisible();
});
