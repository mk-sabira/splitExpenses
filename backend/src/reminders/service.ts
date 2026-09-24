import type { Prisma } from "@prisma/client";
import { config } from "../config";
import { prisma } from "../db";
import { logEmails, queueEmail, type Email } from "../email/outbox";
import { computeBalances } from "../ledger/balances";
import { withGroupRowLock } from "../ledger/lock";
import { settle } from "../ledger/settlement";
import { formatMoney } from "../lib/money";

const DAY_MS = 24 * 60 * 60 * 1000;
// Hard floor between two reminders to the same member of the same group (D19).
export const MIN_REMINDER_GAP_DAYS = 7;

interface ReminderState {
  owingSince: Date | null;
  lastRemindedAt: Date | null;
}

// A debtor is reminded once they've owed for `reminderDays`, then every
// `reminderDays` again, but never twice within MIN_REMINDER_GAP_DAYS (D19).
export function isReminderDue(m: ReminderState, reminderDays: number, now: Date): boolean {
  if (m.owingSince === null) return false;
  if (now.getTime() < m.owingSince.getTime() + reminderDays * DAY_MS) return false;
  if (m.lastRemindedAt === null) return true;
  const gapDays = Math.max(reminderDays, MIN_REMINDER_GAP_DAYS);
  return now.getTime() >= m.lastRemindedAt.getTime() + gapDays * DAY_MS;
}

// Sends every reminder that is due at `now`. Candidates are found without a
// lock, then each group is re-checked under its row lock (D4) before anything
// is sent. A debt settled in the meantime has had owingSince cleared by that
// same lock's holder, and two overlapping runs can't both remind one debtor.
// `groupIds` limits the run to those groups; tests use it so they don't touch
// other files' data in the shared dev database.
export async function sendDueReminders(
  now: Date = new Date(),
  opts: { groupIds?: string[] } = {},
): Promise<Email[]> {
  const candidates = await prisma.groupMember.findMany({
    where: {
      ...(opts.groupIds && { groupId: { in: opts.groupIds } }),
      owingSince: { not: null, lte: new Date(now.getTime() - DAY_MS) }, // reminderDays ≥ 1
      OR: [
        { lastRemindedAt: null },
        { lastRemindedAt: { lte: new Date(now.getTime() - MIN_REMINDER_GAP_DAYS * DAY_MS) } },
      ],
    },
    select: { groupId: true },
    distinct: ["groupId"],
  });

  const sent: Email[] = [];
  for (const { groupId } of candidates) {
    try {
      const emails = await withGroupRowLock(groupId, (tx) => remindGroup(tx, groupId, now));
      logEmails(emails);
      sent.push(...emails);
    } catch (err) {
      // One broken group mustn't stop the others; it's retried on the next run.
      console.error(`[reminders] group ${groupId} failed:`, err);
    }
  }
  return sent;
}

async function remindGroup(tx: Prisma.TransactionClient, groupId: string, now: Date): Promise<Email[]> {
  const [group, members, balances, pending] = await Promise.all([
    tx.group.findUniqueOrThrow({
      where: { id: groupId },
      select: { name: true, currency: true, reminderDays: true },
    }),
    tx.groupMember.findMany({
      where: { groupId },
      include: { user: { select: { name: true, email: true } } },
    }),
    computeBalances(tx, groupId),
    tx.payment.groupBy({ by: ["fromUserId"], where: { groupId, status: "PENDING" }, _sum: { amount: true } }),
  ]);
  const net = new Map(balances.map((b) => [b.userId, b.net]));
  const awaiting = new Map(pending.map((p) => [p.fromUserId, p._sum.amount ?? 0]));
  const name = new Map(members.map((m) => [m.userId, m.user.name]));
  const money = (n: number) => formatMoney(n, group.currency);
  const { transfers } = settle(balances);

  const emails: Email[] = [];
  for (const m of members) {
    if (!isReminderDue(m, group.reminderDays, now)) continue;
    const owed = -(net.get(m.userId) ?? 0);
    // owingSince is kept in step with balances under this lock, so this is a
    // safety net rather than a normal path.
    if (owed <= 0) continue;
    // They've already paid it all; it's the recipient's turn to confirm.
    const waiting = awaiting.get(m.userId) ?? 0;
    if (waiting >= owed) continue;

    const pays = transfers
      .filter((t) => t.fromUserId === m.userId)
      .map((t) => `  Pay ${name.get(t.toUserId)} ${money(t.amount)}`);
    const days = Math.floor((now.getTime() - m.owingSince!.getTime()) / DAY_MS);
    await tx.groupMember.update({
      where: { groupId_userId: { groupId, userId: m.userId } },
      data: { lastRemindedAt: now },
    });
    emails.push(
      await queueEmail(tx, {
        to: m.user.email,
        kind: "DEBT_REMINDER",
        subject: `Reminder: you owe ${money(owed)} in "${group.name}"`,
        body: [
          `Hi ${m.user.name},`,
          ``,
          `You've owed money in "${group.name}" for ${days} day${days === 1 ? "" : "s"}. You currently owe ${money(owed)}.`,
          ...(waiting > 0 ? [`${money(waiting)} of that is in payments awaiting confirmation.`] : []),
          ``,
          `To settle up:`,
          ...pays,
          ``,
          `Record a repayment in the app once you've paid: ${config.appUrl}/groups/${groupId}`,
          `You'll get at most one reminder a week while you owe money in this group.`,
        ].join("\n"),
      }),
    );
  }
  return emails;
}
