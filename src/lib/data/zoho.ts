import type { BooksEstimateFact, CommissionDataSource, CommissionSnapshot } from "@/lib/types";

/**
 * Contract for a future server-side Zoho Books sync.
 *
 * The sync should read estimates (read-only) and write
 * data/source/books-estimates.json. See README "Refresh the snapshot" for the
 * exact file shape. `npm run data:build` copies Books status, accepted date,
 * and salesperson onto sheet jobs, and adds a job for every 2026 estimate
 * that is not already in jobs.json. List price uses the estimate line items
 * and the V-10.9 catalog, through the same film matching as
 * scripts/build_commission_data.py.
 *
 * A quote is commissionable only when quoteStatus is "accepted" or "invoiced".
 * Keep tokens in the host environment. Do not commit them. Do not write to Zoho.
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
