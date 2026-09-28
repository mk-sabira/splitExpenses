import { Link, NavLink, Outlet, useMatch } from "react-router";
import { useAuth } from "./auth/AuthContext";
import { UserSocketProvider } from "./lib/userSocket";
import { NotificationsMenu } from "./notifications/NotificationsMenu";
import { Avatar, Button, Wordmark } from "./ui";
import { RoughLayer, useSeed } from "./ui/rough";

export function AppShell() {
  const { state, logout } = useAuth();
  const user = state.status === "authenticated" ? state.user : null;
  const onGroupsList = useMatch("/groups") !== null;
  const page = (
    <div className={`min-h-screen ${onGroupsList ? "bg-cream" : ""}`}>
      <header className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 pt-6 pb-2 sm:px-6">
        <Link to="/groups" aria-label="Esep, my groups" className="pb-1">
          <Wordmark />
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 font-hand text-base sm:gap-x-5 sm:text-lg">
          {user && <NavItem to="/groups">my groups</NavItem>}
          {user && <NavItem to="/help">help</NavItem>}
          {user && <NotificationsMenu key={user.id} userId={user.id} />}
          {user ? (
            <span className="flex items-center gap-2">
              <Avatar name={user.name} colorKey={user.id} size={30} />
              <span className="sr-only sm:not-sr-only">{user.name}</span>
              <Button variant="danger" size="sm" onClick={logout} className="text-base sm:text-lg">
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
  return user ? (
    <UserSocketProvider key={user.id} userId={user.id}>
      {page}
    </UserSocketProvider>
  ) : (
    page
  );
}

// The current page gets a pale sticky-note fill behind it; the text itself
// doesn't change. "my groups" stays marked inside a group too, since NavLink
// matches everything under /groups.
function NavItem({ to, children }: { to: string; children: string }) {
  const seed = useSeed();
  return (
    <NavLink to={to} className="relative px-2.5 pt-1 pb-0.5 text-ink-soft hover:text-ink">
      {({ isActive }) => (
        <>
          {isActive && (
            <RoughLayer
              shape={{ kind: "rect" }}
              seed={seed}
              fill="var(--color-sticky)"
              fillStyle="solid"
              stroke="var(--color-ink-faint)"
              strokeWidth={1}
              roughness={1.6}
            />
          )}
          <span className="relative">{children}</span>
        </>
      )}
    </NavLink>
  );
}
