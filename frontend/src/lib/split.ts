import type { SplitInput } from "./types";

// Client-side copy of the backend's split rules (backend/src/expenses/split.ts,
// D5), used to preview who owes what before saving. The server stays the
// authority; a unit test checks this copy against it on random inputs.

// Per-person amounts for EQUAL and SHARES splits: every share is rounded down,
// then the leftover minor units go one each to whoever lost most in rounding,
// ties to whoever joined the group first.
export function previewShares(
  total: number,
  weights: { userId: string; shares: number }[],
  joinOrder: string[],
): Map<string, number> {
  const rank = new Map(joinOrder.map((id, i) => [id, i]));
  const totalShares = weights.reduce((acc, w) => acc + w.shares, 0);
  if (totalShares === 0) return new Map();
  const parts = weights.map((w) => {
    const scaled = total * w.shares;
    return { userId: w.userId, amount: Math.floor(scaled / totalShares), remainder: scaled % totalShares };
  });
  let leftover = total - parts.reduce((acc, p) => acc + p.amount, 0);
  const byLoss = [...parts].sort(
    (a, b) =>
      b.remainder - a.remainder ||
      (rank.get(a.userId) ?? Infinity) - (rank.get(b.userId) ?? Infinity) ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  for (const p of byLoss) {
    if (leftover === 0) break;
    p.amount += 1;
    leftover -= 1;
  }
  return new Map(parts.map((p) => [p.userId, p.amount]));
}

export function previewSplit(total: number, split: SplitInput, joinOrder: string[]): Map<string, number> {
  switch (split.type) {
    case "EQUAL":
      return previewShares(total, split.participants.map((userId) => ({ userId, shares: 1 })), joinOrder);
    case "SHARES":
      return previewShares(total, split.shares, joinOrder);
    case "EXACT":
      return new Map(split.amounts.map((a) => [a.userId, a.amount]));
  }
}
