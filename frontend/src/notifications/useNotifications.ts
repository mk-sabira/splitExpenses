import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { api, tokenStore } from "../lib/api";
import type { AppNotification } from "../lib/types";

const PAGE = 20;

interface State {
  items: AppNotification[];
  unreadCount: number;
  loaded: boolean;
}

// The logged-in user's notifications, kept current in real time (D33).
//
// The latest page comes from REST; new ones arrive on the user's own socket
// room, which the server joins on connect (no group:join needed). Anything
// missed while disconnected is picked up by reloading on every (re)connect.
// "notification:read" keeps the unread count in step across open tabs.
export function useNotifications(userId: string) {
  const [state, setState] = useState<State>({ items: [], unreadCount: 0, loaded: false });
  const loadRef = useRef<AbortController | null>(null);
  // Bumped by every live event, so a REST read that started before one can tell
  // its result is already stale.
  const eventsRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    loadRef.current?.abort();
    const ctrl = new AbortController();
    loadRef.current = ctrl;
    const seen = eventsRef.current;
    try {
      const res = await api<{ notifications: AppNotification[]; unreadCount: number }>(
        `/notifications?limit=${PAGE}`,
        { signal: ctrl.signal },
      );
      if (ctrl.signal.aborted) return;
      if (eventsRef.current !== seen) return void load(); // an event overtook this read
      setState({ items: res.notifications, unreadCount: res.unreadCount, loaded: true });
    } catch {
      /* aborted, or offline: the next connect retries */
    }
  }, []);

  useEffect(() => {
    void load();
    const socket = io({ auth: { token: tokenStore.get() }, transports: ["websocket", "polling"] });
    let first = true;
    socket.on("connect", () => {
      if (!first) void load();
      first = false;
    });
    socket.on("notification:new", (n: AppNotification) => {
      eventsRef.current++;
      setState((s) =>
        s.items.some((x) => x.id === n.id)
          ? s
          : { ...s, items: [n, ...s.items].slice(0, PAGE), unreadCount: s.unreadCount + 1 },
      );
    });
    socket.on("notification:read", (r: { id: string | null; unreadCount: number }) => {
      eventsRef.current++;
      setState((s) => markLocally(s, r.id, r.unreadCount));
    });
    return () => {
      loadRef.current?.abort();
      socket.disconnect();
    };
  }, [userId, load]);

  const markRead = useCallback(async (id: string | null) => {
    // Shown as read at once; the server's count wins when it answers.
    setState((s) => markLocally(s, id));
    try {
      const res = await api<{ unreadCount: number }>(id ? `/notifications/${id}/read` : "/notifications/read-all", {
        method: "POST",
      });
      setState((s) => ({ ...s, unreadCount: res.unreadCount }));
    } catch {
      void load();
    }
  }, [load]);

  return { ...state, markRead };
}

function markLocally(s: State, id: string | null, unreadCount?: number): State {
  const now = new Date().toISOString();
  let changed = 0;
  const items = s.items.map((n) => {
    if (n.readAt || (id !== null && n.id !== id)) return n;
    changed++;
    return { ...n, readAt: now };
  });
  return { ...s, items, unreadCount: unreadCount ?? Math.max(0, s.unreadCount - changed) };
}
