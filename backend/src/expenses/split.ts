import { HttpError } from "../lib/errors";

// All amounts are integer minor units (D2).
export type SplitInput =
  | { type: "EQUAL"; participants: string[] }
  | { type: "SHARES"; shares: { userId: string; shares: number }[] }
  | { type: "EXACT"; amounts: { userId: string; amount: number }[] };

export interface ResolvedSplit {
  userId: string;
  shares: number | null; // weight as entered: 1 for EQUAL, N for SHARES, null for EXACT
  amount: number;
}

export function participantIds(split: SplitInput): string[] {
  switch (split.type) {
    case "EQUAL":
      return split.participants;
    case "SHARES":
      return split.shares.map((s) => s.userId);
    case "EXACT":
      return split.amounts.map((a) => a.userId);
  }
}

// Resolves a split into per-person amounts that always sum exactly to `total`.
// `joinOrder` lists group members by (joinedAt, userId) and breaks rounding ties (D5).
export function resolveSplit(total: number, split: SplitInput, joinOrder: string[]): ResolvedSplit[] {
  if (split.type === "EXACT") {
    const sum = split.amounts.reduce((acc, a) => acc + a.amount, 0);
    if (sum !== total) {
      throw new HttpError(400, `Exact amounts add up to ${sum}, but the expense total is ${total}`);
    }
    return split.amounts.map((a) => ({ userId: a.userId, shares: null, amount: a.amount }));
  }
  const weights =
    split.type === "EQUAL"
      ? split.participants.map((userId) => ({ userId, shares: 1 }))
      : split.shares;
  return largestRemainder(total, weights, joinOrder);
}

// Largest remainder method (D5): every share is rounded down, then the leftover
// minor units go one each to the participants who lost the most in rounding.
// Ties go to whoever joined the group first.
function largestRemainder(
  total: number,
  weights: { userId: string; shares: number }[],
  joinOrder: string[],
): ResolvedSplit[] {
  const rank = new Map(joinOrder.map((id, i) => [id, i]));
  const totalShares = weights.reduce((acc, w) => acc + w.shares, 0);

  // Exact share = total * shares / totalShares. The integer part is the rounded-down
  // amount; the remainder (out of totalShares) is how much rounding took away.
  // total <= 2^31 and totalShares is capped by validation, so this stays well
  // inside Number.MAX_SAFE_INTEGER.
  const parts = weights.map((w) => {
    const scaled = total * w.shares;
    return {
      userId: w.userId,
      shares: w.shares,
      amount: Math.floor(scaled / totalShares),
      remainder: scaled % totalShares,
    };
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

  return parts.map(({ userId, shares, amount }) => ({ userId, shares, amount }));
}
