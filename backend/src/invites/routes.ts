import { Router, type Request } from "express";
import { optionalAuth, requireAuth } from "../auth/middleware";
import { getGroup } from "../groups/service";
import { acceptEmailInvite, joinByLink, previewEmailInvite, previewLink } from "./service";

// Express's typings lose the `:token` param type when middleware sits in front of
// the handler; the route pattern guarantees a single string.
const token = (req: Request) => req.params.token as string;

export const invitesRouter = Router();

// Shareable group link: /join/:token in the frontend.
invitesRouter.get("/link/:token", optionalAuth, async (req, res) => {
  res.json(await previewLink(token(req), req.userId));
});

invitesRouter.post("/link/:token/join", requireAuth, async (req, res) => {
  const groupId = await joinByLink(token(req), req.userId!);
  res.json({ group: await getGroup(groupId) });
});

// Personal email invite: /invites/:token in the frontend.
invitesRouter.get("/email/:token", optionalAuth, async (req, res) => {
  res.json(await previewEmailInvite(token(req), req.userId));
});

invitesRouter.post("/email/:token/accept", requireAuth, async (req, res) => {
  const groupId = await acceptEmailInvite(token(req), req.userId!);
  res.json({ group: await getGroup(groupId) });
});
