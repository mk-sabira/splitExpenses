import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  Arrow,
  Avatar,
  Balance,
  Button,
  Card,
  Checkbox,
  Choice,
  Divider,
  Highlight,
  Money,
  SelectField,
  Stamp,
  TextField,
  Wordmark,
} from "../ui";
import { RoughLayer, useSeed } from "../ui/rough";

// Living style guide (dev only, /design). Every component shown with sample
// data shaped like the real screens, so the look can be judged in context.

const people = ["Alice", "Bob", "Carol", "Dan"];
type SplitType = "EQUAL" | "SHARES" | "EXACT";

export function DesignPage() {
  return (
    <div className="space-y-14">
      <div>
        <h1 className="font-hand text-5xl font-bold">
          <Highlight>Style guide</Highlight>
        </h1>
        <p className="mt-2 max-w-prose text-ink-soft">
          The base components, shown with sample data. Nothing on this page talks to the API. The front page is at{" "}
          <Link to="/login" className="font-medium text-ink underline decoration-accent decoration-2 underline-offset-4">
            /login
          </Link>
          .
        </p>
      </div>

      <section className="flex flex-wrap items-end gap-x-16 gap-y-8">
        <Wordmark size="lg" />
        <Wordmark />
      </section>

      <YouSummarySample />

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
        <Card title="Buttons" tone="sky" tape="marker">
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="primary">Add expense</Button>
            <Button>Invite</Button>
            <Button variant="danger">Log out</Button>
            <Button variant="quiet">Cancel</Button>
            <Button disabled>Disabled</Button>
          </div>
          <p className="mt-4 text-sm text-ink-soft">
            One primary button per screen. Hover to watch the outline get re-sketched.
          </p>
        </Card>
        <Card title="Marks" tone="lilac" tape="mint" className="md:mt-6">
          <div className="flex flex-wrap items-center gap-4">
            <Stamp ink="owe">Closed</Stamp>
            <Stamp ink="accent">Pending</Stamp>
            <Stamp ink="owed">Settled</Stamp>
          </div>
          <Divider className="my-5" />
          <div className="flex items-center gap-3">
            Bob <Arrow color="var(--color-owe)" /> Alice
          </div>
          <p className="mt-4">
            Some <Highlight>highlighted</Highlight> words.
          </p>
        </Card>
        <TypeSample />
      </div>

      <Palette />
    </div>
  );
}

function YouSummarySample() {
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-8">
      <Card tone="blush" tape="sky" className="min-w-64">
        <p className="font-hand text-xl text-ink-soft">In Weekend in Lisbon</p>
        <p className="mt-1 font-hand text-4xl font-bold text-owe">
          you owe <Money amount={3000} currency="EUR" className="font-semibold" />
        </p>
      </Card>
      <Card tone="mint" tape="marker" className="min-w-64 md:mt-4">
        <p className="font-hand text-xl text-ink-soft">In Flat 4B</p>
        <p className="mt-1 font-hand text-4xl font-bold text-owed">
          you're owed <Money amount={12550} currency="EUR" className="font-semibold" />
        </p>
      </Card>
      <Card tone="paper" className="min-w-64">
        <p className="font-hand text-xl text-ink-soft">In Book club</p>
        <p className="mt-1 font-hand text-4xl font-bold">
          all <Highlight>settled up</Highlight>
        </p>
      </Card>
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
    <Card
      title="Weekend in Lisbon"
      aside={<span className="text-sm text-ink-soft">EUR · 4 members</span>}
      tone="sticky"
      tape="blush"
    >
      <ul className="space-y-2.5">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center gap-3">
            <Avatar name={r.name} />
            <span className="font-medium">
              {r.name} {r.you && <span className="font-hand text-ink-soft">(you)</span>}
            </span>
            <Balance net={r.net} currency="EUR" className="ml-auto" />
          </li>
        ))}
      </ul>
      <Divider className="my-4" />
      <h3 className="font-hand text-xl font-bold">To settle up</h3>
      <ul className="mt-2 space-y-3">
        {[
          ["Bob", "Alice", 3000],
          ["Carol", "Alice", 3000],
        ].map(([from, to, amount]) => (
          <li key={from} className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
            <Avatar name={from as string} size={28} />
            <span className="font-medium">{from}</span>
            <Arrow color="var(--color-owe)" />
            <Avatar name={to as string} size={28} />
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
    <Card title="Waiting for you" aside={<Stamp ink="accent">Pending</Stamp>} tone="sky">
      <p className="flex flex-wrap items-center gap-2">
        <Avatar name="Bob" size={28} />
        <span>
          <span className="font-medium">Bob</span> says they paid you{" "}
          <Money amount={3000} currency="EUR" className="text-owed" />.
        </span>
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
    <Card title="Add an expense" tilt={0} tape="marker">
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
        <TextField
          label="Bob's part"
          defaultValue="25.00"
          className="tabular"
          error="The parts add up to €85.00, €5.00 short of €90.00."
        />
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
    <Card title="Type" tone="mint" tape="sky" className="md:-mt-2">
      <p className="font-hand text-3xl leading-tight font-bold">Kalam for headings</p>
      <p className="mt-2">IBM Plex Sans for body text, labels you read quickly, and every number.</p>
      <table className="mt-3 w-full text-sm">
        <tbody>
          <tr>
            <td className="text-ink-soft">owed to you</td>
            <td className="text-right">
              <Money amount={123456} currency="EUR" className="text-owed" />
            </td>
          </tr>
          <tr>
            <td className="text-ink-soft">you owe</td>
            <td className="text-right">
              <Money amount={9000} currency="EUR" className="text-owe" />
            </td>
          </tr>
          <tr>
            <td className="text-ink-soft">neutral</td>
            <td className="text-right">
              <Money amount={1101} currency="EUR" />
            </td>
          </tr>
        </tbody>
      </table>
    </Card>
  );
}

const palette: { group: string; swatches: [string, string, string?][] }[] = [
  {
    group: "Ink",
    swatches: [
      ["ink", "#1f1e1c", "lines, text"],
      ["ink-soft", "#57544e", "secondary text"],
      ["ink-faint", "#b4b0a7", "dividers"],
    ],
  },
  {
    group: "Meaning",
    swatches: [
      ["accent", "#2f4f96", "primary action"],
      ["owe", "#c0392b", "you owe"],
      ["owed", "#2e7d4f", "you're owed"],
      ["marker", "#ffd84d", "highlight"],
    ],
  },
  {
    group: "Sticky notes",
    swatches: [
      ["paper", "#fdfbf6"],
      ["sticky", "#fff3b8"],
      ["sky", "#dfe9fb"],
      ["blush", "#fbdcd3"],
      ["mint", "#d8efdd"],
      ["lilac", "#e8def8"],
    ],
  },
  {
    group: "Crayons (avatars)",
    swatches: ["coral", "teal", "mustard", "violet", "sky", "rose"].map((c) => [`crayon-${c}`, ""]),
  },
];

function Palette() {
  return (
    <section>
      <h2 className="font-hand text-3xl font-bold">Palette</h2>
      <div className="mt-4 space-y-8">
        {palette.map(({ group, swatches }) => (
          <div key={group}>
            <h3 className="font-hand text-xl text-ink-soft">{group}</h3>
            <div className="mt-2 flex flex-wrap gap-6">
              {swatches.map(([name, hex, use]) => (
                <Swatch key={name} color={`var(--color-${name})`}>
                  <span className="font-hand text-lg">{name.replace("crayon-", "")}</span>
                  <span className="block text-xs text-ink-soft">
                    {[hex, use].filter(Boolean).join(" · ")}
                  </span>
                </Swatch>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Swatch({ color, children }: { color: string; children: ReactNode }) {
  const seed = useSeed();
  return (
    <div className="w-28">
      <div className="relative h-12">
        <RoughLayer shape={{ kind: "rect" }} seed={seed} fill={color} fillStyle="solid" strokeWidth={1.4} />
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
