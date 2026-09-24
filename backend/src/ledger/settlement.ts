import type { MemberBalance } from "./balances";

export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amount: number; // minor units, > 0
}

export interface SettlementPlan {
  transfers: Transfer[];
  // "exact": provably the fewest transfers. "greedy": at most n − 1, used when
  // too many people have non-zero balances for the exact search (D6).
  method: "exact" | "greedy";
}

// 2^15 subsets × 15 people ≈ 500k steps: a few milliseconds.
export const EXACT_LIMIT = 15;

// Minimum-transfer settlement (D6).
//
// Any group of people whose balances sum to zero can settle among themselves
// with (size − 1) transfers. So the fewest transfers overall is
//   n − (the largest number of disjoint zero-sum groups the people split into).
// Finding that split is NP-hard, so it's searched exactly over all subsets when
// n ≤ EXACT_LIMIT, and each group is then settled greedily. Above the limit, the
// whole set is settled greedily, which still needs at most n − 1 transfers.
export function settle(balances: MemberBalance[]): SettlementPlan {
  // Sorted by user id so the same balances always give the same plan.
  const people = balances
    .filter((b) => b.net !== 0)
    .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  if (people.reduce((acc, p) => acc + p.net, 0) !== 0) {
    throw new Error("Balances don't sum to zero");
  }
  if (people.length > EXACT_LIMIT) {
    return { transfers: greedy(people), method: "greedy" };
  }
  return { transfers: zeroSumGroups(people).flatMap(greedy), method: "exact" };
}

// Splits people into the largest possible number of disjoint zero-sum groups.
//
// best[mask] = the most zero-sum groups the people in `mask` can be split into,
// where each group is a contiguous run in some ordering of the mask. Adding one
// person to a smaller mask never loses a group, and completes a new one exactly
// when the whole mask sums to zero:
//   best[mask] = max over i in mask of best[mask − i]  (+1 if sum[mask] = 0)
function zeroSumGroups(people: MemberBalance[]): MemberBalance[][] {
  const n = people.length;
  if (n === 0) return [];
  const full = (1 << n) - 1;
  const sum = new Float64Array(full + 1); // exact: |sums| stay far below 2^53
  const best = new Int8Array(full + 1);

  for (let mask = 1; mask <= full; mask++) {
    const low = 31 - Math.clz32(mask & -mask);
    sum[mask] = sum[mask & (mask - 1)] + people[low].net;
    let most = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) most = Math.max(most, best[mask ^ (1 << i)]);
    }
    best[mask] = most + (sum[mask] === 0 ? 1 : 0);
  }

  // Walk back from the full set, removing one person at a time along an optimal
  // path. Every time the remaining set sums to zero, the people removed since
  // the previous such point form one zero-sum group.
  const groups: MemberBalance[][] = [];
  let current: MemberBalance[] = [];
  let mask = full;
  while (mask !== 0) {
    const bonus = sum[mask] === 0 ? 1 : 0;
    let i = 0;
    while (!(mask & (1 << i) && best[mask ^ (1 << i)] + bonus === best[mask])) {
      // Can't happen if `best` is correct; fail loudly rather than loop forever.
      if (++i >= n) throw new Error("Settlement table is inconsistent");
    }
    current.push(people[i]);
    mask ^= 1 << i;
    if (sum[mask] === 0) {
      groups.push(current);
      current = [];
    }
  }
  return groups;
}

// Largest debtor pays largest creditor, repeatedly. Each transfer settles at
// least one person and the last settles two, so a group of k needs ≤ k − 1.
// Ties are broken by user id so the plan is deterministic.
function greedy(group: MemberBalance[]): Transfer[] {
  const byId = (a: MemberBalance, b: MemberBalance) => (a.userId < b.userId ? -1 : 1);
  const debtors = group.filter((p) => p.net < 0).map((p) => ({ ...p, net: -p.net }));
  const creditors = group.filter((p) => p.net > 0).map((p) => ({ ...p }));
  const transfers: Transfer[] = [];

  for (;;) {
    debtors.sort((a, b) => b.net - a.net || byId(a, b));
    creditors.sort((a, b) => b.net - a.net || byId(a, b));
    const d = debtors[0];
    const c = creditors[0];
    if (!d || d.net === 0) break;
    const amount = Math.min(d.net, c.net);
    transfers.push({ fromUserId: d.userId, toUserId: c.userId, amount });
    d.net -= amount;
    c.net -= amount;
  }
  return transfers;
}
