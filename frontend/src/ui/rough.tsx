import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import rough from "roughjs";
import type { Drawable, Options } from "roughjs/bin/core";

// Every hand-drawn stroke in the app goes through <RoughLayer>: an SVG that
// fills its (position: relative) parent and redraws only when the parent's
// size or the drawing options change. Seeds are fixed per component, so a
// re-render never makes the lines jitter (D21).

const generator = rough.generator();

export type Shape =
  | { kind: "rect" }
  | { kind: "rect-offset-fill"; offset?: number } // outline + fill printed slightly off-register
  | { kind: "ellipse" }
  | { kind: "underline" }
  | { kind: "hline" }
  | { kind: "check" }
  | { kind: "arrow" };

export interface RoughStyle {
  stroke?: string;
  strokeWidth?: number;
  roughness?: number;
  bowing?: number;
  fill?: string;
  fillStyle?: "hachure" | "solid" | "zigzag" | "cross-hatch" | "dots";
  hachureGap?: number;
  hachureAngle?: number;
}

// Stable positive 31-bit seed from any string (FNV-1a).
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2147483646) + 1;
}

// A seed that stays the same for the lifetime of the component.
export function useSeed() {
  return hash(useId());
}

// Small deterministic tilt in degrees, e.g. for cards: -max..max.
export function tiltFor(seed: number, max = 0.8) {
  return (((seed % 9) - 4) / 4) * max;
}

function draw(shape: Shape, w: number, h: number, o: Options): Drawable[] {
  const p = Math.max(1, o.strokeWidth ?? 1); // keep strokes inside the box
  switch (shape.kind) {
    case "rect":
      return [generator.rectangle(p, p, w - 2 * p, h - 2 * p, o)];
    case "rect-offset-fill": {
      const d = shape.offset ?? 3;
      const { fill, fillStyle, ...outline } = o;
      return [
        generator.rectangle(p + d, p + d, w - 2 * p - d, h - 2 * p - d, { ...o, stroke: "none", fill, fillStyle }),
        generator.rectangle(p, p, w - 2 * p - d, h - 2 * p - d, outline),
      ];
    }
    case "ellipse":
      return [generator.ellipse(w / 2, h / 2, w - 2 * p, h - 2 * p, o)];
    case "underline":
      return [generator.line(p, h - p, w - p, h - p - 1, o)];
    case "hline":
      return [generator.line(0, h / 2, w, h / 2, o)];
    case "check":
      return [generator.linearPath([[w * 0.15, h * 0.55], [w * 0.42, h * 0.85], [w * 0.95, h * 0.05]], o)];
    case "arrow": {
      const y = h / 2;
      const head = Math.min(9, w / 3);
      return [
        generator.line(p, y, w - p, y, o),
        generator.linearPath([[w - p - head, y - head * 0.6], [w - p, y], [w - p - head, y + head * 0.6]], o),
      ];
    }
  }
}

export function RoughLayer({
  shape,
  seed,
  className = "",
  ...style
}: { shape: Shape; seed: number; className?: string } & RoughStyle) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  // Measure the parent's layout size: clientWidth/Height ignore CSS transforms,
  // so a rotated card still gets a box that matches its content.
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  const key = JSON.stringify([shape, style]);
  const paths = useMemo(() => {
    if (!size || size.w < 2 || size.h < 2) return [];
    const options: Options = { roughness: 1.2, bowing: 1, strokeWidth: 1.3, stroke: "var(--color-ink)", ...style, seed };
    return draw(shape, size.w, size.h, options).flatMap((d) => generator.toPaths(d));
    // `key` covers `shape` and `style`, which are new objects on every render.
  }, [size, seed, key]);

  return (
    <svg
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full overflow-visible ${className}`}
    >
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          // Set through `style`, not attributes, so CSS variables work as colours.
          style={{ stroke: p.stroke, strokeWidth: p.strokeWidth, fill: p.fill ?? "none" }}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
