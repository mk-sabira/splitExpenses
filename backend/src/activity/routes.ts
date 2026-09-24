import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware";
import { requireMember } from "../groups/access";
import { listActivity } from "./service";

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.string().min(1).max(64).optional(),
});

// Mounted at /api/groups/:groupId/activity
export const activityRouter = Router({ mergeParams: true });
activityRouter.use(requireAuth, requireMember);

activityRouter.get("/", async (req, res) => {
  res.json(await listActivity(req.groupId!, listQuery.parse(req.query)));
});
