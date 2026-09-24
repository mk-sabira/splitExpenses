// Amounts are integer minor units in the group's currency (backend D2).

// How many minor-unit digits a currency has: 2 for EUR, 0 for JPY, 3 for KWD.
export function minorDigits(currency: string): number {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

// Same formatting as the backend's emails: 123456 EUR → "€1,234.56", 3000 JPY → "¥3,000".
export function formatMoney(amount: number, currency: string): string {
  const format = new Intl.NumberFormat("en", { style: "currency", currency });
  return format.format(amount / 10 ** minorDigits(currency));
}

// Plain number for an input field: 1250 EUR → "12.50", 3000 JPY → "3000".
export function toInput(amount: number, currency: string): string {
  const digits = minorDigits(currency);
  return (amount / 10 ** digits).toFixed(digits);
}

const MAX_AMOUNT = 2_147_483_647; // the backend's limit (Postgres INTEGER)

// Reads what someone typed into an amount field. Returns minor units, or an
// error message. Accepts "12", "12.5", "12,50", "1,234.56", "1 234,56".
// Works on the digits as text, so there's no floating-point rounding.
export function parseAmount(input: string, currency: string): { ok: true; value: number } | { ok: false; error: string } {
  const digits = minorDigits(currency);
  let s = input.trim().replace(/[\s ']/g, "");
  if (s === "") return { ok: false, error: "Enter an amount." };
  if (s.startsWith("-")) return { ok: false, error: "The amount can't be negative." };

  // With both separators, the last one is the decimal point. With a single
  // comma, it's a decimal comma unless it's clearly grouping thousands ("1,234").
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const group = decimal === "." ? "," : ".";
    s = s.split(group).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    const commas = s.split(",").length - 1;
    const thousands = commas > 1 || /^\d{1,3},\d{3}$/.test(s);
    s = thousands && digits !== 3 ? s.split(",").join("") : s.replace(",", ".");
  }

  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] === "" && !m[2])) return { ok: false, error: "That doesn't look like an amount." };
  const whole = m[1] || "0";
  const fraction = m[2] ?? "";
  if (fraction.length > digits) {
    return {
      ok: false,
      error: digits === 0 ? `${currency} amounts have no decimals.` : `Use at most ${digits} decimal places.`,
    };
  }
  const value = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  if (!Number.isSafeInteger(value) || value > MAX_AMOUNT) return { ok: false, error: "That amount is too large." };
  return { ok: true, value };
}
