import { Link, NavLink, Outlet } from "react-router";
import { RoughLayer, useSeed } from "./ui/rough";

export function AppShell() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-5xl items-end justify-between gap-4 px-4 pt-6 pb-2 sm:px-6">
        <Logo />
        <nav className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1 font-hand text-base sm:gap-x-5 sm:text-lg">
          <NavItem to="/groups">my groups</NavItem>
          {import.meta.env.DEV && <NavItem to="/design">style guide</NavItem>}
          <NavItem to="/login">log in</NavItem>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 pt-6 pb-16 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}

function Logo() {
  const seed = useSeed();
  return (
    <Link to="/groups" className="relative -rotate-2 pb-1 font-hand text-4xl font-bold">
      split.
      <RoughLayer shape={{ kind: "underline" }} seed={seed} strokeWidth={2} roughness={2} />
    </Link>
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
