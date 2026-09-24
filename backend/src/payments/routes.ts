import { PaymentStatus } from "@prisma/client";
import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware";
import { requireMember } from "../groups/access";
import {
  listGroupPayments,
  listMyPendingPayments,
  proposePayment,
  respondToPayment,
  type PaymentAction,
} from "./service";

const MAX_AMOUNT = 2_147_483_647;

const paymentBody = z.object({
  toUserId: z.string().min(1).max(64),
  amount: z.number().int().positive().max(MAX_AMOUNT),
  note: z.string().trim().max(500).nullish(),
});

const listQuery = z.object({ status: z.enum(PaymentStatus).optional() });

// Mounted at /api/groups/:groupId/payments
export const groupPaymentsRouter = Router({ mergeParams: true });
groupPaymentsRouter.use(requireAuth, requireMember);

// Every member sees the group's payments: confirmed ones shape everyone's
// balances, and pending ones are visible to both sides (and the rest of the group).
groupPaymentsRouter.get("/", async (req, res) => {
  const { status } = listQuery.parse(req.query);
  res.json({ payments: await listGroupPayments(req.groupId!, status) });
});

groupPaymentsRouter.post("/", async (req, res) => {
  const payment = await proposePayment(req.groupId!, req.userId!, paymentBody.parse(req.body));
  res.status(201).json({ payment });
});

// Mounted at /api/payments
export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

paymentsRouter.get("/pending", async (req, res) => {
  res.json({ payments: await listMyPendingPayments(req.userId!) });
});

// Express's typings lose the `:paymentId` param type when middleware sits in
// front of the handler; the route pattern guarantees a single string.
const paymentId = (req: Request) => req.params.paymentId as string;

for (const action of ["confirm", "reject", "cancel"] satisfies PaymentAction[]) {
  paymentsRouter.post(`/:paymentId/${action}`, async (req, res) => {
    res.json(await respondToPayment(paymentId(req), req.userId!, action));
  });
}
