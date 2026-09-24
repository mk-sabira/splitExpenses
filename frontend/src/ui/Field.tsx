import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { RoughLayer, useSeed } from "./rough";

// Form fields are written on a hand-drawn line rather than boxed in. The line
// turns accent-blue while the field is being edited.

function FieldFrame({
  label,
  hint,
  error,
  id,
  focused,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  id: string;
  focused: boolean;
  children: ReactNode;
}) {
  const seed = useSeed();
  return (
    <div className="block">
      <label htmlFor={id} className="font-hand text-lg text-ink-soft">
        {label}
      </label>
      <div className="relative">
        {children}
        <RoughLayer
          shape={{ kind: "underline" }}
          seed={seed}
          stroke={focused ? "var(--color-accent)" : "var(--color-ink)"}
          strokeWidth={focused ? 2 : 1.3}
          roughness={1.4}
        />
      </div>
      {error ? (
        <p id={`${id}-msg`} role="alert" className="mt-1.5 text-sm font-medium text-ink">
          <span aria-hidden className="mr-1 font-hand text-base font-bold">✗</span>
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-msg`} className="mt-1.5 text-sm text-ink-soft">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

const control = "w-full bg-transparent px-0.5 pt-1 pb-2 text-base text-ink outline-none placeholder:text-ink-faint";

export function TextField({
  label,
  hint,
  error,
  className = "",
  onFocus,
  onBlur,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode; error?: ReactNode }) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  return (
    <FieldFrame label={label} hint={hint} error={error} id={id} focused={focused}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={`${control} ${className}`}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
      />
    </FieldFrame>
  );
}

export function SelectField({
  label,
  hint,
  error,
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: ReactNode; hint?: ReactNode; error?: ReactNode }) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  return (
    <FieldFrame label={label} hint={hint} error={error} id={id} focused={focused}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={`${control} cursor-pointer appearance-none pr-6 ${className}`}
        {...props}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        {children}
      </select>
      <span aria-hidden className="pointer-events-none absolute top-1 right-1 font-hand text-lg">
        ⌄
      </span>
    </FieldFrame>
  );
}
