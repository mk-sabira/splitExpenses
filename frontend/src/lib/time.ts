const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.35],
  ["month", 12],
  ["year", Infinity],
];

// "just now", "5 minutes ago", "yesterday", "3 weeks ago"…
export function timeAgo(iso: string, now = Date.now()): string {
  let value = (Date.parse(iso) - now) / 1000;
  if (Math.abs(value) < 45) return "just now";
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
    value /= size;
  }
  return rtf.format(Math.round(value), "year");
}

// "24 Sep 2026" for a YYYY-MM-DD date, without time-zone shifts.
export function formatDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
