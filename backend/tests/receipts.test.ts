import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Group } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { config } from "../src/config";
import { prisma } from "../src/db";
import { MAX_RECEIPT_BYTES } from "../src/receipts/storage";
import { cleanup, createGroup, createUsers, uniqueSuffix, type TestUser } from "./helpers";

const app = createApp();
const suffix = uniqueSuffix("receipts");

let alice: TestUser, bob: TestUser, carol: TestUser;
let g: Group;

beforeAll(async () => {
  [alice, bob, carol] = await createUsers(suffix, ["Alice", "Bob", "Carol"]);
  g = await createGroup([alice, bob]); // Carol isn't a member
});

afterAll(async () => {
  await cleanup(suffix);
  await prisma.$disconnect();
});

// ---------- fixtures: just enough of each format for content sniffing ----------

// A real 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x20, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(40, 2)]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");

const expenseJson = (extra: object = {}) =>
  JSON.stringify({
    paidById: alice.id,
    amount: 2000,
    description: "Dinner",
    category: "FOOD",
    date: "2026-09-20",
    split: { type: "EQUAL", participants: [alice.id, bob.id] },
    ...extra,
  });

const url = (groupId: string, expenseId?: string, rest = "") =>
  `/api/groups/${groupId}/expenses${expenseId ? `/${expenseId}` : ""}${rest}`;

function createWith(as: TestUser, file?: { data: Buffer; name: string; type?: string }, groupId = g.id) {
  const req = request(app).post(url(groupId)).set(as.auth).field("expense", expenseJson());
  return file ? req.attach("receipt", file.data, { filename: file.name, contentType: file.type ?? "application/octet-stream" }) : req;
}

function download(as: TestUser | null, expenseId: string, groupId = g.id) {
  const req = request(app).get(url(groupId, expenseId, "/receipt")).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  });
  return as ? req.set(as.auth) : req;
}

const files = () => (existsSync(config.uploadsDir) ? readdirSync(config.uploadsDir) : []);
const stored = async (expenseId: string) =>
  (await prisma.expense.findUniqueOrThrow({ where: { id: expenseId }, select: { receiptPath: true } })).receiptPath;
const onDisk = (receiptPath: string | null) => receiptPath !== null && existsSync(path.join(config.uploadsDir, receiptPath));

describe("uploading a receipt with a new expense", () => {
  it("stores it under a random name and lets members download it", async () => {
    const res = await createWith(alice, { data: PNG, name: "../../etc/Dinner bill.png", type: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body.expense.receipt).toEqual({ name: "Dinner bill.png", mime: "image/png", size: PNG.length });
    expect(JSON.stringify(res.body)).not.toMatch(/receiptPath|uploads/);

    const receiptPath = await stored(res.body.expense.id);
    expect(receiptPath).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(onDisk(receiptPath)).toBe(true);

    const got = await download(bob, res.body.expense.id);
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(got.headers["content-disposition"]).toBe("inline; filename*=UTF-8''Dinner%20bill.png");
    expect(Buffer.compare(got.body as Buffer, PNG)).toBe(0);
  });

  it("detects JPEG, WebP and PDF by content, whatever the name or declared type says", async () => {
    for (const [data, mime, name] of [
      [JPEG, "image/jpeg", "photo.jpg"],
      [WEBP, "image/webp", "scan.webp"],
      [PDF, "application/pdf", "invoice.txt"], // misnamed: the content decides, and the name is corrected
    ] as const) {
      const res = await createWith(alice, { data, name, type: "text/plain" });
      expect(res.status).toBe(201);
      expect(res.body.expense.receipt.mime).toBe(mime);
    }
    const pdf = await createWith(alice, { data: PDF, name: "invoice.txt" });
    expect(pdf.body.expense.receipt.name).toBe("invoice.pdf");
  });

  it("still takes plain JSON, without a receipt", async () => {
    const res = await request(app).post(url(g.id)).set(alice.auth).send(JSON.parse(expenseJson()));
    expect(res.status).toBe(201);
    expect(res.body.expense.receipt).toBeNull();
    expect((await createWith(alice)).body.expense.receipt).toBeNull(); // multipart without a file
  });

  it("rejects another type even when it's named and declared as an image, and keeps nothing", async () => {
    const before = { files: files().length, expenses: await prisma.expense.count({ where: { groupId: g.id } }) };
    for (const data of [Buffer.from("just some text, not a picture"), Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), Buffer.from("GIF89a....")]) {
      const res = await createWith(alice, { data, name: "receipt.png", type: "image/png" });
      expect(res.status).toBe(415);
      expect(res.body.error).toBe("A receipt must be a JPEG, PNG or WebP image, or a PDF.");
    }
    expect(files().length).toBe(before.files);
    expect(await prisma.expense.count({ where: { groupId: g.id } })).toBe(before.expenses);
  });

  it("rejects a file over 5 MB, and accepts one of exactly 5 MB", async () => {
    const before = files().length;
    const big = Buffer.concat([PDF, Buffer.alloc(MAX_RECEIPT_BYTES + 1 - PDF.length, 0x20)]);
    const res = await createWith(alice, { data: big, name: "huge.pdf", type: "application/pdf" });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("The receipt is too big: 5 MB at most.");
    expect(files().length).toBe(before);

    const exact = await createWith(alice, { data: big.subarray(0, MAX_RECEIPT_BYTES), name: "max.pdf" });
    expect(exact.status).toBe(201);
    expect(exact.body.expense.receipt.size).toBe(MAX_RECEIPT_BYTES);
  });

  it("rejects a bad expense field or a second file", async () => {
    const bad = await request(app).post(url(g.id)).set(alice.auth).field("expense", "{nope").attach("receipt", PNG, "a.png");
    expect(bad.status).toBe(400);
    const missing = await request(app).post(url(g.id)).set(alice.auth).attach("receipt", PNG, "a.png");
    expect(missing.status).toBe(400);
    const two = await request(app)
      .post(url(g.id))
      .set(alice.auth)
      .field("expense", expenseJson())
      .attach("receipt", PNG, "a.png")
      .attach("receipt", PNG, "b.png");
    expect(two.status).toBe(400);
  });

  it("removes the file again when the expense can't be saved", async () => {
    const closed = await createGroup([alice, bob], { status: "CLOSED" });
    const before = files().length;
    const res = await createWith(alice, { data: PNG, name: "a.png" }, closed.id);
    expect(res.status).toBe(409);
    expect(files().length).toBe(before);
  });
});

describe("who can download it", () => {
  let expenseId: string;
  beforeAll(async () => {
    expenseId = (await createWith(alice, { data: PNG, name: "a.png" })).body.expense.id;
  });

  it("a non-member gets 404, the same as a missing group", async () => {
    const res = await download(carol, expenseId);
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toMatch(/json/);
  });

  it("needs a login", async () => {
    expect((await download(null, expenseId)).status).toBe(401);
  });

  it("can't be reached through another group's URL, even one you belong to", async () => {
    const other = await createGroup([bob, carol]);
    expect((await download(bob, expenseId, other.id)).status).toBe(404);
  });

  it("an expense without a receipt is a 404", async () => {
    const plain = await request(app).post(url(g.id)).set(alice.auth).send(JSON.parse(expenseJson()));
    expect((await download(alice, plain.body.expense.id)).status).toBe(404);
  });

  it("isn't served as a static file", async () => {
    const receiptPath = await stored(expenseId);
    for (const p of [`/uploads/${receiptPath}`, `/${receiptPath}`, `/api/uploads/${receiptPath}`]) {
      expect((await request(app).get(p)).status).toBe(404);
    }
  });
});

describe("editing and deleting", () => {
  const put = (as: TestUser, expenseId: string, version: number, extra: object = {}) =>
    request(app).put(url(g.id, expenseId)).set(as.auth).field("expense", expenseJson({ version, ...extra }));

  it("replaces the receipt, deleting the old file, and records both in the feed", async () => {
    const created = (await createWith(alice, { data: PNG, name: "first.png" })).body.expense;
    const oldPath = await stored(created.id);

    const res = await put(bob, created.id, 1).attach("receipt", PDF, "second.pdf");
    expect(res.status).toBe(200);
    expect(res.body.expense).toMatchObject({ version: 2, receipt: { name: "second.pdf", mime: "application/pdf" } });
    expect(onDisk(oldPath)).toBe(false);
    expect(onDisk(await stored(created.id))).toBe(true);
    expect(Buffer.compare((await download(alice, created.id)).body as Buffer, PDF)).toBe(0);

    const edit = await prisma.activity.findFirstOrThrow({
      where: { groupId: g.id, type: "EXPENSE_UPDATED" },
      orderBy: { createdAt: "desc" },
    });
    const data = edit.data as { before: { receipt: unknown }; after: { receipt: unknown } };
    expect(data.before.receipt).toEqual({ name: "first.png", mime: "image/png", size: PNG.length });
    expect(data.after.receipt).toEqual({ name: "second.pdf", mime: "application/pdf", size: PDF.length });
  });

  it("keeps the receipt when an edit doesn't mention it, JSON or multipart", async () => {
    const created = (await createWith(alice, { data: PNG, name: "keep.png" })).body.expense;
    const json = await request(app).put(url(g.id, created.id)).set(alice.auth).send({ ...JSON.parse(expenseJson()), amount: 3000, version: 1 });
    expect(json.status).toBe(200);
    expect(json.body.expense.receipt.name).toBe("keep.png");
    const multi = await put(alice, created.id, 2, { amount: 4000 });
    expect(multi.body.expense.receipt.name).toBe("keep.png");
    expect(onDisk(await stored(created.id))).toBe(true);
  });

  it("removes the receipt and its file", async () => {
    const created = (await createWith(alice, { data: PNG, name: "gone.png" })).body.expense;
    const oldPath = await stored(created.id);
    const res = await put(alice, created.id, 1, { removeReceipt: true });
    expect(res.status).toBe(200);
    expect(res.body.expense.receipt).toBeNull();
    expect(onDisk(oldPath)).toBe(false);
    expect((await download(alice, created.id)).status).toBe(404);
  });

  it("can't both replace and remove; a stale version leaves the old receipt and no new file", async () => {
    const created = (await createWith(alice, { data: PNG, name: "a.png" })).body.expense;
    expect((await put(alice, created.id, 1, { removeReceipt: true }).attach("receipt", PDF, "b.pdf")).status).toBe(400);

    const before = files().length;
    const stale = await put(alice, created.id, 7).attach("receipt", PDF, "b.pdf");
    expect(stale.status).toBe(409);
    expect(files().length).toBe(before);
    expect((await download(alice, created.id)).headers["content-type"]).toBe("image/png");
  });

  it("deleting the expense keeps the file, still for members only", async () => {
    const created = (await createWith(alice, { data: PNG, name: "kept.png" })).body.expense;
    expect((await request(app).delete(url(g.id, created.id)).set(bob.auth)).status).toBe(200);
    expect(onDisk(await stored(created.id))).toBe(true);
    expect((await download(bob, created.id)).status).toBe(200);
    expect((await download(carol, created.id)).status).toBe(404);
  });
});

it("the test cleanup deletes uploaded files", async () => {
  const other = uniqueSuffix("receipts-cleanup");
  const [dan, eve] = await createUsers(other, ["Dan", "Eve"]);
  const h = await createGroup([dan, eve]);
  const res = await request(app)
    .post(url(h.id))
    .set(dan.auth)
    .field("expense", JSON.stringify({ paidById: dan.id, amount: 100, description: "x", category: "OTHER", date: "2026-09-01", split: { type: "EQUAL", participants: [dan.id] } }))
    .attach("receipt", PNG, "x.png");
  expect(res.status).toBe(201);
  const receiptPath = await stored(res.body.expense.id);
  expect(onDisk(receiptPath)).toBe(true);
  await cleanup(other);
  expect(onDisk(receiptPath)).toBe(false);
});
