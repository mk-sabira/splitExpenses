import { useState } from "react";
import { api } from "../lib/api";
import type { GroupDetail, GroupUpdate } from "../lib/types";
import { useAction } from "../lib/useAction";
import { Button, Highlight, Notice, Stamp } from "../ui";
import { useGroup } from "./context";
import type { Connection } from "./useGroupLive";

export function GroupHeader({
  detail,
  live,
  connection,
}: {
  detail: GroupDetail;
  live: GroupUpdate["group"];
  connection: Connection;
}) {
  const { me } = useGroup();
  const isOwner = detail.members.some((m) => m.userId === me && m.role === "OWNER");
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-hand text-3xl leading-tight font-bold sm:text-4xl">
            <Highlight>{live.name}</Highlight>
          </h1>
          {live.status === "CLOSED" && <Stamp ink="owe">Closed</Stamp>}
        </div>
        <p className="mt-1 text-ink-soft">
          {live.currency} · {detail.members.length} {detail.members.length === 1 ? "member" : "members"} · reminders
          every {live.reminderDays} {live.reminderDays === 1 ? "day" : "days"}
          <LiveDot connection={connection} />
        </p>
      </div>
      {isOwner && <CloseReopen closed={live.status === "CLOSED"} />}
    </header>
  );
}

function LiveDot({ connection }: { connection: Connection }) {
  const label = { live: "live", connecting: "connecting…", offline: "offline, reconnecting…" }[connection];
  return (
    <span className="ml-3 inline-flex items-center gap-1.5 font-hand text-base whitespace-nowrap" role="status">
      <span
        aria-hidden
        className={`inline-block size-2.5 rounded-full ${connection === "live" ? "bg-owed" : connection === "offline" ? "bg-owe" : "bg-ink-faint"}`}
      />
      {label}
    </span>
  );
}

// Owner only (backend D16). Closing asks first, since it emails everyone.
function CloseReopen({ closed }: { closed: boolean }) {
  const { groupId, afterChange } = useGroup();
  const [confirming, setConfirming] = useState(false);
  const action = useAction();
  const run = (what: "close" | "reopen") =>
    action.run(async () => {
      await api(`/groups/${groupId}/${what}`, { method: "POST" });
      await afterChange();
      setConfirming(false);
    });

  if (closed) {
    return (
      <div>
        <Button disabled={action.busy} onClick={() => run("reopen")}>
          Reopen group
        </Button>
        {action.error && <Notice>{action.error}</Notice>}
      </div>
    );
  }
  if (!confirming) return <Button onClick={() => setConfirming(true)}>Close group</Button>;
  return (
    <div className="max-w-sm space-y-3">
      <p className="text-sm">
        No new expenses after this. Everyone gets an email with the final balances, and repayments can still be recorded.
      </p>
      <div className="flex gap-3">
        <Button variant="primary" disabled={action.busy} onClick={() => run("close")}>
          {action.busy ? "Closing…" : "Yes, close it"}
        </Button>
        <Button variant="quiet" onClick={() => setConfirming(false)}>
          Keep it open
        </Button>
      </div>
      {action.error && <Notice>{action.error}</Notice>}
    </div>
  );
}
