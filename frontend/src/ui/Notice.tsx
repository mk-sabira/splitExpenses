import type { ReactNode } from "react";
import { RoughLayer, useSeed } from "./rough";

// A small boxed message: form-level errors, or a short confirmation.
export function Notice({ tone = "error", children }: { tone?: "error" | "info"; children: ReactNode }) {
  const seed = useSeed();
  return (
    <div role={tone === "error" ? "alert" : "status"} className="relative px-4 py-3">
      <RoughLayer
        shape={{ kind: "rect" }}
        seed={seed}
        fill={tone === "error" ? "var(--color-blush)" : "var(--color-sky)"}
        fillStyle="solid"
        roughness={1.4}
      />
      <p className="relative text-sm font-medium">
        {tone === "error" && <span aria-hidden className="mr-1.5 font-hand text-base font-bold">✗</span>}
        {children}
      </p>
    </div>
  );
}
