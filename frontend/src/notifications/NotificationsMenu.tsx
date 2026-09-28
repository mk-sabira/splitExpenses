import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { formatMoney } from "../lib/money";
import { timeAgo } from "../lib/time";
import type { AppNotification } from "../lib/types";
import { Button } from "../ui";
import { RoughLayer, useSeed } from "../ui/rough";
import { useNotifications } from "./useNotifications";

// Header button with the unread count, opening a list of recent notifications
// (D33). Opening an entry marks it as read and goes to the expense (or to the
// group, for a deleted one).
export function NotificationsMenu({ userId }: { userId: string }) {
  const { items, unreadCount, loaded, markRead } = useNotifications(userId);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const seed = useSeed();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = unreadCount > 0 ? `notifications, ${unreadCount} unread` : "notifications";
  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="quiet"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="text-base text-ink-soft hover:text-ink sm:text-lg"
      >
        <span aria-hidden>🔔</span>
        <span className="sr-only sm:not-sr-only">notifications</span>
        {unreadCount > 0 && (
          <span
            aria-hidden
            data-testid="unread-count"
            className="tabular min-w-5 rounded-full bg-owe px-1.5 py-0.5 font-sans text-xs leading-none font-semibold text-paper"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {open && (
        <section
          id={panelId}
          aria-label="Notifications"
          className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] px-4 pt-3 pb-4"
        >
          <RoughLayer shape={{ kind: "rect" }} seed={seed} fill="var(--color-paper)" fillStyle="solid" strokeWidth={1.4} roughness={1.4} />
          <div className="relative">
            <header className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="font-hand text-xl font-bold">Notifications</h2>
              {unreadCount > 0 && (
                <Button variant="quiet" size="sm" onClick={() => void markRead(null)} className="text-base text-ink-soft">
                  mark all as read
                </Button>
              )}
            </header>
            {!loaded ? (
              <p className="text-sm text-ink-soft">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-ink-soft">
                Nothing yet. You'll hear here when someone adds or changes an expense you're part of.
              </p>
            ) : (
              <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
                {items.map((n) => (
                  <li key={n.id}>
                    <Link
                      to={target(n)}
                      onClick={() => {
                        setOpen(false);
                        if (!n.readAt) void markRead(n.id);
                      }}
                      className={`flex gap-2 rounded px-2 py-1.5 text-sm hover:bg-sticky ${n.readAt ? "text-ink-soft" : "text-ink"}`}
                    >
                      <span
                        aria-hidden
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-accent"}`}
                      />
                      <span className="min-w-0">
                        {!n.readAt && <span className="sr-only">Unread: </span>}
                        {describe(n)}
                        <span className="mt-0.5 block text-xs text-ink-soft">
                          {n.group?.name ?? "a group"} · {timeAgo(n.createdAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function target(n: AppNotification) {
  if (!n.group) return "/groups";
  if (n.type === "EXPENSE_DELETED") return `/groups/${n.group.id}`;
  return `/groups/${n.group.id}/expenses/${n.data.expenseId}`;
}

function describe(n: AppNotification): ReactNode {
  const d = n.data;
  // Amounts in the plain sans-serif, like <Money> everywhere else.
  const money = (x: number) => <span className="tabular font-sans text-[0.8rem]">{formatMoney(x, n.group?.currency ?? "EUR")}</span>;
  const who = <b className="font-medium">{d.actor.name}</b>;
  const what = <b className="font-medium">{d.description}</b>;
  switch (n.type) {
    case "EXPENSE_ADDED":
      return (
        <>
          {who} added {what} · {money(d.amount)}
          {d.share !== null && <>, your share {money(d.share)}</>}
        </>
      );
    case "EXPENSE_UPDATED": {
      const before = d.previousShare ?? null;
      let share: ReactNode = null;
      if (before === null && d.share !== null) share = <>, you're now in it: {money(d.share)}</>;
      else if (before !== null && d.share === null) share = <>, you're no longer in it</>;
      else if (before !== null && d.share !== null && before !== d.share)
        share = <>, your share {money(before)} → {money(d.share)}</>;
      return (
        <>
          {who} edited {what}
          {share}
        </>
      );
    }
    case "EXPENSE_DELETED":
      return (
        <>
          {who} deleted {what} · {money(d.amount)}
        </>
      );
  }
}
