import { formatMoney } from "../lib/money";

// Amounts stay in the plain sans-serif with tabular figures, so columns line up.
export function Money({ amount, currency, className = "" }: { amount: number; currency: string; className?: string }) {
  return <span className={`tabular font-sans font-medium whitespace-nowrap ${className}`}>{formatMoney(amount, currency)}</span>;
}

// A net balance (backend: > 0 is owed money, < 0 owes). Red means owing, green
// means being owed. The words say the same thing, so colour is never the only cue.
export function Balance({
  net,
  currency,
  you = false,
  className = "",
}: {
  net: number;
  currency: string;
  you?: boolean;
  className?: string;
}) {
  if (net === 0) return <span className={`text-ink-soft ${className}`}>settled up</span>;
  const owes = net < 0;
  const words = owes ? (you ? "you owe" : "owes") : you ? "you're owed" : "is owed";
  return (
    <span className={`${owes ? "text-owe" : "text-owed"} ${className}`}>
      <span className="mr-2 whitespace-nowrap">{words}</span>
      <Money amount={Math.abs(net)} currency={currency} className="font-semibold" />
    </span>
  );
}
