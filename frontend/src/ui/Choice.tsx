import { useId, type ReactNode } from "react";
import { RoughLayer, useSeed } from "./rough";

// Pick one of a few options, e.g. the split type. The chosen option is circled
// in pen. Built on native radio buttons, so arrow keys and screen readers work.
export function Choice<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: ReactNode;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
}) {
  const name = useId();
  const seed = useSeed();
  return (
    <fieldset>
      <legend className="font-hand text-lg text-ink-soft">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
        {options.map((o, i) => (
          <label key={o.value} className="relative cursor-pointer px-4 py-2">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
              className="peer sr-only"
            />
            {o.value === value && (
              <RoughLayer shape={{ kind: "ellipse" }} seed={seed + i} strokeWidth={1.6} roughness={1.6} />
            )}
            <span className="relative rounded-sm font-hand text-lg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent peer-focus-visible:outline-dashed">
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
