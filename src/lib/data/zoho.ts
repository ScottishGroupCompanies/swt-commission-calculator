import type { CommissionDataSource } from "@/lib/types";

/**
 * Placeholder for a future read-only Zoho Books + Sheet source.
 * Implement loadSnapshot() to return the same CommissionSnapshot shape,
 * then return this object from getCommissionDataSource().
 * Keep tokens in the host environment. Do not commit them.
 */
export function createZohoDataSource(): CommissionDataSource {
  return {
    kind: "zoho",
    async loadSnapshot() {
      throw new Error(
        "Zoho data source is not wired. Use the bundled snapshot, or implement src/lib/data/zoho.ts.",
      );
    },
  };
}
