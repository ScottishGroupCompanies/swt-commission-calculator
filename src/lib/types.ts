export type SnapshotFilmLine = {
  itemName: string;
  description: string;
  film: string | null;
  catalogProduct: string | null;
  sellPerSf: number | null;
  pricingGroup: number | null;
  sf: number | null;
  lineAmount: number | null;
  lump: boolean;
  removal: boolean;
  cBond: boolean;
  french: boolean;
};

export type SnapshotJob = {
  id: string;
  client: string;
  zoho: string;
  jobNumber: string;
  designer: string;
  location: string;
  dateSold: string;
  monthSold: string;
  jobType: string;
  filmType: string;
  charged: number;
  estimateNumber: string | null;
  films: SnapshotFilmLine[];
};

export type CatalogFilm = {
  manufacturer: string;
  product: string;
  costPerSf: number;
  pricingGroup: number;
  sellPerSf: number;
};

export type CommissionSnapshot = {
  asOf: string;
  asOfIso: string;
  source: "snapshot";
  pricingVersion: "V-10.9";
  note: string;
  catalog: CatalogFilm[];
  jobs: SnapshotJob[];
};

/**
 * Read path for job facts. The calculator and a future dashboard depend on this,
 * not on Zoho. Swap in a live reader later without changing commission math.
 */
export interface CommissionDataSource {
  readonly kind: "snapshot" | "zoho";
  loadSnapshot(): Promise<CommissionSnapshot>;
}
