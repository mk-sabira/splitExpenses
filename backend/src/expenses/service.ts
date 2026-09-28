import type { Category, Expense, ExpenseSplit, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { withGroupLock } from "../ledger/lock";
import { HttpError } from "../lib/errors";
import { notifyExpenseChange } from "../notifications/service";
import { publishGroupUpdate, publishNotifications } from "../realtime";
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

// Live expenses, newest first by the expense's date, then by when it was
// recorded (D35). Keyset-paged on (date, createdAt, id) like the activity feed
// (D22); `before` is the id of the last expense on the previous page. A cursor
// expense deleted in between still works, so paging carries on past it.
export async function listExpenses(groupId: string, opts: { limit: number; before?: string }) {
  let where: Prisma.ExpenseWhereInput = { groupId, deletedAt: null };
  if (opts.before) {
    const c = await prisma.expense.findFirst({
      where: { id: opts.before, groupId },
      select: { id: true, date: true, createdAt: true },
    });
    if (!c) throw new HttpError(400, "Invalid cursor");
    where = {
      groupId,
      deletedAt: null,
      OR: [
        { date: { lt: c.date } },
        { date: c.date, createdAt: { lt: c.createdAt } },
        { date: c.date, createdAt: c.createdAt, id: { lt: c.id } },
      ],
    };
  }
  const rows = await prisma.expense.findMany({
    where,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
    include: withSplits,
  });
  const page = rows.slice(0, opts.limit);
  return {
    expenses: page.map(serializeExpense),
    nextCursor: rows.length > opts.limit ? page[page.length - 1].id : null,
  };
}

export async function getExpense(groupId: string, expenseId: string) {
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, groupId, deletedAt: null },
    include: withSplits,
  });
  if (!expense) throw new HttpError(404, "Expense not found");
  return serializeExpense(expense);
}

export async function createExpense(groupId: string, actorId: string, input: ExpenseInput) {
  const saved = await withGroupLock(groupId, async (tx, group) => {
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
    const notified = await notifyExpenseChange(tx, { groupId, actorId, type: "EXPENSE_ADDED", before: null, after });
    return { expense: after, notified };
  });
  publishGroupUpdate(groupId, { type: "expense.created", id: saved.result.expense.id, actorId });
  publishNotifications(saved.result.notified);
  return { result: saved.result.expense, ledgerVersion: saved.ledgerVersion };
}

// Full replacement of the expense. `version` must match the stored one (D10).
export async function updateExpense(
  groupId: string,
  expenseId: string,
  actorId: string,
  version: number,
  input: ExpenseInput,
) {
  const saved = await withGroupLock(groupId, async (tx, group) => {
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
    const notified = await notifyExpenseChange(tx, { groupId, actorId, type: "EXPENSE_UPDATED", before, after });
    return { expense: after, notified };
  });
  publishGroupUpdate(groupId, { type: "expense.updated", id: expenseId, actorId });
  publishNotifications(saved.result.notified);
  return { result: saved.result.expense, ledgerVersion: saved.ledgerVersion };
}

// Soft delete (D9): the row stays for history but no longer counts toward balances.
export async function deleteExpense(groupId: string, expenseId: string, actorId: string) {
  const saved = await withGroupLock(groupId, async (tx, group) => {
    assertOpen(group.status);
    const current = await findLive(tx, groupId, expenseId);
    await tx.expense.update({ where: { id: expenseId }, data: { deletedAt: new Date() } });
    const before = serializeExpense(current);
    await tx.activity.create({
      data: { groupId, actorId, type: "EXPENSE_DELETED", data: before },
    });
    return notifyExpenseChange(tx, { groupId, actorId, type: "EXPENSE_DELETED", before, after: null });
  });
  publishGroupUpdate(groupId, { type: "expense.deleted", id: expenseId, actorId });
  publishNotifications(saved.result);
  return { ledgerVersion: saved.ledgerVersion };
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
