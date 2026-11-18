import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { policyForJob, toCommissionRecord } from "@/lib/commission-lookup";
import { roundMoney } from "@/lib/commission";
import { booksDataLabel, booksFreshnessIso, formatBooksAsOf } from "@/lib/freshness";
import { priceSnapshotJob } from "@/lib/snapshot-price";
import type { CommissionSnapshot, SnapshotJob } from "@/lib/types";

const root = path.resolve(process.cwd());
const snapshot = JSON.parse(
  readFileSync(path.join(root, "src/data/snapshot.json"), "utf8"),
) as CommissionSnapshot;

function filmLine(description: string, quantity: number, rate: number, itemTotal: number) {
  return {
    name: "Solar Film",
    description,
    quantity,
    rate,
    itemTotal,
    unit: "sf",
    category: "Material - Film",
  };
}

function feeLine(itemTotal: number) {
  return {
    name: "Fee",
    description: "4% fee",
    quantity: 1,
    rate: itemTotal,
    itemTotal,
    unit: "",
    category: "Fee",
  };
}

function extraLine(
  name: string,
  description: string,
  itemTotal: number,
  category = "Service",
  unit = "",
) {
  return {
    name,
    description,
    quantity: 1,
    rate: itemTotal,
    itemTotal,
    unit,
    category,
  };
}

function estimate(partial: Record<string, unknown>) {
  return {
    estimateId: partial.estimateId,
    estimateNumber: partial.estimateNumber,
    status: partial.status ?? "accepted",
    acceptedDate: partial.acceptedDate ?? "2026-11-18",
    date: partial.date ?? "2026-11-18",
    salesperson: partial.salesperson ?? "Amy Haley",
    customerName: partial.customerName ?? "Test Customer",
    total: partial.total ?? 0,
    lineItems: partial.lineItems ?? [],
  };
}

function toSnapshotJob(job: {
  id: string;
  client: string;
  zoho: string;
  jobNumber: string;
  designer: string;
  salesperson: string | null;
  location?: string;
  acceptedDate: string | null;
  charged: number;
  quoteAmount?: number | null;
  commissionableAmount?: number | null;
  excludedLines?: Array<{ name: string; description: string; amount: number; category: string | null; reason: string }>;
  commissionableAmountVerified?: boolean;
  lineItemsAvailable?: boolean;
  estimateId: string | null;
  estimateNumber: string | null;
  quoteStatus: string | null;
  films: Array<{
    itemName?: string;
    description?: string;
    film?: string | null;
    catalogProduct?: string | null;
    sellPerSf?: number | null;
    pricingGroup?: number | null;
    sf?: number | null;
    lineAmount?: number | null;
    lump?: boolean;
    addons?: { removal?: boolean; cbond?: boolean; french?: boolean };
  }>;
}): SnapshotJob {
  return {
    id: job.id,
    client: job.client,
    zoho: job.zoho,
    jobNumber: job.jobNumber,
    designer: job.designer,
    salesperson: job.salesperson,
    location: job.location || "",
    dateSold: "",
    acceptedDate: job.acceptedDate,
    monthSold: "",
    jobType: "",
    filmType: "",
    charged: job.charged,
    quoteAmount: job.quoteAmount,
    commissionableAmount: job.commissionableAmount,
    excludedLines: job.excludedLines,
    commissionableAmountVerified: job.commissionableAmountVerified,
    lineItemsAvailable: job.lineItemsAvailable,
    estimateId: job.estimateId,
    estimateNumber: job.estimateNumber,
    quoteStatus: job.quoteStatus,
    films: job.films.map((film) => ({
      itemName: film.itemName || "",
      description: film.description || "",
      film: film.film ?? null,
      catalogProduct: film.catalogProduct ?? null,
      sellPerSf: film.sellPerSf ?? null,
      pricingGroup: film.pricingGroup ?? null,
      sf: film.sf ?? null,
      lineAmount: film.lineAmount ?? null,
      lump: Boolean(film.lump),
      removal: Boolean(film.addons?.removal),
      cBond: Boolean(film.addons?.cbond),
      french: Boolean(film.addons?.french),
    })),
  };
}

function buildFixtureJobs() {
  const dir = mkdtempSync(path.join(tmpdir(), "books-jobs-"));
  const jobsPath = path.join(dir, "jobs.json");
  const booksPath = path.join(dir, "books.json");
  const atList = filmLine("Install Prestige 50 on the south windows", 10, 29.252, 292.52);
  const under = filmLine("Install Prestige 50 on the north windows", 10, 27.8, 278);
  writeFileSync(
    jobsPath,
    JSON.stringify({
      jobs: [
        {
          id: "WT-03620|1",
          zoho: "WT-03620",
          estimateNumber: "WT-03620-QT01",
          estimateId: "existing-3620",
          jobNumber: "F1",
        },
      ],
    }),
  );
  writeFileSync(
    booksPath,
    JSON.stringify({
      fetchedAt: "2026-11-17T22:16:18Z",
      estimates: [
        estimate({
          estimateId: "existing-3620",
          estimateNumber: "WT-03620-QT01",
          customerName: "Already on the sheet",
          lineItems: [atList, feeLine(11.7)],
        }),
        estimate({
          estimateId: "at-list",
          estimateNumber: "WT-03901-QT01",
          customerName: "At List Co",
          salesperson: "Amy Haley",
          status: "accepted",
          lineItems: [atList, feeLine(11.7)],
          total: 304.22,
        }),
        estimate({
          estimateId: "undersold",
          estimateNumber: "WT-03902-QT01",
          customerName: "Under List Co",
          salesperson: "Amy Haley",
          status: "invoiced",
          acceptedDate: "2026-11-18",
          lineItems: [under, feeLine(11.12)],
          total: 289.12,
        }),
        estimate({
          estimateId: "outsider",
          estimateNumber: "WT-03903-QT01",
          customerName: "Outside Rep Co",
          salesperson: "Katie Pelowich Faith",
          status: "accepted",
          lineItems: [atList, feeLine(11.7)],
        }),
        estimate({
          estimateId: "sent",
          estimateNumber: "WT-03904-QT01",
          customerName: "Not Sold Co",
          salesperson: "Dana Hojnacki",
          status: "sent",
          acceptedDate: null,
          date: "2026-11-18",
          lineItems: [atList, feeLine(11.7)],
        }),
        estimate({
          estimateId: "unmatched",
          estimateNumber: "WT-03905-QT01",
          customerName: "No Film Co",
          salesperson: "Dana Hojnacki",
          status: "accepted",
          lineItems: [
            filmLine("ZZZNOTAFILM custom coating panels", 10, 20, 200),
            feeLine(8),
          ],
        }),
        estimate({
          estimateId: "old",
          estimateNumber: "WT-03906-QT01",
          customerName: "Last Year Co",
          status: "accepted",
          acceptedDate: "2025-12-01",
          date: "2025-12-01",
          lineItems: [atList],
        }),
        estimate({
          estimateId: "extras",
          estimateNumber: "WT-03907-QT01",
          customerName: "Travel Lift Fee Co",
          salesperson: "Amy Haley",
          status: "accepted",
          lineItems: [
            atList,
            extraLine("Trip Charge", "Mileage to the job site", 100),
            extraLine("Equipment", "Boom lift rental for the upper windows", 200),
            extraLine("Parking", "Downtown parking permit", 50, "Service"),
            feeLine(23.7),
          ],
          total: 666.22,
        }),
        estimate({
          estimateId: "ambiguous",
          estimateNumber: "WT-03908-QT01",
          customerName: "Unclassified Co",
          salesperson: "Dana Hojnacki",
          status: "invoiced",
          lineItems: [atList, extraLine("Widget", "See the office notes", 15, "Service")],
          total: 307.52,
        }),
        estimate({
          estimateId: "no-lines",
          estimateNumber: "WT-03909-QT01",
          customerName: "No Lines Co",
          salesperson: "Scott Gafney",
          status: "accepted",
          lineItems: [],
          total: 208,
        }),
      ],
    }),
  );
  const raw = execFileSync("python3", [path.join(root, "scripts/books_jobs.py"), "--jobs", jobsPath, "--books", booksPath], {
    cwd: root,
    encoding: "utf8",
  });
  return JSON.parse(raw) as {
    jobs: Array<Parameters<typeof toSnapshotJob>[0]>;
    missingLineItems: string[];
  };
}

describe("Books estimates become jobs", () => {
  const built = buildFixtureJobs();
  const byNumber = new Map(built.jobs.map((job) => [job.estimateNumber, toSnapshotJob(job)]));

  it("prices a new at-list estimate and a mild undersell from Books line items", () => {
    const atList = byNumber.get("WT-03901-QT01");
    expect(atList).toBeTruthy();
    const atPrice = priceSnapshotJob(atList!);
    expect(atPrice.listVerified).toBe(true);
    expect(atPrice.listPrice).toBe(292.52);
    expect(atPrice.charged).toBe(292.52);
    expect(atPrice.commission).toBe(roundMoney(0.05 * 292.52));
    expect(atPrice.commission).toBe(14.63);
    expect(policyForJob(atList!, atPrice).policy).toBe("at/over list");

    const under = byNumber.get("WT-03902-QT01");
    expect(under).toBeTruthy();
    const underPrice = priceSnapshotJob(under!);
    expect(underPrice.listVerified).toBe(true);
    expect(underPrice.listPrice).toBe(292.52);
    expect(underPrice.charged).toBe(278);
    expect(underPrice.status).toBe("undersold");
    expect(underPrice.belowFloor).toBe(false);
    expect(underPrice.commission).toBe(7.37);
    expect(policyForJob(under!, underPrice).policy).toBe("undersold <10%");
  });

  it("pays a non-earner and a quote that was not accepted $0, and keeps an unmatched film", () => {
    const outsider = byNumber.get("WT-03903-QT01");
    expect(outsider?.salesperson).toBe("Katie Pelowich Faith");
    const outsiderPrice = priceSnapshotJob(outsider!);
    expect(outsiderPrice.commission).toBe(0);
    expect(policyForJob(outsider!, outsiderPrice)).toMatchObject({
      policy: "not an earner",
      commissionable: false,
    });

    const sent = byNumber.get("WT-03904-QT01");
    expect(sent?.quoteStatus).toBe("sent");
    const sentPrice = priceSnapshotJob(sent!);
    expect(sentPrice.notSold).toBe(true);
    expect(sentPrice.commission).toBe(0);
    expect(policyForJob(sent!, sentPrice).policy).toBe("not accepted");

    const unmatched = byNumber.get("WT-03905-QT01");
    expect(unmatched).toBeTruthy();
    expect(unmatched!.films[0]?.catalogProduct).toBeNull();
    const unmatchedPrice = priceSnapshotJob(unmatched!);
    expect(unmatchedPrice.listVerified).toBe(false);
    expect(unmatchedPrice.charged).toBe(200);
    expect(unmatchedPrice.commission).toBe(14);
    expect(policyForJob(unmatched!, unmatchedPrice).policy).toBe("list not verified");
  });

  it("excludes travel, a lift, parking, and the fee, and still prices the film", () => {
    const job = byNumber.get("WT-03907-QT01");
    expect(job).toBeTruthy();
    expect(job!.charged).toBe(292.52);
    expect(job!.commissionableAmount).toBe(292.52);
    expect(job!.quoteAmount).toBe(666.22);
    expect(job!.lineItemsAvailable).toBe(true);
    expect(job!.commissionableAmountVerified).toBe(true);
    expect(job!.films.map((film) => film.itemName)).toEqual(["Solar Film"]);
    expect(job!.excludedLines?.map((line) => [line.name, line.amount, line.reason])).toEqual([
      ["Trip Charge", 100, "Travel / mileage"],
      ["Equipment", 200, "Lift / equipment"],
      ["Parking", 50, "Permit / parking"],
      ["Fee", 23.7, "Fee"],
    ]);
    const price = priceSnapshotJob(job!);
    expect(price.listPrice).toBe(292.52);
    expect(price.charged).toBe(292.52);
    expect(price.commission).toBe(14.63);
    expect(policyForJob(job!, price).policy).toBe("at/over list");
  });

  it("leaves an unclassified line out and flags the job", () => {
    const job = byNumber.get("WT-03908-QT01");
    expect(job).toBeTruthy();
    expect(job!.charged).toBe(292.52);
    expect(job!.commissionableAmountVerified).toBe(false);
    expect(job!.excludedLines).toEqual([
      expect.objectContaining({ name: "Widget", amount: 15, reason: "Not classified" }),
    ]);
    const price = priceSnapshotJob(job!);
    expect(price.commission).toBe(roundMoney(0.07 * 292.52));
  });

  it("strips 4% and flags a quote that has no line items", () => {
    const job = byNumber.get("WT-03909-QT01");
    expect(job).toBeTruthy();
    expect(job!.charged).toBe(200);
    expect(job!.quoteAmount).toBe(208);
    expect(job!.lineItemsAvailable).toBe(false);
    expect(job!.commissionableAmountVerified).toBe(true);
    expect(job!.excludedLines).toEqual([]);
    expect(job!.films).toEqual([]);
    expect(built.missingLineItems).toContain("WT-03909-QT01");
    const price = priceSnapshotJob(job!);
    expect(price.charged).toBe(200);
    expect(price.commission).toBe(30);
  });

  it("does not duplicate a sheet job or add a 2025 estimate", () => {
    expect(byNumber.has("WT-03620-QT01")).toBe(false);
    expect(built.jobs.some((job) => job.zoho === "WT-03620")).toBe(false);
    expect(byNumber.has("WT-03906-QT01")).toBe(false);
  });
});

describe("Books freshness label", () => {
  it("uses booksAsOf when that read is newer than the job export", () => {
    const booksAsOf = "2026-11-18T16:12:00Z";
    const newerThanJobs = {
      booksAsOf,
      asOfIso: "2026-11-05T12:34:41.581812-07:00",
      asOf: "2026-11-05 12:34 PM MST",
    };
    const job = toSnapshotJob({
      id: "fixture|1",
      client: "Fixture Co",
      zoho: "WT-00001",
      jobNumber: "F1",
      designer: "Amy Haley",
      salesperson: "Amy Haley",
      acceptedDate: "2026-11-18",
      charged: 100,
      estimateId: "fixture",
      estimateNumber: "WT-00001-QT01",
      quoteStatus: "accepted",
      films: [],
    });
    const label = formatBooksAsOf(booksAsOf);
    expect(label).toBe("Nov 18, 2026 9:12 AM MT");
    expect(booksFreshnessIso(newerThanJobs)).toBe(booksAsOf);
    expect(booksDataLabel(newerThanJobs)).toBe(
      `Zoho Books data as of ${label}. Prices exclude the 4% fee. Edits stay in this browser and are not written to Zoho.`,
    );
    expect(toCommissionRecord(job, newerThanJobs).fetchedAt).toBe(booksAsOf);
  });

  it("uses the job build time when that is later than the Books fetch", () => {
    const later = {
      booksAsOf: "2026-11-01T12:00:00Z",
      asOfIso: "2026-11-18T22:16:18Z",
      asOf: "2026-11-18 3:16 PM MST",
    };
    expect(booksFreshnessIso(later)).toBe(later.asOfIso);
    expect(booksDataLabel(later)).toContain("Nov 18, 2026 3:16 PM MT");
    expect(toCommissionRecord(snapshot.jobs[0], later).fetchedAt).toBe(later.asOfIso);
  });
});

describe("backfilled Books jobs in the snapshot", () => {
  function byEstimate(number: string): SnapshotJob {
    const found = snapshot.jobs.find((job) => job.estimateNumber === number);
    if (!found) throw new Error(`missing ${number}`);
    return found;
  }

  it("includes WT-03638 and WT-03645 from Books line items", () => {
    const barbeque = byEstimate("WT-03638-QT01");
    expect(barbeque.client).toBe("Barbeques Galore");
    expect(barbeque.salesperson).toBe("Amy Haley");
    expect(barbeque.quoteStatus).toBe("accepted");
    expect(barbeque.acceptedDate).toBe("2026-11-17");
    expect(barbeque.charged).toBe(1125);
    const barbequePrice = priceSnapshotJob(barbeque);
    expect(barbequePrice.listVerified).toBe(false);
    expect(barbequePrice.commission).toBe(56.25);
    expect(policyForJob(barbeque, barbequePrice).policy).toBe("list not verified");

    const alldredge = byEstimate("WT-03645-QT01");
    expect(alldredge.client).toBe("Linda Alldredge");
    expect(alldredge.salesperson).toBe("Dana Hojnacki");
    expect(alldredge.quoteStatus).toBe("accepted");
    expect(alldredge.acceptedDate).toBe("2026-11-17");
    expect(alldredge.charged).toBe(756.7);
    const alldredgePrice = priceSnapshotJob(alldredge);
    expect(alldredgePrice.listVerified).toBe(false);
    expect(alldredgePrice.commission).toBe(52.97);
    expect(policyForJob(alldredge, alldredgePrice).policy).toBe("list not verified");
  });

  it("excludes attachment, travel, and glass on real Books quotes", () => {
    const attachment = byEstimate("WT-02431-QT01");
    expect(attachment.salesperson).toBe("Amy Haley");
    expect(attachment.charged).toBe(10395.5);
    expect(attachment.quoteAmount).toBe(18375.58);
    expect(attachment.commissionableAmountVerified).toBe(true);
    expect(attachment.films.map((film) => film.itemName)).toEqual(["Security Film"]);
    expect(attachment.excludedLines?.map((line) => [line.name, line.amount, line.reason])).toEqual([
      ["Attachment", 7273.33, "Non-film extra"],
      ["Fee (No Tax)", 706.75, "Fee"],
    ]);
    const attachmentPrice = priceSnapshotJob(attachment);
    expect(attachmentPrice.listVerified).toBe(true);
    expect(attachmentPrice.belowFloor).toBe(true);
    expect(attachmentPrice.commission).toBe(0);

    const trip = byEstimate("WT-02153-QT01");
    expect(trip.charged).toBe(436.92);
    expect(trip.excludedLines?.map((line) => [line.name, line.reason])).toEqual([
      ["Replacement Glass", "Non-film extra"],
      ["Trip Charge", "Travel / mileage"],
    ]);
    expect(trip.commissionableAmountVerified).toBe(true);

    const discount = byEstimate("WT-03643-QT01");
    expect(discount.charged).toBe(12100.05);
    expect(discount.commissionableAmountVerified).toBe(false);
    expect(discount.excludedLines?.some((line) => line.reason === "Not classified" && line.amount === -605)).toBe(
      true,
    );
  });
});
