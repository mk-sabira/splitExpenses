import type { Notification, NotificationType, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../lib/errors";
import type { SerializedExpense } from "../expenses/service";

type Tx = Prisma.TransactionClient;

// In-app notifications (D33). A row per recipient, written in the same
// transaction as the change, then pushed to each recipient's socket room
// after commit (see publishNotifications in ../realtime).

export type SerializedNotification = ReturnType<typeof serialize>;

function serialize(n: Notification, group: { id: string; name: string; currency: string } | null) {
  return {
    id: n.id,
    type: n.type,
    group,
    data: n.data,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

const involved = (e: SerializedExpense | null) =>
  e ? [e.paidById, ...e.splits.map((s) => s.userId)] : [];
const shareOf = (e: SerializedExpense | null, userId: string) =>
  e?.splits.find((s) => s.userId === userId)?.amount ?? null;

// Everyone the expense involves, before or after the change: the payer and
// everyone in the split, so someone taken out of an expense by an edit hears
// about it too. Never the person who made the change.
export async function notifyExpenseChange(
  tx: Tx,
  change: {
    groupId: string;
    actorId: string;
    type: Extract<NotificationType, "EXPENSE_ADDED" | "EXPENSE_UPDATED" | "EXPENSE_DELETED">;
    before: SerializedExpense | null;
    after: SerializedExpense | null;
  },
): Promise<{ userId: string; notification: SerializedNotification }[]> {
  const { groupId, actorId, type, before, after } = change;
  const recipients = [...new Set([...involved(before), ...involved(after)])].filter((id) => id !== actorId);
  if (recipients.length === 0) return [];

  const [actor, group] = await Promise.all([
    tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { id: true, name: true } }),
    tx.group.findUniqueOrThrow({ where: { id: groupId }, select: { id: true, name: true, currency: true } }),
  ]);
  const expense = (after ?? before)!;
  const rows = await tx.notification.createManyAndReturn({
    data: recipients.map((userId) => ({
      userId,
      groupId,
      type,
      data: {
        actor,
        expenseId: expense.id,
        description: expense.description,
        amount: expense.amount,
        // The recipient's part of the split (null if they aren't in it, e.g. only paid).
        share: shareOf(after ?? before, userId),
        ...(type === "EXPENSE_UPDATED" && { previousShare: shareOf(before, userId) }),
      },
    })),
  });
  return rows.map((n) => ({ userId: n.userId, notification: serialize(n, group) }));
}

// Newest first, keyset-paged on (createdAt, id) like the activity feed (D22).
export async function listNotifications(userId: string, opts: { limit: number; before?: string }) {
  let where: Prisma.NotificationWhereInput = { userId };
  if (opts.before) {
    const cursor = await prisma.notification.findFirst({
      where: { id: opts.before, userId },
      select: { id: true, createdAt: true },
    });
    if (!cursor) throw new HttpError(400, "Invalid cursor");
    where = {
      userId,
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    };
  }
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: opts.limit + 1,
      include: { group: { select: { id: true, name: true, currency: true } } },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  const page = rows.slice(0, opts.limit);
  return {
    notifications: page.map((n) => serialize(n, n.group)),
    unreadCount,
    nextCursor: rows.length > opts.limit ? page[page.length - 1].id : null,
  };
}

// Marks one notification as read, or all of the caller's when `id` is omitted.
// Someone else's notification looks the same as a missing one.
export async function markRead(userId: string, id?: string) {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(id && { id }) },
    data: { readAt: new Date() },
  });
  if (id && count === 0) {
    const exists = await prisma.notification.findFirst({ where: { id, userId }, select: { id: true } });
    if (!exists) throw new HttpError(404, "Notification not found");
  }
  return { unreadCount: await prisma.notification.count({ where: { userId, readAt: null } }) };
}
