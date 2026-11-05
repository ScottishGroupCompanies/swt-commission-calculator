import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatRate } from "./format";
import {
  ADDON_RATES,
  EXCLUDED_FEE_RATE,
  REPS,
  SELL_PER_SF_BY_GROUP,
  commissionFromListAndCharged,
  commissionRateFor,
  priceJob,
  sellPerSfForGroup,
} from "./commission";
import type { CommissionSnapshot, SnapshotJob } from "./types";

describe("formatRate", () => {
  it("prints whole-number rates without a float artifact", () => {
    expect(formatRate(0.07)).toBe("7%");
    expect(formatRate(0.05)).toBe("5%");
    expect(formatRate(0.15)).toBe("15%");
  });
});

describe("commissionFromListAndCharged", () => {
  it("pays 15% of the $450 base when list is $500 and charged is $400", () => {
    const result = commissionFromListAndCharged(0.15, 400, 500);
    expect(result.listPrice).toBe(500);
    expect(result.charged).toBe(400);
    expect(result.difference).toBe(-100);
    expect(result.commissionBase).toBe(450);
    expect(result.commission).toBe(67.5);
    expect(result.status).toBe("undersold");
    expect(result.listVerified).toBe(true);
    expect(result.reason).toBeNull();
  });

  it("pays the rate on charged when the job is oversold", () => {
    const result = commissionFromListAndCharged(0.15, 600, 500);
    expect(result.difference).toBe(100);
    expect(result.commissionBase).toBe(600);
    expect(result.commission).toBe(90);
    expect(result.status).toBe("oversold");
    expect(result.listVerified).toBe(true);
  });

  it("pays the rate on charged when charged equals list", () => {
    const result = commissionFromListAndCharged(0.07, 500, 500);
    expect(result.difference).toBe(0);
    expect(result.commissionBase).toBe(500);
    expect(result.commission).toBe(35);
    expect(result.status).toBe("ok");
  });

  it("uses charged as the base and flags list not verified when list is missing", () => {
    const result = commissionFromListAndCharged(0.15, 400, null);
    expect(result.listPrice).toBeNull();
    expect(result.difference).toBeNull();
    expect(result.commissionBase).toBe(400);
    expect(result.commission).toBe(60);
    expect(result.listVerified).toBe(false);
    expect(result.status).toBe("list_not_verified");
    expect(result.reason).toMatch(/list not verified/i);
  });

  it("does not invent a commission when charged is missing", () => {
    const result = commissionFromListAndCharged(0.15, null, 500);
    expect(result.commission).toBeNull();
    expect(result.commissionBase).toBeNull();
    expect(result.status).toBe("needs_review");
    expect(result.listVerified).toBe(false);
  });

  it("rounds an undersold base to cents before applying the rate", () => {
    const result = commissionFromListAndCharged(0.07, 3282, 4555.24);
    expect(result.difference).toBe(-1273.24);
    expect(result.commissionBase).toBe(3918.62);
    expect(result.commission).toBe(274.3);
    expect(result.status).toBe("undersold");
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
    expect(result.commissionBase).toBe(450);
    expect(result.commission).toBe(67.5);
    expect(result.needsReview).toBe(false);
    expect(result.listVerified).toBe(true);
    expect(result.status).toBe("undersold");
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
    expect(result.commission).toBe(67.5);
    expect(result.needsReview).toBe(true);
    expect(result.reasons.join(" ")).toMatch(/Film is missing/);
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
    expect(result.commissionBase).toBe(3918.62);
    expect(result.commission).toBe(274.3);
    expect(result.needsReview).toBe(false);
    expect(result.status).toBe("undersold");
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
});
