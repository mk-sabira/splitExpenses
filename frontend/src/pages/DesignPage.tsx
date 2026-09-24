import { useState, type ReactNode } from "react";
import { Arrow, Button, Card, Checkbox, Choice, Divider, Money, SelectField, Stamp, TextField } from "../ui";
import { RoughLayer, useSeed } from "../ui/rough";

// Living style guide (dev only, /design). Every component shown with sample
// data shaped like the real screens, so the look can be judged in context.

const people = ["Alice", "Bob", "Carol", "Dan"];
type SplitType = "EQUAL" | "SHARES" | "EXACT";

export function DesignPage() {
  return (
    <div className="space-y-12">
      <div>
        <h1 className="font-hand text-5xl font-bold">Style guide</h1>
        <p className="mt-1 max-w-prose text-ink-soft">
          The base components, shown with sample data. Nothing on this page talks to the API.
        </p>
      </div>

      {/* Deliberately uneven: the right column starts lower and the cards lean. */}
      <div className="grid items-start gap-x-10 gap-y-10 md:grid-cols-[1.15fr_1fr]">
        <div className="space-y-10">
          <BalancesSample />
          <PendingSample />
        </div>
        <div className="space-y-10 md:mt-8">
          <ExpenseFormSample />
        </div>
      </div>

      <div className="grid items-start gap-10 md:grid-cols-3">
        <Card title="Buttons">
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="primary">Add expense</Button>
            <Button>Invite</Button>
            <Button variant="quiet">Cancel</Button>
            <Button disabled>Disabled</Button>
          </div>
          <p className="mt-4 text-sm text-ink-soft">
            One primary button per screen. Hover to watch the outline get re-sketched.
          </p>
        </Card>
        <Card title="Marks" className="md:mt-6">
          <div className="flex flex-wrap items-center gap-4">
            <Stamp>Closed</Stamp>
            <Stamp>Pending</Stamp>
            <Stamp>Settled</Stamp>
          </div>
          <Divider className="my-5" />
          <div className="flex items-center gap-3">
            Bob <Arrow /> Alice
          </div>
        </Card>
        <TypeSample />
      </div>

      <Palette />
    </div>
  );
}

function BalancesSample() {
  const rows = [
    { name: "Alice", you: true, net: 6000 },
    { name: "Bob", net: -3000 },
    { name: "Carol", net: -3000 },
    { name: "Dan", net: 0 },
  ];
  return (
    <Card title="Weekend in Lisbon" aside={<span className="text-sm text-ink-soft">EUR · 4 members</span>} taped>
      <table className="w-full">
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="h-9">
              <td className="font-medium">
                {r.name} {r.you && <span className="font-hand text-ink-soft">(you)</span>}
              </td>
              <td className="text-ink-soft">{r.net > 0 ? "is owed" : r.net < 0 ? "owes" : "settled up"}</td>
              <td className="text-right">{r.net !== 0 ? <Money amount={Math.abs(r.net)} currency="EUR" /> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Divider className="my-4" />
      <h3 className="font-hand text-xl font-bold">To settle up</h3>
      <ul className="mt-2 space-y-3">
        {[
          ["Bob", "Alice", 3000],
          ["Carol", "Alice", 3000],
        ].map(([from, to, amount]) => (
          <li key={from} className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-medium">{from}</span>
            <Arrow />
            <span className="font-medium">{to}</span>
            <Money amount={amount as number} currency="EUR" className="ml-auto" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PendingSample() {
  return (
    <Card title="Waiting for you" aside={<Stamp>Pending</Stamp>}>
      <p>
        <span className="font-medium">Bob</span> says they paid you <Money amount={3000} currency="EUR" />.
      </p>
      <p className="mt-1 text-sm text-ink-soft">“Bank transfer, Friday” · 2 hours ago</p>
      <div className="mt-4 flex gap-3">
        <Button variant="primary">Confirm</Button>
        <Button>Reject</Button>
      </div>
    </Card>
  );
}

function ExpenseFormSample() {
  const [split, setSplit] = useState<SplitType>("EXACT");
  const [included, setIncluded] = useState<Record<string, boolean>>({ Alice: true, Bob: true, Carol: true, Dan: false });
  return (
    <Card title="Add an expense" tilt={0}>
      <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
        <TextField label="What for?" placeholder="Dinner at Taberna" defaultValue="Dinner at Taberna" />
        <div className="grid grid-cols-2 gap-5">
          <TextField label="Amount" inputMode="decimal" defaultValue="90.00" hint="in EUR" className="tabular" />
          <SelectField label="Paid by" defaultValue="Alice">
            {people.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </SelectField>
        </div>
        <Choice<SplitType>
          legend="Split"
          value={split}
          onChange={setSplit}
          options={[
            { value: "EQUAL", label: "equally" },
            { value: "SHARES", label: "by shares" },
            { value: "EXACT", label: "exact amounts" },
          ]}
        />
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {people.map((p) => (
            <Checkbox
              key={p}
              label={p}
              checked={included[p]}
              onChange={(e) => setIncluded({ ...included, [p]: e.target.checked })}
            />
          ))}
        </div>
        <TextField label="Bob's part" defaultValue="25.00" className="tabular" error="The parts add up to €85.00, €5.00 short of €90.00." />
        <div className="flex items-center gap-4 pt-1">
          <Button variant="primary" type="submit">
            Add expense
          </Button>
          <Button variant="quiet">Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function TypeSample() {
  return (
    <Card title="Type" className="md:-mt-2">
      <p className="font-hand text-3xl font-bold leading-tight">Kalam for headings</p>
      <p className="mt-2">
        IBM Plex Sans for body text, labels you read quickly, and every number.
      </p>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {[123456, 9000, 1101].map((n) => (
            <tr key={n}>
              <td className="text-ink-soft">tabular figures</td>
              <td className="text-right">
                <Money amount={n} currency="EUR" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Palette() {
  const swatches: [string, string, string][] = [
    ["paper", "var(--color-paper)", "#fdfcf9 · background"],
    ["ink", "var(--color-ink)", "#1f1e1c · lines and text"],
    ["ink-soft", "var(--color-ink-soft)", "#57544e · secondary text"],
    ["ink-faint", "var(--color-ink-faint)", "#b4b0a7 · dividers, placeholders"],
    ["accent", "var(--color-accent)", "#2f4f96 · primary action, active field"],
  ];
  return (
    <section>
      <h2 className="font-hand text-3xl font-bold">Palette</h2>
      <div className="mt-4 flex flex-wrap gap-8">
        {swatches.map(([name, color, note]) => (
          <Swatch key={name} color={color}>
            <span className="font-hand text-lg">{name}</span>
            <span className="block text-xs text-ink-soft">{note}</span>
          </Swatch>
        ))}
      </div>
    </section>
  );
}

function Swatch({ color, children }: { color: string; children: ReactNode }) {
  const seed = useSeed();
  return (
    <div className="w-36">
      <div className="relative h-16">
        <RoughLayer shape={{ kind: "rect" }} seed={seed} fill={color} fillStyle="hachure" hachureGap={4} strokeWidth={1.4} />
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
