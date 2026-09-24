import { RoughLayer, useSeed } from "./rough";

const CRAYONS = ["coral", "teal", "mustard", "violet", "sky", "rose"] as const;

// Stable colour per person: from a position (e.g. join order in a group, so
// the first six members always differ) or else from a hash of their id.
export function crayonFor(key: string | number) {
  let h = typeof key === "number" ? key : 0;
  if (typeof key === "string") for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `var(--color-crayon-${CRAYONS[h % CRAYONS.length]})`;
}

// A member as a crayon-filled circle with their initial.
export function Avatar({ name, colorKey, size = 36 }: { name: string; colorKey?: string | number; size?: number }) {
  const seed = useSeed();
  return (
    <span
      aria-hidden
      className="relative inline-flex shrink-0 items-center justify-center font-hand font-bold"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      <RoughLayer
        shape={{ kind: "ellipse" }}
        seed={seed}
        fill={crayonFor(colorKey ?? name)}
        fillStyle="hachure"
        hachureGap={2.6}
        fillWeight={1.5}
        hachureAngle={-50}
        strokeWidth={1.4}
        roughness={1.3}
      />
      {/* Drawn with CSS, so the letter isn't part of the page's text or selection. */}
      <span className="relative leading-none after:content-[attr(data-initial)]" data-initial={name.slice(0, 1).toUpperCase()} />
    </span>
  );
}
