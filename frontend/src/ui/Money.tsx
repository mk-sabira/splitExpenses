import { formatMoney } from "../lib/money";

// Amounts stay in the plain sans-serif with tabular figures, so columns line up.
export function Money({ amount, currency, className = "" }: { amount: number; currency: string; className?: string }) {
  return <span className={`tabular font-medium whitespace-nowrap ${className}`}>{formatMoney(amount, currency)}</span>;
}
