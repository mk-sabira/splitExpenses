// Shown while the first data for a screen loads.
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" className="py-16 text-center font-hand text-2xl text-ink-soft">
      {label}
    </p>
  );
}
