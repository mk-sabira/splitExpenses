import { describe, expect, it } from "vitest";
// The backend's implementation, imported directly so the two can't drift apart.
import { resolveSplit } from "../../../backend/src/expenses/split";
import { previewShares, previewSplit } from "./split";
import type { SplitInput } from "./types";

// Small seeded PRNG (mulberry32), so a failure can be replayed.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("previewShares", () => {
  it("gives the extra cent to whoever joined first (10.00 / 3)", () => {
    const got = previewShares(1000, ["c", "a", "b"].map((userId) => ({ userId, shares: 1 })), ["a", "b", "c"]);
    expect(Object.fromEntries(got)).toEqual({ a: 334, b: 333, c: 333 });
  });

  it("splits by weight", () => {
    const got = previewShares(9000, [{ userId: "a", shares: 2 }, { userId: "b", shares: 1 }], ["a", "b"]);
    expect(Object.fromEntries(got)).toEqual({ a: 6000, b: 3000 });
  });

  it("returns nothing when nobody is in the split", () => {
    expect(previewShares(1000, [], ["a"]).size).toBe(0);
  });
});

describe("previewSplit matches the backend exactly", () => {
  it("on 5,000 random EQUAL and SHARES splits", () => {
    const next = rng(20260924);
    const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
    for (let i = 0; i < 5000; i++) {
      const members = Array.from({ length: int(1, 12) }, (_, k) => `user${String.fromCharCode(97 + ((k * 7) % 26))}${k}`);
      const joinOrder = [...members].sort(() => next() - 0.5);
      const chosen = members.filter(() => next() < 0.7);
      const people = chosen.length > 0 ? chosen : [members[0]];
      const total = next() < 0.1 ? int(1, 2_147_483_647) : int(1, 100_000);
      const split: SplitInput =
        next() < 0.5
          ? { type: "EQUAL", participants: people }
          : { type: "SHARES", shares: people.map((userId) => ({ userId, shares: int(1, 1000) })) };

      const server = new Map(resolveSplit(total, split, joinOrder).map((r) => [r.userId, r.amount]));
      expect(previewSplit(total, split, joinOrder)).toEqual(server);
    }
  });
});
