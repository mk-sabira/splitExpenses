import type { Prisma } from "@prisma/client";

type Db = Prisma.TransactionClient;

export interface MemberBalance {
  userId: string;
  net: number; // minor units; > 0 means the group owes them, < 0 means they owe
}

// Net balance per user, derived from the records every time (D3):
//   paid − owed + confirmed payments sent − confirmed payments received
// Deleted expenses and unconfirmed payments are ignored. Current members are
// always listed (possibly with 0); anyone else with a non-zero balance is too.
export async function computeBalances(db: Db, groupId: string): Promise<MemberBalance[]> {
  const liveExpense = { groupId, deletedAt: null };
  const confirmed = { groupId, status: "CONFIRMED" as const };

  const [members, paid, owed, sent, received] = await Promise.all([
    db.groupMember.findMany({
      where: { groupId },
      orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
      select: { userId: true },
    }),
    db.expense.groupBy({ by: ["paidById"], where: liveExpense, _sum: { amount: true } }),
    db.expenseSplit.groupBy({
      by: ["userId"],
      where: { expense: liveExpense },
      _sum: { amount: true },
    }),
    db.payment.groupBy({ by: ["fromUserId"], where: confirmed, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["toUserId"], where: confirmed, _sum: { amount: true } }),
  ]);

  const net = new Map<string, number>(members.map((m) => [m.userId, 0]));
  const add = (userId: string, amount: number | null) =>
    net.set(userId, (net.get(userId) ?? 0) + (amount ?? 0));

  for (const row of paid) add(row.paidById, row._sum.amount);
  for (const row of owed) add(row.userId, -(row._sum.amount ?? 0));
  for (const row of sent) add(row.fromUserId, row._sum.amount);
  for (const row of received) add(row.toUserId, -(row._sum.amount ?? 0));

  const memberIds = new Set(members.map((m) => m.userId));
  return [...net]
    .filter(([userId, amount]) => memberIds.has(userId) || amount !== 0)
    .map(([userId, amount]) => ({ userId, net: amount }));
}

// One user's net balance in every group they belong to, in a single query:
// the same formula as computeBalances, restricted to that user and grouped by
// group. Used by the groups list and the combined totals (D34), in place of one
// balances request per group.
export async function computeMyNets(db: Db, userId: string): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ groupId: string; net: bigint }[]>`
    SELECT m."groupId", COALESCE(SUM(t.v), 0)::bigint AS net
    FROM "GroupMember" m
    LEFT JOIN (
      SELECT e."groupId", e.amount::bigint AS v
        FROM "Expense" e WHERE e."paidById" = ${userId} AND e."deletedAt" IS NULL
      UNION ALL
      SELECT e."groupId", -s.amount::bigint
        FROM "ExpenseSplit" s JOIN "Expense" e ON e.id = s."expenseId"
        WHERE s."userId" = ${userId} AND e."deletedAt" IS NULL
      UNION ALL
      SELECT p."groupId", p.amount::bigint
        FROM "Payment" p WHERE p."fromUserId" = ${userId} AND p.status = 'CONFIRMED'
      UNION ALL
      SELECT p."groupId", -p.amount::bigint
        FROM "Payment" p WHERE p."toUserId" = ${userId} AND p.status = 'CONFIRMED'
    ) t ON t."groupId" = m."groupId"
    WHERE m."userId" = ${userId}
    GROUP BY m."groupId"`;
  return new Map(rows.map((r) => [r.groupId, Number(r.net)]));
}
