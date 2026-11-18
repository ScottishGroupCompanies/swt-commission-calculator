import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(process.cwd());

type Decision = {
  name: string;
  amount: number;
  counts: boolean;
  kind: string;
  reason: string;
};

type Summary = {
  commissionable: number;
  preFee: number;
  lineTotal: number;
  ambiguous: boolean;
  excluded: Array<{ name: string; amount: number; reason: string }>;
  decisions: Decision[];
};

function line(partial: Record<string, unknown>) {
  return {
    name: partial.name ?? "",
    description: partial.description ?? "",
    quantity: partial.quantity ?? 1,
    rate: partial.rate ?? partial.itemTotal ?? 0,
    itemTotal: partial.itemTotal ?? 0,
    unit: partial.unit ?? "",
    category: partial.category ?? null,
  };
}

function summarize(lines: Array<Record<string, unknown>>): Summary {
  const raw = execFileSync("python3", [path.join(root, "scripts/commissionable_lines.py"), "--summarize"], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify({ lines }),
  });
  return JSON.parse(raw) as Summary;
}

function decision(lines: Array<Record<string, unknown>>, name: string): Decision {
  const found = summarize(lines).decisions.find((item) => item.name === name);
  if (!found) throw new Error(`missing decision for ${name}`);
  return found;
}

describe("commissionable line classification", () => {
  it("counts window film, removal, C-Bond, and labor-only install", () => {
    const summary = summarize([
      line({ name: "Solar Film", description: "Install Prestige 50", itemTotal: 400, unit: "sf", category: "Material - Film" }),
      line({ name: "Film Removal", description: "remove existing film", itemTotal: 50, unit: "sf", category: "Service" }),
      line({ name: "C-Bond", description: "C-Bond on the storefront", itemTotal: 40, unit: "sf", category: "Material - Other" }),
      line({ name: "Install (Labor Only)", description: "Remove old and reinstall new graphics and film", itemTotal: 90, unit: "sf", category: "Service" }),
    ]);
    expect(summary.commissionable).toBe(580);
    expect(summary.ambiguous).toBe(false);
    expect(summary.excluded).toEqual([]);
    expect(summary.decisions.map((item) => item.kind)).toEqual(["film", "removal", "cbond", "labor"]);
  });

  it("keeps a film line that mentions removal and equipment in the scope", () => {
    const summary = summarize([
      line({
        name: "Security Film",
        description: "Removal and reinstallation of window film. Equipment stays on site for 6 days.",
        itemTotal: 1000,
        unit: "sf",
        category: "Material - Film",
      }),
    ]);
    expect(summary.commissionable).toBe(1000);
    expect(summary.ambiguous).toBe(false);
    expect(summary.decisions[0]).toMatchObject({ counts: true, kind: "film" });
  });

  it("excludes a travel, lift, and fee quote and flags only the unclassified line", () => {
    const summary = summarize([
      line({ name: "Frost/Privacy Film", description: "Supply and install frost", itemTotal: 300, unit: "sf", category: "Material - Film" }),
      line({ name: "Trip Charge", description: "Total Mileage - 85.8", itemTotal: 47.19, unit: "pc", category: "Service" }),
      line({ name: "Other Charge", description: "Mileage Trip Charge - $20.79", itemTotal: 20.79, category: "Service" }),
      line({ name: "Equipment", description: "Boom Lift needed to install Llumar White Out film to 16 upper windows.", itemTotal: 1500, category: "Service" }),
      line({ name: "Credit Card Fee", description: "3% credit card fee", itemTotal: 12, category: "Fee" }),
      line({ name: "Fee (No Tax)", description: "4% fee includes shipping, handling, delivery, and energy surcharge.", itemTotal: 18, category: "Fee" }),
      line({ name: "Parking", description: "Garage parking", itemTotal: 25, category: "Service" }),
      line({ name: "Attachment", description: "Clear attachment", itemTotal: 80, unit: "lf", category: "Material - Other" }),
      line({ name: "Site Visit", description: "", itemTotal: 137.5, unit: "pc", category: "Service" }),
      line({ name: "Widget", description: "Call the office", itemTotal: 15, category: "Service" }),
    ]);
    expect(summary.commissionable).toBe(300);
    expect(summary.preFee).toBe(300 + 47.19 + 20.79 + 1500 + 25 + 80 + 137.5 + 15);
    expect(summary.ambiguous).toBe(true);
    expect(summary.decisions.find((item) => item.name === "Trip Charge")).toMatchObject({ counts: false, reason: "Travel / mileage" });
    expect(summary.decisions.find((item) => item.name === "Other Charge")).toMatchObject({ counts: false, reason: "Travel / mileage" });
    expect(summary.decisions.find((item) => item.name === "Equipment")).toMatchObject({ counts: false, kind: "lift" });
    expect(summary.decisions.find((item) => item.name === "Credit Card Fee")).toMatchObject({ counts: false, kind: "fee" });
    expect(summary.decisions.find((item) => item.name === "Fee (No Tax)")).toMatchObject({ counts: false, kind: "fee" });
    expect(summary.decisions.find((item) => item.name === "Parking")).toMatchObject({ counts: false, reason: "Permit / parking" });
    expect(summary.decisions.find((item) => item.name === "Attachment")).toMatchObject({ counts: false, reason: "Non-film extra" });
    expect(summary.decisions.find((item) => item.name === "Site Visit")).toMatchObject({ counts: false, reason: "Non-film extra" });
    expect(summary.decisions.find((item) => item.name === "Widget")).toMatchObject({ counts: false, reason: "Not classified" });
    expect(decision([line({ name: "Replacement Glass", description: "Replace 1 window", itemTotal: 325, category: "Material - Other" })], "Replacement Glass").kind).toBe("extra");
  });

  it("counts a film-and-labor reimbursement and flags a mixed glass line", () => {
    const summary = summarize([
      line({ name: "Other Charge", description: "Film & Labor Reimbursement - $120.36", itemTotal: 120.36, unit: "pc", category: "Service" }),
      line({
        name: "Replacement Glass",
        description: "Film / Labor Cost - $88.54\nGlass Cost - $118.02\nMileage - $42.13",
        itemTotal: 248.69,
        category: "Material - Other",
      }),
      line({ name: "Over/Short", description: "Less 5% Military", itemTotal: -50, category: "Material - Other" }),
      line({ name: "Other Charge", description: "Purchase of Materials\nVS50 - 72\" x 42'", itemTotal: 630, category: "Service" }),
    ]);
    expect(summary.decisions.map((item) => [item.kind, item.counts])).toEqual([
      ["film", true],
      ["ambiguous", false],
      ["ambiguous", false],
      ["ambiguous", false],
    ]);
    expect(summary.commissionable).toBe(120.36);
    expect(summary.ambiguous).toBe(true);
  });

  it("counts known film item names even when the category is blank", () => {
    const summary = summarize([
      line({ name: "Graffiti", description: "Main St", itemTotal: 10, unit: "sf" }),
      line({ name: "Custom/Graphics", description: "Install store hour graphic", itemTotal: 20, unit: "sf" }),
      line({ name: "Bird Film", description: "Lobby glass", itemTotal: 30, unit: "sf" }),
      line({ name: "C Bond", description: "Edge seal", itemTotal: 5 }),
    ]);
    expect(summary.commissionable).toBe(65);
    expect(summary.decisions.map((item) => item.kind)).toEqual(["film", "film", "film", "cbond"]);
  });
});
