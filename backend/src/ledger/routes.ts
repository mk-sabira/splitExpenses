import { Router } from "express";
import { requireAuth } from "../auth/middleware";
import { prisma } from "../db";
import { requireMember } from "../groups/access";
import { computeBalances } from "./balances";

export const balancesRouter = Router({ mergeParams: true });
balancesRouter.use(requireAuth, requireMember);

// Balances and ledgerVersion are read from one snapshot, so they always match.
balancesRouter.get("/", async (req, res) => {
  const groupId = req.groupId!;
  const body = await prisma.$transaction(
    async (tx) => {
      const group = await tx.group.findUniqueOrThrow({
        where: { id: groupId },
        select: { ledgerVersion: true, currency: true },
      });
      return { ...group, balances: await computeBalances(tx, groupId) };
    },
    { isolationLevel: "RepeatableRead" },
  );
  res.json(body);
});
