import "server-only";
import snapshotJson from "@/data/snapshot.json";
import type { CommissionDataSource, CommissionSnapshot } from "@/lib/types";

function assertSnapshot(data: CommissionSnapshot): CommissionSnapshot {
  if (data.source !== "snapshot") {
    throw new Error("Bundled data is not a snapshot.");
  }
  if (!data.asOf) throw new Error("Snapshot is missing its data-as-of timestamp.");
  if (data.catalog.length !== 307) {
    throw new Error(`Film catalog should have 307 films, found ${data.catalog.length}.`);
  }
  if (data.jobs.length < 1) throw new Error("Snapshot has no jobs.");
  return data;
}

const bundled: CommissionSnapshot = assertSnapshot(snapshotJson as CommissionSnapshot);

/**
 * Bundled JSON snapshot. Books quote status, accepted date, and salesperson
 * are already on each job. A future sync replaces this reader; see zoho.ts.
 */
export const snapshotSource: CommissionDataSource = {
  kind: "snapshot",
  async loadSnapshot() {
    return bundled;
  },
};

export function getCommissionDataSource(): CommissionDataSource {
  return snapshotSource;
}
