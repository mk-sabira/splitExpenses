import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { tokenStore } from "./api";

// One socket per tab for the logged-in user's own room (backend D33, D34):
// notifications and "groups:changed". The server puts every authenticated
// socket in that room on connect, so there's nothing to join. The group page
// keeps its own socket for the group's room (D18).
const UserSocketContext = createContext<Socket | null>(null);

export function UserSocketProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  useEffect(() => {
    const s = io({ auth: { token: tokenStore.get() }, transports: ["websocket", "polling"] });
    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [userId]);
  return <UserSocketContext.Provider value={socket}>{children}</UserSocketContext.Provider>;
}

// null when logged out, and briefly while the socket is being created.
export function useUserSocket() {
  return useContext(UserSocketContext);
}

// Runs `onEvent` for every `event` on the user's socket, and `onConnect` on
// every connect while mounted, including the first. Events are only sent to
// connected sockets, so anything that happened before a (re)connect must be
// re-read from REST; the first connect can come after the page's initial read.
export function useUserEvent<T>(event: string, onEvent: (payload: T) => void, onConnect?: () => void) {
  const socket = useUserSocket();
  useEffect(() => {
    if (!socket) return;
    const connected = () => onConnect?.();
    socket.on(event, onEvent);
    socket.on("connect", connected);
    return () => {
      socket.off(event, onEvent);
      socket.off("connect", connected);
    };
  }, [socket, event, onEvent, onConnect]);
}
