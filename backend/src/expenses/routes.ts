import { Category } from "@prisma/client";
import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware";
import { requireMember } from "../groups/access";
import { HttpError } from "../lib/errors";
import { receiptUpload, withStoredReceipt } from "../receipts/storage";
import { createExpense, deleteExpense, getExpense, getReceipt, listExpenses, updateExpense } from "./service";

// Largest value of a Postgres INTEGER column (D2).
const MAX_AMOUNT = 2_147_483_647;
const MAX_PARTICIPANTS = 200;
const MAX_SHARES = 1000;

const id = z.string().min(1).max(64);
const amount = z.number().int().positive().max(MAX_AMOUNT);

const unique = (ids: string[]) => new Set(ids).size === ids.length;
const duplicateMessage = "Each person can appear only once";

const split = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("EQUAL"),
    participants: z
      .array(id)
      .min(1)
      .max(MAX_PARTICIPANTS)
      .refine(unique, duplicateMessage),
  }),
  z.object({
    type: z.literal("SHARES"),
    shares: z
      .array(z.object({ userId: id, shares: z.number().int().positive().max(MAX_SHARES) }))
      .min(1)
      .max(MAX_PARTICIPANTS)
      .refine((xs) => unique(xs.map((x) => x.userId)), duplicateMessage),
  }),
  z.object({
    type: z.literal("EXACT"),
    amounts: z
      .array(z.object({ userId: id, amount: z.number().int().min(0).max(MAX_AMOUNT) }))
      .min(1)
      .max(MAX_PARTICIPANTS)
      .refine((xs) => unique(xs.map((x) => x.userId)), duplicateMessage),
  }),
]);

const expenseBody = z.object({
  paidById: id,
  amount,
  description: z.string().trim().min(1).max(200),
  category: z.enum(Category),
  date: z.iso.date(),
  comment: z.string().trim().max(1000).nullish(),
  split,
});

// removeReceipt drops the current receipt; a new file replaces it (D36).
const updateBody = expenseBody.extend({
  version: z.number().int().positive(),
  removeReceipt: z.boolean().optional(),
});

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: id.optional(),
});

export const expensesRouter = Router({ mergeParams: true });
expensesRouter.use(requireAuth, requireMember);

expensesRouter.get("/", async (req, res) => {
  res.json(await listExpenses(req.groupId!, listQuery.parse(req.query)));
});

// JSON as before, or multipart (D36): the same JSON in an "expense" field plus
// an optional "receipt" file.
function expenseJson(req: Request): unknown {
  if (!req.is("multipart/form-data")) return req.body;
  const raw = req.body?.expense;
  if (typeof raw !== "string") throw new HttpError(400, 'Send the expense as JSON in a field named "expense"');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'The "expense" field must be valid JSON');
  }
}

// Members only, like everything under the group, and also for a deleted
// expense, whose feed entry still describes it. Never a public static file.
expensesRouter.get("/:expenseId/receipt", async (req, res) => {
  const receipt = await getReceipt(req.groupId!, req.params.expenseId);
  res.set({
    "Content-Type": receipt.mime,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(receipt.name)}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-cache",
  });
  res.sendFile(receipt.file, (err) => {
    if (!err || res.headersSent) return;
    const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
    for (const h of ["Content-Disposition", "Content-Type", "Cache-Control"]) res.removeHeader(h);
    res.status(missing ? 404 : 500).json({ error: missing ? "Receipt file is missing" : "Internal server error" });
  });
});

expensesRouter.get("/:expenseId", async (req, res) => {
  res.json({ expense: await getExpense(req.groupId!, req.params.expenseId) });
});

expensesRouter.post("/", receiptUpload, async (req, res) => {
  const body = expenseBody.parse(expenseJson(req));
  const { result, ledgerVersion } = await withStoredReceipt(req.file, (receipt) =>
    createExpense(req.groupId!, req.userId!, body, receipt),
  );
  res.status(201).json({ expense: result, ledgerVersion });
});

expensesRouter.put("/:expenseId", receiptUpload, async (req, res) => {
  const { version, removeReceipt, ...body } = updateBody.parse(expenseJson(req));
  if (req.file && removeReceipt) throw new HttpError(400, "Either replace the receipt or remove it, not both");
  const expenseId = req.params.expenseId as string;
  const { result, ledgerVersion } = await withStoredReceipt(req.file, (receipt) =>
    updateExpense(
      req.groupId!,
      expenseId,
      req.userId!,
      version,
      body,
      receipt ? { kind: "replace", receipt } : removeReceipt ? { kind: "remove" } : { kind: "keep" },
    ),
  );
  res.json({ expense: result, ledgerVersion });
});

expensesRouter.delete("/:expenseId", async (req, res) => {
  const { ledgerVersion } = await deleteExpense(req.groupId!, req.params.expenseId, req.userId!);
  res.json({ ledgerVersion });
});
