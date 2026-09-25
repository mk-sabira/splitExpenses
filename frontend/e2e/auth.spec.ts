import { expect, test } from "@playwright/test";
import { choose, newEmail, PASSWORD, register } from "./helpers";

test("sign up, stay logged in across a reload, then log out", async ({ page }) => {
  await register(page, "Aigerim");
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByRole("banner")).toContainText("Aigerim");

  await page.reload();
  await expect(page.getByRole("banner")).toContainText("Aigerim");

  await page.getByRole("button", { name: "log out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/groups");
  await expect(page).toHaveURL(/\/login\?next=%2Fgroups/);
});

test("log in with the right password, and not with a wrong one", async ({ page }) => {
  const { email } = await register(page, "Bob");
  await page.getByRole("button", { name: "log out" }).click();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toHaveText(/Invalid email or password/);

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/groups$/);
});

test("signing up with an email that's taken says so", async ({ page, browser }) => {
  const { email } = await register(page, "Chen");
  const other = await (await browser.newContext()).newPage();
  await other.goto("/register");
  await other.getByLabel("Your name").fill("Someone else");
  await other.getByLabel("Email").fill(email);
  await other.getByLabel("Password").fill(PASSWORD);
  await other.getByRole("button", { name: "Create my account" }).click();
  await expect(other.getByRole("alert")).toHaveText(/already exists/);
});

test("a logged-out visitor returns to the page they wanted after logging in", async ({ page }) => {
  const { email } = await register(page, "Dana");
  await page.getByRole("button", { name: "log out" }).click();

  await page.goto("/help");
  await expect(page).toHaveURL(/\/login\?next=%2Fhelp/);

  // Switching to sign up keeps where they were going.
  await choose(page, "sign up");
  await expect(page).toHaveURL(/\/register\?next=%2Fhelp/);
  await choose(page, "log in");

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/help$/);
});

test("?next= can't send people to another site", async ({ page }) => {
  await page.goto(`/login?next=${encodeURIComponent("//evil.example")}`);
  // Registering is the quickest way to become logged in on this page.
  await choose(page, "sign up");
  await page.getByLabel("Your name").fill("Eve");
  await page.getByLabel("Email").fill(newEmail("Eve"));
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL(/localhost:5199\/groups$/);
});
