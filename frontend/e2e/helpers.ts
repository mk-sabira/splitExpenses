import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";

export const PASSWORD = "correct horse battery";

// Unique per call; the teardown deletes everything under this domain.
export function newEmail(name: string) {
  return `${name.toLowerCase()}-${Date.now()}-${randomBytes(3).toString("hex")}@e2e.test.local`;
}

export async function register(page: Page, name: string, email = newEmail(name)) {
  await page.goto("/register");
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page.getByRole("button", { name: "log out" })).toBeVisible();
  return { name, email };
}

// Picks an option in a <Choice>: clicks its visible label, as a person would
// (the radio itself is visually hidden).
export async function choose(page: Page, option: string) {
  await page.locator("label").filter({ has: page.getByRole("radio", { name: option, exact: true }) }).click();
  await expect(page.getByRole("radio", { name: option, exact: true })).toBeChecked();
}
