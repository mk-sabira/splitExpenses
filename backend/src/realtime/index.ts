import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { verifyToken } from "../auth/tokens";
import { config } from "../config";
import { prisma } from "../db";
import { computeBalances } from "../ledger/balances";
import { settle } from "../ledger/settlement";
import type { SerializedNotification } from "../notifications/service";
import { serializePayment } from "../payments/serialize";

// Real-time sync (D18). Clients connect with their JWT, then join the room of
// each group they're viewing. After every committed change to a group, its
// room receives a "group:update" event with a fresh snapshot of the group's
// balances, settlement plan, status and pending payments.
//
// Every socket also joins its user's own room on connect, authenticated by the
// same handshake. It carries "notification:new" and "notification:read" (D33).

export type ChangeType =
  | "expense.created"
  | "expense.updated"
  | "expense.deleted"
  | "payment.proposed"
  | "payment.confirmed"
  | "payment.rejected"
  | "payment.cancelled"
  | "group.settings_updated"
  | "group.closed"
  | "group.reopened"
  | "member.joined";

export interface Change {
  type: ChangeType;
  id?: string; // the expense or payment that changed
  actorId: string;
}

export const UPDATE_EVENT = "group:update";
export const NOTIFICATION_EVENT = "notification:new";
export const NOTIFICATION_READ_EVENT = "notification:read";
const room = (groupId: string) => `group:${groupId}`;
const userRoom = (userId: string) => `user:${userId}`;

let io: Server | null = null;

export function attachRealtime(httpServer: HttpServer): Server {
  io = new Server(httpServer, { cors: { origin: config.corsOrigin } });

  // Same Bearer JWT as the REST API, sent as { auth: { token } } in the handshake.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const userId = typeof token === "string" ? verifyToken(token) : null;
    if (!userId) return next(new Error("Authentication required"));
    socket.data.userId = userId;
    next();
  });

  io.on("connection", (socket) => {
    void socket.join(userRoom(socket.data.userId));

    // Acks with { ok: true, update } where `update` is the current snapshot, or
    // { ok: false, error }. Non-members get the same answer as a missing group.
    socket.on("group:join", async (groupId: unknown, ack?: (res: unknown) => void) => {
      const reply = typeof ack === "function" ? ack : () => {};
      if (typeof groupId !== "string") return reply({ ok: false, error: "groupId must be a string" });
      try {
        const member = await prisma.groupMember.findUnique({
          where: { groupId_userId: { groupId, userId: socket.data.userId } },
        });
        if (!member) return reply({ ok: false, error: "Group not found" });
        await socket.join(room(groupId));
      } catch (err) {
        console.error("[realtime] group:join failed", err);
        return reply({ ok: false, error: "Internal server error" });
      }
      // Queued like a broadcast, so it can't overtake an update already on its way.
      enqueue(groupId, async () => {
        reply({ ok: true, update: await snapshot(groupId, null) });
      });
    });

    socket.on("group:leave", async (groupId: unknown, ack?: (res: unknown) => void) => {
      if (typeof groupId === "string") await socket.leave(room(groupId));
      if (typeof ack === "function") ack({ ok: true });
    });
  });

  return io;
}

export async function closeRealtime() {
  await io?.close();
  io = null;
}

// Call after the change's transaction has committed. Never throws: a failed
// broadcast must not fail the request that caused it.
export function publishGroupUpdate(groupId: string, change: Change) {
  if (!io) return;
  enqueue(groupId, async () => {
    const server = io;
    if (!server || !server.sockets.adapter.rooms.get(room(groupId))?.size) return; // nobody watching
    server.to(room(groupId)).emit(UPDATE_EVENT, await snapshot(groupId, change));
  });
}

// Call after the transaction that wrote the notifications has committed.
export function publishNotifications(notifications: { userId: string; notification: SerializedNotification }[]) {
  for (const { userId, notification } of notifications) {
    io?.to(userRoom(userId)).emit(NOTIFICATION_EVENT, notification);
  }
}

// Keeps the unread count in step across a user's open tabs. `id` null means all.
export function publishNotificationsRead(userId: string, read: { id: string | null; unreadCount: number }) {
  io?.to(userRoom(userId)).emit(NOTIFICATION_READ_EVENT, read);
}

// Updates for one group are read and sent strictly one after another, in the
// order the changes committed. Each snapshot is read after the previous one was
// sent, so clients never receive an older state after a newer one. That matters
// because not every change bumps ledgerVersion (D16, D17), so clients can't use
// it alone to spot a stale update. Different groups don't wait for each other.
const queues = new Map<string, Promise<void>>();

function enqueue(groupId: string, task: () => Promise<void>) {
  const next = (queues.get(groupId) ?? Promise.resolve())
    .then(task)
    .catch((err) => console.error(`[realtime] update for group ${groupId} failed`, err));
  queues.set(groupId, next);
  void next.finally(() => {
    if (queues.get(groupId) === next) queues.delete(groupId);
  });
}

async function snapshot(groupId: string, change: Change | null) {
  const { group, balances, pending } = await prisma.$transaction(
    async (tx) => ({
      group: await tx.group.findUniqueOrThrow({
        where: { id: groupId },
        select: {
          name: true,
          currency: true,
          status: true,
          closedAt: true,
          reminderDays: true,
          ledgerVersion: true,
        },
      }),
      balances: await computeBalances(tx, groupId),
      pending: await tx.payment.findMany({
        where: { groupId, status: "PENDING" },
        orderBy: { createdAt: "asc" },
      }),
    }),
    { isolationLevel: "RepeatableRead" },
  );
  const { ledgerVersion, ...details } = group;
  return {
    groupId,
    change, // null for the snapshot sent on join
    ledgerVersion,
    group: { ...details, closedAt: details.closedAt?.toISOString() ?? null },
    balances,
    settlement: settle(balances),
    pendingPayments: pending.map(serializePayment),
  };
}

export type GroupUpdate = Awaited<ReturnType<typeof snapshot>>;
