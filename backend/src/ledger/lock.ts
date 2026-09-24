import type { GroupStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { HttpError } from "../lib/errors";
import { computeBalances } from "./balances";

const TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 };

// Locks the group row until the transaction ends (D4). Every write that must be
// ordered against money writes takes this lock: expense changes, but also
// settings, close/reopen and joins, so e.g. a currency change can't race the
// group's first expense.
export async function lockGroup(tx: Prisma.TransactionClient, groupId: string) {
  const rows = await tx.$queryRaw<{ status: GroupStatus }[]>`
    SELECT status FROM "Group" WHERE id = ${groupId} FOR UPDATE`;
  if (rows.length === 0) throw new HttpError(404, "Group not found");
  return rows[0];
}

// A write that must hold the group lock but doesn't change any money.
export function withGroupRowLock<T>(
  groupId: string,
  fn: (tx: Prisma.TransactionClient, group: { status: GroupStatus }) => Promise<T>,
): Promise<T> {
  // Waiting for the row lock counts toward the timeout, so allow for a queue.
  return prisma.$transaction(async (tx) => fn(tx, await lockGroup(tx, groupId)), TX_OPTIONS);
}

// Runs a money-changing write for one group (D4):
// 1. locks the group row, so writes to the same group run one at a time;
// 2. runs `fn`;
// 3. bumps ledgerVersion so clients can drop stale real-time updates;
// 4. updates each member's owingSince reminder bookkeeping (D7).
// Everything happens in one transaction; if any step throws, nothing is saved.
export async function withGroupLock<T>(
  groupId: string,
  fn: (tx: Prisma.TransactionClient, group: { status: GroupStatus }) => Promise<T>,
): Promise<{ result: T; ledgerVersion: number }> {
  return prisma.$transaction(async (tx) => {
    const result = await fn(tx, await lockGroup(tx, groupId));
    const { ledgerVersion } = await tx.group.update({
      where: { id: groupId },
      data: { ledgerVersion: { increment: 1 } },
      select: { ledgerVersion: true },
    });
    await syncOwingSince(tx, groupId);
    return { result, ledgerVersion };
  }, TX_OPTIONS);
}

// owingSince is set when a member's balance goes negative and cleared when it
// returns to zero or above (D7).
async function syncOwingSince(tx: Prisma.TransactionClient, groupId: string) {
  const [balances, members] = await Promise.all([
    computeBalances(tx, groupId),
    tx.groupMember.findMany({ where: { groupId }, select: { userId: true, owingSince: true } }),
  ]);
  const net = new Map(balances.map((b) => [b.userId, b.net]));
  const now = new Date();
  for (const m of members) {
    const owes = (net.get(m.userId) ?? 0) < 0;
    if (owes === (m.owingSince !== null)) continue;
    await tx.groupMember.update({
      where: { groupId_userId: { groupId, userId: m.userId } },
      data: { owingSince: owes ? now : null },
    });
  }
}
