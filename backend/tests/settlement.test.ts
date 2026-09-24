import { describe, expect, it } from "vitest";
import type { MemberBalance } from "../src/ledger/balances";
import { EXACT_LIMIT, settle, type SettlementPlan } from "../src/ledger/settlement";
import { rng } from "./helpers";

const people = (...nets: number[]): MemberBalance[] => nets.map((net, i) => ({ userId: `u${String(i).padStart(2, "0")}`, net }));

// Every plan must settle everyone exactly, with positive whole amounts, where
// only debtors pay and only creditors receive, in at most n − 1 transfers.
function expectValid(balances: MemberBalance[], plan: SettlementPlan, context = "") {
  const left = new Map(balances.map((b) => [b.userId, b.net]));
  for (const t of plan.transfers) {
    expect(Number.isInteger(t.amount) && t.amount > 0, context).toBe(true);
    const from = balances.find((b) => b.userId === t.fromUserId)!;
    const to = balances.find((b) => b.userId === t.toUserId)!;
    expect(from.net < 0 && to.net > 0, `${context} ${JSON.stringify(t)}`).toBe(true);
    left.set(t.fromUserId, left.get(t.fromUserId)! + t.amount);
    left.set(t.toUserId, left.get(t.toUserId)! - t.amount);
  }
  expect([...left.values()].every((n) => n === 0), context).toBe(true);
  const nonZero = balances.filter((b) => b.net !== 0).length;
  expect(plan.transfers.length, context).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
}

// Independent reference: the classic backtracking search for the fewest
// transfers (settle person `start` against each later person of opposite sign).
// Exponential, so only for small n, but shares no code or idea with the bitmask DP.
function bruteForceMinimum(nets: number[]): number {
  const d = nets.filter((n) => n !== 0);
  const search = (start: number): number => {
    while (start < d.length && d[start] === 0) start++;
    if (start === d.length) return 0;
    let best = Infinity;
    for (let i = start + 1; i < d.length; i++) {
      if (d[i] * d[start] < 0) {
        d[i] += d[start];
        best = Math.min(best, 1 + search(start + 1));
        d[i] -= d[start];
      }
    }
    return best;
  };
  return search(0);
}

function randomNets(r: ReturnType<typeof rng>, n: number, range: number) {
  const nets = Array.from({ length: n - 1 }, () => r.int(-range, range));
  nets.push(-nets.reduce((a, x) => a + x, 0));
  return nets;
}

describe("settle: minimum-transfer plan (D6)", () => {
  it("needs no transfers when everyone is settled", () => {
    expect(settle([])).toEqual({ transfers: [], method: "exact" });
    expect(settle(people(0, 0, 0))).toEqual({ transfers: [], method: "exact" });
  });

  it("settles two people with one transfer", () => {
    expect(settle(people(-3000, 3000)).transfers).toEqual([{ fromUserId: "u00", toUserId: "u01", amount: 3000 }]);
  });

  it("finds a plan that beats greedy matching", () => {
    // {−5, +10, −5} and {+1, +6, −7} each sum to zero, so 6 − 2 = 4 transfers.
    // Greedy matching (largest debtor → largest creditor) over everyone needs 5.
    const balances = people(-5, 10, 1, 6, -5, -7);
    const plan = settle(balances);
    expectValid(balances, plan);
    expect(plan.method).toBe("exact");
    expect(plan.transfers).toHaveLength(4);
  });

  it("gives the same plan whatever order the balances come in", () => {
    const balances = people(-5, 10, 1, 6, -5, -7, 3, -3);
    const plan = settle(balances);
    const r = rng(7);
    for (let i = 0; i < 20; i++) expect(settle(r.shuffle(balances))).toEqual(plan);
  });

  it("refuses balances that don't sum to zero", () => {
    expect(() => settle(people(-100, 99))).toThrow(/sum to zero/);
  });

  it("property: matches the brute-force minimum on 3,000 random small groups", () => {
    const seed = 6_2026;
    const r = rng(seed);
    for (let run = 0; run < 3000; run++) {
      // Small values produce many zero-sum subgroups (the hard case); large values are realistic.
      const nets = randomNets(r, r.int(2, 8), r.next() < 0.7 ? 10 : 100_000);
      const balances = people(...nets);
      const plan = settle(balances);
      const context = `seed ${seed}, run ${run}, nets ${JSON.stringify(nets)}`;
      expectValid(balances, plan, context);
      expect(plan.transfers.length, context).toBe(bruteForceMinimum(nets));
    }
  });

  it(`uses the exact search up to ${EXACT_LIMIT} non-zero balances, and it's fast`, () => {
    const r = rng(15);
    const balances = people(...randomNets(r, EXACT_LIMIT, 20), 0, 0, 0); // zeros don't count
    const start = performance.now();
    const plan = settle(balances);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(plan.method).toBe("exact");
    expectValid(balances, plan);
  });

  it("falls back to greedy above the limit, still settling everyone in ≤ n − 1 transfers", () => {
    const r = rng(16);
    for (let run = 0; run < 200; run++) {
      const nets = randomNets(r, r.int(EXACT_LIMIT + 1, 60), r.pick([10, 100_000, 2_000_000_000]));
      if (nets.filter((n) => n !== 0).length <= EXACT_LIMIT) continue;
      const balances = people(...nets);
      const plan = settle(balances);
      expect(plan.method).toBe("greedy");
      expectValid(balances, plan, `run ${run}`);
    }
  });
});
