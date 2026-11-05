import type { BooksEstimateFact, CommissionDataSource, CommissionSnapshot } from "@/lib/types";

/**
 * Contract for a future server-side Zoho Books sync.
 *
 * The sync should read estimates (read-only) and produce the same
 * CommissionSnapshot the calculator already loads:
 * - quoteStatus from estimate.status
 * - acceptedDate from estimate.accepted_date (this is the date sold)
 * - salesperson from estimate.salesperson_name (this is the rep)
 * - estimateNumber from estimate.estimate_number
 *
 * A quote is commissionable only when quoteStatus is "accepted" or "invoiced".
 * The current bundled path stores those facts in data/source/books-estimates.json
 * and `npm run data:build` copies them onto each job. Replace
 * getCommissionDataSource() with createZohoDataSource() once the sync exists.
 * Keep tokens in the host environment. Do not commit them.
 */
export function booksEstimateFact(raw: {
  estimate_id?: string;
  estimateId?: string;
  estimate_number?: string;
  estimateNumber?: string;
  status?: string;
  accepted_date?: string;
  acceptedDate?: string | null;
  salesperson_name?: string;
  salesperson?: string | null;
}): BooksEstimateFact {
  const accepted = raw.acceptedDate ?? raw.accepted_date ?? "";
  return {
    estimateId: raw.estimateId || raw.estimate_id || "",
    estimateNumber: raw.estimateNumber || raw.estimate_number || "",
    status: (raw.status || "").trim().toLowerCase(),
    acceptedDate: accepted || null,
    salesperson: raw.salesperson ?? raw.salesperson_name ?? null,
  };
}

export function createZohoDataSource(): CommissionDataSource {
  return {
    kind: "zoho",
    async loadSnapshot(): Promise<CommissionSnapshot> {
      throw new Error(
        "Zoho Books sync is not wired. The app is using the bundled snapshot, which already carries Books quote status, accepted date, and salesperson.",
      );
    },
  };
}
