import { useId, type ReactNode } from "react";
import { RoughLayer, tiltFor, useSeed } from "./rough";

export type Tone = "paper" | "sticky" | "sky" | "blush" | "mint" | "lilac";
export type TapeColor = "marker" | "blush" | "sky" | "mint";

// A sheet of paper with a hand-drawn edge, slightly askew. `tone` picks a
// pale sticky-note fill; `tape` pins it to the page with a strip of washi tape.
// Pass tilt={0} for cards holding forms or long tables.
export function Card({
  title,
  aside,
  tilt,
  tone = "paper",
  tape,
  className = "",
  children,
}: {
  title?: ReactNode;
  aside?: ReactNode; // right-hand side of the title row
  tilt?: number;
  tone?: Tone;
  tape?: TapeColor;
  className?: string;
  children: ReactNode;
}) {
  const seed = useSeed();
  const titleId = useId();
  const angle = tilt ?? tiltFor(seed);
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={`relative px-5 pt-4 pb-5 ${className}`}
      style={{ transform: `rotate(${angle}deg)` }}
    >
      <RoughLayer
        shape={{ kind: "rect" }}
        seed={seed}
        strokeWidth={1.4}
        roughness={1.5}
        bowing={1.4}
        fill={`var(--color-${tone})`}
        fillStyle="solid"
      />
      {tape && <Tape seed={seed} color={tape} />}
      <div className="relative">
        {(title || aside) && (
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            {title && (
              <h2 id={titleId} className="font-hand text-2xl leading-tight font-bold">
                {title}
              </h2>
            )}
            {aside}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}

// A strip of translucent washi tape holding the card to the page.
function Tape({ seed, color }: { seed: number; color: TapeColor }) {
  return (
    <div
      aria-hidden
      className="absolute -top-3 left-1/2 h-6 w-24 opacity-90 mix-blend-multiply"
      style={{
        transform: `translateX(-50%) rotate(${tiltFor(seed * 7, 4)}deg)`,
        background: `repeating-linear-gradient(135deg, var(--color-${color}) 0 6px, color-mix(in srgb, var(--color-${color}) 70%, white) 6px 12px)`,
      }}
    />
  );
}
