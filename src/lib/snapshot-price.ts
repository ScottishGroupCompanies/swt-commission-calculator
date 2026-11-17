import { commissionRateFor, priceJob, type JobPriceResult } from "@/lib/commission";
import { isSoldQuoteStatus } from "@/lib/quotes";
import type { SnapshotJob } from "@/lib/types";

/**
 * Commission for a snapshot job before any in-browser edits.
 * The calculator and the bot API both call this so the numbers match.
 * Manager approval stays off, French panes stay 0, and there is no list override.
 */
export function priceSnapshotJob(job: SnapshotJob): JobPriceResult {
  return priceJob({
    rate: commissionRateFor(job.salesperson) ?? 0,
    charged: job.charged,
    sold: isSoldQuoteStatus(job.quoteStatus),
    lines: job.films.map((film) => ({
      sellPerSf: film.sellPerSf,
      sf: film.sf,
      removal: film.removal,
      cBond: film.cBond,
    })),
  });
}
