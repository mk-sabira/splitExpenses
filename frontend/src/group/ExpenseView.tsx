import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ApiError, errorMessage } from "../lib/api";
import { formatDay } from "../lib/time";
import type { Expense } from "../lib/types";
import { useApi } from "../lib/useApi";
import { Button, Card, Loading, Money, Notice } from "../ui";
import { MemberAvatar, useGroup } from "./context";
import { CATEGORIES, ExpenseForm } from "./ExpenseForm";

// One expense, opened from the activity feed, shown above the group's
// balances. "Edit" swaps in the expense form, which lists everyone who is in
// the group now, so people who joined later can be added to the split.
export function ExpenseView({ expenseId, changeCount }: { expenseId: string; changeCount: number }) {
  const { groupId, members, name, currency, closed } = useGroup();
  const res = useApi<{ expense: Expense }>(`/groups/${groupId}/expenses/${expenseId}`);
  const [editing, setEditing] = useState(false);
  const { reload } = res;

  // Someone else may have edited it: follow the group's live updates.
  useEffect(() => {
    if (changeCount > 0) reload();
  }, [changeCount, reload]);

  const back = (
    <Link to={`/groups/${groupId}`} className="font-hand text-lg underline decoration-accent decoration-2 underline-offset-4">
      Back to the group
    </Link>
  );

  if (res.status === "loading") return <Loading />;
  if (res.status === "error") {
    const gone = res.error instanceof ApiError && res.error.status === 404;
    return (
      <div className="space-y-3">
        <Notice>{gone ? "This expense was deleted." : errorMessage(res.error)}</Notice>
        {back}
      </div>
    );
  }

  const e = res.data.expense;
  if (editing) {
    return (
      <div className="max-w-2xl">
        <ExpenseForm
          key={e.version}
          expense={e}
          onDone={() => {
            setEditing(false);
            reload();
          }}
        />
      </div>
    );
  }

  const left = members.filter((m) => !e.splits.some((s) => s.userId === m.userId));
  return (
    <div className="max-w-2xl space-y-3">
      <Card
        title={e.description}
        aside={<Money amount={e.amount} currency={currency} className="font-hand text-2xl font-bold" />}
        tone="sky"
        tape="marker"
        tilt={-0.3}
      >
        <p className="text-ink-soft">
          Paid by <span className="font-medium text-ink">{name(e.paidById)}</span> · {formatDay(e.date)} ·{" "}
          {CATEGORIES.find((c) => c.value === e.category)?.label ?? e.category}
        </p>
        {e.comment && <p className="mt-1 text-ink-soft">“{e.comment}”</p>}
        <ul className="mt-4 space-y-2" aria-label="Split">
          {e.splits.map((s) => (
            <li key={s.userId} className="flex items-center gap-3">
              <MemberAvatar userId={s.userId} size={28} />
              <span>
                {name(s.userId)}
                {e.splitType === "SHARES" && (
                  <span className="ml-1 font-hand text-ink-soft">
                    ({s.shares} {s.shares === 1 ? "share" : "shares"})
                  </span>
                )}
              </span>
              <Money amount={s.amount} currency={currency} className="ml-auto" />
            </li>
          ))}
        </ul>
        {left.length > 0 && !closed && (
          <p className="mt-4 text-sm text-ink-soft">
            Not in this split: {left.map((m) => m.name).join(", ")}. Edit it to include them.
          </p>
        )}
        {!closed && (
          <div className="mt-5">
            <Button onClick={() => setEditing(true)}>Edit</Button>
          </div>
        )}
      </Card>
      {back}
    </div>
  );
}
