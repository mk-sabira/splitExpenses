import { expect, test } from "@playwright/test";
import { register } from "./helpers";

test("the front page shows the five-step guide", async ({ page }) => {
  await page.goto("/login");
  const guide = page.getByRole("region", { name: "How it works" });
  await expect(page.getByText("Weekend in Almaty")).toHaveCount(0);
  await expect(page.getByText("Split any way")).toHaveCount(0);
  await expect(guide.getByRole("listitem")).toHaveCount(5);
  await expect(guide.getByRole("listitem").first()).toContainText("Log in or sign up");
});

test("a logged-in user reaches the guide from the header, not from the group screens", async ({ page }) => {
  await register(page, "Erlan");
  await expect(page.getByRole("heading", { name: "How it works" })).toHaveCount(0);
  await page.getByRole("banner").getByRole("link", { name: "help" }).click();
  await expect(page).toHaveURL(/\/help$/);
  await expect(page.getByRole("heading", { name: "How Esep works" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(5);
  await page.getByRole("link", { name: "Go to my groups" }).click();
  await expect(page).toHaveURL(/\/groups$/);
});

test("the guide page needs a login", async ({ page }) => {
  await page.goto("/help");
  await expect(page).toHaveURL(/\/login\?next=%2Fhelp/);
});
