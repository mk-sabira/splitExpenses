import { expect, test, type Browser, type Page } from "@playwright/test";
import { apiAs, groupWith, register } from "./helpers";

// A real 1×1 PNG and a minimal PDF.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");

async function two(browser: Browser) {
  const alice = await (await browser.newContext()).newPage();
  const bob = await (await browser.newContext()).newPage();
  await register(alice, "Alice");
  await register(bob, "Bob");
  const g = await groupWith(alice, [bob], "Trip");
  return { alice, bob, g };
}

const form = (page: Page) => page.getByRole("region", { name: /Add an expense|Edit expense/ });
const receiptInput = (page: Page) => form(page).getByLabel("Receipt (optional)");
const receipt = (page: Page) => page.getByRole("region", { name: "Receipt" });
const rows = (page: Page) => page.getByRole("region", { name: "Expenses" }).getByRole("listitem");

async function startExpense(page: Page, description: string) {
  await page.getByRole("button", { name: "+ Add an expense" }).click();
  await form(page).getByLabel("What for?").fill(description);
  await form(page).getByLabel("Amount", { exact: true }).fill("20");
}

// The thumbnail really rendered, i.e. the authenticated download worked.
async function expectImageLoaded(page: Page) {
  const img = receipt(page).getByRole("img");
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(1);
}

test("a receipt added with an expense can be opened by the other member in their own browser", async ({ browser }) => {
  const { alice, bob, g } = await two(browser);
  await alice.goto(`/groups/${g.id}`);
  await startExpense(alice, "Dinner");
  await receiptInput(alice).setInputFiles({ name: "dinner-bill.png", mimeType: "image/png", buffer: PNG });
  await expect(form(alice)).toContainText("dinner-bill.png · 70 B");
  await form(alice).getByRole("button", { name: "Add expense" }).click();
  await expect(form(alice)).toHaveCount(0);

  await rows(alice).filter({ hasText: "Dinner" }).getByRole("link").click();
  await expectImageLoaded(alice);
  const expenseUrl = alice.url();

  // Bob, logged in separately, opens the same expense and the receipt itself.
  await bob.goto(expenseUrl);
  await expectImageLoaded(bob);
  await expect(receipt(bob).getByRole("img")).toHaveAttribute("alt", "Receipt: dinner-bill.png");
  const [tab] = await Promise.all([
    bob.context().waitForEvent("page"),
    receipt(bob).getByText("Open receipt (dinner-bill.png · 70 B)").click(),
  ]);
  await tab.waitForLoadState();
  expect(tab.url()).toMatch(/^blob:/);
  expect(await tab.evaluate(() => document.contentType)).toBe("image/png");

  // Someone outside the group can't fetch it, even with the right URL.
  const carol = await (await browser.newContext()).newPage();
  await register(carol, "Carol");
  const expenseId = expenseUrl.split("/").pop();
  const token = await carol.evaluate(() => localStorage.getItem("esep.token"));
  const res = await carol.request.get(`/api/groups/${g.id}/expenses/${expenseId}/receipt`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(404);
});

test("wrong type and oversize files are refused with a clear message, and nothing is saved", async ({ browser }) => {
  const { alice, g } = await two(browser);
  await alice.goto(`/groups/${g.id}`);
  await startExpense(alice, "Snacks");
  const error = form(alice).getByRole("alert");

  // Caught in the browser, as soon as the file is picked.
  await receiptInput(alice).setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(error).toHaveText(/A receipt must be a JPEG, PNG or WebP image, or a PDF\./);
  await expect(receiptInput(alice)).toHaveAttribute("aria-invalid", "true");
  const big = Buffer.concat([PDF, Buffer.alloc(6 * 1024 * 1024, 0x20)]);
  await receiptInput(alice).setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: big });
  await expect(error).toHaveText(/The receipt is too big \(6\.0 MB\): 5 MB at most\./);
  await form(alice).getByRole("button", { name: "Add expense" }).click();
  await expect(form(alice)).toBeVisible();

  // Looks like a PNG by name and type, but isn't: only the server can tell.
  await receiptInput(alice).setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("not really a picture") });
  await expect(error).toHaveCount(0);
  await form(alice).getByRole("button", { name: "Add expense" }).click();
  await expect(error).toHaveText(/A receipt must be a JPEG, PNG or WebP image, or a PDF\./);
  await expect(form(alice)).toBeVisible();

  const { expenses } = await (await apiAs(alice)).get(`/groups/${g.id}/expenses`);
  expect(expenses).toHaveLength(0);

  // A good file then goes through from the same form.
  await receiptInput(alice).setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
  await form(alice).getByRole("button", { name: "Add expense" }).click();
  await expect(form(alice)).toHaveCount(0);
  await expect(rows(alice)).toHaveCount(1);
});

test("editing replaces the receipt, or removes it", async ({ browser }) => {
  const { alice, bob, g } = await two(browser);
  await alice.goto(`/groups/${g.id}`);
  await startExpense(alice, "Hotel");
  await receiptInput(alice).setInputFiles({ name: "hotel.png", mimeType: "image/png", buffer: PNG });
  await form(alice).getByRole("button", { name: "Add expense" }).click();
  await rows(alice).filter({ hasText: "Hotel" }).getByRole("link").click();
  await expectImageLoaded(alice);
  await bob.goto(alice.url());
  await expectImageLoaded(bob);

  // Replace the photo with a PDF: the view now shows a link, and Bob's view follows live.
  await alice.getByRole("button", { name: "Edit" }).click();
  await expect(form(alice)).toContainText("hotel.png · 70 B");
  await receiptInput(alice).setInputFiles({ name: "hotel-invoice.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(form(alice)).toContainText("(replaces the current one)");
  await form(alice).getByRole("button", { name: "Save changes" }).click();
  await expect(receipt(alice)).toContainText("Open receipt (hotel-invoice.pdf");
  await expect(receipt(alice).getByRole("img")).toHaveCount(0);
  await expect(receipt(bob)).toContainText("Open receipt (hotel-invoice.pdf");

  // Remove it, with a chance to change your mind first.
  await alice.getByRole("button", { name: "Edit" }).click();
  await form(alice).getByRole("button", { name: "remove" }).click();
  await expect(form(alice)).toContainText("The receipt will be removed when you save.");
  await form(alice).getByRole("button", { name: "keep it" }).click();
  await expect(form(alice)).toContainText("hotel-invoice.pdf");
  await form(alice).getByRole("button", { name: "remove" }).click();
  await form(alice).getByRole("button", { name: "Save changes" }).click();
  await expect(alice.getByRole("heading", { name: "Hotel" })).toBeVisible();
  await expect(receipt(alice)).toHaveCount(0);
  await expect(receipt(bob)).toHaveCount(0);
});
