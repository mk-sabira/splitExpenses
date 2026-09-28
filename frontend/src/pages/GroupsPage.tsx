import { useCallback, useState, type SubmitEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api, ApiError, errorMessage } from "../lib/api";
import { currencies } from "../lib/currencies";
import type { CurrencyTotal, GroupDetail, GroupSummary, Payment } from "../lib/types";
import { useApi } from "../lib/useApi";
import { useUserEvent } from "../lib/userSocket";
import { Balance, Button, Card, Highlight, Loading, Money, Notice, SelectField, Stamp, TextField, type Tone } from "../ui";

const TONES: Tone[] = ["sticky", "sky", "mint", "lilac", "blush"];

// Your groups with your balance in each, and the totals across all of them,
// from one request (D34). Any change in any of your groups arrives as
// "groups:changed" on your own socket and re-reads the page's data, so a
// balance here is never older than the last change.
export function GroupsPage() {
  const groups = useApi<{ groups: GroupSummary[]; totals: CurrencyTotal[] }>("/groups");
  const pending = useApi<{ payments: PendingPayment[] }>("/payments/pending");
  const [creating, setCreating] = useState(false);
  const { reload: reloadGroups } = groups;
  const { reload: reloadPending } = pending;
  const refresh = useCallback(() => {
    reloadGroups();
    reloadPending();
  }, [reloadGroups, reloadPending]);
  useUserEvent("groups:changed", refresh, refresh);

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

      {groups.status === "ok" && groups.data.groups.length > 0 && <Totals totals={groups.data.totals} />}

      <WaitingForYou payments={pending.data?.payments ?? []} />

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
function WaitingForYou({ payments }: { payments: PendingPayment[] }) {
  const incoming = payments.filter((p) => p.direction === "incoming");
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

// Across all your groups, closed ones included: one line per currency, since
// amounts in different currencies are never added together. The main figure
// is the net; the owe/owed split underneath shows when it hides debts in both
// directions (those are to different people, so they don't cancel out).
function Totals({ totals }: { totals: CurrencyTotal[] }) {
  return (
    <Card title="Across all your groups" tone="paper" tilt={-0.3} className="max-w-2xl">
      <ul className="space-y-3">
        {totals.map((t) => (
          <li key={t.currency} data-testid={`total-${t.currency}`}>
            <p className="font-hand text-2xl font-bold">
              <Balance net={t.net} currency={t.currency} you />
            </p>
            {t.owe > 0 && t.owed > 0 && (
              <p className="text-sm text-ink-soft">
                you owe <Money amount={t.owe} currency={t.currency} /> and you're owed{" "}
                <Money amount={t.owed} currency={t.currency} />, in {t.groupCount} {t.currency} groups
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function GroupGrid({ groups }: { groups: GroupSummary[] }) {
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
                <Balance net={g.myNet} currency={g.currency} you />
              </p>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
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
