import type { PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { computeBalances } from "../ledger/balances";
import { withGroupLock, withGroupRowLock } from "../ledger/lock";
import { HttpError } from "../lib/errors";
import { publishGroupUpdate } from "../realtime";
import { formatMoney } from "../lib/money";
import { serializePayment } from "./serialize";

export { serializePayment };

export interface PaymentInput {
  toUserId: string;
  amount: number;
  note?: string | null;
}

// The payer says they've paid; nothing changes until the recipient confirms.
// Allowed in closed groups: debts outlive the group (D8).
//
// A proposal can't exceed what the payer still owes, minus any of their payments
// already awaiting confirmation, which guards against typos and double
// submissions. A balance can still flip later if an expense is edited after a
// confirmed payment; that's intended (D3).
export async function proposePayment(groupId: string, fromUserId: string, input: PaymentInput) {
  const payment = await withGroupRowLock(groupId, async (tx) => {
    if (input.toUserId === fromUserId) throw new HttpError(400, "You can't pay yourself");
    const recipient = await tx.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId: input.toUserId } },
    });
    if (!recipient) throw new HttpError(400, "The recipient isn't a member of this group");

    const [balances, pending, group] = await Promise.all([
      computeBalances(tx, groupId),
      tx.payment.aggregate({
        where: { groupId, fromUserId, status: "PENDING" },
        _sum: { amount: true },
      }),
      tx.group.findUniqueOrThrow({ where: { id: groupId }, select: { currency: true } }),
    ]);
    const owed = -(balances.find((b) => b.userId === fromUserId)?.net ?? 0);
    const awaiting = pending._sum.amount ?? 0;
    if (owed <= 0) throw new HttpError(400, "You don't owe anything in this group");
    if (input.amount > owed - awaiting) {
      const money = (n: number) => formatMoney(n, group.currency);
      throw new HttpError(
        400,
        awaiting > 0
          ? `That's more than you owe: ${money(owed)}, of which ${money(awaiting)} is already awaiting confirmation`
          : `That's more than you owe (${money(owed)})`,
      );
    }

    const payment = await tx.payment.create({
      data: { groupId, fromUserId, ...input, note: input.note ?? null },
    });
    await tx.activity.create({
      data: { groupId, actorId: fromUserId, type: "PAYMENT_CREATED", data: serializePayment(payment) },
    });
    return payment;
  });
  publishGroupUpdate(groupId, { type: "payment.proposed", id: payment.id, actorId: fromUserId });
  return serializePayment(payment);
}

// Payments are addressed by id alone, so check the caller is in the payment's
// group; anyone else gets the same 404 as a missing payment.
async function findVisiblePayment(paymentId: string, userId: string) {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, group: { members: { some: { userId } } } },
  });
  if (!payment) throw new HttpError(404, "Payment not found");
  return payment;
}

const transitions = {
  confirm: { who: "toUserId", status: "CONFIRMED", activity: "PAYMENT_CONFIRMED", change: "payment.confirmed" },
  reject: { who: "toUserId", status: "REJECTED", activity: "PAYMENT_REJECTED", change: "payment.rejected" },
  cancel: { who: "fromUserId", status: "CANCELLED", activity: "PAYMENT_CANCELLED", change: "payment.cancelled" },
} as const;

export type PaymentAction = keyof typeof transitions;

// Only the recipient can confirm or reject; only the payer can cancel.
// Only a PENDING payment can change, so each payment is decided once.
export async function respondToPayment(paymentId: string, userId: string, action: PaymentAction) {
  const t = transitions[action];
  const found = await findVisiblePayment(paymentId, userId);
  if (found[t.who] !== userId) {
    throw new HttpError(
      403,
      t.who === "toUserId"
        ? "Only the recipient can confirm or reject a payment"
        : "Only the payer can cancel a payment",
    );
  }

  const decide = async (tx: Prisma.TransactionClient) => {
    // Re-read under the lock, so a confirm and a reject racing each other can't both win.
    const current = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (current.status !== "PENDING") {
      throw new HttpError(409, `This payment was already ${current.status.toLowerCase()}`);
    }
    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: { status: t.status as PaymentStatus, respondedAt: new Date() },
    });
    await tx.activity.create({
      data: { groupId: found.groupId, actorId: userId, type: t.activity, data: serializePayment(updated) },
    });
    return serializePayment(updated);
  };

  // Only confirming changes balances, so only it is a money write (D4): it bumps
  // ledgerVersion and updates owingSince. Reject and cancel just take the lock.
  const change = { type: t.change, id: paymentId, actorId: userId };
  if (action === "confirm") {
    const { result, ledgerVersion } = await withGroupLock(found.groupId, decide);
    publishGroupUpdate(found.groupId, change);
    return { payment: result, ledgerVersion };
  }
  const payment = await withGroupRowLock(found.groupId, decide);
  publishGroupUpdate(found.groupId, change);
  return { payment };
}

export async function listGroupPayments(groupId: string, status?: PaymentStatus) {
  const payments = await prisma.payment.findMany({
    where: { groupId, status },
    orderBy: { createdAt: "desc" },
  });
  return payments.map(serializePayment);
}

// Pending payments across all groups where the caller is either side:
// incoming ones need their confirmation, outgoing ones are awaiting the other person.
export async function listMyPendingPayments(userId: string) {
  const payments = await prisma.payment.findMany({
    where: {
      status: "PENDING",
      OR: [{ fromUserId: userId }, { toUserId: userId }],
      group: { members: { some: { userId } } },
    },
    orderBy: { createdAt: "desc" },
    include: { group: { select: { name: true, currency: true } } },
  });
  return payments.map((p) => ({
    ...serializePayment(p),
    groupName: p.group.name,
    currency: p.group.currency,
    direction: p.toUserId === userId ? ("incoming" as const) : ("outgoing" as const),
  }));
}
