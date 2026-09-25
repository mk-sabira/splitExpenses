import { useEffect, useId, useRef, useState, type SubmitEvent } from "react";
import { api } from "../lib/api";
import { formatMoney, parseAmount, toInput } from "../lib/money";
import { timeAgo } from "../lib/time";
import type { MemberBalance, Payment, Transfer } from "../lib/types";
import { useAction } from "../lib/useAction";
import { Arrow, Balance, Button, Card, Divider, Highlight, Money, Notice, SelectField, Stamp, TextField } from "../ui";
import { MemberAvatar, useGroup } from "./context";

// Where the group stands, in one card: your own position first (with the one
// action that matters most), then everyone's balance and the fewest transfers
// that settle them (backend D6). When nobody owes anything, it says just that.
export function BalanceCard({
  balances,
  pending,
  transfers,
  method,
  onRepay,
  onPaid,
}: {
  balances: MemberBalance[];
  pending: Payment[];
  transfers: Transfer[];
  method: "exact" | "greedy";
  onRepay: () => void;
  onPaid: (t: Transfer) => void;
}) {
  const { me, currency, name } = useGroup();
  const net = balances.find((b) => b.userId === me)?.net ?? 0;
  const sent = pending.filter((p) => p.fromUserId === me).reduce((sum, p) => sum + p.amount, 0);
  const everyoneSettled = transfers.length === 0 && balances.every((b) => b.net === 0);
  return (
    <Card label="Balances" tone={net < 0 ? "blush" : net > 0 ? "mint" : "paper"} tape="marker" tilt={-0.4}>
      {net === 0 ? (
        <p className="font-hand text-4xl font-bold">
          you're <Highlight>{everyoneSettled ? "all settled up" : "settled up"}</Highlight>
        </p>
      ) : (
        <p className={`font-hand text-4xl font-bold ${net < 0 ? "text-owe" : "text-owed"}`}>
          {net < 0 ? "you owe " : "you're owed "}
          <Money amount={Math.abs(net)} currency={currency} className="font-semibold" />
        </p>
      )}
      {sent > 0 && (
        <p className="mt-1 text-ink-soft">
          <Money amount={sent} currency={currency} /> of that is waiting for confirmation.
        </p>
      )}
      {net < 0 && sent < -net && (
        <div className="mt-4">
          <Button onClick={onRepay}>Record a repayment</Button>
        </div>
      )}

      {!everyoneSettled && (
        <>
          <Divider />
          <ul className="space-y-2.5" aria-label="Everyone's balance">
            {balances.map((b) => (
              <li key={b.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <MemberAvatar userId={b.userId} />
                <span className="font-medium">
                  {name(b.userId)} {b.userId === me && <span className="font-hand text-ink-soft">(you)</span>}
                </span>
                <Balance net={b.net} currency={currency} className="ml-auto" />
              </li>
            ))}
          </ul>
          {transfers.length > 0 && <SettleUp transfers={transfers} method={method} onPaid={onPaid} />}
        </>
      )}
    </Card>
  );
}

// The plan, right under the balances it settles. You can record your own
// transfers straight from here.
function SettleUp({
  transfers,
  method,
  onPaid,
}: {
  transfers: Transfer[];
  method: "exact" | "greedy";
  onPaid: (t: Transfer) => void;
}) {
  const { me, currency, name } = useGroup();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="mt-6">
      <h3 id={titleId} className="font-hand text-2xl font-bold">
        To settle up
      </h3>
      <ul className="mt-2 space-y-3">
        {transfers.map((t) => (
          <li key={`${t.fromUserId}-${t.toUserId}`} className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
            <MemberAvatar userId={t.fromUserId} size={28} />
            <span className="font-medium">{t.fromUserId === me ? "You" : name(t.fromUserId)}</span>
            <Arrow color="var(--color-owe)" />
            <MemberAvatar userId={t.toUserId} size={28} />
            <span className="font-medium">{t.toUserId === me ? "you" : name(t.toUserId)}</span>
            <Money amount={t.amount} currency={currency} className="ml-auto" />
            {t.fromUserId === me && (
              <Button onClick={() => onPaid(t)} className="text-base">
                I paid this
              </Button>
            )}
          </li>
        ))}
      </ul>
      {transfers.length > 1 && (
        <p className="mt-4 text-sm text-ink-soft">
          {method === "exact"
            ? `${transfers.length} payments is the fewest that settles everyone.`
            : `${transfers.length} payments settle everyone.`}
        </p>
      )}
    </section>
  );
}

// Propose a repayment; the recipient confirms it (backend D17).
export function RepayForm({
  initial,
  onDone,
}: {
  initial?: { toUserId: string; amount: number };
  onDone: () => void;
}) {
  const { groupId, me, members, currency, afterChange } = useGroup();
  const others = members.filter((m) => m.userId !== me);
  const [to, setTo] = useState(initial?.toUserId ?? others[0]?.userId ?? "");
  const [amount, setAmount] = useState(initial ? toInput(initial.amount, currency) : "");
  const [note, setNote] = useState("");
  const [amountError, setAmountError] = useState<string | undefined>();
  const action = useAction();
  const ref = useRef<HTMLDivElement>(null);

  // Opened from further down the page ("I paid this"), so bring it into view.
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    ref.current?.querySelector<HTMLInputElement>("input[inputmode=decimal]")?.focus({ preventScroll: true });
  }, []);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const parsed = parseAmount(amount, currency);
    if (!parsed.ok) return setAmountError(parsed.error);
    if (parsed.value === 0) return setAmountError("Enter an amount above zero.");
    setAmountError(undefined);
    const ok = await action.run(async () => {
      await api(`/groups/${groupId}/payments`, {
        method: "POST",
        body: { toUserId: to, amount: parsed.value, note: note.trim() || null },
      });
      await afterChange();
    });
    if (ok) onDone();
  }

  return (
    <div ref={ref}>
    <Card title="Record a repayment" tone="sky" tilt={0} tape="marker">
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField label="You paid" value={to} onChange={(e) => setTo(e.target.value)}>
            {others.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Amount"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            hint={`in ${currency}`}
            error={amountError}
            className="tabular"
          />
        </div>
        <TextField label="Note (optional)" placeholder="Bank transfer" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="text-sm text-ink-soft">They'll be asked to confirm they got it. It counts once they do.</p>
        {action.error && <Notice>{action.error}</Notice>}
        <div className="flex items-center gap-4">
          <Button variant="primary" type="submit" disabled={action.busy || others.length === 0}>
            {action.busy ? "Saving…" : "Record it"}
          </Button>
          <Button variant="quiet" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
    </div>
  );
}

// Repayments waiting for the recipient: they confirm or reject, the payer can withdraw.
export function PendingCard({ payments }: { payments: Payment[] }) {
  if (payments.length === 0) return null;
  return (
    <Card title="Waiting for confirmation" aside={<Stamp ink="accent">Pending</Stamp>} tone="sky" tape="mint">
      <ul className="space-y-4">
        {payments.map((p) => (
          <PendingRow key={p.id} payment={p} />
        ))}
      </ul>
    </Card>
  );
}

function PendingRow({ payment: p }: { payment: Payment }) {
  const { me, name, currency, afterChange } = useGroup();
  const action = useAction();
  const act = (what: "confirm" | "reject" | "cancel") =>
    action.run(async () => {
      await api(`/payments/${p.id}/${what}`, { method: "POST" });
      await afterChange();
    });
  const amount = <Money amount={p.amount} currency={currency} className={p.toUserId === me ? "text-owed" : ""} />;

  return (
    <li>
      <p className="flex flex-wrap items-center gap-2">
        <MemberAvatar userId={p.fromUserId} size={28} />
        <span>
          {p.fromUserId === me ? (
            <>You say you paid {name(p.toUserId)} {amount}</>
          ) : (
            <>
              <b className="font-medium">{name(p.fromUserId)}</b> says they paid {p.toUserId === me ? "you" : name(p.toUserId)} {amount}
            </>
          )}
        </span>
      </p>
      <p className="mt-0.5 text-sm text-ink-soft">
        {p.note && <>“{p.note}” · </>}
        {timeAgo(p.createdAt)}
        {p.fromUserId === me && <> · waiting for {name(p.toUserId)} to confirm</>}
      </p>
      {(p.toUserId === me || p.fromUserId === me) && (
        <div className="mt-2 flex flex-wrap gap-3">
          {p.toUserId === me && (
            <>
              <Button variant="primary" disabled={action.busy} onClick={() => act("confirm")}>
                Confirm I got {formatMoney(p.amount, currency)}
              </Button>
              <Button disabled={action.busy} onClick={() => act("reject")}>
                I didn't get it
              </Button>
            </>
          )}
          {p.fromUserId === me && (
            <Button variant="quiet" disabled={action.busy} onClick={() => act("cancel")}>
              Withdraw
            </Button>
          )}
        </div>
      )}
      {action.error && (
        <div className="mt-2">
          <Notice>{action.error}</Notice>
        </div>
      )}
    </li>
  );
}
