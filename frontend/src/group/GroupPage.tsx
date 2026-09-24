import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useUser } from "../auth/AuthContext";
import { errorMessage } from "../lib/api";
import type { Transfer } from "../lib/types";
import { Card, Loading, Notice } from "../ui";
import { ActivityFeed } from "./ActivityFeed";
import { GroupContext, type GroupCtx } from "./context";
import { GroupHeader } from "./GroupHeader";
import { MembersCard } from "./MembersCard";
import { BalancesCard, PendingCard, RepayForm, SettleUpCard, YouCard } from "./MoneyCards";
import { useGroupLive } from "./useGroupLive";

export function GroupPage() {
  const { groupId } = useParams() as { groupId: string };
  const me = useUser();
  const { state, connection, changeCount, afterChange } = useGroupLive(groupId);
  // null: closed; {}: open with nothing prefilled; a transfer: prefilled from the plan.
  const [repay, setRepay] = useState<Partial<Transfer> | null>(null);

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

  return (
    <GroupContext.Provider value={ctx}>
      <div className="space-y-10">
        <GroupHeader detail={detail} live={snapshot.group} connection={connection} />
        <div className="grid items-start gap-x-10 gap-y-10 md:grid-cols-12">
          <div className="space-y-10 md:col-span-7">
            <YouCard balances={snapshot.balances} pending={snapshot.pendingPayments} onRepay={() => setRepay({})} />
            {repay && (
              <RepayForm
                key={`${repay.toUserId}-${repay.amount}`}
                initial={repay.toUserId && repay.amount ? { toUserId: repay.toUserId, amount: repay.amount } : undefined}
                onDone={() => setRepay(null)}
              />
            )}
            <PendingCard payments={snapshot.pendingPayments} />
            <BalancesCard balances={snapshot.balances} />
            <SettleUpCard
              transfers={snapshot.settlement.transfers}
              method={snapshot.settlement.method}
              onPaid={(t) => setRepay(t)}
            />
          </div>
          <div className="space-y-10 md:col-span-5 md:mt-6">
            <ActivityFeed changeCount={changeCount} />
            <MembersCard detail={detail} closed={ctx.closed} />
          </div>
        </div>
      </div>
    </GroupContext.Provider>
  );
}
