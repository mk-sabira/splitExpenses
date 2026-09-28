import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware";
import { inviteByEmail } from "../invites/service";
import { requireMember, requireOwner } from "./access";
import {
  createGroup,
  getGroup,
  listGroups,
  regenerateInviteLink,
  setStatus,
  updateSettings,
} from "./service";

const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

const name = z.string().trim().min(1).max(100);
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => CURRENCIES.has(c), "Unknown ISO 4217 currency code");
const reminderDays = z.number().int().min(1).max(365);

const createBody = z.object({ name, currency, reminderDays: reminderDays.default(7) });

const settingsBody = z
  .object({ name, currency, reminderDays })
  .partial()
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");

const inviteBody = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)) });

export const groupsRouter = Router();
groupsRouter.use(requireAuth);

groupsRouter.post("/", async (req, res) => {
  const groupId = await createGroup(req.userId!, createBody.parse(req.body));
  res.status(201).json({ group: await getGroup(groupId) });
});

groupsRouter.get("/", async (req, res) => {
  res.json(await listGroups(req.userId!));
});

groupsRouter.get("/:groupId", requireMember, async (req, res) => {
  res.json({ group: await getGroup(req.groupId!) });
});

groupsRouter.put("/:groupId/settings", requireMember, requireOwner, async (req, res) => {
  await updateSettings(req.groupId!, req.userId!, settingsBody.parse(req.body));
  res.json({ group: await getGroup(req.groupId!) });
});

groupsRouter.post("/:groupId/close", requireMember, requireOwner, async (req, res) => {
  await setStatus(req.groupId!, req.userId!, "CLOSED");
  res.json({ group: await getGroup(req.groupId!) });
});

groupsRouter.post("/:groupId/reopen", requireMember, requireOwner, async (req, res) => {
  await setStatus(req.groupId!, req.userId!, "OPEN");
  res.json({ group: await getGroup(req.groupId!) });
});

groupsRouter.post("/:groupId/invite-link", requireMember, requireOwner, async (req, res) => {
  res.json(await regenerateInviteLink(req.groupId!));
});

// Any member can invite.
groupsRouter.post("/:groupId/invites", requireMember, async (req, res) => {
  const { email } = inviteBody.parse(req.body);
  res.status(201).json({ invite: await inviteByEmail(req.groupId!, req.userId!, email) });
});
