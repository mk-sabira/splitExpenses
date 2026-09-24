import { Category } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware";
import { requireMember } from "../groups/access";
import { createExpense, deleteExpense, getExpense, listExpenses, updateExpense } from "./service";

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

const updateBody = expenseBody.extend({ version: z.number().int().positive() });

export const expensesRouter = Router({ mergeParams: true });
expensesRouter.use(requireAuth, requireMember);

expensesRouter.get("/", async (req, res) => {
  res.json({ expenses: await listExpenses(req.groupId!) });
});

expensesRouter.get("/:expenseId", async (req, res) => {
  res.json({ expense: await getExpense(req.groupId!, req.params.expenseId) });
});

expensesRouter.post("/", async (req, res) => {
  const body = expenseBody.parse(req.body);
  const { result, ledgerVersion } = await createExpense(req.groupId!, req.userId!, body);
  res.status(201).json({ expense: result, ledgerVersion });
});

expensesRouter.put("/:expenseId", async (req, res) => {
  const { version, ...body } = updateBody.parse(req.body);
  const { result, ledgerVersion } = await updateExpense(
    req.groupId!,
    req.params.expenseId,
    req.userId!,
    version,
    body,
  );
  res.json({ expense: result, ledgerVersion });
});

expensesRouter.delete("/:expenseId", async (req, res) => {
  const { ledgerVersion } = await deleteExpense(req.groupId!, req.params.expenseId, req.userId!);
  res.json({ ledgerVersion });
});
