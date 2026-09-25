import { useEffect, useState, type SubmitEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useUser } from "../auth/AuthContext";
import { api, ApiError, errorMessage } from "../lib/api";
import { currencies } from "../lib/currencies";
import type { GroupDetail, GroupSummary, MemberBalance, Payment } from "../lib/types";
import { useApi } from "../lib/useApi";
import { Balance, Button, Card, Highlight, Loading, Money, Notice, SelectField, Stamp, TextField, type Tone } from "../ui";

const TONES: Tone[] = ["sticky", "sky", "mint", "lilac", "blush"];

export function GroupsPage() {
  const groups = useApi<{ groups: GroupSummary[] }>("/groups");
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-hand text-3xl font-bold sm:text-4xl">
          <Highlight>My groups</Highlight>
        </h1>
        {!creating && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            New group
          </Button>
        )}
      </div>

      <WaitingForYou />

      {creating && <CreateGroup onCancel={() => setCreating(false)} />}

      {groups.status === "loading" && <Loading />}
      {groups.status === "error" && <Notice>{errorMessage(groups.error)}</Notice>}
      {groups.status === "ok" &&
        (groups.data.groups.length === 0 ? (
          !creating && <EmptyState onCreate={() => setCreating(true)} />
        ) : (
          <GroupGrid groups={groups.data.groups} />
        ))}
    </div>
  );
}

type PendingPayment = Payment & { groupName: string; currency: string; direction: "incoming" | "outgoing" };

// Repayments someone says they've made to you, which only you can confirm.
function WaitingForYou() {
  const pending = useApi<{ payments: PendingPayment[] }>("/payments/pending");
  const incoming = pending.data?.payments.filter((p) => p.direction === "incoming") ?? [];
  if (incoming.length === 0) return null;
  return (
    <Card title="Waiting for you" tone="sky" tape="marker" tilt={-0.4} className="max-w-2xl">
      <ul className="space-y-2">
        {incoming.map((p) => (
          <li key={p.id} className="flex flex-wrap items-baseline gap-x-2">
            <span>
              A repayment of <Money amount={p.amount} currency={p.currency} className="text-owed" /> in{" "}
              <span className="font-medium">{p.groupName}</span> needs your confirmation.
            </span>
            <Link to={`/groups/${p.groupId}`} className="font-hand text-lg underline decoration-accent decoration-2 underline-offset-4">
              review
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function GroupGrid({ groups }: { groups: GroupSummary[] }) {
  const net = useMyBalances(groups);
  return (
    <ul className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map((g, i) => (
        <li key={g.id} className={i % 3 === 1 ? "lg:mt-5" : ""}>
          <Link to={`/groups/${g.id}`} className="group block rounded-sm">
            <Card
              tone={g.status === "CLOSED" ? "paper" : TONES[i % TONES.length]}
              tape={i % 2 ? "marker" : undefined}
              className="transition-transform group-hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-hand text-2xl leading-tight font-bold group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4">
                  {g.name}
                </h2>
                {g.status === "CLOSED" && <Stamp ink="owe">Closed</Stamp>}
              </div>
              <p className="mt-1 text-sm text-ink-soft">
                {g.currency} · {g.memberCount} {g.memberCount === 1 ? "member" : "members"}
                {g.myRole === "OWNER" && " · you're the owner"}
              </p>
              <p className="mt-4 font-hand text-2xl font-bold">
                {net[g.id] === undefined ? (
                  <span className="text-ink-faint">…</span>
                ) : net[g.id] === null ? (
                  <span className="text-base text-ink-soft">balance unavailable</span>
                ) : (
                  <Balance net={net[g.id]!} currency={g.currency} you />
                )}
              </p>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// The logged-in user's net balance in each group, fetched in parallel.
// undefined while loading, null if that request failed.
function useMyBalances(groups: GroupSummary[]) {
  const me = useUser();
  const [net, setNet] = useState<Record<string, number | null>>({});
  useEffect(() => {
    const ctrl = new AbortController();
    for (const g of groups) {
      api<{ balances: MemberBalance[] }>(`/groups/${g.id}/balances`, { signal: ctrl.signal })
        .then(({ balances }) => {
          if (!ctrl.signal.aborted) setNet((n) => ({ ...n, [g.id]: balances.find((b) => b.userId === me.id)?.net ?? 0 }));
        })
        .catch((err) => {
          if ((err as Error).name !== "AbortError") setNet((n) => ({ ...n, [g.id]: null }));
        });
    }
    return () => ctrl.abort();
  }, [groups, me.id]);
  return net;
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card tone="sticky" tape="blush" className="max-w-lg">
      <h2 className="font-hand text-3xl font-bold">No groups yet</h2>
      <p className="mt-2 text-ink-soft">
        Start one for a trip, a shared flat or a dinner, then invite the others. If someone sent you an invite
        link, just open it.
      </p>
      <div className="mt-5">
        <Button variant="primary" onClick={onCreate}>
          Start a group
        </Button>
      </div>
    </Card>
  );
}

function CreateGroup({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [reminderDays, setReminderDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const { group } = await api<{ group: GroupDetail }>("/groups", {
        method: "POST",
        body: { name, currency, reminderDays: Number(reminderDays) },
      });
      navigate(`/groups/${group.id}`);
    } catch (err) {
      const f = err instanceof ApiError ? err.fields : {};
      setFields(f);
      setError(Object.keys(f).length > 0 ? null : errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Card title="Start a group" tilt={0} tape="sky" className="max-w-2xl">
      <form onSubmit={submit} className="space-y-5">
        <TextField
          label="Name"
          placeholder="Weekend in Almaty"
          required
          maxLength={100}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={fields.name}
        />
        <div className="grid gap-5 sm:grid-cols-[2fr_1fr]">
          <SelectField
            label="Currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            hint="Can't be changed once there's an expense."
            error={fields.currency}
          >
            {currencies().map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Remind debtors after"
            type="number"
            min={1}
            max={365}
            required
            value={reminderDays}
            onChange={(e) => setReminderDays(e.target.value)}
            hint="days"
            error={fields.reminderDays}
            className="tabular"
          />
        </div>
        {error && <Notice>{error}</Notice>}
        <div className="flex items-center gap-4">
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create group"}
          </Button>
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
