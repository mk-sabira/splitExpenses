import type { InputHTMLAttributes, ReactNode } from "react";
import { RoughLayer, useSeed } from "./rough";

// A real checkbox (keyboard and screen readers work as usual), drawn as a
// sketched square with a pen tick.
export function Checkbox({
  label,
  className = "",
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode }) {
  const seed = useSeed();
  return (
    <label className={`inline-flex cursor-pointer items-center gap-2.5 select-none ${className}`}>
      <input type="checkbox" className="peer sr-only" {...props} />
      <span className="relative inline-block size-5 shrink-0 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-focus-visible:outline-dashed peer-disabled:opacity-45">
        <RoughLayer shape={{ kind: "rect" }} seed={seed} strokeWidth={1.3} roughness={1.3} />
        {props.checked && (
          <span className="absolute -top-1 left-0.5 size-5">
            <RoughLayer shape={{ kind: "check" }} seed={seed + 1} strokeWidth={2.2} roughness={0.8} />
          </span>
        )}
      </span>
      <span className="peer-disabled:opacity-45">{label}</span>
    </label>
  );
}
