import type { Prisma } from "@prisma/client";
import type { Email } from "../email/outbox";
import { computeBalances } from "../ledger/balances";
import { settle } from "../ledger/settlement";
import { formatMoney } from "../lib/money";

// One summary email per member when a group is closed: final balances, the
// settlement plan, and what it means for that person. Built inside the closing
// transaction, so it reflects exactly the balances at the moment of closing.
export async function closingSummaryEmails(
  tx: Prisma.TransactionClient,
  groupId: string,
  actorId: string,
): Promise<Email[]> {
  const [group, members, balances] = await Promise.all([
    tx.group.findUniqueOrThrow({ where: { id: groupId }, select: { name: true, currency: true } }),
    tx.groupMember.findMany({
      where: { groupId },
      orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
      include: { user: { select: { name: true, email: true } } },
    }),
    computeBalances(tx, groupId),
  ]);
  const { transfers } = settle(balances);
  const name = new Map(members.map((m) => [m.userId, m.user.name]));
  const money = (n: number) => formatMoney(n, group.currency);
  const net = new Map(balances.map((b) => [b.userId, b.net]));

  const balanceLines = members.map((m) => {
    const n = net.get(m.userId) ?? 0;
    const state = n > 0 ? `is owed ${money(n)}` : n < 0 ? `owes ${money(-n)}` : "is settled up";
    return `  ${m.user.name} ${state}`;
  });
  const planLines =
    transfers.length === 0
      ? ["  Everyone is settled up. Nothing left to pay."]
      : transfers.map((t) => `  ${name.get(t.fromUserId)} pays ${name.get(t.toUserId)} ${money(t.amount)}`);

  return members.map((m) => {
    const pays = transfers.filter((t) => t.fromUserId === m.userId);
    const gets = transfers.filter((t) => t.toUserId === m.userId);
    const personal = [
      ...pays.map((t) => `You pay ${name.get(t.toUserId)} ${money(t.amount)}.`),
      ...gets.map((t) => `${name.get(t.fromUserId)} pays you ${money(t.amount)}.`),
    ];
    return {
      to: m.user.email,
      kind: "GROUP_CLOSED_SUMMARY" as const,
      subject: `"${group.name}" was closed: final summary`,
      body: [
        `${name.get(actorId)} closed "${group.name}".`,
        ``,
        `Final balances:`,
        ...balanceLines,
        ``,
        `To settle up:`,
        ...planLines,
        ``,
        `For you: ${personal.length > 0 ? personal.join(" ") : "you're settled up."}`,
        ``,
        `The group no longer accepts new expenses, but repayments can still be recorded`,
        `in the app. The recipient confirms each one.`,
      ].join("\n"),
    };
  });
}
