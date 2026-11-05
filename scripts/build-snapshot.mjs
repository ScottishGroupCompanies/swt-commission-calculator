/**
 * Package the bundled calculator snapshot from the prototype job export
 * and the V-10.9 film catalog.
 *
 *   node scripts/build-snapshot.mjs
 *
 * Inputs:
 *   data/source/jobs.json              (from scripts/build_commission_data.py, or the checked-in export)
 *   data/source/swt-film-catalog.csv
 * Output:
 *   src/data/snapshot.json
 *
 * Commission dollars on the source jobs are ignored. The app recalculates
 * with src/lib/commission.ts.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jobsPath = path.join(root, "data/source/jobs.json");
const catalogPath = path.join(root, "data/source/swt-film-catalog.csv");
const outPath = path.join(root, "src/data/snapshot.json");

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
const catalog = parseCatalog(readFileSync(catalogPath, "utf8"));
const jobs = (source.jobs || []).map((job) => ({
  id: job.id,
  client: job.client || "",
  zoho: job.zoho || "",
  jobNumber: job.jobNumber || "",
  designer: job.designer,
  location: job.location || "",
  dateSold: job.dateSold || "",
  monthSold: job.monthSold || "",
  jobType: job.jobType || "",
  filmType: job.filmType || "",
  charged: num(job.charged),
  estimateNumber: job.estimateNumber || null,
  films: (job.films || []).map(mapFilm),
}));

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
  note: "Prices exclude the 4% fee. Charged amounts are master-sheet job totals (pre-fee). Commission is calculated in the app, not stored in this file.",
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
    },
    null,
    2,
  ),
);
