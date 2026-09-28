import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useUser } from "../auth/AuthContext";
import { errorMessage } from "../lib/api";
import type { Transfer } from "../lib/types";
import { Button, Card, Loading, Notice } from "../ui";
import { ActivityFeed } from "./ActivityFeed";
import { ExpenseForm } from "./ExpenseForm";
import { ExpenseList } from "./ExpenseList";
import { ExpenseView } from "./ExpenseView";
import { GroupContext, type GroupCtx } from "./context";
import { GroupHeader } from "./GroupHeader";
import { MembersPanel } from "./MembersPanel";
import { BalanceCard, PendingCard, RepayForm } from "./MoneyCards";
import { useGroupLive } from "./useGroupLive";

export function GroupPage() {
  // Also serves /groups/:groupId/expenses/:expenseId: the expense opens above the balances.
  const { groupId, expenseId } = useParams() as { groupId: string; expenseId?: string };
  const me = useUser();
  const { state, connection, changeCount, afterChange } = useGroupLive(groupId);
  // null: closed; {}: open with nothing prefilled; a transfer: prefilled from the plan.
  const [repay, setRepay] = useState<Partial<Transfer> | null>(null);
  const [adding, setAdding] = useState(false);

  const ctx = useMemo<GroupCtx | null>(() => {
    if (state.status !== "ok") return null;
    const { detail, snapshot } = state.group;
    const names = new Map(detail.members.map((m) => [m.userId, m.name]));
    const order = new Map(detail.members.map((m, i) => [m.userId, i])); // members come in join order
    return {
      groupId,
      currency: snapshot.group.currency,
      me: me.id,
      members: detail.members,
      name: (id) => names.get(id) ?? "Former member",
      crayon: (id) => order.get(id) ?? id,
      closed: snapshot.group.status === "CLOSED",
      afterChange,
    };
  }, [state, groupId, me.id, afterChange]);

  if (state.status === "loading") return <Loading />;
  if (state.status === "not-found") {
    return (
      <Card title="Group not found" className="max-w-md">
        <p className="text-ink-soft">
          It doesn't exist, or you're not a member.{" "}
          <Link to="/groups" className="text-ink underline underline-offset-4">
            Back to my groups
          </Link>
        </p>
      </Card>
    );
  }
  if (state.status === "error" || !ctx) {
    return <Notice>{state.status === "error" ? errorMessage(state.error) : "Something went wrong."}</Notice>;
  }

  const { detail, snapshot } = state.group;
  // No expense or repayment has ever been recorded (every money write bumps
  // ledgerVersion), so there's nothing to balance or settle yet.
  const fresh = snapshot.ledgerVersion === 0;

  return (
    <GroupContext.Provider value={ctx}>
      {/* Top to bottom: who and where, the everyday action, the money, then what happened. */}
      <div className="space-y-8">
        <div className="space-y-4">
          <GroupHeader detail={detail} live={snapshot.group} connection={connection} />
          <MembersPanel detail={detail} closed={ctx.closed} />
        </div>
        {expenseId ? (
          <ExpenseView key={expenseId} expenseId={expenseId} changeCount={changeCount} />
        ) : ctx.closed ? (
          <p className="font-hand text-xl text-ink-soft">This group is closed, so no new expenses. Repayments still work.</p>
        ) : adding ? (
          <div className="max-w-2xl">
            <ExpenseForm onDone={() => setAdding(false)} />
          </div>
        ) : (
          <div>
            {fresh && <p className="mb-3 font-hand text-2xl">Add your first expense to get started.</p>}
            <Button variant="primary" onClick={() => setAdding(true)} className="text-xl">
              + Add an expense
            </Button>
            {detail.members.length === 1 && (
              <p className="mt-3 max-w-xl text-sm text-ink-soft">
                This will be split only among current members — invite others first if you want them included.
              </p>
            )}
          </div>
        )}
        <div className="grid items-start gap-x-10 gap-y-10 md:grid-cols-12">
          <div className="space-y-10 md:col-span-7">
            {!fresh && (
              <BalanceCard
                balances={snapshot.balances}
                pending={snapshot.pendingPayments}
                transfers={snapshot.settlement.transfers}
                method={snapshot.settlement.method}
                onRepay={() => setRepay({})}
                onPaid={(t) => setRepay(t)}
              />
            )}
            {repay && (
              <RepayForm
                key={`${repay.toUserId}-${repay.amount}`}
                initial={repay.toUserId && repay.amount ? { toUserId: repay.toUserId, amount: repay.amount } : undefined}
                onDone={() => setRepay(null)}
              />
            )}
            <PendingCard payments={snapshot.pendingPayments} />
            {!fresh && <ExpenseList changeCount={changeCount} openId={expenseId} />}
          </div>
          <div className="md:col-span-5">
            <ActivityFeed changeCount={changeCount} />
          </div>
        </div>
      </div>
    </GroupContext.Provider>
  );
}
