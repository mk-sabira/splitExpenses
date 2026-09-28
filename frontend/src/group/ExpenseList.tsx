import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api, errorMessage } from "../lib/api";
import { formatDay } from "../lib/time";
import type { Expense } from "../lib/types";
import { Button, Card, Money, Notice } from "../ui";
import { useGroup } from "./context";
import { CATEGORIES } from "./ExpenseForm";

const PAGE = 10;
const MAX = 100; // the API's page limit

type Page = { expenses: Expense[]; nextCursor: string | null };

// Every expense in the group that hasn't been deleted, newest first by date
// (backend D35). "Show more" loads older ones. On every change to the group
// (`changeCount`) it re-reads as many as are showing, from the top: unlike the
// activity feed, expenses can be edited or disappear, so older pages can't
// simply be kept.
export function ExpenseList({ changeCount, openId }: { changeCount: number; openId?: string }) {
  const { groupId, currency, me, name } = useGroup();
  const [list, setList] = useState<{ items: Expense[]; cursor: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const shownRef = useRef(PAGE);

  useEffect(() => {
    const ctrl = new AbortController();
    const limit = Math.min(MAX, Math.max(PAGE, shownRef.current));
    api<Page>(`/groups/${groupId}/expenses?limit=${limit}`, { signal: ctrl.signal })
      .then((page) => {
        if (ctrl.signal.aborted) return;
        setError(null);
        shownRef.current = page.expenses.length;
        setList({ items: page.expenses, cursor: page.nextCursor });
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError(errorMessage(err));
      });
    return () => ctrl.abort();
  }, [groupId, changeCount]);

  const loadMore = useCallback(async () => {
    if (!list?.cursor) return;
    setLoadingMore(true);
    try {
      const page = await api<Page>(`/groups/${groupId}/expenses?limit=${PAGE}&before=${list.cursor}`);
      setList((old) => {
        const seen = new Set(old?.items.map((e) => e.id));
        const items = [...(old?.items ?? []), ...page.expenses.filter((e) => !seen.has(e.id))];
        shownRef.current = items.length;
        return { items, cursor: page.nextCursor };
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }, [groupId, list?.cursor]);

  const category = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? c;

  return (
    <Card title="Expenses" tone="paper" tilt={-0.2}>
      {error && <Notice>{error}</Notice>}
      {list === null && !error && <p className="text-ink-soft">Loading…</p>}
      {list?.items.length === 0 && <p className="text-ink-soft">No expenses right now.</p>}
      <ul className="-mx-2 divide-y divide-ink-faint/40">
        {list?.items.map((e) => {
          const share = e.splits.find((s) => s.userId === me)?.amount;
          return (
            <li key={e.id}>
              <Link
                to={`/groups/${groupId}/expenses/${e.id}`}
                aria-current={e.id === openId ? "page" : undefined}
                className="flex items-start gap-3 rounded px-2 py-2.5 hover:bg-sticky aria-[current=page]:bg-sky"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.description}</span>
                  <span className="block text-sm text-ink-soft">
                    {name(e.paidById)} paid · {formatDay(e.date)} · {category(e.category)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <Money amount={e.amount} currency={currency} className="block" />
                  <span className="block text-sm text-ink-soft">
                    {share === undefined ? (
                      "not in it"
                    ) : (
                      <>
                        your share <Money amount={share} currency={currency} className="font-normal" />
                      </>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {list?.cursor && (
        <div className="mt-4">
          <Button onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Show more"}
          </Button>
        </div>
      )}
    </Card>
  );
}
