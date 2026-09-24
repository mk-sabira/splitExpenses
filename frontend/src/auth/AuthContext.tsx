import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler, tokenStore } from "../lib/api";
import type { User } from "../lib/types";

type AuthState =
  | { status: "loading" } // checking a stored token
  | { status: "anonymous" }
  | { status: "authenticated"; user: User };

interface AuthContextValue {
  state: AuthState;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// The token lives in localStorage (D14, D24). On start-up a stored token is
// checked with /auth/me; any later 401 logs the user out.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    tokenStore.get() ? { status: "loading" } : { status: "anonymous" },
  );

  const logout = useCallback(() => {
    tokenStore.set(null);
    setState({ status: "anonymous" });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) return;
    const ctrl = new AbortController();
    api<{ user: User }>("/auth/me", { signal: ctrl.signal })
      .then(({ user }) => setState({ status: "authenticated", user }))
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        // Also covers the server being unreachable: better to show the login
        // page than a spinner forever. The token is only dropped on a 401.
        setState({ status: "anonymous" });
      });
    return () => ctrl.abort();
  }, [logout]);

  const value = useMemo<AuthContextValue>(() => {
    const signedIn = ({ token, user }: { token: string; user: User }) => {
      tokenStore.set(token);
      setState({ status: "authenticated", user });
    };
    return {
      state,
      logout,
      login: async (email, password) =>
        signedIn(await api("/auth/login", { method: "POST", body: { email, password } })),
      register: async (name, email, password) =>
        signedIn(await api("/auth/register", { method: "POST", body: { name, email, password } })),
    };
  }, [state, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

// The logged-in user; only for components under <RequireAuth>.
export function useUser(): User {
  const { state } = useAuth();
  if (state.status !== "authenticated") throw new Error("useUser needs a logged-in user");
  return state.user;
}
