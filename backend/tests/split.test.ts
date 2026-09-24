import { describe, expect, it } from "vitest";
import { resolveSplit, type SplitInput } from "../src/expenses/split";
import { rng } from "./helpers";

const MAX_AMOUNT = 2_147_483_647;
const sum = (xs: { amount: number }[]) => xs.reduce((acc, x) => acc + x.amount, 0);
const amounts = (xs: { userId: string; amount: number }[]) =>
  Object.fromEntries(xs.map((x) => [x.userId, x.amount]));

describe("resolveSplit: largest remainder rounding (D5)", () => {
  // Join order deliberately differs from alphabetical order, so a test can tell
  // whether ties are broken by join order (correct) or by user id (wrong).
  const joinOrder = ["carol", "alice", "bob"];

  it("gives the extra cent of 10.00 / 3 to the earliest-joined participant", () => {
    const result = resolveSplit(1000, { type: "EQUAL", participants: ["alice", "bob", "carol"] }, joinOrder);
    expect(amounts(result)).toEqual({ carol: 334, alice: 333, bob: 333 });
    expect(result.every((r) => r.shares === 1)).toBe(true);
  });

  it("gives two leftover cents to the two earliest-joined participants", () => {
    const result = resolveSplit(1001, { type: "EQUAL", participants: ["bob", "alice", "carol"] }, joinOrder);
    expect(amounts(result)).toEqual({ carol: 334, alice: 334, bob: 333 });
  });

  it("falls back to user id when join order doesn't decide", () => {
    const result = resolveSplit(1000, { type: "EQUAL", participants: ["zed", "amy", "kim"] }, []);
    expect(amounts(result)).toEqual({ amy: 334, kim: 333, zed: 333 });
  });

  it("gives leftovers to whoever lost the most in rounding, not by join order", () => {
    // Exact shares: carol 33.33…, alice 66.66… → rounded down to 33 and 66.
    // alice lost 0.66, carol 0.33, so alice gets the leftover unit even though carol joined first.
    const split: SplitInput = {
      type: "SHARES",
      shares: [
        { userId: "carol", shares: 1 },
        { userId: "alice", shares: 2 },
      ],
    };
    const result = resolveSplit(100, split, joinOrder);
    expect(amounts(result)).toEqual({ carol: 33, alice: 67 });
    expect(result.find((r) => r.userId === "alice")?.shares).toBe(2);
  });

  it("splits exactly when shares divide the total evenly", () => {
    const split: SplitInput = {
      type: "SHARES",
      shares: [
        { userId: "alice", shares: 1 },
        { userId: "bob", shares: 3 },
      ],
    };
    expect(amounts(resolveSplit(400, split, joinOrder))).toEqual({ alice: 100, bob: 300 });
  });

  it("handles a total smaller than the number of participants", () => {
    const result = resolveSplit(2, { type: "EQUAL", participants: ["alice", "bob", "carol"] }, joinOrder);
    expect(amounts(result)).toEqual({ carol: 1, alice: 1, bob: 0 });
  });

  it("does not depend on the order participants are listed in", () => {
    const a = resolveSplit(1001, { type: "EQUAL", participants: ["alice", "bob", "carol"] }, joinOrder);
    const b = resolveSplit(1001, { type: "EQUAL", participants: ["carol", "bob", "alice"] }, joinOrder);
    expect(amounts(a)).toEqual(amounts(b));
  });

  it("stays exact at the maximum amount with large share weights", () => {
    const split: SplitInput = {
      type: "SHARES",
      shares: Array.from({ length: 200 }, (_, i) => ({ userId: `u${i}`, shares: 1000 - i })),
    };
    expect(sum(resolveSplit(MAX_AMOUNT, split, []))).toBe(MAX_AMOUNT);
  });

  it("accepts EXACT amounts that add up to the total, including zero", () => {
    const split: SplitInput = {
      type: "EXACT",
      amounts: [
        { userId: "alice", amount: 700 },
        { userId: "bob", amount: 300 },
        { userId: "carol", amount: 0 },
      ],
    };
    const result = resolveSplit(1000, split, joinOrder);
    expect(amounts(result)).toEqual({ alice: 700, bob: 300, carol: 0 });
    expect(result.every((r) => r.shares === null)).toBe(true);
  });

  it("rejects EXACT amounts that don't add up to the total, by even one cent", () => {
    for (const off of [-1, 1]) {
      const split: SplitInput = {
        type: "EXACT",
        amounts: [
          { userId: "alice", amount: 500 },
          { userId: "bob", amount: 500 + off },
        ],
      };
      expect(() => resolveSplit(1000, split, joinOrder)).toThrow(/add up to/);
    }
  });

  it("property: 20,000 random splits always sum exactly to the total and round fairly", () => {
    const seed = 20260924;
    const r = rng(seed);
    const users = Array.from({ length: 15 }, (_, i) => `user${i}`);

    for (let run = 0; run < 20_000; run++) {
      // Mix of small totals (where rounding dominates) and huge ones (overflow risk).
      const total = r.next() < 0.5 ? r.int(1, 10_000) : r.int(1, MAX_AMOUNT);
      const people = r.subset(users);
      const joinOrder = r.shuffle(users);
      const weights = people.map((userId) => ({
        userId,
        shares: r.next() < 0.3 ? 1 : r.int(1, 1000),
      }));
      const split: SplitInput =
        r.next() < 0.5
          ? { type: "EQUAL", participants: people }
          : { type: "SHARES", shares: weights };
      const w = split.type === "EQUAL" ? people.map((userId) => ({ userId, shares: 1 })) : weights;
      const result = resolveSplit(total, split, joinOrder);
      const context = `seed ${seed}, run ${run}, total ${total}, ${JSON.stringify(split)}`;

      // 1. The amounts sum exactly to the total.
      expect(sum(result), context).toBe(total);

      // 2. Each amount is the exact share rounded down or up by at most one unit,
      //    and only the participants who lost the most in rounding were rounded up.
      //    BigInt so the check itself can't lose precision.
      const S = BigInt(w.reduce((acc, x) => acc + x.shares, 0));
      const byUser = new Map(result.map((x) => [x.userId, x.amount]));
      const roundedUp: bigint[] = [];
      const roundedDown: bigint[] = [];
      for (const { userId, shares } of w) {
        const scaled = BigInt(total) * BigInt(shares);
        const floor = scaled / S;
        const extra = BigInt(byUser.get(userId)!) - floor;
        expect(extra === 0n || extra === 1n, context).toBe(true);
        (extra === 1n ? roundedUp : roundedDown).push(scaled % S);
      }
      if (roundedUp.length > 0 && roundedDown.length > 0) {
        const minUp = roundedUp.reduce((a, b) => (a < b ? a : b));
        const maxDown = roundedDown.reduce((a, b) => (a > b ? a : b));
        expect(minUp >= maxDown, context).toBe(true);
      }
    }
  });
});
