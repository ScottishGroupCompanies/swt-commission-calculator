export function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export function formatRate(rate: number): string {
  const pct = Math.round(rate * 1000) / 10;
  const text = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1);
  return `${text}%`;
}

export function formatSell(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `$${rate.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}
