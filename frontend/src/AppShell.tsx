import { Link, NavLink, Outlet } from "react-router";
import { useAuth } from "./auth/AuthContext";
import { Avatar, Button, Wordmark } from "./ui";
import { RoughLayer, useSeed } from "./ui/rough";

export function AppShell() {
  const { state, logout } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-6 pb-2 sm:px-6">
        <Link to="/groups" aria-label="Esep, my groups" className="pb-1">
          <Wordmark />
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 font-hand text-base sm:gap-x-5 sm:text-lg">
          {user && <NavItem to="/groups">my groups</NavItem>}
          {user && <NavItem to="/help">help</NavItem>}
          {import.meta.env.DEV && <NavItem to="/design">style guide</NavItem>}
          {user ? (
            <span className="flex items-center gap-2">
              <Avatar name={user.name} colorKey={user.id} size={30} />
              <span className="sr-only sm:not-sr-only">{user.name}</span>
              <Button variant="quiet" onClick={logout} className="text-base text-ink-soft sm:text-lg">
                log out
              </Button>
            </span>
          ) : (
            <NavItem to="/login">log in</NavItem>
          )}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-16 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({ to, children }: { to: string; children: string }) {
  const seed = useSeed();
  return (
    <NavLink to={to} className="relative pb-0.5 text-ink-soft hover:text-ink aria-[current=page]:text-ink">
      {({ isActive }) => (
        <>
          {children}
          {isActive && <RoughLayer shape={{ kind: "underline" }} seed={seed} strokeWidth={1.5} roughness={1.8} />}
        </>
      )}
    </NavLink>
  );
}
