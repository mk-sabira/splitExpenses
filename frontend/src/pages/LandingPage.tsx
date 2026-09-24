import { useNavigate } from "react-router";
import { Arrow, Avatar, Balance, Button, Card, Choice, Highlight, Money, Stamp, TextField, Wordmark, type TapeColor, type Tone } from "../ui";

// The logged-out front page: what Esep is, a coloured sample of a group, and
// the log-in / sign-up form. The form isn't wired to the API yet; that comes
// with the auth screens.

type Mode = "login" | "register";

const features: { title: string; body: string; tone: Tone; tape: TapeColor }[] = [
  { title: "Split any way", body: "Equally, by shares, or exact amounts. Every cent adds up.", tone: "sky", tape: "marker" },
  { title: "Fewest payments", body: "Esep works out who pays whom, in as few transfers as possible.", tone: "mint", tape: "blush" },
  { title: "Live for everyone", body: "Add a coffee and the whole group sees it straight away.", tone: "lilac", tape: "sky" },
  { title: "Gentle nudges", body: "A friendly reminder to whoever owes. Never more than once a week.", tone: "blush", tape: "mint" },
];

export function LandingPage({ mode }: { mode: Mode }) {
  return (
    <div className="min-h-screen overflow-x-hidden">
      <main className="mx-auto grid max-w-6xl gap-x-12 gap-y-12 px-4 pt-10 pb-20 sm:px-6 md:grid-cols-12 md:pt-14">
        <section className="md:col-span-7">
          <Wordmark size="lg" />
          <h1 className="mt-8 max-w-xl font-hand text-4xl leading-tight font-bold sm:text-5xl">
            Shared costs, <Highlight>kept friendly</Highlight>.
          </h1>
          <p className="mt-4 max-w-lg text-lg text-ink-soft">
            Esep keeps track of who paid for what on trips, in shared flats and at dinners, then tells everyone
            exactly how to settle up.
          </p>
        </section>

        <div className="md:col-span-5 md:row-span-2">
          <AuthCard mode={mode} />
        </div>

        <section className="md:col-span-7" aria-label="How it looks">
          <SampleGroup />
        </section>

        <section className="grid gap-x-8 gap-y-10 sm:grid-cols-2 md:col-span-12 md:grid-cols-4" aria-label="Features">
          {features.map((f, i) => (
            <Card key={f.title} tone={f.tone} tape={f.tape} className={i % 2 ? "md:mt-6" : ""}>
              <h2 className="font-hand text-2xl font-bold">{f.title}</h2>
              <p className="mt-1 text-ink-soft">{f.body}</p>
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}

function AuthCard({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  return (
    <Card tilt={0} tape="marker" className="md:sticky md:top-10">
      <Choice<Mode>
        legend={<span className="sr-only">Log in or sign up</span>}
        value={mode}
        onChange={(m) => navigate(m === "login" ? "/login" : "/register")}
        options={[
          { value: "login", label: <span className="text-2xl font-bold">log in</span> },
          { value: "register", label: <span className="text-2xl font-bold">sign up</span> },
        ]}
      />
      <form className="mt-4 space-y-5" onSubmit={(e) => e.preventDefault()}>
        {mode === "register" && <TextField label="Your name" autoComplete="name" required />}
        <TextField label="Email" type="email" autoComplete="email" required />
        <TextField
          label="Password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          hint={mode === "register" ? "At least 8 characters." : undefined}
          required
        />
        <Button variant="primary" type="submit" className="w-full">
          {mode === "login" ? "Log in" : "Create my account"}
        </Button>
      </form>
      <p className="mt-5 text-sm text-ink-soft">
        Got an invite link? Open it after logging in and you'll join the group straight away.
      </p>
    </Card>
  );
}

// A small, static picture of a group: who's owed, who owes, and how to settle.
function SampleGroup() {
  const people = [
    { name: "Aigerim", net: 6000 },
    { name: "Bob", net: -3500 },
    { name: "Chen", net: -2500 },
  ];
  return (
    <div className="relative">
      <Card
        title="Weekend in Almaty"
        aside={<span className="text-sm text-ink-soft">EUR · 3 people</span>}
        tone="sticky"
        tape="blush"
        className="sm:mr-16"
      >
        <ul className="space-y-2.5">
          {people.map((p) => (
            <li key={p.name} className="flex items-center gap-3">
              <Avatar name={p.name} />
              <span className="font-medium">{p.name}</span>
              <Balance net={p.net} currency="EUR" className="ml-auto" />
            </li>
          ))}
        </ul>
      </Card>
      {/* Tucked under the balances card's corner, clear of the amounts. */}
      <Card tone="paper" className="-mt-3 ml-auto w-full max-w-xs" tilt={2.5}>
        <p className="font-hand text-lg font-bold">To settle up</p>
        <p className="mt-1 flex items-center gap-2">
          Bob <Arrow className="w-8" color="var(--color-owe)" /> Aigerim <Money amount={3500} currency="EUR" className="ml-auto" />
        </p>
        <p className="mt-1 flex items-center gap-2">
          Chen <Arrow className="w-8" color="var(--color-owe)" /> Aigerim <Money amount={2500} currency="EUR" className="ml-auto" />
        </p>
        <Stamp ink="owed" className="mt-3">2 payments</Stamp>
      </Card>
    </div>
  );
}
