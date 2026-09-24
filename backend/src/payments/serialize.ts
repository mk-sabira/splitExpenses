import type { Payment } from "@prisma/client";

export function serializePayment(p: Payment) {
  return {
    id: p.id,
    groupId: p.groupId,
    fromUserId: p.fromUserId,
    toUserId: p.toUserId,
    amount: p.amount,
    status: p.status,
    note: p.note,
    createdAt: p.createdAt.toISOString(),
    respondedAt: p.respondedAt?.toISOString() ?? null,
  };
}
