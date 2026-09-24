import type { ReactNode } from "react";
import { RoughLayer, tiltFor, useSeed } from "./rough";

// A sheet of paper with a hand-drawn edge, slightly askew. Pass tilt={0} for
// cards holding forms or long tables, where a tilt would get in the way.
export function Card({
  title,
  aside,
  tilt,
  taped = false,
  className = "",
  children,
}: {
  title?: ReactNode;
  aside?: ReactNode; // right-hand side of the title row
  tilt?: number;
  taped?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const seed = useSeed();
  const angle = tilt ?? tiltFor(seed);
  return (
    <section className={`relative px-5 pt-4 pb-5 ${className}`} style={{ transform: `rotate(${angle}deg)` }}>
      <RoughLayer
        shape={{ kind: "rect" }}
        seed={seed}
        strokeWidth={1.4}
        roughness={1.5}
        bowing={1.4}
        fill="var(--color-paper)"
        fillStyle="solid"
      />
      {taped && <Tape seed={seed} />}
      <div className="relative">
        {(title || aside) && (
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            {title && <h2 className="font-hand text-2xl leading-tight font-bold">{title}</h2>}
            {aside}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}

// A strip of masking tape holding the card to the page.
function Tape({ seed }: { seed: number }) {
  return (
    <div
      aria-hidden
      className="absolute -top-3 left-1/2 h-6 w-24 bg-ink/10"
      style={{ transform: `translateX(-50%) rotate(${tiltFor(seed * 7, 4)}deg)` }}
    />
  );
}
