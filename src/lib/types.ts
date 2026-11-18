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
  /** Master-sheet designer. The rep used for pay is salesperson. */
  designer: string;
  /** Zoho Books estimate salesperson_name. Null when no Books quote was found. */
  salesperson: string | null;
  location: string;
  /** Display date from the Books accepted_date. Empty when Books has no accepted date. */
  dateSold: string;
  /** Books accepted_date as yyyy-mm-dd. */
  acceptedDate: string | null;
  monthSold: string;
  jobType: string;
  filmType: string;
  charged: number;
  estimateId: string | null;
  estimateNumber: string | null;
  /** Zoho Books estimate status, lowercased. Null when the quote was not found. */
  quoteStatus: string | null;
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
  /** When the Books estimate facts in this snapshot were read. */
  booksAsOf?: string;
  note: string;
  catalog: CatalogFilm[];
  jobs: SnapshotJob[];
};

/**
 * Read path for job facts. The calculator and a future dashboard depend on this.
 * A server-side Zoho Books sync should write the same CommissionSnapshot shape
 * (quoteStatus, acceptedDate, salesperson) and replace getCommissionDataSource().
 */
export interface CommissionDataSource {
  readonly kind: "snapshot" | "zoho";
  loadSnapshot(): Promise<CommissionSnapshot>;
}

/**
 * One Books line, the fields a sync must write.
 * `category` is the item custom field cf_category. "Fee" lines (or a name
 * containing "fee") are the 4% fee and are not part of list or pre-fee charged.
 */
export type BooksLineItem = {
  name: string;
  description: string;
  quantity: number;
  rate: number;
  itemTotal: number;
  unit: string;
  category: string | null;
};

/**
 * One Zoho Books estimate, the fields a sync must write.
 * `date` is the estimate date (yyyy-mm-dd). A 2026 quote with no accepted
 * date is still included when `date` is in 2026.
 * `total` is the Books total and includes the 4% fee when a fee line is present.
 * `lineItems` are required to compute list price. An estimate with no
 * matchable film line is kept and flagged list not verified.
 */
export type BooksEstimateFact = {
  estimateId: string;
  estimateNumber: string;
  status: string;
  acceptedDate: string | null;
  date?: string | null;
  salesperson: string | null;
  customerName?: string | null;
  total?: number | null;
  lineItems?: BooksLineItem[];
};
