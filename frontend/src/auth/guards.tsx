import type { ReactNode } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";
import { Loading } from "../ui";
import { useAuth } from "./AuthContext";

// Sends logged-out visitors to /login, remembering where they were going
// (e.g. an invite link), so they land back there after logging in.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
  if (state.status === "loading") return <Loading />;
  if (state.status === "anonymous") {
    const next = location.pathname + location.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return children;
}

// The opposite, for /login and /register: a logged-in user goes on to `next`.
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const [params] = useSearchParams();
  if (state.status === "loading") return <Loading />;
  if (state.status === "authenticated") return <Navigate to={safeNext(params.get("next"))} replace />;
  return children;
}

// Only same-site paths, so ?next= can't bounce people to another website.
export function safeNext(next: string | null) {
  return next && /^\/(?![/\\])/.test(next) ? next : "/groups";
}
