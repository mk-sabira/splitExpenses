// Amounts arrive as integer minor units in the group's currency (backend D2).
// Same formatting as the backend's emails: 123456 EUR → "€1,234.56", 3000 JPY → "¥3,000".
export function formatMoney(amount: number, currency: string): string {
  const format = new Intl.NumberFormat("en", { style: "currency", currency });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  return format.format(amount / 10 ** digits);
}
