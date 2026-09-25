import type { ReactNode } from "react";
import { Link } from "react-router";
import { Arrow, Avatar, Card, Highlight, Money, Stamp, type TapeColor, type Tone } from "../ui";
import { RoughLayer, useSeed } from "../ui/rough";

// How to use Esep, in five steps. The front page shows the short version as a
// path under the pitch; logged-in people get the longer one at /help, linked from the header.

const steps: { title: string; short: string; long: string }[] = [
  {
    title: "Log in or sign up",
    short: "All you need is an email and a password.",
    long: "An account keeps your groups and balances in one place, on any device.",
  },
  {
    title: "Create a group",
    short: "One for each trip, flat or dinner.",
    long: "Give it a name and pick its currency. Every expense in the group uses that currency, and it can't be changed once there's an expense in it.",
  },
  {
    title: "Invite people",
    short: "Send them the group's invite link.",
    long: "Each group has its own invite link, shown next to its members. Anyone who opens it can join, after logging in or signing up.",
  },
  {
    title: "Add expenses",
    short: "As they happen, split however suits. Everyone sees them live.",
    long: "Say who paid and who it was for. Split equally, by shares, or by exact amounts; the form shows each person's part before you save. Everyone in the group sees it straight away.",
  },
  {
    title: "Settle up",
    short: "Esep says who pays whom, and gently reminds anyone who owes, at most once a week.",
    long: "The group page lists the fewest payments that clear every balance. Pay outside Esep, then record it with “I paid this”. It counts once the person you paid confirms they got it. Anyone who still owes gets a friendly reminder, never more than once a week.",
  },
];

export function HelpPage() {
  return (
    <div className="max-w-2xl">
      <h1 className="font-hand text-3xl font-bold sm:text-4xl">
        <Highlight>How Esep works</Highlight>
      </h1>
      <ol className="mt-10 space-y-8">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <StepNumber n={i + 1} />
            <div>
              <h2 className="font-hand text-2xl font-bold">{s.title}</h2>
              <p className="mt-1 text-ink-soft">
                {s.long}
                {i === 0 && " You've done this one."}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-12 font-hand text-xl">
        Ready?{" "}
        <Link to="/groups" className="underline decoration-accent decoration-2 underline-offset-4">
          Go to my groups
        </Link>
      </p>
    </div>
  );
}

// The front-page version: the steps as a path of tilted, taped sticky notes
// running down the page, joined by arrows, each with a small doodle.
const JOURNEY: { tone: Tone; tape: TapeColor; doodle: ReactNode }[] = [
  { tone: "sky", tape: "marker", doodle: <Avatar name="You" size={34} /> },
  {
    tone: "mint",
    tape: "blush",
    doodle: <Highlight className="font-hand text-lg font-bold whitespace-nowrap">Flat 4B</Highlight>,
  },
  {
    tone: "lilac",
    tape: "sky",
    doodle: (
      <span className="flex -space-x-2">
        {["Aigerim", "Bob", "Chen"].map((n) => (
          <Avatar key={n} name={n} size={30} />
        ))}
      </span>
    ),
  },
  {
    tone: "blush",
    tape: "mint",
    doodle: (
      <span className="font-hand text-lg whitespace-nowrap">
        coffee <Money amount={450} currency="EUR" />
      </span>
    ),
  },
  { tone: "sticky", tape: "marker", doodle: <Stamp ink="owed">all square</Stamp> },
];

export function GuideJourney() {
  return (
    <ol>
      {steps.map((s, i) => {
        const { tone, tape, doodle } = JOURNEY[i];
        const right = i % 2 === 1; // every other note steps to the right, so the path zigzags
        return (
          <li key={s.title} className={right ? "sm:ml-16" : "sm:mr-16"}>
            <Card tone={tone} tape={tape} tilt={right ? 0.8 : -0.8}>
              <div className="flex items-center gap-3">
                <StepNumber n={i + 1} tone="paper" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-hand text-2xl leading-tight font-bold">{s.title}</h3>
                  <p className="mt-0.5 text-ink-soft">{s.short}</p>
                </div>
                <span aria-hidden className="hidden shrink-0 sm:block">
                  {doodle}
                </span>
              </div>
            </Card>
            {i < steps.length - 1 && (
              <div aria-hidden className={`flex h-12 items-center ${right ? "justify-start pl-24" : "justify-end pr-24"}`}>
                <span className="inline-block" style={{ transform: `rotate(${right ? 115 : 65}deg)` }}>
                  <Arrow className="w-10" color="var(--color-ink-soft)" />
                </span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// A number with a hand-drawn circle around it. The <ol> already gives screen
// readers the numbering.
function StepNumber({ n, tone }: { n: number; tone?: Tone }) {
  const seed = useSeed();
  return (
    <span aria-hidden className="relative grid size-10 shrink-0 place-items-center font-hand text-xl font-bold">
      <RoughLayer
        shape={{ kind: "ellipse" }}
        seed={seed}
        strokeWidth={1.5}
        roughness={1.6}
        fill={tone && `var(--color-${tone})`}
        fillStyle="solid"
      />
      <span className="relative">{n}</span>
    </span>
  );
}
