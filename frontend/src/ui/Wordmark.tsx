import { RoughLayer, useSeed } from "./rough";

// The Esep wordmark: heavy Kalam over a highlighter swipe, with a small coin
// doodle tucked against the "p". Scales with `size`; the rest is proportional.
export function Wordmark({ size = "md" }: { size?: "md" | "lg" }) {
  const seed = useSeed();
  const text = size === "lg" ? "text-7xl sm:text-8xl" : "text-5xl";
  const coin = size === "lg" ? "size-9 sm:size-11 -right-8 sm:-right-10 top-1" : "size-6 -right-6 top-0";
  return (
    <span className={`relative inline-block -rotate-3 font-hand leading-none font-bold tracking-tight ${text}`}>
      <span className="absolute inset-x-0 top-[38%] bottom-[2%]">
        <RoughLayer shape={{ kind: "marker" }} seed={seed} fill="var(--color-marker)" roughness={2} className="mix-blend-multiply" />
      </span>
      <span className="relative">Esep</span>
      <span aria-hidden className={`absolute ${coin}`}>
        <RoughLayer
          shape={{ kind: "ellipse" }}
          seed={seed + 1}
          fill="var(--color-crayon-mustard)"
          fillStyle="hachure"
          hachureGap={2.5}
          strokeWidth={size === "lg" ? 2 : 1.4}
          roughness={1.2}
        />
      </span>
    </span>
  );
}
