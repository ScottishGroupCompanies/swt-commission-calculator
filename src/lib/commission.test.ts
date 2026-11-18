import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatRate } from "./format";
import { isSoldQuoteStatus, normalizeQuoteNumber, quoteMatches } from "./quotes";
import {
  ADDON_RATES,
  CREDIT_CARD_FEE_RATE,
  CREDIT_CARD_FEE_THRESHOLD,
  EXCLUDED_FEE_RATE,
  REPS,
  SELL_PER_SF_BY_GROUP,
  clampCommission,
  commissionFromListAndCharged,
  commissionRateFor,
  creditCardFeeApplies,
  creditCardProcessingFee,
  priceJob,
  sellPerSfForGroup,
} from "./commission";
import { priceSnapshotJob } from "./snapshot-price";
import type { CommissionSnapshot, SnapshotJob } from "./types";

describe("formatRate", () => {
  it("prints whole-number rates without a float artifact", () => {
    expect(formatRate(0.07)).toBe("7%");
    expect(formatRate(0.05)).toBe("5%");
    expect(formatRate(0.15)).toBe("15%");
  });
});

describe("Zoho Books quote status", () => {
  it("treats only accepted and invoiced quotes as sold", () => {
    expect(isSoldQuoteStatus("accepted")).toBe(true);
    expect(isSoldQuoteStatus("Invoiced")).toBe(true);
    expect(isSoldQuoteStatus("sent")).toBe(false);
    expect(isSoldQuoteStatus("draft")).toBe(false);
    expect(isSoldQuoteStatus(null)).toBe(false);
  });

  it("matches WT-03533 and WT-03533-QT01 as the same quote", () => {
    const job = { zoho: "WT-03533", estimateNumber: "WT-03533-QT01" };
    expect(normalizeQuoteNumber("wt-03533-qt01")).toBe("WT-03533");
    expect(quoteMatches(job, "WT-03533")).toBe(true);
    expect(quoteMatches(job, "WT-03533-QT01")).toBe(true);
    expect(quoteMatches(job, "wt 03533")).toBe(false);
    expect(quoteMatches(job, "WT-03533-QT02")).toBe(true);
  });

  it("pays $0 when the Books quote is not accepted or invoiced", () => {
    const result = priceJob({
      rate: 0.05,
      charged: 1100,
      sold: false,
      lines: [{ sellPerSf: 10, sf: 100 }],
    });
    expect(result.listPrice).toBe(1000);
    expect(result.commission).toBe(0);
    expect(result.notSold).toBe(true);
    expect(result.status).toBe("not_sold");
    expect(result.belowFloor).toBe(false);
    expect(result.reasons.join(" ")).toBe("Not sold in Zoho Books — no commission.");
  });
});

describe("official commission policy at 5%", () => {
  it("pays rate times charged when sold above list ($1,000 list, sold $1,100 = $55)", () => {
    const result = commissionFromListAndCharged(0.05, 1100, 1000);
    expect(result.commission).toBe(55);
    expect(result.commissionBase).toBe(1100);
    expect(result.difference).toBe(100);
    expect(result.status).toBe("oversold");
    expect(result.belowFloor).toBe(false);
    expect(result.listVerified).toBe(true);
  });

  it("pays rate times list minus half the shortfall when undersold by less than 10% ($950 = $25)", () => {
    const result = commissionFromListAndCharged(0.05, 950, 1000);
    expect(result.difference).toBe(-50);
    expect(result.commission).toBe(25);
    expect(result.status).toBe("undersold");
    expect(result.belowFloor).toBe(false);
    expect(result.managerApproved).toBe(false);
  });

  it("pays $0 when charged is 10% or more below list ($900) unless a manager approved it", () => {
    const blocked = commissionFromListAndCharged(0.05, 900, 1000);
    expect(blocked.commission).toBe(0);
    expect(blocked.status).toBe("below_floor");
    expect(blocked.belowFloor).toBe(true);
    expect(blocked.reason).toMatch(/below 10% floor/i);

    const approved = commissionFromListAndCharged(0.05, 900, 1000, true);
    expect(approved.managerApproved).toBe(true);
    expect(approved.belowFloor).toBe(true);
    expect(approved.status).toBe("below_floor");
    // 5% of $1,000 minus half of the $100 shortfall is $0.
    expect(approved.commission).toBe(0);
  });

  it("uses the undersold formula when a manager approves a deeper discount, and clamps at $0", () => {
    const approved = commissionFromListAndCharged(0.15, 900, 1000, true);
    expect(approved.belowFloor).toBe(true);
    expect(approved.commission).toBe(100);

    const clamped = commissionFromListAndCharged(0.05, 800, 1000, true);
    expect(clamped.belowFloor).toBe(true);
    expect(clamped.commission).toBe(0);
  });
});

describe("commissionFromListAndCharged", () => {
  it("pays the rate on charged when charged equals list", () => {
    const result = commissionFromListAndCharged(0.07, 500, 500);
    expect(result.difference).toBe(0);
    expect(result.commissionBase).toBe(500);
    expect(result.commission).toBe(35);
    expect(result.status).toBe("ok");
    expect(result.belowFloor).toBe(false);
  });

  it("uses charged as the base and flags list not verified when list is missing", () => {
    const result = commissionFromListAndCharged(0.15, 400, null);
    expect(result.listPrice).toBeNull();
    expect(result.difference).toBeNull();
    expect(result.commissionBase).toBe(400);
    expect(result.commission).toBe(60);
    expect(result.listVerified).toBe(false);
    expect(result.belowFloor).toBe(false);
    expect(result.status).toBe("list_not_verified");
    expect(result.reason).toMatch(/list not verified/i);
  });

  it("does not invent a commission when charged is missing", () => {
    const result = commissionFromListAndCharged(0.15, null, 500);
    expect(result.commission).toBeNull();
    expect(result.commissionBase).toBeNull();
    expect(result.status).toBe("needs_review");
    expect(result.listVerified).toBe(false);
    expect(result.belowFloor).toBe(false);
  });

  it("treats a sale exactly at 90% of list as the floor", () => {
    const result = commissionFromListAndCharged(0.15, 900, 1000);
    expect(result.belowFloor).toBe(true);
    expect(result.commission).toBe(0);
    const justAbove = commissionFromListAndCharged(0.05, 901, 1000);
    expect(justAbove.belowFloor).toBe(false);
    expect(justAbove.status).toBe("undersold");
    expect(justAbove.commission).toBe(0.5);
  });
});

describe("allowlist and pricing groups", () => {
  it("pays only Dana, Amy, Blake, Scott, and John", () => {
    expect(REPS.map((rep) => [rep.shortName, rep.rate])).toEqual([
      ["Dana", 0.07],
      ["Amy", 0.05],
      ["Blake", 0.15],
      ["Scott", 0.15],
      ["John", 0.15],
    ]);
    expect(commissionRateFor("Dana Hojnacki")).toBe(0.07);
    expect(commissionRateFor("amy")).toBe(0.05);
    expect(commissionRateFor("Blake Parish")).toBe(0.15);
    expect(commissionRateFor("Scott")).toBe(0.15);
    expect(commissionRateFor("John")).toBe(0.15);
    expect(commissionRateFor("Katie Pelowich Faith")).toBeNull();
    expect(commissionRateFor("MB")).toBeNull();
    expect(commissionRateFor("")).toBeNull();
  });

  it("exposes the V-10.9 group sell rates and the excluded 4% fee", () => {
    expect(sellPerSfForGroup(7)).toBe(29.252);
    expect(sellPerSfForGroup(4)).toBe(20.4558);
    expect(sellPerSfForGroup(1)).toBe(SELL_PER_SF_BY_GROUP[1]);
    expect(sellPerSfForGroup(11)).toBeNull();
    expect(EXCLUDED_FEE_RATE).toBe(0.04);
    expect(ADDON_RATES).toEqual({ removalPerSf: 1.25, cBondPerSf: 1.25, frenchPane: 3 });
  });
});

describe("priceJob", () => {
  it("builds list from sell × SF and does not add the 4% fee", () => {
    const result = priceJob({
      rate: 0.15,
      charged: 400,
      lines: [{ sellPerSf: 25, sf: 20 }],
    });
    expect(result.listPrice).toBe(500);
    expect(result.listPrice).not.toBeCloseTo(500 * 1.04, 2);
    expect(result.belowFloor).toBe(true);
    expect(result.commission).toBe(0);
    expect(result.needsReview).toBe(false);
    expect(result.listVerified).toBe(true);
    expect(result.status).toBe("below_floor");
  });

  it("adds removal and C-Bond at $1.25 per SF and French panes at $3", () => {
    const result = priceJob({
      rate: 0.15,
      charged: 250,
      frenchPanes: 2,
      lines: [{ sellPerSf: 20, sf: 10, removal: true, cBond: true }],
    });
    // 20*10 + 1.25*10 + 1.25*10 + 2*3 = 231
    expect(result.listPrice).toBe(231);
    expect(result.needsReview).toBe(false);
    expect(result.listVerified).toBe(true);
  });

  it("flags needs review and list not verified when film or SF is missing", () => {
    const missingFilm = priceJob({
      rate: 0.15,
      charged: 764,
      lines: [{ sellPerSf: null, sf: null, cBond: true }],
    });
    expect(missingFilm.needsReview).toBe(true);
    expect(missingFilm.listVerified).toBe(false);
    expect(missingFilm.listPrice).toBeNull();
    expect(missingFilm.status).toBe("list_not_verified");
    expect(missingFilm.commissionBase).toBe(764);
    expect(missingFilm.commission).toBe(114.6);
    expect(missingFilm.reasons.join(" ")).toMatch(/Film is missing/);
    expect(missingFilm.reasons.join(" ")).toMatch(/Square footage is missing/);
    expect(missingFilm.reasons.join(" ")).toMatch(/List not verified/);

    const missingSf = priceJob({
      rate: 0.05,
      charged: 100,
      lines: [{ sellPerSf: 16.2019, sf: null }],
    });
    expect(missingSf.needsReview).toBe(true);
    expect(missingSf.listVerified).toBe(false);
    expect(missingSf.commission).toBe(5);
  });

  it("keeps needs review when a list override supplies the missing list", () => {
    const result = priceJob({
      rate: 0.15,
      charged: 400,
      listOverride: 500,
      lines: [{ sellPerSf: null, sf: null }],
    });
    expect(result.usedOverride).toBe(true);
    expect(result.listVerified).toBe(true);
    expect(result.listPrice).toBe(500);
    expect(result.belowFloor).toBe(true);
    expect(result.commission).toBe(0);
    expect(result.needsReview).toBe(true);
    expect(result.reasons.join(" ")).toMatch(/Film is missing/);
    expect(result.reasons.join(" ")).toMatch(/Below 10% floor/);
    expect(result.reasons.join(" ")).not.toMatch(/List not verified/);
  });

  it("does not treat a partial film total as a verified list", () => {
    const result = priceJob({
      rate: 0.05,
      charged: 1247.98,
      lines: [
        { sellPerSf: 17.2834, sf: 55.0275 },
        { sellPerSf: null, sf: null },
      ],
    });
    expect(result.listPrice).toBeNull();
    expect(result.listVerified).toBe(false);
    expect(result.needsReview).toBe(true);
    expect(result.commissionBase).toBe(1247.98);
  });
});

describe("paid by credit card", () => {
  it("charges 2.9% only when the commissionable amount is over $10,000", () => {
    expect(CREDIT_CARD_FEE_RATE).toBe(0.029);
    expect(CREDIT_CARD_FEE_THRESHOLD).toBe(10_000);
    expect(creditCardProcessingFee(20_000)).toBe(580);
    expect(creditCardFeeApplies(true, 10_000)).toBe(false);
    expect(creditCardFeeApplies(true, 10_000.01)).toBe(true);
    expect(creditCardFeeApplies(false, 20_000)).toBe(false);

    const atCeiling = commissionFromListAndCharged(0.15, 10_000, 10_000, false, true);
    expect(atCeiling.creditCardFee).toBe(0);
    expect(atCeiling.commission).toBe(1500);
    expect(atCeiling.commissionBeforeCreditCard).toBe(1500);
    expect(atCeiling.paidByCreditCard).toBe(true);
    expect(atCeiling.status).toBe("ok");

    const under = commissionFromListAndCharged(0.15, 9999.99, 9999.99, false, true);
    const underPlain = commissionFromListAndCharged(0.15, 9999.99, 9999.99);
    expect(under.creditCardFee).toBe(0);
    expect(under.commission).toBe(underPlain.commission);
    expect(under.commissionBase).toBe(underPlain.commissionBase);
  });

  it("deducts $580 from a $20,000 at-list job before Blake's 15% ($2,913)", () => {
    const plain = commissionFromListAndCharged(0.15, 20_000, 20_000);
    expect(plain.commission).toBe(3000);
    expect(plain.creditCardFee).toBe(0);
    expect(plain.paidByCreditCard).toBe(false);

    const card = commissionFromListAndCharged(0.15, 20_000, 20_000, false, true);
    expect(card.status).toBe("ok");
    expect(card.belowFloor).toBe(false);
    expect(card.creditCardFee).toBe(580);
    expect(card.commissionBase).toBe(19_420);
    expect(card.commissionBeforeCreditCard).toBe(3000);
    expect(card.commission).toBe(2913);
  });

  it("keeps an oversold tier when the fee would drop the base under list", () => {
    // $20,100 vs list $20,000 is over list. Fee $582.90 leaves a base of $19,517.10,
    // which would be undersold if the tier were chosen after the fee.
    const card = commissionFromListAndCharged(0.15, 20_100, 20_000, false, true);
    expect(creditCardProcessingFee(20_100)).toBe(582.9);
    expect(card.status).toBe("oversold");
    expect(card.belowFloor).toBe(false);
    expect(card.creditCardFee).toBe(582.9);
    expect(card.commissionBase).toBe(19517.1);
    expect(card.commission).toBe(2927.57);
    expect(card.commissionBeforeCreditCard).toBe(3015);
  });

  it("subtracts rate × fee from the undersold base and does not cross the 10% floor", () => {
    // List $22,000, commissionable $20,000 after a $2,000 discount.
    // 20000 / 22000 is about 9.09% under list, so the tier is undersold <10%.
    // Fee $580 would leave $19,420, which is under 90% of $22,000 ($19,800).
    // The tier stays undersold and the fee comes off the formula's base.
    const plain = commissionFromListAndCharged(0.15, 20_000, 22_000);
    expect(plain.status).toBe("undersold");
    expect(plain.belowFloor).toBe(false);
    // 15% of $22,000 − half of the $2,000 shortfall = $3,300 − $1,000.
    expect(plain.commission).toBe(2300);

    const card = commissionFromListAndCharged(0.15, 20_000, 22_000, false, true);
    expect(card.status).toBe("undersold");
    expect(card.belowFloor).toBe(false);
    expect(card.creditCardFee).toBe(580);
    expect(card.commissionBeforeCreditCard).toBe(2300);
    // U − rate × fee = 2300 − 0.15 × 580 = 2300 − 87.
    expect(card.commission).toBe(clampCommission(2300 - 0.15 * 580));
    expect(card.commission).toBe(2213);
    expect(card.commission).not.toBe(0);
  });

  it("leaves a below-floor job at $0 and still reports the fee", () => {
    const blocked = commissionFromListAndCharged(0.15, 15_000, 20_000, false, true);
    expect(blocked.status).toBe("below_floor");
    expect(blocked.commission).toBe(0);
    expect(blocked.creditCardFee).toBe(435);
    expect(blocked.commissionBeforeCreditCard).toBe(0);

    const approved = commissionFromListAndCharged(0.15, 15_000, 20_000, true, true);
    expect(approved.status).toBe("below_floor");
    expect(approved.managerApproved).toBe(true);
    // 15% of $20,000 − half of the $5,000 shortfall = $3,000 − $2,500 = $500.
    // Then subtract 15% of the $435 fee.
    expect(approved.commissionBeforeCreditCard).toBe(500);
    expect(approved.creditCardFee).toBe(435);
    expect(approved.commission).toBe(434.75);
  });
});

describe("bundled snapshot jobs", () => {
  const snapshot = JSON.parse(
    readFileSync(path.join(process.cwd(), "src/data/snapshot.json"), "utf8"),
  ) as CommissionSnapshot;

  function job(zoho: string): SnapshotJob {
    const found = snapshot.jobs.find((entry) => entry.zoho === zoho);
    if (!found) throw new Error(`missing ${zoho}`);
    return found;
  }

  it("recalculates Helibrun from catalog films without the 4% fee", () => {
    expect(snapshot.asOf).toMatch(/2026/);
    expect(snapshot.catalog).toHaveLength(307);
    const helibrun = job("WT-03533");
    expect(helibrun.designer).toBe("Dana Hojnacki");
    expect(helibrun.salesperson).toBe("Dana Hojnacki");
    expect(helibrun.quoteStatus).toBe("invoiced");
    expect(helibrun.acceptedDate).toBe("2026-10-12");
    expect(helibrun.dateSold).toBe("10/12/2026");
    expect(helibrun.estimateNumber).toBe("WT-03533-QT01");
    expect(helibrun.charged).toBe(3282);
    const result = priceJob({
      rate: commissionRateFor(helibrun.designer) ?? 0,
      charged: helibrun.charged,
      lines: helibrun.films.map((film) => ({
        sellPerSf: film.sellPerSf,
        sf: film.sf,
        removal: film.removal,
        cBond: film.cBond,
      })),
    });
    expect(result.listPrice).toBe(4555.24);
    expect(result.difference).toBe(-1273.24);
    expect(result.belowFloor).toBe(true);
    expect(result.commission).toBe(0);
    expect(result.needsReview).toBe(false);
    expect(result.status).toBe("below_floor");
    expect(result.reasons.join(" ")).toMatch(/Below 10% floor/);

    const approved = priceJob({
      rate: commissionRateFor(helibrun.designer) ?? 0,
      charged: helibrun.charged,
      managerApproved: true,
      lines: helibrun.films.map((film) => ({
        sellPerSf: film.sellPerSf,
        sf: film.sf,
        removal: film.removal,
        cBond: film.cBond,
      })),
    });
    expect(approved.managerApproved).toBe(true);
    expect(approved.belowFloor).toBe(true);
    expect(approved.commission).toBe(0);
  });

  it("pays nothing on a Books quote that was only sent", () => {
    const sent = job("WT-03130");
    expect(sent.quoteStatus).toBe("sent");
    expect(sent.salesperson).toBe("Amy Haley");
    expect(sent.acceptedDate).toBeNull();
    const result = priceJob({
      rate: commissionRateFor(sent.salesperson) ?? 0,
      charged: sent.charged,
      sold: isSoldQuoteStatus(sent.quoteStatus),
      lines: sent.films.map((film) => ({
        sellPerSf: film.sellPerSf,
        sf: film.sf,
        removal: film.removal,
        cBond: film.cBond,
      })),
    });
    expect(result.commission).toBe(0);
    expect(result.notSold).toBe(true);
    expect(result.reasons[0]).toBe("Not sold in Zoho Books — no commission.");
  });

  it("flags Dorhout needs review and pays 15% of charged", () => {
    const dorhout = job("WT-03539");
    expect(dorhout.designer).toBe("Blake Parish");
    const result = priceJob({
      rate: commissionRateFor(dorhout.designer) ?? 0,
      charged: dorhout.charged,
      lines: dorhout.films.map((film) => ({
        sellPerSf: film.sellPerSf,
        sf: film.sf,
        removal: film.removal,
        cBond: film.cBond,
      })),
    });
    expect(result.needsReview).toBe(true);
    expect(result.listVerified).toBe(false);
    expect(result.commission).toBe(114.6);
  });

  it("takes the credit card fee from the discounted commissionable amount", () => {
    const discount = job("WT-03643");
    expect(discount.estimateNumber).toBe("WT-03643-QT01");
    expect(discount.charged).toBe(11495.05);
    expect(discount.discountLines?.some((line) => line.amount === -605)).toBe(true);
    const plain = priceSnapshotJob(discount);
    expect(plain.listVerified).toBe(false);
    expect(plain.commission).toBe(1724.26);
    expect(plain.creditCardFee).toBe(0);

    const card = priceSnapshotJob(discount, { paidByCreditCard: true });
    // Fee is 2.9% of $11,495.05 (film minus the $605 discount), not of the pre-discount film.
    expect(card.status).toBe("list_not_verified");
    expect(card.creditCardFee).toBe(333.36);
    expect(card.creditCardFee).not.toBe(creditCardProcessingFee(11495.05 + 605));
    expect(card.commissionBase).toBe(11161.69);
    expect(card.commissionBeforeCreditCard).toBe(1724.26);
    expect(card.commission).toBe(1674.25);
  });
});
