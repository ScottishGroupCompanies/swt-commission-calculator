import { findRep, roundMoney, type JobPriceResult } from "@/lib/commission";
import { normalizeQuoteNumber } from "@/lib/quotes";
import { priceSnapshotJob } from "@/lib/snapshot-price";
import type { CommissionSnapshot, SnapshotJob } from "@/lib/types";

/** Policy branch names the bot API returns. */
export type PolicyBranch =
  | "at/over list"
  | "undersold <10%"
  | "undersold >=10% needs manager approval"
  | "undersold >=10% manager approved"
  | "not an earner"
  | "not accepted"
  | "list not verified"
  | "needs review";

export type CommissionRecord = {
  estimateNumber: string | null;
  quoteNumber: string;
  jobId: string;
  jobNumber: string;
  customer: string;
  rep: string | null;
  repName: string | null;
  repInitials: string | null;
  status: string | null;
  /** Books accepted_date as yyyy-mm-dd. Null when the quote has no accepted date. */
  acceptedDate: string | null;
  commissionable: boolean;
  reason: string | null;
  /** Pre-fee amount charged. The 4% fee is not included. */
  preFeeCharged: number | null;
  listAmount: number | null;
  /** Rep rate as a fraction (0.05 = 5%). Null when the salesperson is not an earner. */
  rate: number | null;
  /**
   * (list − charged) / list, in percent, rounded to cents.
   * Positive means undersold. Negative means over list. Null when list is unknown.
   */
  undersoldPercent: number | null;
  commission: number | null;
  policy: PolicyBranch;
  /** When the Books estimate facts in this snapshot were read. */
  fetchedAt: string;
  /** Master-sheet data-as-of label baked into the snapshot. */
  dataAsOf: string;
};

export type JobSelector = {
  estimate?: string;
  job?: string;
  jobId?: string;
};

const IDENTIFIER_MAX = 80;

export function repInitials(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return parts.map((part) => part.charAt(0).toUpperCase()).join("");
}

export function undersoldPercent(list: number | null, charged: number | null): number | null {
  if (list == null || charged == null || !Number.isFinite(list) || list === 0) return null;
  if (!Number.isFinite(charged)) return null;
  return roundMoney(((list - charged) / list) * 100);
}

export function policyForJob(
  job: SnapshotJob,
  price: JobPriceResult,
): { policy: PolicyBranch; commissionable: boolean; reason: string | null } {
  if (price.notSold) {
    return {
      policy: "not accepted",
      commissionable: false,
      reason: "Not sold in Zoho Books — no commission.",
    };
  }
  if (!findRep(job.salesperson)) {
    return {
      policy: "not an earner",
      commissionable: false,
      reason: "This salesperson is not on the commission list (Dana, Amy, Blake, Scott, John).",
    };
  }
  if (price.commission == null || price.status === "needs_review") {
    return {
      policy: "needs review",
      commissionable: false,
      reason: price.reasons.join(" ") || "Charged amount or list price needs review.",
    };
  }
  if (price.belowFloor && !price.managerApproved) {
    return {
      policy: "undersold >=10% needs manager approval",
      commissionable: false,
      reason: "Below the 10% floor. Commission is $0 unless a manager approved this price in writing.",
    };
  }
  if (price.belowFloor && price.managerApproved) {
    return {
      policy: "undersold >=10% manager approved",
      commissionable: true,
      reason: "Manager approved. Commission is the rate times list minus half the shortfall, and it does not go below $0.",
    };
  }
  if (!price.listVerified || price.status === "list_not_verified") {
    return {
      policy: "list not verified",
      commissionable: true,
      reason: "List not verified. Commission is the rep rate times the charged amount.",
    };
  }
  if (price.status === "undersold") {
    return {
      policy: "undersold <10%",
      commissionable: true,
      reason: "Undersold by less than 10%. Commission is the rate times list minus half the shortfall.",
    };
  }
  return {
    policy: "at/over list",
    commissionable: true,
    reason:
      price.status === "oversold"
        ? "Charged is above list, so commission is the rate times the charged amount."
        : "Charged matches list, so commission is the rate times the charged amount.",
  };
}

export function toCommissionRecord(
  job: SnapshotJob,
  snapshot: Pick<CommissionSnapshot, "booksAsOf" | "asOfIso" | "asOf">,
): CommissionRecord {
  const price = priceSnapshotJob(job);
  const branch = policyForJob(job, price);
  const earner = findRep(job.salesperson);
  return {
    estimateNumber: job.estimateNumber,
    quoteNumber: job.zoho,
    jobId: job.id,
    jobNumber: job.jobNumber,
    customer: job.client,
    rep: job.salesperson,
    repName: earner?.name ?? null,
    repInitials: repInitials(earner?.name ?? job.salesperson),
    status: job.quoteStatus,
    acceptedDate: job.acceptedDate,
    commissionable: branch.commissionable,
    reason: branch.reason,
    preFeeCharged: price.charged,
    listAmount: price.listPrice,
    rate: earner?.rate ?? null,
    undersoldPercent: undersoldPercent(price.listPrice, price.charged),
    commission: price.commission,
    policy: branch.policy,
    fetchedAt: snapshot.booksAsOf || snapshot.asOfIso,
    dataAsOf: snapshot.asOf,
  };
}

function sameText(left: string | null | undefined, right: string): boolean {
  return (left || "").trim().toLowerCase() === right.trim().toLowerCase();
}

function matchesEstimate(job: SnapshotJob, estimate: string): boolean {
  const raw = estimate.trim().toUpperCase();
  if ((job.estimateNumber || "").toUpperCase() === raw || (job.zoho || "").toUpperCase() === raw) {
    return true;
  }
  const needle = normalizeQuoteNumber(estimate);
  if (!needle) return false;
  return (
    normalizeQuoteNumber(job.estimateNumber) === needle || normalizeQuoteNumber(job.zoho) === needle
  );
}

function matchesJob(job: SnapshotJob, jobKey: string): boolean {
  return (
    sameText(job.jobNumber, jobKey) ||
    sameText(job.id, jobKey) ||
    sameText(job.zoho, jobKey) ||
    sameText(job.estimateId, jobKey) ||
    sameText(job.estimateNumber, jobKey)
  );
}

/** Exact snapshot identifiers. Quote numbers treat WT-03533 and WT-03533-QT01 as the same quote. */
export function findSnapshotJobs(jobs: readonly SnapshotJob[], query: JobSelector): SnapshotJob[] {
  const estimate = query.estimate?.trim() || "";
  const job = query.job?.trim() || "";
  const jobId = query.jobId?.trim() || "";
  if (!estimate && !job && !jobId) return [];
  return jobs.filter((entry) => {
    if (jobId && !sameText(entry.id, jobId)) return false;
    if (job && !matchesJob(entry, job)) return false;
    if (estimate && !matchesEstimate(entry, estimate)) return false;
    return true;
  });
}

export function assertIdentifierLength(value: string | undefined): string | null {
  if (value && value.length > IDENTIFIER_MAX) {
    return "An identifier is longer than 80 characters.";
  }
  return null;
}

export function filterSnapshotJobs(
  jobs: readonly SnapshotJob[],
  filter: { repId: string | null; since: string | null },
): SnapshotJob[] {
  return jobs
    .filter((job) => {
      if (filter.repId && findRep(job.salesperson)?.id !== filter.repId) return false;
      if (filter.since && (!job.acceptedDate || job.acceptedDate < filter.since)) return false;
      return true;
    })
    .sort((a, b) => {
      const byDate = (b.acceptedDate || "").localeCompare(a.acceptedDate || "");
      if (byDate !== 0) return byDate;
      return (a.estimateNumber || a.zoho).localeCompare(b.estimateNumber || b.zoho);
    });
}

export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
