import { describe, expect, it } from "vitest";
import { formatMoney, parseAmount, toInput } from "./money";

const ok = (value: number) => ({ ok: true, value });

describe("parseAmount", () => {
  it.each([
    ["12", "EUR", 1200],
    ["12.5", "EUR", 1250],
    ["12.50", "EUR", 1250],
    ["12,50", "EUR", 1250],
    [".5", "EUR", 50],
    ["0.01", "EUR", 1],
    ["1,234.56", "EUR", 123456],
    ["1.234,56", "EUR", 123456],
    ["1 234,56", "EUR", 123456],
    ["1,234", "EUR", 123400], // thousands, not 1.234
    ["1,234,567", "EUR", 123456700],
    ["3000", "JPY", 3000],
    ["1,500", "JPY", 1500],
    ["1.234", "KWD", 1234],
    ["1,234", "KWD", 1234], // KWD has 3 decimals, so this is a decimal comma
    ["  7  ", "USD", 700],
    ["21474836.47", "EUR", 2147483647],
  ])("%s %s → %d", (input, currency, value) => {
    expect(parseAmount(input, currency)).toEqual(ok(value));
  });

  it.each([
    ["", "EUR", "Enter an amount."],
    ["abc", "EUR", "That doesn't look like an amount."],
    ["1.2.3", "EUR", "That doesn't look like an amount."],
    ["-5", "EUR", "The amount can't be negative."],
    ["12.345", "EUR", "Use at most 2 decimal places."],
    ["12.5", "JPY", "JPY amounts have no decimals."],
    ["21474836.48", "EUR", "That amount is too large."],
    ["1e5", "EUR", "That doesn't look like an amount."],
    [".", "EUR", "That doesn't look like an amount."],
  ])("rejects %j in %s", (input, currency, error) => {
    expect(parseAmount(input, currency)).toEqual({ ok: false, error });
  });

  it("never loses a cent to floating point", () => {
    for (let cents = 0; cents < 100_000; cents += 7) {
      expect(parseAmount(toInput(cents, "EUR"), "EUR")).toEqual(ok(cents));
    }
  });
});

describe("formatMoney / toInput", () => {
  it("uses the currency's minor units", () => {
    expect(formatMoney(123456, "EUR")).toBe("€1,234.56");
    expect(formatMoney(3000, "JPY")).toBe("¥3,000");
    expect(toInput(1250, "EUR")).toBe("12.50");
    expect(toInput(3000, "JPY")).toBe("3000");
    expect(toInput(1, "KWD")).toBe("0.001");
  });
});
