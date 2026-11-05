/** WT-03533 and WT-03533-QT01 are the same quote for search. */
export function normalizeQuoteNumber(value: string | null | undefined): string {
  return (value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/-QT\d+$/, "");
}

export function quoteMatches(
  job: { zoho: string; estimateNumber: string | null },
  query: string,
): boolean {
  const needle = normalizeQuoteNumber(query);
  if (!needle) return false;
  const keys = [normalizeQuoteNumber(job.zoho), normalizeQuoteNumber(job.estimateNumber)].filter(
    Boolean,
  );
  return keys.some((key) => key === needle || key.includes(needle) || needle.includes(key));
}

/** Books statuses that mean the quote was sold. */
export function isSoldQuoteStatus(status: string | null | undefined): boolean {
  const value = (status || "").trim().toLowerCase();
  return value === "accepted" || value === "invoiced";
}
