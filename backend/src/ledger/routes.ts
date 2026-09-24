import { Router } from "express";
import { requireAuth } from "../auth/middleware";
import { prisma } from "../db";
import { requireMember } from "../groups/access";
import { computeBalances } from "./balances";
import { settle } from "./settlement";

// Balances, the settlement plan and ledgerVersion are read from one snapshot,
// so they always match each other.
function snapshot(groupId: string) {
  return prisma.$transaction(
    async (tx) => {
      const group = await tx.group.findUniqueOrThrow({
        where: { id: groupId },
        select: { ledgerVersion: true, currency: true },
      });
      return { ...group, balances: await computeBalances(tx, groupId) };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

// Mounted at /api/groups/:groupId/balances
export const balancesRouter = Router({ mergeParams: true });
balancesRouter.use(requireAuth, requireMember);

balancesRouter.get("/", async (req, res) => {
  res.json(await snapshot(req.groupId!));
});

// Mounted at /api/groups/:groupId/settlement
export const settlementRouter = Router({ mergeParams: true });
settlementRouter.use(requireAuth, requireMember);

// The fewest transfers that settle everyone, from current balances (D6).
// Only confirmed payments count; pending ones are listed separately via /payments.
settlementRouter.get("/", async (req, res) => {
  const { balances, ...rest } = await snapshot(req.groupId!);
  res.json({ ...rest, ...settle(balances) });
});
