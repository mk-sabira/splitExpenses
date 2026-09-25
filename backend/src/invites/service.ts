import { config } from "../config";
import { prisma } from "../db";
import { logEmails, queueEmail } from "../email/outbox";
import { addMember, newToken } from "../groups/service";
import { withGroupRowLock } from "../ledger/lock";
import { HttpError } from "../lib/errors";
import { publishGroupUpdate } from "../realtime";

export const INVITE_TTL_DAYS = 7;

const inviteLink = (token: string) => `${config.appUrl}/invites/${token}`;

// ---------- invite by email ----------

// Creates the invite, or re-sends it with a fresh token and expiry if this email
// was already invited (the old link stops working).
export async function inviteByEmail(groupId: string, actorId: string, email: string) {
  const { invite, sent } = await withGroupRowLock(groupId, async (tx, group) => {
    if (group.status === "CLOSED") throw new HttpError(409, "This group is closed");
    const alreadyMember = await tx.groupMember.findFirst({
      where: { groupId, user: { email } },
      select: { userId: true },
    });
    if (alreadyMember) throw new HttpError(409, "This person is already a member of the group");

    const fields = {
      token: newToken(),
      invitedById: actorId,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      acceptedAt: null,
    };
    const invite = await tx.groupInvite.upsert({
      where: { groupId_email: { groupId, email } },
      create: { groupId, email, ...fields },
      update: fields,
      include: { group: { select: { name: true } }, invitedBy: { select: { name: true } } },
    });
    await tx.activity.create({
      data: { groupId, actorId, type: "MEMBER_INVITED", data: { email } },
    });
    const sent = await queueEmail(tx, {
      to: email,
      kind: "INVITE",
      subject: `${invite.invitedBy.name} invited you to "${invite.group.name}"`,
      body: [
        `${invite.invitedBy.name} invited you to share expenses in "${invite.group.name}".`,
        ``,
        `Accept the invite: ${inviteLink(invite.token)}`,
        ``,
        `If you don't have an account yet, you can create one with this email address from that page.`,
        `The link expires in ${INVITE_TTL_DAYS} days.`,
      ].join("\n"),
    });
    return { invite, sent };
  });
  logEmails([sent]);
  return { id: invite.id, email: invite.email, expiresAt: invite.expiresAt };
}

async function findInvite(token: string) {
  const invite = await prisma.groupInvite.findUnique({
    where: { token },
    include: {
      group: { select: { id: true, name: true, currency: true, status: true, _count: { select: { members: true } } } },
      invitedBy: { select: { name: true } },
    },
  });
  if (!invite) throw new HttpError(404, "Invite not found");
  return invite;
}

// Public, so the invite page can show what's being accepted before the person
// logs in or registers. A logged-in caller who is already a member also gets
// the group's id, so the page can take them straight in.
export async function previewEmailInvite(token: string, userId?: string) {
  const invite = await findInvite(token);
  const member = userId
    ? (await prisma.groupMember.count({ where: { groupId: invite.group.id, userId } })) > 0
    : false;
  return {
    email: invite.email,
    groupName: invite.group.name,
    currency: invite.group.currency,
    memberCount: invite.group._count.members,
    closed: invite.group.status === "CLOSED",
    invitedBy: invite.invitedBy.name,
    expiresAt: invite.expiresAt,
    expired: invite.expiresAt <= new Date(),
    accepted: invite.acceptedAt !== null,
    alreadyMember: member,
    ...(member && { groupId: invite.group.id }),
  };
}

// The invite is personal: only the account with the invited email can accept it.
// A new user registers with that email first, then accepts.
export async function acceptEmailInvite(token: string, userId: string) {
  const invite = await findInvite(token);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
  if (user.email !== invite.email) {
    throw new HttpError(403, "This invite was sent to a different email address");
  }
  const groupId = invite.group.id;
  const joined = await withGroupRowLock(groupId, async (tx, group) => {
    // Re-read under the lock, so two accepts at once can't both pass the checks.
    const current = await tx.groupInvite.findUniqueOrThrow({ where: { id: invite.id } });
    if (current.acceptedAt === null && current.expiresAt <= new Date()) {
      throw new HttpError(410, "This invite has expired. Ask for a new one.");
    }
    const joined = await addMember(tx, groupId, userId, group.status);
    if (current.acceptedAt === null) {
      await tx.groupInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    }
    return joined;
  });
  if (joined) publishGroupUpdate(groupId, { type: "member.joined", actorId: userId });
  return groupId;
}

// ---------- shareable link ----------

async function findGroupByLink(inviteToken: string) {
  const group = await prisma.group.findUnique({
    where: { inviteToken },
    select: { id: true, name: true, currency: true, status: true, _count: { select: { members: true } } },
  });
  if (!group) throw new HttpError(404, "This invite link is invalid or has been replaced");
  return group;
}

// Public, so the join page can show the group before anyone logs in (D16).
// A logged-in caller who is already a member also gets the group's id, so the
// page can take them straight in.
export async function previewLink(inviteToken: string, userId?: string) {
  const group = await findGroupByLink(inviteToken);
  const member = userId
    ? (await prisma.groupMember.count({ where: { groupId: group.id, userId } })) > 0
    : false;
  return {
    groupName: group.name,
    currency: group.currency,
    memberCount: group._count.members,
    closed: group.status === "CLOSED",
    alreadyMember: member,
    ...(member && { groupId: group.id }),
  };
}

export async function joinByLink(inviteToken: string, userId: string) {
  const { id: groupId } = await findGroupByLink(inviteToken);
  const joined = await withGroupRowLock(groupId, async (tx, group) => {
    // The link may have been regenerated while we waited for the lock.
    const stillValid = await tx.group.count({ where: { id: groupId, inviteToken } });
    if (!stillValid) throw new HttpError(404, "This invite link is invalid or has been replaced");
    return addMember(tx, groupId, userId, group.status);
  });
  if (joined) publishGroupUpdate(groupId, { type: "member.joined", actorId: userId });
  return groupId;
}
