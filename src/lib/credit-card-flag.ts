/**
 * Stable key for a job's "paid by credit card" flag.
 *
 * Sheet jobs use the job number (F240464), which survives a snapshot rebuild
 * that changes the sheet-row id (WT-02523|30). A Books-only job has no separate
 * job number, so the key is the estimate number (WT-03533-QT01).
 */

export type FlagJob = {
  id?: string | null;
  jobNumber?: string | null;
  estimateNumber?: string | null;
  zoho?: string | null;
};

export type StoredCreditCardFlag = {
  paidByCreditCard: boolean;
  updatedBy: string;
  updatedAt: string;
  estimateNumber?: string | null;
  jobNumber?: string | null;
  quoteNumber?: string | null;
  jobId?: string | null;
};

export function normalizeFlagKey(value: string | null | undefined): string {
  return (value || "").trim().toUpperCase();
}

export function creditCardFlagKey(job: FlagJob): string {
  const jobNumber = normalizeFlagKey(job.jobNumber);
  const estimate = normalizeFlagKey(job.estimateNumber);
  const quote = normalizeFlagKey(job.zoho);
  const distinctJob = Boolean(jobNumber) && jobNumber !== estimate && jobNumber !== quote;
  if (distinctJob) return jobNumber;
  return estimate || jobNumber || quote || normalizeFlagKey(job.id);
}

/**
 * Find a saved flag for this job.
 * The primary key wins. An older flag stored under the estimate number or
 * the snapshot id still matches after a sync gives the job an F-number,
 * as long as nobody has saved a newer flag under the new primary key.
 * A sibling sheet row with its own job number does not inherit that flag.
 */
export function flagForJob<T extends StoredCreditCardFlag>(
  job: FlagJob,
  flags: Readonly<Record<string, T>>,
): T | null {
  const primary = creditCardFlagKey(job);
  if (primary && flags[primary]) return flags[primary];
  const estimate = normalizeFlagKey(job.estimateNumber);
  const id = normalizeFlagKey(job.id);
  if (estimate && estimate !== primary && flags[estimate]) return flags[estimate];
  if (id && id !== primary && flags[id]) return flags[id];
  return null;
}
