/**
 * Package the bundled calculator snapshot from the prototype job export,
 * Zoho Books estimates, and the V-10.9 film catalog.
 *
 *   node scripts/build-snapshot.mjs
 *
 * Inputs:
 *   data/source/jobs.json              (from scripts/build_commission_data.py, or the checked-in export)
 *   data/source/books-estimates.json   (Books status, dates, salesperson, and line items)
 *   data/source/swt-film-catalog.csv
 * Output:
 *   src/data/snapshot.json
 *
 * Every 2026 estimate in books-estimates.json that is not already in jobs.json
 * is added. Film matching and square feet come from scripts/books_jobs.py,
 * which uses scripts/build_commission_data.py. Commission dollars on the
 * source jobs are ignored. The app recalculates with src/lib/commission.ts.
 *
 * Requires python3. Does not call Zoho.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jobsPath = path.join(root, "data/source/jobs.json");
const booksPath = path.join(root, "data/source/books-estimates.json");
const catalogPath = path.join(root, "data/source/swt-film-catalog.csv");
const outPath = path.join(root, "src/data/snapshot.json");

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatAcceptedDate(iso) {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

function monthSoldFromAccepted(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!match) return "";
  const month = Number(match[2]);
  return `${month}-${MONTHS[month - 1]}`;
}

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseCatalog(csv) {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = lines[0].split(",");
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  const films = lines.slice(1).map((line) => {
    const cols = line.split(",");
    const cost = num(cols[index.cost_per_sf]);
    return {
      manufacturer: cols[index.manufacturer],
      product: cols[index.product],
      costPerSf: cost ?? 0,
      pricingGroup: Number(cols[index.pricing_group]),
      sellPerSf: Number(cols[index.sell_per_sf]),
    };
  });
  if (films.length !== 307) {
    throw new Error(`Expected 307 catalog films, found ${films.length}`);
  }
  for (const film of films) {
    if (!film.product || !Number.isFinite(film.sellPerSf) || !Number.isFinite(film.pricingGroup)) {
      throw new Error(`Bad catalog row: ${JSON.stringify(film)}`);
    }
  }
  return films;
}

function mapPricedLine(line, fallbackReason) {
  return {
    name: line.name || "",
    description: line.description || "",
    amount: num(line.amount) ?? 0,
    category: line.category || null,
    reason: line.reason || fallbackReason,
  };
}

function mapFilm(film) {
  const addons = film.addons || {};
  return {
    itemName: film.itemName || "",
    description: film.description || "",
    film: film.film || null,
    catalogProduct: film.catalogProduct || null,
    sellPerSf: num(film.sellPerSf),
    pricingGroup: film.pricingGroup == null ? null : Number(film.pricingGroup),
    sf: num(film.sf),
    lineAmount: num(film.lineAmount),
    lump: Boolean(film.lump),
    removal: Boolean(addons.removal),
    cBond: Boolean(addons.cbond),
    french: Boolean(addons.french),
  };
}

const source = JSON.parse(readFileSync(jobsPath, "utf8"));
const books = JSON.parse(readFileSync(booksPath, "utf8"));
const supplemental = JSON.parse(
  execFileSync("python3", [path.join(root, "scripts/books_jobs.py")], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);
const byEstimateId = new Map(
  (books.estimates || []).map((estimate) => [estimate.estimateId, estimate]),
);
const catalog = parseCatalog(readFileSync(catalogPath, "utf8"));
const jobs = [...(source.jobs || []), ...(supplemental.jobs || [])].map((job) => {
  const quote = byEstimateId.get(job.estimateId) || null;
  const acceptedDate = quote?.acceptedDate || job.acceptedDate || null;
  return {
    id: job.id,
    client: job.client || "",
    zoho: job.zoho || "",
    jobNumber: job.jobNumber || "",
    designer: job.designer,
    salesperson: quote?.salesperson || job.salesperson || null,
    location: job.location || "",
    dateSold: formatAcceptedDate(acceptedDate),
    acceptedDate,
    monthSold: monthSoldFromAccepted(acceptedDate),
    jobType: job.jobType || "",
    filmType: job.filmType || "",
    charged: num(job.charged),
    quoteAmount: job.quoteAmount == null ? null : num(job.quoteAmount),
    commissionableAmount:
      job.commissionableAmount == null ? num(job.charged) : num(job.commissionableAmount),
    excludedLines: Array.isArray(job.excludedLines)
      ? job.excludedLines.map((line) => mapPricedLine(line, "Not classified"))
      : [],
    discountLines: Array.isArray(job.discountLines)
      ? job.discountLines.map((line) => mapPricedLine(line, "Discount"))
      : [],
    commissionableAmountVerified: job.commissionableAmountVerified !== false,
    lineItemsAvailable: job.lineItemsAvailable !== false,
    estimateId: job.estimateId || null,
    estimateNumber: quote?.estimateNumber || job.estimateNumber || null,
    quoteStatus: quote?.status || job.quoteStatus || null,
    films: (job.films || []).map(mapFilm),
  };
});

if (!source.asOf || !source.asOfIso) {
  throw new Error("jobs.json is missing asOf / asOfIso");
}
if (jobs.length < 1) throw new Error("jobs.json has no jobs");
if (jobs.some((job) => job.charged == null)) {
  throw new Error("A job is missing charged");
}

const snapshot = {
  asOf: source.asOf,
  asOfIso: source.asOfIso,
  source: "snapshot",
  pricingVersion: "V-10.9",
  booksAsOf: books.fetchedAt,
  note: "Zoho Books is the source of truth for quote status, accepted date, and salesperson. Commission is paid only when the quote status is accepted or invoiced. Charged amounts are the commissionable portion: window film, film removal, C-Bond, and labor-only install, minus discounts. Fees, travel, lifts, and other non-film extras are excluded. Commission is calculated in the app, not stored in this file.",
  catalog,
  jobs,
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(snapshot));
console.log(
  JSON.stringify(
    {
      out: path.relative(root, outPath),
      asOf: snapshot.asOf,
      jobs: snapshot.jobs.length,
      catalog: snapshot.catalog.length,
      booksEstimates: byEstimateId.size,
      booksJobsAdded: (supplemental.jobs || []).length,
      missingLineItems: supplemental.missingLineItems || [],
      commissionableUnverified: jobs.filter((job) => job.commissionableAmountVerified === false).length,
      lineItemsMissing: jobs.filter((job) => job.lineItemsAvailable === false).length,
      withQuote: snapshot.jobs.filter((job) => job.quoteStatus).length,
    },
    null,
    2,
  ),
);
