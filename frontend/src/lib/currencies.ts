// Every ISO 4217 currency the browser knows, e.g. { code: "EUR", name: "Euro" },
// with a few common ones first. The backend accepts the same set (Intl.supportedValuesOf).
const COMMON = ["EUR", "USD", "GBP", "KGS", "KZT", "TRY", "AED", "JPY"];

let cached: { code: string; name: string }[] | null = null;

export function currencies() {
  if (cached) return cached;
  const names = new Intl.DisplayNames(["en"], { type: "currency" });
  const all = Intl.supportedValuesOf("currency").map((code) => ({ code, name: names.of(code) ?? code }));
  const common = COMMON.filter((c) => all.some((a) => a.code === c));
  cached = [
    ...common.map((code) => all.find((a) => a.code === code)!),
    ...all.filter((a) => !common.includes(a.code)),
  ];
  return cached;
}
