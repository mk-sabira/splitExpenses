import { randomBytes } from "node:crypto";
import type { GroupStatus, Prisma } from "@prisma/client";
import { config } from "../config";
import { logEmails, queueEmail } from "../email/outbox";
import { prisma } from "../db";
import { withGroupRowLock } from "../ledger/lock";
import { HttpError } from "../lib/errors";
import { publishGroupUpdate } from "../realtime";
import { closingSummaryEmails } from "./closingSummary";

type Tx = Prisma.TransactionClient;

export function newToken() {
  return randomBytes(24).toString("base64url");
}

export const joinLink = (inviteToken: string) => `${config.appUrl}/join/${inviteToken}`;

export interface GroupSettings {
  name: string;
  currency: string;
  reminderDays: number;
}

export async function createGroup(userId: string, input: GroupSettings) {
  return prisma.$transaction(async (tx) => {
    const group = await tx.group.create({
      data: {
        ...input,
        inviteToken: newToken(),
        createdById: userId,
        members: { create: { userId, role: "OWNER" } },
      },
    });
    await tx.activity.create({
      data: { groupId: group.id, actorId: userId, type: "GROUP_CREATED", data: { ...input } },
    });
    return group.id;
  });
}

export async function listGroups(userId: string) {
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    orderBy: { joinedAt: "desc" },
    include: { group: { include: { _count: { select: { members: true } } } } },
  });
  return memberships.map(({ role, group }) => ({
    id: group.id,
    name: group.name,
    currency: group.currency,
    status: group.status,
    closedAt: group.closedAt,
    reminderDays: group.reminderDays,
    memberCount: group._count.members,
    myRole: role,
    createdAt: group.createdAt,
  }));
}

export async function getGroup(groupId: string) {
  const [group, currencyLocked] = await Promise.all([
    prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      include: {
        members: {
          orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
          include: { user: { select: { name: true, email: true } } },
        },
        invites: {
          where: { acceptedAt: null, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: "asc" },
          select: { id: true, email: true, expiresAt: true, invitedById: true, createdAt: true },
        },
      },
    }),
    hasLedgerEntries(prisma, groupId),
  ]);
  return {
    id: group.id,
    name: group.name,
    currency: group.currency,
    currencyLocked,
    reminderDays: group.reminderDays,
    status: group.status,
    closedAt: group.closedAt,
    ledgerVersion: group.ledgerVersion,
    createdById: group.createdById,
    createdAt: group.createdAt,
    inviteLink: joinLink(group.inviteToken),
    inviteToken: group.inviteToken,
    members: group.members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      joinedAt: m.joinedAt,
    })),
    pendingInvites: group.invites,
  };
}

// The currency is locked once any amount has been recorded in it, including
// deleted expenses (their history is still shown) and payments of any status.
function hasLedgerEntries(db: Tx, groupId: string) {
  return Promise.all([
    db.expense.count({ where: { groupId }, take: 1 }),
    db.payment.count({ where: { groupId }, take: 1 }),
  ]).then(([expenses, payments]) => expenses + payments > 0);
}

export async function updateSettings(groupId: string, actorId: string, patch: Partial<GroupSettings>) {
  const changed = await withGroupRowLock(groupId, async (tx) => {
    const current = await tx.group.findUniqueOrThrow({
      where: { id: groupId },
      select: { name: true, currency: true, reminderDays: true },
    });
    const next = { ...current, ...patch };
    if (next.currency !== current.currency && (await hasLedgerEntries(tx, groupId))) {
      throw new HttpError(409, "The currency can't be changed once the group has expenses or payments");
    }
    const changed = (Object.keys(current) as (keyof GroupSettings)[]).some((k) => next[k] !== current[k]);
    if (changed) {
      await tx.group.update({ where: { id: groupId }, data: next });
      await tx.activity.create({
        data: {
          groupId,
          actorId,
          type: "GROUP_SETTINGS_UPDATED",
          data: { before: current, after: next },
        },
      });
    }
    return changed;
  });
  if (changed) publishGroupUpdate(groupId, { type: "group.settings_updated", actorId });
}

// Closing only blocks expense changes; repayments and reminders carry on (D8).
// Closing emails every member a summary with the settlement plan.
export async function setStatus(groupId: string, actorId: string, status: GroupStatus) {
  const emails = await withGroupRowLock(groupId, async (tx, group) => {
    if (group.status === status) {
      throw new HttpError(409, status === "CLOSED" ? "The group is already closed" : "The group is already open");
    }
    await tx.group.update({
      where: { id: groupId },
      data: { status, closedAt: status === "CLOSED" ? new Date() : null },
    });
    await tx.activity.create({
      data: {
        groupId,
        actorId,
        type: status === "CLOSED" ? "GROUP_CLOSED" : "GROUP_REOPENED",
        data: {},
      },
    });
    if (status === "OPEN") return [];
    const emails = await closingSummaryEmails(tx, groupId, actorId);
    for (const email of emails) await queueEmail(tx, email);
    return emails;
  });
  logEmails(emails);
  publishGroupUpdate(groupId, { type: status === "CLOSED" ? "group.closed" : "group.reopened", actorId });
}

// Replaces the shareable link; the old one stops working immediately.
export async function regenerateInviteLink(groupId: string) {
  const { inviteToken } = await prisma.group.update({
    where: { id: groupId },
    data: { inviteToken: newToken() },
    select: { inviteToken: true },
  });
  return { inviteToken, inviteLink: joinLink(inviteToken) };
}

// Adds a member inside a transaction that already holds the group lock.
// Returns false if they were already a member, so joins are idempotent.
export async function addMember(tx: Tx, groupId: string, userId: string, status: GroupStatus) {
  const existing = await tx.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (existing) return false;
  if (status === "CLOSED") throw new HttpError(409, "This group is closed and can't take new members");
  await tx.groupMember.create({ data: { groupId, userId, role: "MEMBER" } });
  await tx.activity.create({
    data: { groupId, actorId: userId, type: "MEMBER_JOINED", data: {} },
  });
  return true;
}
