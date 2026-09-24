import type { Category, Expense, ExpenseSplit, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { withGroupLock } from "../ledger/lock";
import { HttpError } from "../lib/errors";
import { participantIds, resolveSplit, type SplitInput } from "./split";

export interface ExpenseInput {
  paidById: string;
  amount: number;
  description: string;
  category: Category;
  date: string; // YYYY-MM-DD
  comment?: string | null;
  split: SplitInput;
}

type Tx = Prisma.TransactionClient;
type ExpenseWithSplits = Expense & { splits: ExpenseSplit[] };

const withSplits = { splits: { orderBy: { userId: "asc" } } } as const;

// The API shape, also stored as the Activity snapshot (D9), so it must be plain JSON.
export function serializeExpense(e: ExpenseWithSplits) {
  return {
    id: e.id,
    groupId: e.groupId,
    paidById: e.paidById,
    amount: e.amount,
    description: e.description,
    category: e.category,
    date: e.date.toISOString().slice(0, 10),
    comment: e.comment,
    splitType: e.splitType,
    version: e.version,
    createdById: e.createdById,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    splits: e.splits.map((s) => ({ userId: s.userId, shares: s.shares, amount: s.amount })),
  };
}

export type SerializedExpense = ReturnType<typeof serializeExpense>;

export async function listExpenses(groupId: string) {
  const expenses = await prisma.expense.findMany({
    where: { groupId, deletedAt: null },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: withSplits,
  });
  return expenses.map(serializeExpense);
}

export async function getExpense(groupId: string, expenseId: string) {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, groupId, deletedAt: null },
    include: withSplits,
  });
  if (!expense) throw new HttpError(404, "Expense not found");
  return serializeExpense(expense);
}

export function createExpense(groupId: string, actorId: string, input: ExpenseInput) {
  return withGroupLock(groupId, async (tx, group) => {
    assertOpen(group.status);
    const splits = await resolveForGroup(tx, groupId, input);
    const expense = await tx.expense.create({
      data: {
        groupId,
        createdById: actorId,
        ...expenseFields(input),
        splits: { create: splits },
      },
      include: withSplits,
    });
    const after = serializeExpense(expense);
    await tx.activity.create({
      data: { groupId, actorId, type: "EXPENSE_CREATED", data: after },
    });
    return after;
  });
}

// Full replacement of the expense. `version` must match the stored one (D10).
export function updateExpense(
  groupId: string,
  expenseId: string,
  actorId: string,
  version: number,
  input: ExpenseInput,
) {
  return withGroupLock(groupId, async (tx, group) => {
    assertOpen(group.status);
    const current = await findLive(tx, groupId, expenseId);
    if (current.version !== version) {
      throw new HttpError(409, "This expense was changed by someone else. Reload and try again.");
    }
    const splits = await resolveForGroup(tx, groupId, input);
    await tx.expenseSplit.deleteMany({ where: { expenseId } });
    const expense = await tx.expense.update({
      where: { id: expenseId },
      data: {
        ...expenseFields(input),
        version: { increment: 1 },
        splits: { create: splits },
      },
      include: withSplits,
    });
    const before = serializeExpense(current);
    const after = serializeExpense(expense);
    await tx.activity.create({
      data: { groupId, actorId, type: "EXPENSE_UPDATED", data: { before, after } },
    });
    return after;
  });
}

// Soft delete (D9): the row stays for history but no longer counts toward balances.
export function deleteExpense(groupId: string, expenseId: string, actorId: string) {
  return withGroupLock(groupId, async (tx, group) => {
    assertOpen(group.status);
    const current = await findLive(tx, groupId, expenseId);
    await tx.expense.update({ where: { id: expenseId }, data: { deletedAt: new Date() } });
    await tx.activity.create({
      data: { groupId, actorId, type: "EXPENSE_DELETED", data: serializeExpense(current) },
    });
  });
}

function assertOpen(status: string) {
  // Closing a group blocks expense changes, but not repayments (D8).
  if (status === "CLOSED") throw new HttpError(409, "This group is closed");
}

async function findLive(tx: Tx, groupId: string, expenseId: string) {
  const expense = await tx.expense.findFirst({
    where: { id: expenseId, groupId, deletedAt: null },
    include: withSplits,
  });
  if (!expense) throw new HttpError(404, "Expense not found");
  return expense;
}

// Checks the payer and participants are members, then resolves the split amounts.
// Runs inside the group lock so the member list can't change mid-write.
async function resolveForGroup(tx: Tx, groupId: string, input: ExpenseInput) {
  const members = await tx.groupMember.findMany({
    where: { groupId },
    orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
    select: { userId: true },
  });
  const joinOrder = members.map((m) => m.userId);
  const memberIds = new Set(joinOrder);
  for (const userId of [input.paidById, ...participantIds(input.split)]) {
    if (!memberIds.has(userId)) {
      throw new HttpError(400, `User ${userId} is not a member of this group`);
    }
  }
  return resolveSplit(input.amount, input.split, joinOrder);
}

function expenseFields(input: ExpenseInput) {
  return {
    paidById: input.paidById,
    amount: input.amount,
    description: input.description,
    category: input.category,
    date: new Date(`${input.date}T00:00:00Z`),
    comment: input.comment ?? null,
    splitType: input.split.type,
  };
}
