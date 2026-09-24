import type { MemberRole } from "@prisma/client";
import type { RequestHandler } from "express";
import { prisma } from "../db";
import { HttpError } from "../lib/errors";

declare global {
  namespace Express {
    interface Request {
      groupId?: string;
      memberRole?: MemberRole;
    }
  }
}

// For routes under /api/groups/:groupId. Must run after requireAuth.
// Non-members get the same 404 as a missing group, so group ids can't be probed.
export const requireMember: RequestHandler<{ groupId: string }> = async (req, _res, next) => {
  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: req.params.groupId, userId: req.userId! } },
    select: { role: true },
  });
  if (!member) throw new HttpError(404, "Group not found");
  req.groupId = req.params.groupId;
  req.memberRole = member.role;
  next();
};

// Must run after requireMember.
export const requireOwner: RequestHandler = (req, _res, next) => {
  if (req.memberRole !== "OWNER") {
    throw new HttpError(403, "Only the group owner can do this");
  }
  next();
};
