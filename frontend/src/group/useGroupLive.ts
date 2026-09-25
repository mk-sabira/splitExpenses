import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError, tokenStore } from "../lib/api";
import type { GroupDetail, GroupUpdate, Payment, Transfer } from "../lib/types";

export type Connection = "connecting" | "live" | "offline";

export interface LiveGroup {
  detail: GroupDetail; // members, invite link, settings
  snapshot: GroupUpdate; // balances, settlement, pending payments, status
}

type State =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; error: unknown }
  | { status: "ok"; group: LiveGroup };

// Everything the group screen shows, kept current in real time (D18, D26).
//
// The details come from REST. The live part (balances, settlement, pending
// payments, status) comes from the Socket.io room: the join ack carries the
// current snapshot and every change pushes a new one. Socket events are applied
// in arrival order, which the server guarantees is commit order. If the socket
// is down, `refresh()` falls back to REST, and a REST result older than what's
// on screen (lower ledgerVersion) is ignored.
export function useGroupLive(groupId: string) {
  const { logout } = useAuth();
  const [state, setState] = useState<State>({ status: "loading" });
  const [connection, setConnection] = useState<Connection>("connecting");
  const [changeCount, setChangeCount] = useState(0); // bumps on every update, for dependants like the feed
  const detailRef = useRef<GroupDetail | null>(null);
  const snapshotRef = useRef<GroupUpdate | null>(null);
  const socketRef = useRef<Socket | null>(null);
  // In the group's room, so changes will be pushed. Being connected isn't enough:
  // the join can fail or still be on its way.
  const joinedRef = useRef(false);

  const publish = useCallback(() => {
    const detail = detailRef.current;
    const snapshot = snapshotRef.current;
    if (detail && snapshot) setState({ status: "ok", group: { detail, snapshot } });
  }, []);

  const loadDetail = useCallback(async () => {
    try {
      detailRef.current = (await api<{ group: GroupDetail }>(`/groups/${groupId}`)).group;
      publish();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setState({ status: "not-found" });
      else if (!detailRef.current) setState({ status: "error", error: err });
    }
  }, [groupId, publish]);

  // `from`: "socket" events are in commit order and always apply. A "rest" read
  // applies unless it's older than what's shown. A "fallback" read only fills
  // an empty screen, so it can never overwrite a live snapshot.
  const applySnapshot = useCallback(
    (update: GroupUpdate, from: "socket" | "rest" | "fallback") => {
      const current = snapshotRef.current;
      if (from === "rest" && current && update.ledgerVersion < current.ledgerVersion) return;
      if (from === "fallback" && current) return;
      snapshotRef.current = update;
      publish();
      setChangeCount((n) => n + 1);
      // Membership and settings aren't in the snapshot, so reload them when they change.
      const t = update.change?.type;
      if (t === "member.joined" || t === "group.settings_updated") void loadDetail();
    },
    [loadDetail, publish],
  );

  // The live part over REST, for when the socket isn't connected.
  const refreshFromRest = useCallback(async (from: "rest" | "fallback" = "rest") => {
    const [balances, settlement, payments, detail] = await Promise.all([
      api<{ ledgerVersion: number; currency: string; balances: GroupUpdate["balances"] }>(`/groups/${groupId}/balances`),
      api<{ ledgerVersion: number; transfers: Transfer[]; method: "exact" | "greedy" }>(`/groups/${groupId}/settlement`),
      api<{ payments: Payment[] }>(`/groups/${groupId}/payments?status=PENDING`),
      api<{ group: GroupDetail }>(`/groups/${groupId}`),
    ]);
    detailRef.current = detail.group;
    const d = detail.group;
    applySnapshot(
      {
        groupId,
        change: null,
        ledgerVersion: Math.min(balances.ledgerVersion, settlement.ledgerVersion),
        group: { name: d.name, currency: d.currency, status: d.status, closedAt: d.closedAt, reminderDays: d.reminderDays },
        balances: balances.balances,
        settlement: { transfers: settlement.transfers, method: settlement.method },
        pendingPayments: [...payments.payments].reverse(), // oldest first, like the socket
      },
      from,
    );
  }, [groupId, applySnapshot]);

  useEffect(() => {
    detailRef.current = null;
    snapshotRef.current = null;
    setState({ status: "loading" });
    void loadDetail();

    const socket = io({ auth: { token: tokenStore.get() }, transports: ["websocket", "polling"] });
    socketRef.current = socket;
    joinedRef.current = false;
    // "connect" also fires after every reconnect, and rooms don't survive a
    // reconnect, so join again each time; the ack brings us up to date.
    socket.on("connect", () => {
      socket.emit("group:join", groupId, (res: { ok: true; update: GroupUpdate } | { ok: false; error: string }) => {
        if (res.ok) {
          joinedRef.current = true;
          setConnection("live");
          applySnapshot(res.update, "socket");
        } else if (res.error === "Group not found") {
          setState({ status: "not-found" });
        } else {
          setConnection("offline");
        }
      });
    });
    socket.on("group:update", (update: GroupUpdate) => {
      if (update.groupId === groupId) applySnapshot(update, "socket");
    });
    socket.on("disconnect", () => {
      joinedRef.current = false;
      setConnection("offline");
    });
    socket.on("connect_error", (err) => {
      joinedRef.current = false;
      setConnection("offline");
      if (err.message === "Authentication required") logout();
      else void refreshFromRest("fallback").catch(() => {});
    });
    // A socket can also hang without ever reporting an error (e.g. a proxy
    // that accepts the upgrade and then drops it). Don't leave the screen empty.
    const fallback = setTimeout(() => {
      if (socket.connected) return;
      setConnection("offline");
      void refreshFromRest("fallback").catch(() => {});
    }, 3000);

    return () => {
      clearTimeout(fallback);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [groupId, loadDetail, applySnapshot, refreshFromRest, logout]);

  // After a change made on this screen. The socket delivers it once we're in the
  // group's room; otherwise read it back over REST (which also bumps changeCount,
  // so the activity feed reloads too).
  const afterChange = useCallback(async () => {
    if (!joinedRef.current) await refreshFromRest().catch(() => {});
    else void loadDetail(); // cheap, and keeps e.g. currencyLocked current
  }, [refreshFromRest, loadDetail]);

  return { state, connection, changeCount, afterChange };
}
