import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api, errorMessage } from "../lib/api";
import { formatMoney } from "../lib/money";
import { timeAgo } from "../lib/time";
import type { Activity } from "../lib/types";
import { Button, Card, Notice } from "../ui";
import { MemberAvatar, useGroup } from "./context";

const PAGE = 15;

type Page = { activities: Activity[]; nextCursor: string | null };

// What happened in the group, newest first (backend D22). Reloads the newest
// page whenever the group changes (`changeCount`) and keeps older pages that
// were already loaded.
export function ActivityFeed({ changeCount }: { changeCount: number }) {
  const { groupId, currency, name: nameOf } = useGroup();
  const [feed, setFeed] = useState<{ items: Activity[]; cursor: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    api<Page>(`/groups/${groupId}/activity?limit=${PAGE}`, { signal: ctrl.signal })
      .then((page) => {
        setError(null);
        setFeed((old) => {
          const last = page.activities.at(-1);
          // Nothing older loaded yet (or the page reaches the very start): the page is the feed.
          if (!old || !last || page.nextCursor === null || old.items.length <= page.activities.length) {
            return { items: page.activities, cursor: page.nextCursor };
          }
          // Otherwise keep the older entries already loaded below the fresh page.
          // Entries are never deleted, so "older than the page's last" is exact.
          const older = old.items.filter((a) => isOlder(a, last));
          return { items: [...page.activities, ...older], cursor: old.cursor };
        });
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError(errorMessage(err));
      });
    return () => ctrl.abort();
  }, [groupId, changeCount]);

  const loadMore = useCallback(async () => {
    if (!feed?.cursor) return;
    setLoadingMore(true);
    try {
      const page = await api<Page>(`/groups/${groupId}/activity?limit=${PAGE}&before=${feed.cursor}`);
      setFeed((old) => {
        const seen = new Set(old?.items.map((a) => a.id));
        return { items: [...(old?.items ?? []), ...page.activities.filter((a) => !seen.has(a.id))], cursor: page.nextCursor };
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [groupId, feed?.cursor]);

  const items = feed?.items ?? null;
  const cursor = feed?.cursor ?? null;

  const money = (n: unknown) => formatMoney(Number(n), currency);
  const name = (id: unknown) => nameOf(String(id));

  return (
    <Card title="What happened" tone="paper" tilt={0.3}>
      {error && <Notice>{error}</Notice>}
      {items === null && !error && <p className="text-ink-soft">Loading…</p>}
      {items?.length === 0 && <p className="text-ink-soft">Nothing yet.</p>}
      <ol className="space-y-3">
        {items?.map((a) => (
          <li key={a.id} className="flex gap-3">
            <MemberAvatar userId={a.actor.id} size={28} />
            <div className="min-w-0">
              <p className="leading-snug">{describe(a, groupId, name, money)}</p>
              <p className="text-xs text-ink-soft">
                <time dateTime={a.createdAt} title={new Date(a.createdAt).toLocaleString()}>
                  {timeAgo(a.createdAt)}
                </time>
              </p>
            </div>
          </li>
        ))}
      </ol>
      {cursor && items && (
        <div className="mt-4">
          <Button onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Show older"}
          </Button>
        </div>
      )}
    </Card>
  );
}

// Same order as the API: newest first by (createdAt, id).
function isOlder(a: Activity, than: Activity) {
  return a.createdAt < than.createdAt || (a.createdAt === than.createdAt && a.id < than.id);
}

type Data = Record<string, unknown>;

function describe(
  a: Activity,
  groupId: string,
  name: (id: unknown) => string,
  money: (n: unknown) => string,
): ReactNode {
  const who = <b className="font-medium">{a.actor.name}</b>;
  const d = a.data as Data;
  const expenseLink = (e: Data) => (
    <Link to={`/groups/${groupId}/expenses/${e.id}`} className="underline decoration-ink-faint underline-offset-2 hover:decoration-ink">
      {String(e.description)}
    </Link>
  );
  switch (a.type) {
    case "GROUP_CREATED":
      return <>{who} started the group</>;
    case "MEMBER_JOINED":
      return <>{who} joined</>;
    case "MEMBER_INVITED":
      return <>{who} invited {String(d.email)}</>;
    case "EXPENSE_CREATED":
      return <>{who} added {expenseLink(d)} · {money(d.amount)}</>;
    case "EXPENSE_UPDATED": {
      const before = d.before as Data;
      const after = d.after as Data;
      return (
        <>
          {who} edited {expenseLink(after)}
          {before.amount !== after.amount && <> · {money(before.amount)} → {money(after.amount)}</>}
          {before.description !== after.description && <> (was “{String(before.description)}”)</>}
        </>
      );
    }
    case "EXPENSE_DELETED":
      return <>{who} deleted {String(d.description)} · {money(d.amount)}</>;
    case "PAYMENT_CREATED":
      return <>{who} says they paid {name(d.toUserId)} {money(d.amount)}</>;
    case "PAYMENT_CONFIRMED":
      return <>{who} confirmed getting {money(d.amount)} from {name(d.fromUserId)}</>;
    case "PAYMENT_REJECTED":
      return <>{who} said they didn't get {money(d.amount)} from {name(d.fromUserId)}</>;
    case "PAYMENT_CANCELLED":
      return <>{who} withdrew their {money(d.amount)} payment to {name(d.toUserId)}</>;
    case "GROUP_SETTINGS_UPDATED": {
      const before = d.before as Data;
      const after = d.after as Data;
      const changes = [
        before.name !== after.name && `renamed it “${String(after.name)}”`,
        before.currency !== after.currency && `switched the currency to ${String(after.currency)}`,
        before.reminderDays !== after.reminderDays && `set reminders to every ${String(after.reminderDays)} days`,
      ].filter(Boolean);
      return <>{who} {changes.length ? changes.join(", ") : "changed the settings"}</>;
    }
    case "GROUP_CLOSED":
      return <>{who} closed the group</>;
    case "GROUP_REOPENED":
      return <>{who} reopened the group</>;
  }
}
