import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware";
import { publishNotificationsRead } from "../realtime";
import { listNotifications, markRead } from "./service";

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.string().min(1).max(64).optional(),
});

// Mounted at /api/notifications. Always the caller's own.
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get("/", async (req, res) => {
  res.json(await listNotifications(req.userId!, listQuery.parse(req.query)));
});

notificationsRouter.post("/read-all", async (req, res) => {
  const result = await markRead(req.userId!);
  publishNotificationsRead(req.userId!, { id: null, ...result });
  res.json(result);
});

notificationsRouter.post("/:id/read", async (req, res) => {
  const result = await markRead(req.userId!, req.params.id);
  publishNotificationsRead(req.userId!, { id: req.params.id, ...result });
  res.json(result);
});
