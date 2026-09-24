import type { RequestHandler } from "express";
import { prisma } from "../db";
import { HttpError } from "../lib/errors";

declare global {
  namespace Express {
    interface Request {
      groupId?: string;
    }
  }
}

// For routes under /api/groups/:groupId. Must run after requireAuth.
// Non-members get the same 404 as a missing group, so group ids can't be probed.
export const requireMember: RequestHandler<{ groupId: string }> = async (req, _res, next) => {
  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: req.params.groupId, userId: req.userId! } },
    select: { groupId: true },
  });
  if (!member) throw new HttpError(404, "Group not found");
  req.groupId = req.params.groupId;
  next();
};
