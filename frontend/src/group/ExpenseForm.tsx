import { useEffect, useMemo, useRef, useState, type SubmitEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatMoney, parseAmount, toInput } from "../lib/money";
import { previewSplit } from "../lib/split";
import type { Category, Expense, SplitInput, SplitType } from "../lib/types";
import { useAction } from "../lib/useAction";
import { Button, Card, Checkbox, Choice, Money, Notice, SelectField, TextField } from "../ui";
import { MemberAvatar, useGroup } from "./context";

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: "FOOD", label: "Food & drink" },
  { value: "GROCERIES", label: "Groceries" },
  { value: "TRANSPORT", label: "Transport" },
  { value: "ACCOMMODATION", label: "Accommodation" },
  { value: "ENTERTAINMENT", label: "Fun" },
  { value: "UTILITIES", label: "Bills" },
  { value: "RENT", label: "Rent" },
  { value: "SHOPPING", label: "Shopping" },
  { value: "OTHER", label: "Other" },
];

const MAX_SHARES = 1000; // the backend's limit

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Add an expense, or edit one (pass `expense`). Shows who owes what while you
// type, using the same rounding as the server (D5, D27).
export function ExpenseForm({ expense, onDone }: { expense?: Expense; onDone: () => void }) {
  const { groupId, me, members, currency, afterChange } = useGroup();
  const joinOrder = useMemo(() => members.map((m) => m.userId), [members]);
  const inSplit = (id: string) => !expense || expense.splits.some((s) => s.userId === id);
  const splitOf = (id: string) => expense?.splits.find((s) => s.userId === id);

  const [description, setDescription] = useState(expense?.description ?? "");
  const [amount, setAmount] = useState(expense ? toInput(expense.amount, currency) : "");
  const [paidBy, setPaidBy] = useState(expense?.paidById ?? me);
  const [date, setDate] = useState(expense?.date ?? today());
  const [category, setCategory] = useState<Category>(expense?.category ?? "FOOD");
  const [comment, setComment] = useState(expense?.comment ?? "");
  const [type, setType] = useState<SplitType>(expense?.splitType ?? "EQUAL");
  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(joinOrder.map((id) => [id, inSplit(id)])),
  );
  const [shares, setShares] = useState<Record<string, string>>(() =>
    Object.fromEntries(joinOrder.map((id) => [id, String(splitOf(id)?.shares ?? (inSplit(id) ? 1 : 0))])),
  );
  const [exact, setExact] = useState<Record<string, string>>(() =>
    Object.fromEntries(joinOrder.map((id) => [id, expense && splitOf(id) ? toInput(splitOf(id)!.amount, currency) : ""])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expense) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [expense]);

  const total = parseAmount(amount, currency);

  // The split as the API wants it, or per-field problems.
  const built = useMemo((): { split: SplitInput } | { errors: Record<string, string> } => {
    const errs: Record<string, string> = {};
    let split: SplitInput;
    if (type === "EQUAL") {
      split = { type, participants: joinOrder.filter((id) => included[id]) };
      if (split.participants.length === 0) errs.split = "Pick at least one person.";
    } else if (type === "SHARES") {
      const list: { userId: string; shares: number }[] = [];
      for (const id of joinOrder) {
        const raw = shares[id]?.trim() || "0";
        const n = Number(raw);
        if (!/^\d+$/.test(raw) || n > MAX_SHARES) errs[`shares.${id}`] = `A whole number from 0 to ${MAX_SHARES}.`;
        else if (n > 0) list.push({ userId: id, shares: n });
      }
      split = { type, shares: list };
      if (list.length === 0 && Object.keys(errs).length === 0) errs.split = "Give at least one person a share.";
    } else {
      const list: { userId: string; amount: number }[] = [];
      for (const id of joinOrder) {
        const raw = exact[id]?.trim() ?? "";
        if (raw === "") continue;
        const parsed = parseAmount(raw, currency);
        if (!parsed.ok) errs[`exact.${id}`] = parsed.error;
        else list.push({ userId: id, amount: parsed.value });
      }
      split = { type, amounts: list };
      if (list.length === 0 && Object.keys(errs).length === 0) errs.split = "Enter at least one person's part.";
    }
    return Object.keys(errs).length > 0 ? { errors: errs } : { split };
  }, [type, joinOrder, included, shares, exact, currency]);

  const preview = total.ok && "split" in built ? previewSplit(total.value, built.split, joinOrder) : new Map<string, number>();
  const exactSum = type === "EXACT" && "split" in built && built.split.type === "EXACT"
    ? built.split.amounts.reduce((acc, a) => acc + a.amount, 0)
    : 0;

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!description.trim()) errs.description = "Say what it was for.";
    if (!total.ok) errs.amount = total.error;
    else if (total.value === 0) errs.amount = "Enter an amount above zero.";
    if ("errors" in built) Object.assign(errs, built.errors);
    else if (total.ok && type === "EXACT" && exactSum !== total.value) {
      errs.split = `The parts add up to ${formatMoney(exactSum, currency)}, not ${formatMoney(total.value, currency)}.`;
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0 || !total.ok || !("split" in built)) return;

    const body = {
      paidById: paidBy,
      amount: total.value,
      description: description.trim(),
      category,
      date,
      comment: comment.trim() || null,
      split: built.split,
    };
    let fieldErrors = false;
    const ok = await action.run(async () => {
      try {
        if (expense) {
          await api(`/groups/${groupId}/expenses/${expense.id}`, { method: "PUT", body: { ...body, version: expense.version } });
        } else {
          await api(`/groups/${groupId}/expenses`, { method: "POST", body });
        }
      } catch (err) {
        if (err instanceof ApiError && Object.keys(err.fields).length > 0) {
          setErrors(err.fields);
          fieldErrors = true;
        }
        throw err;
      }
      await afterChange();
    });
    if (ok) onDone();
    else if (fieldErrors) action.setError(null); // the fields already say what's wrong
  }

  const setAll = (value: boolean) => setIncluded(Object.fromEntries(joinOrder.map((id) => [id, value])));

  return (
    <div ref={ref}>
      <Card title={expense ? "Edit expense" : "Add an expense"} tone="paper" tilt={0} tape="marker">
        <form onSubmit={submit} className="space-y-5" noValidate>
          <TextField
            label="What for?"
            placeholder="Dinner at Navat"
            maxLength={200}
            autoFocus={!expense}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            error={errors.description}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField
              label="Amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              hint={`in ${currency}`}
              error={errors.amount}
              className="tabular"
            />
            <SelectField label="Paid by" value={paidBy} onChange={(e) => setPaidBy(e.target.value)} error={errors.paidById}>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.userId === me ? `${m.name} (you)` : m.name}
                </option>
              ))}
            </SelectField>
            <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
            <SelectField label="Category" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </SelectField>
          </div>

          <div>
            <Choice<SplitType>
              legend="Split"
              value={type}
              onChange={(t) => {
                setType(t);
                setErrors({});
              }}
              options={[
                { value: "EQUAL", label: "equally" },
                { value: "SHARES", label: "by shares" },
                { value: "EXACT", label: "exact amounts" },
              ]}
            />
            {type === "EQUAL" && members.length > 2 && (
              <div className="mt-1 flex gap-3 text-sm">
                <Button variant="quiet" className="text-base" onClick={() => setAll(true)}>
                  everyone
                </Button>
                <Button variant="quiet" className="text-base" onClick={() => setAll(false)}>
                  no one
                </Button>
              </div>
            )}
            <ul className="mt-3 space-y-2" aria-label="Who's in the split">
              {members.map((m) => (
                <li key={m.userId} className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
                  {type === "EQUAL" ? (
                    <Checkbox
                      label={m.name}
                      checked={!!included[m.userId]}
                      onChange={(e) => setIncluded({ ...included, [m.userId]: e.target.checked })}
                    />
                  ) : (
                    <span className="flex items-center gap-2">
                      <MemberAvatar userId={m.userId} size={26} />
                      {m.name}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-3">
                    {type === "SHARES" && (
                      <span className="w-20">
                        <TextField
                          label={<span className="sr-only">{m.name}'s shares</span>}
                          inputMode="numeric"
                          value={shares[m.userId] ?? ""}
                          onChange={(e) => setShares({ ...shares, [m.userId]: e.target.value })}
                          error={errors[`shares.${m.userId}`]}
                          className="tabular text-right"
                        />
                      </span>
                    )}
                    {type === "EXACT" ? (
                      <span className="w-28">
                        <TextField
                          label={<span className="sr-only">{m.name}'s part</span>}
                          inputMode="decimal"
                          placeholder="0.00"
                          value={exact[m.userId] ?? ""}
                          onChange={(e) => setExact({ ...exact, [m.userId]: e.target.value })}
                          error={errors[`exact.${m.userId}`]}
                          className="tabular text-right"
                        />
                      </span>
                    ) : (
                      <span className="w-24 text-right text-ink-soft" aria-live="polite">
                        {preview.has(m.userId) ? <Money amount={preview.get(m.userId)!} currency={currency} /> : "—"}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {type === "EXACT" && total.ok && total.value > 0 && (
              <p className="mt-2 text-right text-sm" aria-live="polite">
                {exactSum === total.value ? (
                  <span className="text-owed">✓ adds up to <Money amount={total.value} currency={currency} /></span>
                ) : exactSum < total.value ? (
                  <span className="text-owe"><Money amount={total.value - exactSum} currency={currency} /> left to assign</span>
                ) : (
                  <span className="text-owe"><Money amount={exactSum - total.value} currency={currency} /> too much</span>
                )}
              </p>
            )}
            {errors.split && (
              <p role="alert" className="mt-2 text-sm font-medium">
                <span aria-hidden className="mr-1 font-hand text-base font-bold">✗</span>
                {errors.split}
              </p>
            )}
          </div>

          <TextField
            label="Comment (optional)"
            maxLength={1000}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            error={errors.comment}
          />
          {action.error && <Notice>{action.error}</Notice>}
          <div className="flex items-center gap-4">
            <Button variant="primary" type="submit" disabled={action.busy}>
              {action.busy ? "Saving…" : expense ? "Save changes" : "Add expense"}
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
