import type { ReactNode } from "react";
import { RoughLayer, useSeed } from "./rough";

// Small hand-drawn marks: dividers, arrows, rubber stamps.

export function Divider({ className = "" }: { className?: string }) {
  const seed = useSeed();
  return (
    <div role="separator" className={`relative my-3 h-2 ${className}`}>
      <RoughLayer shape={{ kind: "hline" }} seed={seed} strokeWidth={1} roughness={1.8} stroke="var(--color-ink-faint)" />
    </div>
  );
}

export function Arrow({ className = "w-10" }: { className?: string }) {
  const seed = useSeed();
  return (
    <span aria-hidden className={`relative inline-block h-4 shrink-0 ${className}`}>
      <RoughLayer shape={{ kind: "arrow" }} seed={seed} strokeWidth={1.4} roughness={1.4} />
    </span>
  );
}

// A status stamped onto the page: CLOSED, PENDING, SETTLED…
export function Stamp({ children, className = "" }: { children: ReactNode; className?: string }) {
  const seed = useSeed();
  return (
    <span
      className={`relative inline-block px-2.5 pt-1 pb-0.5 font-hand text-sm font-bold tracking-widest uppercase ${className}`}
      style={{ transform: `rotate(${seed % 2 ? -3 : 2.5}deg)` }}
    >
      <RoughLayer shape={{ kind: "rect" }} seed={seed} strokeWidth={1.6} roughness={2} bowing={2} />
      <span className="relative">{children}</span>
    </span>
  );
}
