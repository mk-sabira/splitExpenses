// Formats integer minor units (D2) for people to read, e.g. 123456 EUR → "€1,234.56",
// 3000 JPY → "¥3,000". Display only: never parse the result back into an amount.
export function formatMoney(amount: number, currency: string): string {
  const format = new Intl.NumberFormat("en", { style: "currency", currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amount / 10 ** digits);
}
