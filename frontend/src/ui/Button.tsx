import { useState, type ButtonHTMLAttributes } from "react";
import { RoughLayer, useSeed } from "./rough";

type Variant = "primary" | "default" | "danger" | "quiet";

// primary: the one action that matters on a screen, filled with the accent ink.
// default: outlined. danger: outlined in red, for leaving or destroying.
// quiet: text only, underlined on hover. size="sm" for tight spots like the header.
// The outline is re-sketched on every hover, like a pen going over it again.
export function Button({
  variant = "default",
  className = "",
  children,
  disabled,
  type = "button",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "md" | "sm" }) {
  const seed = useSeed();
  const [pass, setPass] = useState(0);
  const [hover, setHover] = useState(false);
  const s = seed + pass;

  return (
    <button
      type={type}
      disabled={disabled}
      onMouseEnter={() => {
        setHover(true);
        if (!disabled) setPass((n) => n + 1);
      }}
      onMouseLeave={() => setHover(false)}
      className={`relative inline-flex items-center justify-center gap-2 font-hand text-lg leading-none whitespace-nowrap
        transition-transform active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45
        ${variant === "quiet" ? "px-1 py-1" : size === "sm" ? "px-3 pt-1.5 pb-1" : "px-5 pt-2.5 pb-2"}
        ${variant === "primary" ? "font-bold text-paper" : variant === "danger" ? "text-owe" : "text-ink"} ${className}`}
      {...props}
    >
      {variant === "primary" && (
        <RoughLayer
          shape={{ kind: "rect-offset-fill" }}
          seed={s}
          stroke="var(--color-ink)"
          strokeWidth={1.5}
          fill="var(--color-accent)"
          fillStyle="solid"
          roughness={1.3}
        />
      )}
      {(variant === "default" || variant === "danger") && (
        <RoughLayer
          shape={{ kind: "rect" }}
          seed={s}
          stroke={variant === "danger" ? "var(--color-owe)" : undefined}
          strokeWidth={1.5}
          roughness={1.4}
          fill="var(--color-paper)"
          fillStyle="solid"
        />
      )}
      {variant === "quiet" && hover && !disabled && (
        <RoughLayer shape={{ kind: "underline" }} seed={s} strokeWidth={1.4} roughness={1.6} />
      )}
      <span className={`relative ${variant === "primary" ? "-translate-x-px" : ""}`}>{children}</span>
    </button>
  );
}
