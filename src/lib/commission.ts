/**
 * SWT commission and V-10.9 list pricing.
 *
 * Owner-confirmed 2026-11-05. Ported from scripts/engine/commission.py.
 * A future per-rep dashboard should import this module rather than reimplementing pay.
 *
 * Prices exclude the 4% fee. Charged amounts are pre-fee job totals.
 * Commission is never negative.
 *
 * - Charged >= list: commission = rate × charged
 *   Example: list $1,000, rate 5%, sold $1,100 → $55
 * - Undersold by less than 10% of list: commission = rate × list − 0.5 × (list − charged)
 *   Example: list $1,000, rate 5%, sold $950 → $50 − $25 = $25
 * - Charged <= 90% of list: commission = $0 unless managerApproved, which uses the
 *   undersold formula above and still clamps at $0
 *   Example: list $1,000, rate 5%, sold $900 → $0
 * - List cannot be computed: commission = rate × charged, listVerified = false
 *   ("list not verified")
 *
 * Only Dana (7%), Amy (5%), Blake (15%), Scott (15%), and John (15%) earn commission.
 */

export const PRICING_VERSION = "V-10.9" as const;

/** Documented only. List and charged figures passed into this module are already pre-fee. */
export const EXCLUDED_FEE_RATE = 0.04;

/** Film Pricing add-on rates from the V-10.9 Preferences sheet. */
export const ADDON_RATES = {
  removalPerSf: 1.25,
  cBondPerSf: 1.25,
  frenchPane: 3,
} as const;

/** Sell $/SF by pricing group (Preferences Price_Group table). */
export const SELL_PER_SF_BY_GROUP: Record<number, number> = {
  1: 16.2019,
  2: 17.2834,
  3: 18.3649,
  4: 20.4558,
  5: 23.5664,
  6: 26.9139,
  7: 29.252,
  8: 34.5256,
  9: 41.097,
  10: 47.3594,
};

export type Rep = {
  id: "dana" | "amy" | "blake" | "scott" | "john";
  name: string;
  shortName: string;
  rate: number;
};

export const REPS: readonly Rep[] = [
  { id: "dana", name: "Dana Hojnacki", shortName: "Dana", rate: 0.07 },
  { id: "amy", name: "Amy Haley", shortName: "Amy", rate: 0.05 },
  { id: "blake", name: "Blake Parish", shortName: "Blake", rate: 0.15 },
  { id: "scott", name: "Scott Gafney", shortName: "Scott", rate: 0.15 },
  { id: "john", name: "John", shortName: "John", rate: 0.15 },
] as const;

const REPS_BY_KEY = new Map<string, Rep>();
for (const rep of REPS) {
  REPS_BY_KEY.set(rep.name.toLowerCase(), rep);
  REPS_BY_KEY.set(rep.shortName.toLowerCase(), rep);
  REPS_BY_KEY.set(rep.id, rep);
}

export function findRep(designer: string | null | undefined): Rep | null {
  if (!designer) return null;
  const key = designer.trim().toLowerCase();
  const direct = REPS_BY_KEY.get(key);
  if (direct) return direct;
  const first = key.split(/\s+/)[0];
  return (first && REPS_BY_KEY.get(first)) || null;
}

/** Null when the designer is outside the commissioned allowlist. */
export function commissionRateFor(designer: string | null | undefined): number | null {
  return findRep(designer)?.rate ?? null;
}

export function sellPerSfForGroup(group: number): number | null {
  return SELL_PER_SF_BY_GROUP[group] ?? null;
}

export type CommissionStatus =
  | "ok"
  | "oversold"
  | "undersold"
  | "below_floor"
  | "list_not_verified"
  | "needs_review"
  | "not_sold";

export type CommissionResult = {
  listPrice: number | null;
  charged: number | null;
  difference: number | null;
  /** Amount the rate multiplies. Null when pay is the undersold formula or the 10% floor. */
  commissionBase: number | null;
  commission: number | null;
  rate: number;
  status: CommissionStatus;
  listVerified: boolean;
  /** Charged is at or under 90% of list. */
  belowFloor: boolean;
  managerApproved: boolean;
  reason: string | null;
};

export type FilmLineInput = {
  /** Catalog sell $/SF. Null when the film is not on the V-10.9 catalog. */
  sellPerSf: number | null;
  /** Billed square feet. Null when the quote does not have usable SF. */
  sf: number | null;
  removal?: boolean;
  cBond?: boolean;
};

export type ListPriceResult = {
  listPrice: number | null;
  listVerified: boolean;
  usedOverride: boolean;
  lineAmounts: Array<number | null>;
  missingFilm: boolean;
  missingSf: boolean;
  frenchInvalid: boolean;
};

export type JobPriceInput = {
  rate: number;
  charged: number | null;
  lines: FilmLineInput[];
  frenchPanes?: number;
  /** Pre-fee list, when accounting already knows it. Replaces the catalog total. */
  listOverride?: number | null;
  /** Written manager approval. Uses the undersold formula when charged is 10% or more under list. */
  managerApproved?: boolean;
  /**
   * False when the Zoho Books quote is not accepted or invoiced.
   * Omitted means the caller already knows the quote is sold.
   */
  sold?: boolean;
};

export type JobPriceResult = {
  listPrice: number | null;
  charged: number | null;
  difference: number | null;
  commissionBase: number | null;
  commission: number | null;
  rate: number;
  status: CommissionStatus;
  listVerified: boolean;
  needsReview: boolean;
  belowFloor: boolean;
  managerApproved: boolean;
  notSold: boolean;
  usedOverride: boolean;
  reasons: string[];
  lineAmounts: Array<number | null>;
};

/** Half-up rounding to cents. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("roundMoney requires a finite number");
  }
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100 + 1e-8)) / 100;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function toCents(value: number): number {
  return Math.round(roundMoney(value) * 100);
}

/** Payable commission, never below zero. */
export function clampCommission(amount: number): number {
  return Math.max(0, roundMoney(amount));
}

/**
 * True when charged is at or under 90% of list, compared in cents.
 * `chargedCents * 10 <= listCents * 9` is the same test as charged <= 0.9 × list.
 */
export function isBelowListFloor(listPrice: number, charged: number): boolean {
  const listCents = toCents(listPrice);
  const chargedCents = toCents(charged);
  return chargedCents * 10 <= listCents * 9;
}

/**
 * rate × list − half the shortfall, clamped at $0.
 * Used for a mild undersell and for a below-floor sale that a manager approved.
 */
export function undersoldCommission(rate: number, listPrice: number, charged: number): number {
  const shortfall = roundMoney(roundMoney(listPrice) - roundMoney(charged));
  return clampCommission(rate * roundMoney(listPrice) - 0.5 * shortfall);
}

/**
 * Commission for one job from a pre-fee list and a pre-fee charged amount.
 * Mirrors scripts/engine/commission.py.
 */
export function commissionFromListAndCharged(
  rate: number,
  charged: number | null,
  listPrice: number | null,
  managerApproved = false,
): CommissionResult {
  const approved = Boolean(managerApproved);
  if (!isFiniteNumber(charged)) {
    return {
      listPrice: isFiniteNumber(listPrice) ? listPrice : null,
      charged: null,
      difference: null,
      commissionBase: null,
      commission: null,
      rate,
      status: "needs_review",
      listVerified: false,
      belowFloor: false,
      managerApproved: approved,
      reason: "invalid charged",
    };
  }

  const listVerified = isFiniteNumber(listPrice);
  if (!listVerified) {
    const base = charged;
    return {
      listPrice: null,
      charged: roundMoney(charged),
      difference: null,
      commissionBase: roundMoney(base),
      commission: clampCommission(rate * base),
      rate,
      status: "list_not_verified",
      listVerified: false,
      belowFloor: false,
      managerApproved: approved,
      reason: "list not verified — used charged as base",
    };
  }

  const listRounded = roundMoney(listPrice);
  const chargedRounded = roundMoney(charged);
  const difference = roundMoney(chargedRounded - listRounded);

  if (chargedRounded >= listRounded - 1e-9) {
    const status: CommissionStatus = Math.abs(difference) < 0.01 ? "ok" : "oversold";
    return {
      listPrice: listRounded,
      charged: chargedRounded,
      difference,
      commissionBase: chargedRounded,
      commission: clampCommission(rate * chargedRounded),
      rate,
      status,
      listVerified: true,
      belowFloor: false,
      managerApproved: approved,
      reason: null,
    };
  }

  const belowFloor = isBelowListFloor(listRounded, chargedRounded);
  const formulaPay = undersoldCommission(rate, listRounded, chargedRounded);
  const waived = belowFloor && !approved;
  return {
    listPrice: listRounded,
    charged: chargedRounded,
    difference,
    commissionBase: null,
    commission: waived ? 0 : formulaPay,
    rate,
    status: belowFloor ? "below_floor" : "undersold",
    listVerified: true,
    belowFloor,
    managerApproved: approved,
    reason: waived ? "below 10% floor" : null,
  };
}

export function computeCommission(
  rate: number,
  charged: number | null,
  listPrice: number | null,
  managerApproved = false,
): CommissionResult {
  return commissionFromListAndCharged(rate, charged, listPrice, managerApproved);
}

/** Unrounded list dollars for one film line, including removal and C-Bond on that SF. */
export function lineListPrice(line: FilmLineInput): number | null {
  if (!isFiniteNumber(line.sellPerSf) || line.sellPerSf < 0) return null;
  if (!isFiniteNumber(line.sf) || line.sf < 0) return null;
  let total = line.sellPerSf * line.sf;
  if (line.removal) total += ADDON_RATES.removalPerSf * line.sf;
  if (line.cBond) total += ADDON_RATES.cBondPerSf * line.sf;
  return total;
}

export function calculateListPrice(input: {
  lines: FilmLineInput[];
  frenchPanes?: number;
  listOverride?: number | null;
}): ListPriceResult {
  const lineAmounts = input.lines.map(lineListPrice);
  let missingFilm = input.lines.length === 0;
  let missingSf = input.lines.length === 0;
  for (const line of input.lines) {
    if (!isFiniteNumber(line.sellPerSf) || line.sellPerSf < 0) missingFilm = true;
    if (!isFiniteNumber(line.sf) || line.sf < 0) missingSf = true;
  }

  if (isFiniteNumber(input.listOverride)) {
    return {
      listPrice: roundMoney(input.listOverride),
      listVerified: true,
      usedOverride: true,
      lineAmounts,
      missingFilm,
      missingSf,
      frenchInvalid: false,
    };
  }

  const french = input.frenchPanes ?? 0;
  const frenchInvalid = !Number.isFinite(french) || french < 0;
  if (frenchInvalid || missingFilm || missingSf || lineAmounts.some((amount) => amount == null)) {
    return {
      listPrice: null,
      listVerified: false,
      usedOverride: false,
      lineAmounts,
      missingFilm,
      missingSf,
      frenchInvalid,
    };
  }

  const filmTotal = lineAmounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);
  return {
    listPrice: roundMoney(filmTotal + french * ADDON_RATES.frenchPane),
    listVerified: true,
    usedOverride: false,
    lineAmounts,
    missingFilm: false,
    missingSf: false,
    frenchInvalid: false,
  };
}

/**
 * Full job price: V-10.9 list (catalog × SF + add-ons) and commission.
 * This is the function the calculator and a future dashboard should call.
 */
export function priceJob(input: JobPriceInput): JobPriceResult {
  const list = calculateListPrice({
    lines: input.lines,
    frenchPanes: input.frenchPanes,
    listOverride: input.listOverride,
  });
  const charged = isFiniteNumber(input.charged) ? input.charged : null;
  if (input.sold === false) {
    return {
      listPrice: list.listPrice,
      charged: charged == null ? null : roundMoney(charged),
      difference:
        list.listVerified && list.listPrice != null && charged != null
          ? roundMoney(roundMoney(charged) - list.listPrice)
          : null,
      commissionBase: null,
      commission: 0,
      rate: input.rate,
      status: "not_sold",
      listVerified: list.listVerified,
      needsReview: list.missingFilm || list.missingSf || list.frenchInvalid,
      belowFloor: false,
      managerApproved: Boolean(input.managerApproved),
      notSold: true,
      usedOverride: list.usedOverride,
      reasons: ["Not sold in Zoho Books — no commission."],
      lineAmounts: list.lineAmounts,
    };
  }
  const pay = commissionFromListAndCharged(
    input.rate,
    charged,
    list.listVerified ? list.listPrice : null,
    input.managerApproved,
  );

  const reasons: string[] = [];
  if (list.missingFilm) reasons.push("Film is missing.");
  if (list.missingSf) reasons.push("Square footage is missing.");
  if (list.frenchInvalid) reasons.push("French pane count is invalid.");
  if (charged == null) reasons.push("Charged amount is missing.");
  else if (!list.listVerified) reasons.push("List not verified.");
  else if (pay.belowFloor && !pay.managerApproved) reasons.push("Below 10% floor.");

  const needsReview =
    list.missingFilm || list.missingSf || list.frenchInvalid || charged == null;

  return {
    listPrice: list.listPrice,
    charged: charged == null ? null : roundMoney(charged),
    difference: list.listVerified && charged != null ? pay.difference : null,
    commissionBase: pay.commissionBase,
    commission: pay.commission,
    rate: input.rate,
    status: charged == null ? "needs_review" : pay.status,
    listVerified: list.listVerified && charged != null ? pay.listVerified : list.listVerified,
    needsReview,
    belowFloor: list.listVerified && charged != null ? pay.belowFloor : false,
    managerApproved: pay.managerApproved,
    notSold: false,
    usedOverride: list.usedOverride,
    reasons,
    lineAmounts: list.lineAmounts,
  };
}
