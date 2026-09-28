import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { AppNotification } from "../lib/types";
import { useUserEvent } from "../lib/userSocket";

const PAGE = 20;

interface State {
  items: AppNotification[];
  unreadCount: number;
  loaded: boolean;
}

// The logged-in user's notifications, kept current in real time (D33).
//
// The latest page comes from REST; new ones arrive on the user's own socket
// room (shared with the groups list, see lib/userSocket). Anything missed
// while disconnected is picked up by reloading on every connect.
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
    return () => loadRef.current?.abort();
  }, [userId, load]);

  const onNew = useCallback((n: AppNotification) => {
    eventsRef.current++;
    setState((s) =>
      s.items.some((x) => x.id === n.id)
        ? s
        : { ...s, items: [n, ...s.items].slice(0, PAGE), unreadCount: s.unreadCount + 1 },
    );
  }, []);
  const onRead = useCallback((r: { id: string | null; unreadCount: number }) => {
    eventsRef.current++;
    setState((s) => markLocally(s, r.id, r.unreadCount));
  }, []);
  useUserEvent("notification:new", onNew, load);
  useUserEvent("notification:read", onRead);

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
