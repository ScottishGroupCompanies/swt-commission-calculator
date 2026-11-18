import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/commission-flags/route";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { creditCardFlagKey, flagForJob } from "@/lib/credit-card-flag";
import { readCreditCardFlags, resetCreditCardFlagsForTests, writeCreditCardFlag } from "@/lib/credit-card-flags";
import type { CommissionSnapshot, SnapshotJob } from "@/lib/types";

const ORIGINAL_SECRET = process.env.AUTH_SECRET;

const snapshot = JSON.parse(
  readFileSync(path.join(process.cwd(), "src/data/snapshot.json"), "utf8"),
) as CommissionSnapshot;

function job(zoho: string): SnapshotJob {
  const found = snapshot.jobs.find((entry) => entry.zoho === zoho);
  if (!found) throw new Error(`missing ${zoho}`);
  return found;
}

function cookie(username: string): string {
  const token = createSessionToken(username);
  if (!token) throw new Error("session");
  return `${SESSION_COOKIE}=${token}`;
}

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-value-123456";
  resetCreditCardFlagsForTests();
});

afterEach(() => {
  process.env.AUTH_SECRET = ORIGINAL_SECRET;
  resetCreditCardFlagsForTests();
});

describe("credit card flag keys", () => {
  it("keys a sheet job by its job number and a Books-only job by its estimate", () => {
    const sheet = job("WT-02523");
    expect(sheet.jobNumber).toBe("F240464");
    expect(creditCardFlagKey(sheet)).toBe("F240464");

    const booksOnly = snapshot.jobs.find((entry) => entry.id === entry.estimateNumber);
    expect(booksOnly).toBeTruthy();
    expect(creditCardFlagKey(booksOnly!)).toBe(booksOnly!.estimateNumber!.toUpperCase());
  });

  it("does not let a sibling sheet row inherit the other job's flag", () => {
    const rows = snapshot.jobs.filter((entry) => entry.zoho === "WT-02852");
    expect(rows).toHaveLength(2);
    expect(creditCardFlagKey(rows[0])).not.toBe(creditCardFlagKey(rows[1]));
    const flags = {
      [creditCardFlagKey(rows[0])]: {
        paidByCreditCard: true,
        updatedBy: "admin",
        updatedAt: "2026-11-18T00:00:00.000Z",
      },
    };
    expect(flagForJob(rows[0], flags)?.paidByCreditCard).toBe(true);
    expect(flagForJob(rows[1], flags)).toBeNull();
  });

  it("still finds a flag saved under the estimate number after a job number exists", () => {
    const sheet = job("WT-02523");
    const flags = {
      [sheet.estimateNumber!.toUpperCase()]: {
        paidByCreditCard: true,
        updatedBy: "admin",
        updatedAt: "2026-11-18T00:00:00.000Z",
      },
    };
    expect(flagForJob(sheet, flags)?.paidByCreditCard).toBe(true);
  });
});

describe("credit card flag route", () => {
  it("lets an admin save a flag and lets Kelly read it without changing it", async () => {
    const target = job("WT-03643");
    const anonymous = await GET(new Request("http://localhost/api/commission-flags"));
    expect(anonymous.status).toBe(401);

    const kellySave = await POST(
      new Request("http://localhost/api/commission-flags", {
        method: "POST",
        headers: { cookie: cookie("Kelly"), "content-type": "application/json" },
        body: JSON.stringify({ jobId: target.id, paidByCreditCard: true }),
      }),
    );
    expect(kellySave.status).toBe(403);

    const saved = await POST(
      new Request("http://localhost/api/commission-flags", {
        method: "POST",
        headers: { cookie: cookie("admin"), "content-type": "application/json" },
        body: JSON.stringify({ jobId: target.id, paidByCreditCard: true }),
      }),
    );
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as {
      key: string;
      flag: { paidByCreditCard: boolean; updatedBy: string; updatedAt: string; jobNumber: string };
    };
    expect(body.key).toBe(creditCardFlagKey(target));
    expect(body.flag.paidByCreditCard).toBe(true);
    expect(body.flag.updatedBy).toBe("admin");
    expect(Number.isNaN(Date.parse(body.flag.updatedAt))).toBe(false);
    expect(body.flag.jobNumber).toBe(target.jobNumber);

    const listed = await GET(
      new Request("http://localhost/api/commission-flags", { headers: { cookie: cookie("Kelly") } }),
    );
    expect(listed.status).toBe(200);
    const flags = (await listed.json()) as { flags: Record<string, { paidByCreditCard: boolean }> };
    expect(flags.flags[body.key].paidByCreditCard).toBe(true);

    const missing = await POST(
      new Request("http://localhost/api/commission-flags", {
        method: "POST",
        headers: { cookie: cookie("admin"), "content-type": "application/json" },
        body: JSON.stringify({ jobId: "not-a-job", paidByCreditCard: true }),
      }),
    );
    expect(missing.status).toBe(404);
  });

  it("remembers who changed the flag in the private store", async () => {
    const target = job("WT-02523");
    const ok = await writeCreditCardFlag({
      key: creditCardFlagKey(target),
      paidByCreditCard: true,
      updatedBy: "admin",
      updatedAt: "2026-11-18T22:00:00.000Z",
      estimateNumber: target.estimateNumber,
      jobNumber: target.jobNumber,
      quoteNumber: target.zoho,
      jobId: target.id,
    });
    expect(ok).toBe(true);
    const flags = await readCreditCardFlags();
    expect(flags[creditCardFlagKey(target)]).toMatchObject({
      paidByCreditCard: true,
      updatedBy: "admin",
      updatedAt: "2026-11-18T22:00:00.000Z",
    });
  });
});
