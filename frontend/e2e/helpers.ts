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

// Calls the API as whoever is logged in on `page`, for setting up data that
// a test isn't about (the UI for it is tested elsewhere).
export async function apiAs(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem("esep.token"));
  const call = async <T = any>(method: string, path: string, data?: unknown): Promise<T> => {
    const res = await page.request.fetch(`/api${path}`, {
      method,
      data,
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${await res.text()}`);
    return res.json();
  };
  const me = (await call<{ user: { id: string } }>("GET", "/auth/me")).user;
  return { me, get: <T = any>(p: string) => call<T>("GET", p), post: <T = any>(p: string, d?: unknown) => call<T>("POST", p, d ?? {}) };
}

// A group owned by `owner` with the others joined through its invite link.
export async function groupWith(owner: Page, others: Page[], name = "Trip", currency = "EUR") {
  const a = await apiAs(owner);
  const { group } = await a.post("/groups", { name, currency });
  const members = [a.me.id];
  for (const p of others) {
    const b = await apiAs(p);
    await b.post(`/invites/link/${group.inviteToken}/join`);
    members.push(b.me.id);
  }
  return { id: group.id as string, members };
}
