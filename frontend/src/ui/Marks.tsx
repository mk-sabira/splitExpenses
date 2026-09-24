import type { ReactNode } from "react";
import { RoughLayer, useSeed } from "./rough";

// Small hand-drawn marks: dividers, arrows, stamps, highlighter.

export function Divider({ className = "" }: { className?: string }) {
  const seed = useSeed();
  return (
    <div role="separator" className={`relative my-3 h-2 ${className}`}>
      <RoughLayer shape={{ kind: "hline" }} seed={seed} strokeWidth={1} roughness={1.8} stroke="var(--color-ink-faint)" />
    </div>
  );
}

export function Arrow({ className = "w-10", color = "var(--color-ink)" }: { className?: string; color?: string }) {
  const seed = useSeed();
  return (
    <span aria-hidden className={`relative inline-block h-4 shrink-0 ${className}`}>
      <RoughLayer shape={{ kind: "arrow" }} seed={seed} strokeWidth={1.5} roughness={1.4} stroke={color} />
    </span>
  );
}

// A status stamped onto the page in coloured ink.
const stampInk = {
  ink: "var(--color-ink)",
  owe: "var(--color-owe)",
  owed: "var(--color-owed)",
  accent: "var(--color-accent)",
};

export function Stamp({
  children,
  ink = "ink",
  className = "",
}: {
  children: ReactNode;
  ink?: keyof typeof stampInk;
  className?: string;
}) {
  const seed = useSeed();
  return (
    <span
      className={`relative inline-block px-2.5 pt-1 pb-0.5 font-hand text-sm font-bold tracking-widest uppercase ${className}`}
      style={{ transform: `rotate(${seed % 2 ? -3 : 2.5}deg)`, color: stampInk[ink] }}
    >
      <RoughLayer shape={{ kind: "rect" }} seed={seed} strokeWidth={1.8} roughness={2} bowing={2} stroke={stampInk[ink]} />
      <span className="relative">{children}</span>
    </span>
  );
}

// A highlighter swipe behind a few words.
export function Highlight({
  children,
  color = "var(--color-marker)",
  className = "",
}: {
  children: ReactNode;
  color?: string;
  className?: string;
}) {
  const seed = useSeed();
  return (
    <span className={`relative inline-block ${className}`}>
      <RoughLayer shape={{ kind: "marker" }} seed={seed} fill={color} roughness={1.8} className="opacity-80 mix-blend-multiply" />
      <span className="relative">{children}</span>
    </span>
  );
}
