import type { CommissionSnapshot } from "@/lib/types";

/**
 * When the calculator and the bot API should say the Books facts were read.
 * Uses the later of the Books fetch and the job-list build time.
 */
export function booksFreshnessIso(
  snapshot: Pick<CommissionSnapshot, "booksAsOf" | "asOfIso">,
): string {
  const books = snapshot.booksAsOf ? Date.parse(snapshot.booksAsOf) : Number.NaN;
  const jobs = snapshot.asOfIso ? Date.parse(snapshot.asOfIso) : Number.NaN;
  if (Number.isFinite(books) && Number.isFinite(jobs)) {
    return (books >= jobs ? snapshot.booksAsOf : snapshot.asOfIso) || snapshot.asOfIso;
  }
  if (Number.isFinite(books) && snapshot.booksAsOf) return snapshot.booksAsOf;
  return snapshot.asOfIso;
}

/** Mountain Time label, for example "Nov 17, 2026 3:16 PM MT". */
export function formatBooksAsOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const ampm = pick("dayPeriod").toUpperCase();
  return `${pick("month")} ${pick("day")}, ${pick("year")} ${pick("hour")}:${pick("minute")} ${ampm} MT`;
}

/** The freshness sentence on the calculator. */
export function booksDataLabel(
  snapshot: Pick<CommissionSnapshot, "booksAsOf" | "asOfIso">,
): string {
  return `Zoho Books data as of ${formatBooksAsOf(booksFreshnessIso(snapshot))}. Prices exclude the 4% fee. Edits stay in this browser and are not written to Zoho.`;
}
