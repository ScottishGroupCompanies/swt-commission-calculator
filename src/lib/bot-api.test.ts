import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as usageGet } from "@/app/api/admin/usage/route";
import { POST as loginPost } from "@/app/api/login/route";
import { GET, POST } from "@/app/api/v1/commission/route";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { identifyBotKey, parseBotApiKeys, secretsMatch } from "@/lib/bot-auth";
import { findRep } from "@/lib/commission";
import {
  filterSnapshotJobs,
  findSnapshotJobs,
  toCommissionRecord,
  type CommissionRecord,
} from "@/lib/commission-lookup";
import { allowRequest, rateLimits, resetRateLimits } from "@/lib/rate-limit";
import { priceSnapshotJob } from "@/lib/snapshot-price";
import { resetCreditCardFlagsForTests, writeCreditCardFlag } from "@/lib/credit-card-flags";
import { creditCardFlagKey } from "@/lib/credit-card-flag";
import { creditCardProcessingFee } from "@/lib/commission";
import type { CommissionSnapshot, SnapshotJob } from "@/lib/types";
import { memoryUsage, resetUsageForTests, safeQueryString } from "@/lib/usage-log";
import { proxy } from "@/proxy";
import { NextRequest } from "next/server";

const SARAH_KEY = "sarah-bot-test-key-0123456789abcdef";
const OTHER_KEY = "other-bot-test-key-fedcba9876543210";
const BAD_KEY = "not-a-configured-bot-key-zzzzzzzz";
const LOGIN_CODE = "login-code-must-never-be-logged";

const ORIGINAL_KEYS = process.env.BOT_API_KEYS;
const ORIGINAL_SECRET = process.env.AUTH_SECRET;

const snapshot = JSON.parse(
  readFileSync(path.join(process.cwd(), "src/data/snapshot.json"), "utf8"),
) as CommissionSnapshot;

function job(zoho: string): SnapshotJob {
  const found = snapshot.jobs.find((entry) => entry.zoho === zoho);
  if (!found) throw new Error(`missing ${zoho}`);
  return found;
}

function authHeaders(key: string, extra?: Record<string, string>): Headers {
  const headers = new Headers(extra);
  headers.set("authorization", `Bearer ${key}`);
  return headers;
}

async function capture<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const result = await run();
    return { result, lines };
  } finally {
    console.log = log;
    console.error = error;
  }
}

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-value-123456";
  process.env.BOT_API_KEYS = JSON.stringify({
    "sarah-bot": SARAH_KEY,
    "billy-bot": OTHER_KEY,
  });
  resetRateLimits();
  resetUsageForTests();
  resetCreditCardFlagsForTests();
  rateLimits.validPerMinute = 60;
  rateLimits.invalidPerMinute = 30;
});

afterEach(() => {
  process.env.BOT_API_KEYS = ORIGINAL_KEYS;
  process.env.AUTH_SECRET = ORIGINAL_SECRET;
  resetRateLimits();
  resetUsageForTests();
  resetCreditCardFlagsForTests();
  vi.restoreAllMocks();
});

describe("bot API keys", () => {
  it("parses a JSON map and name:key pairs", () => {
    expect(parseBotApiKeys(JSON.stringify({ "sarah-bot": SARAH_KEY }))).toEqual([
      { name: "sarah-bot", secret: SARAH_KEY },
    ]);
    expect(parseBotApiKeys(`sarah-bot:${SARAH_KEY},billy-bot:${OTHER_KEY}`).map((key) => key.name)).toEqual([
      "sarah-bot",
      "billy-bot",
    ]);
  });

  it("compares secrets without accepting a different key", () => {
    expect(secretsMatch(SARAH_KEY, SARAH_KEY)).toBe(true);
    expect(secretsMatch(SARAH_KEY, OTHER_KEY)).toBe(false);
    const keys = parseBotApiKeys(process.env.BOT_API_KEYS);
    expect(identifyBotKey(`Bearer ${SARAH_KEY}`, keys)).toBe("sarah-bot");
    expect(identifyBotKey(`Bearer ${OTHER_KEY}`, keys)).toBe("billy-bot");
    expect(identifyBotKey(`Bearer ${BAD_KEY}`, keys)).toBeNull();
    expect(identifyBotKey(null, keys)).toBeNull();
    expect(identifyBotKey("Basic abc", keys)).toBeNull();
  });

  it("returns 401 for a missing or wrong key and does not require the browser session", async () => {
    const missing = await GET(new Request("http://localhost/api/v1/commission?estimate=WT-03533"));
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({ error: "Unauthorized" });

    const wrong = await GET(
      new Request("http://localhost/api/v1/commission?estimate=WT-03533", {
        headers: authHeaders(BAD_KEY),
      }),
    );
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "Unauthorized" });

    const open = proxy(new NextRequest("http://localhost/api/v1/commission?estimate=WT-03533"));
    expect(open.headers.get("location")).toBeNull();

    const page = proxy(new NextRequest("http://localhost/"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login");
  });
});

describe("commission lookup", () => {
  async function lookup(path: string, key = SARAH_KEY): Promise<{ status: number; body: CommissionRecord }> {
    const response = await GET(new Request(`http://localhost${path}`, { headers: authHeaders(key) }));
    return { status: response.status, body: (await response.json()) as CommissionRecord };
  }

  it("matches the calculator for snapshot jobs across policy branches", async () => {
    const cases = [
      job("WT-03533"),
      job("WT-03130"),
      job("WT-03539"),
      job("WT-02536"),
    ];
    const priced = snapshot.jobs.map((entry) => ({ entry, price: priceSnapshotJob(entry) }));
    const undersold = priced.find(
      (item) => item.price.status === "undersold" && findRep(item.entry.salesperson),
    );
    const oversold = priced.find(
      (item) => item.price.status === "oversold" && findRep(item.entry.salesperson),
    );
    expect(undersold).toBeTruthy();
    expect(oversold).toBeTruthy();
    cases.push(undersold!.entry, oversold!.entry);

    for (const entry of cases) {
      const { status, body } = await lookup(`/api/v1/commission?jobId=${encodeURIComponent(entry.id)}`);
      expect(status).toBe(200);
      const expected = toCommissionRecord(entry, snapshot);
      expect(body).toEqual(expected);
      expect(body.commission).toBe(priceSnapshotJob(entry).commission);
      expect(body.listAmount).toBe(priceSnapshotJob(entry).listPrice);
      expect(body.preFeeCharged).toBe(priceSnapshotJob(entry).charged);
    }

    const helibrun = await lookup("/api/v1/commission?estimate=WT-03533-QT01");
    expect(helibrun.body).toMatchObject({
      estimateNumber: "WT-03533-QT01",
      customer: "Robert Helibrun",
      rep: "Dana Hojnacki",
      repName: "Dana Hojnacki",
      repInitials: "DH",
      status: "invoiced",
      commissionable: false,
      preFeeCharged: 3282,
      listAmount: 4555.24,
      rate: 0.07,
      undersoldPercent: 27.95,
      commission: 0,
      policy: "undersold >=10% needs manager approval",
      fetchedAt: snapshot.booksAsOf,
    });
    const shortQuote = await lookup("/api/v1/commission?quote=WT-03533");
    expect(shortQuote.body.jobId).toBe(helibrun.body.jobId);

    const sent = await lookup("/api/v1/commission?estimate=WT-03130-QT01");
    expect(sent.body.policy).toBe("not accepted");
    expect(sent.body.commissionable).toBe(false);
    expect(sent.body.commission).toBe(0);
    expect(sent.body.status).toBe("sent");

    const unverified = await lookup("/api/v1/commission?estimate=WT-03539");
    expect(unverified.body.policy).toBe("list not verified");
    expect(unverified.body.commission).toBe(114.6);

    const withExtras = await lookup("/api/v1/commission?estimate=WT-02431-QT01");
    expect(withExtras.body.quoteAmount).toBe(18375.58);
    expect(withExtras.body.commissionableAmount).toBe(10395.5);
    expect(withExtras.body.preFeeCharged).toBe(10395.5);
    expect(withExtras.body.commission).toBe(0);
    expect(withExtras.body.commissionableAmountVerified).toBe(true);
    expect(withExtras.body.lineItemsAvailable).toBe(true);
    expect(withExtras.body.excludedLines.map((line) => [line.name, line.amount, line.reason])).toEqual([
      ["Attachment", 7273.33, "Non-film extra"],
      ["Fee (No Tax)", 706.75, "Fee"],
    ]);
    expect(withExtras.body.discountLines).toEqual([]);

    const military = await lookup("/api/v1/commission?estimate=WT-03643-QT01");
    expect(military.body).toMatchObject({
      estimateNumber: "WT-03643-QT01",
      customer: "Lynn Ottinger",
      rep: "Blake Parish",
      repName: "Blake Parish",
      rate: 0.15,
      status: "accepted",
      commissionable: true,
      preFeeCharged: 11495.05,
      commissionableAmount: 11495.05,
      commission: 1724.26,
      policy: "list not verified",
      commissionableAmountVerified: true,
    });
    expect(military.body.discountLines).toEqual([
      expect.objectContaining({
        name: "Over/Short",
        description: "Less 5% Military",
        amount: -605,
        reason: "Discount",
      }),
    ]);
    expect(military.body.excludedLines.map((line) => [line.name, line.amount, line.reason])).toEqual([
      ["Fee", 459.8, "Fee"],
    ]);

    const outsider = await lookup("/api/v1/commission?estimate=WT-02536-QT01");
    expect(outsider.body.policy).toBe("not an earner");
    expect(outsider.body.rate).toBeNull();
    expect(outsider.body.commission).toBe(0);
    expect(outsider.body.commissionable).toBe(false);

    expect(undersold && (await lookup(`/api/v1/commission?jobId=${encodeURIComponent(undersold.entry.id)}`)).body.policy).toBe(
      "undersold <10%",
    );
    expect(oversold && (await lookup(`/api/v1/commission?jobId=${encodeURIComponent(oversold.entry.id)}`)).body.policy).toBe(
      "at/over list",
    );
  });

  it("accepts the same lookup as JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/commission", {
        method: "POST",
        headers: authHeaders(SARAH_KEY, { "content-type": "application/json" }),
        body: JSON.stringify({ estimate: "WT-03533-QT01" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as CommissionRecord;
    expect(body).toEqual(toCommissionRecord(job("WT-03533"), snapshot));
  });

  it("returns 404 for an unknown number and 400 for bad input", async () => {
    const missing = await GET(
      new Request("http://localhost/api/v1/commission?estimate=WT-99999-QT99", {
        headers: authHeaders(SARAH_KEY),
      }),
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "No job in the commission snapshot matches that estimate or job.",
    });

    const empty = await GET(new Request("http://localhost/api/v1/commission", { headers: authHeaders(SARAH_KEY) }));
    expect(empty.status).toBe(400);

    const badDate = await GET(
      new Request("http://localhost/api/v1/commission?rep=Amy&since=2026-13-40", {
        headers: authHeaders(SARAH_KEY),
      }),
    );
    expect(badDate.status).toBe(400);

    const badRep = await GET(
      new Request("http://localhost/api/v1/commission?rep=NotARep", { headers: authHeaders(SARAH_KEY) }),
    );
    expect(badRep.status).toBe(400);

    const badJson = await POST(
      new Request("http://localhost/api/v1/commission", {
        method: "POST",
        headers: authHeaders(SARAH_KEY, { "content-type": "application/json" }),
        body: "{",
      }),
    );
    expect(badJson.status).toBe(400);
  });

  it("lists a rep since a date and returns every match when a quote is shared", async () => {
    const response = await GET(
      new Request("http://localhost/api/v1/commission?rep=Amy&since=2026-11-01", {
        headers: authHeaders(OTHER_KEY),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      matched: number;
      count: number;
      truncated: boolean;
      results: CommissionRecord[];
    };
    const expected = filterSnapshotJobs(snapshot.jobs, { repId: "amy", since: "2026-11-01" });
    expect(body.matched).toBe(expected.length);
    expect(body.count).toBe(expected.length);
    expect(body.truncated).toBe(false);
    expect(body.results.map((row) => row.jobId)).toEqual(expected.map((entry) => entry.id));
    for (const row of body.results) {
      const entry = snapshot.jobs.find((item) => item.id === row.jobId);
      expect(entry).toBeTruthy();
      expect(row).toEqual(toCommissionRecord(entry!, snapshot));
      expect(findRep(row.rep)?.id).toBe("amy");
      expect(row.acceptedDate && row.acceptedDate >= "2026-11-01").toBe(true);
    }

    const shared = await GET(
      new Request("http://localhost/api/v1/commission?estimate=WT-02852", { headers: authHeaders(SARAH_KEY) }),
    );
    expect(shared.status).toBe(200);
    const many = (await shared.json()) as { count: number; results: CommissionRecord[] };
    expect(many.count).toBe(findSnapshotJobs(snapshot.jobs, { estimate: "WT-02852" }).length);
    expect(many.count).toBeGreaterThan(1);
    expect(many.results.map((row) => row.commission)).toEqual(
      findSnapshotJobs(snapshot.jobs, { estimate: "WT-02852" }).map((entry) => priceSnapshotJob(entry).commission),
    );
  });

  it("returns the credit card fee and adjusted commission without changing an unflagged job", async () => {
    const plain = await lookup("/api/v1/commission?estimate=WT-03643-QT01");
    expect(plain.status).toBe(200);
    expect(plain.body.paidByCreditCard).toBe(false);
    expect(plain.body.creditCardFee).toBe(0);
    expect(plain.body.adjustedCommission).toBe(plain.body.commission);
    expect(plain.body.commissionBeforeCreditCard).toBe(plain.body.commission);
    expect(plain.body.commissionableAmount).toBe(11495.05);
    expect(plain.body.commission).toBe(1724.26);

    const entry = snapshot.jobs.find((item) => item.estimateNumber === "WT-03643-QT01");
    expect(entry).toBeTruthy();
    await writeCreditCardFlag({
      key: creditCardFlagKey(entry!),
      paidByCreditCard: true,
      updatedBy: "admin",
      updatedAt: "2026-11-18T22:05:00.000Z",
      estimateNumber: entry!.estimateNumber,
      jobNumber: entry!.jobNumber,
      quoteNumber: entry!.zoho,
      jobId: entry!.id,
    });

    const flagged = await lookup("/api/v1/commission?estimate=WT-03643-QT01");
    const fee = creditCardProcessingFee(11495.05);
    expect(flagged.body.paidByCreditCard).toBe(true);
    expect(flagged.body.creditCardFee).toBe(fee);
    expect(flagged.body.creditCardFee).toBe(333.36);
    expect(flagged.body.commissionBeforeCreditCard).toBe(1724.26);
    expect(flagged.body.adjustedCommission).toBe(1674.25);
    expect(flagged.body.commission).toBe(flagged.body.adjustedCommission);
    expect(flagged.body.policy).toBe("list not verified");
    expect(flagged.body.discountLines.some((line) => line.amount === -605)).toBe(true);

    const posted = await POST(
      new Request("http://localhost/api/v1/commission", {
        method: "POST",
        headers: authHeaders(SARAH_KEY, { "content-type": "application/json" }),
        body: JSON.stringify({ estimate: "WT-03643-QT01", paidByCreditCard: false }),
      }),
    );
    expect(posted.status).toBe(200);
    const postedBody = (await posted.json()) as CommissionRecord;
    expect(postedBody.paidByCreditCard).toBe(true);
    expect(postedBody.adjustedCommission).toBe(1674.25);
  });
});

describe("usage logging", () => {
  it("never writes the API key, and names the caller", async () => {
    const { result, lines } = await capture(() =>
      GET(
        new Request(
          `http://localhost/api/v1/commission?estimate=WT-03533-QT01&token=${SARAH_KEY}&code=${LOGIN_CODE}`,
          {
            headers: authHeaders(SARAH_KEY, {
              "user-agent": `sarah-agent ${SARAH_KEY}`,
              "x-forwarded-for": "203.0.113.10, 10.0.0.1",
            }),
          },
        ),
      ),
    );
    expect(result.status).toBe(200);
    const blob = lines.join("\n");
    expect(blob).not.toContain(SARAH_KEY);
    expect(blob).not.toContain(OTHER_KEY);
    expect(blob).not.toContain(LOGIN_CODE);
    expect(blob).toContain("swt-commission-usage");
    expect(blob).toContain("sarah-bot");
    expect(blob).toContain("203.0.113.10");
    expect(memoryUsage().some((event) => JSON.stringify(event).includes(SARAH_KEY))).toBe(false);
    expect(memoryUsage().some((event) => JSON.stringify(event).includes(LOGIN_CODE))).toBe(false);

    const token = createSessionToken("admin");
    const usage = await usageGet(
      new Request("http://localhost/api/admin/usage", {
        headers: { cookie: `${SESSION_COOKIE}=${token}` },
      }),
    );
    expect(usage.status).toBe(200);
    const payload = JSON.stringify(await usage.json());
    expect(payload).not.toContain(SARAH_KEY);
    expect(payload).not.toContain(LOGIN_CODE);
    expect(payload).toContain("sarah-bot");
    expect(payload).toContain("WT-03533-QT01");
  });

  it("logs an invalid key name without the presented token", async () => {
    const { lines } = await capture(() =>
      GET(
        new Request(`http://localhost/api/v1/commission?estimate=WT-03533&token=${BAD_KEY}`, {
          headers: authHeaders(BAD_KEY, { "user-agent": BAD_KEY }),
        }),
      ),
    );
    const blob = lines.join("\n");
    expect(blob).toContain('"keyName":"invalid"');
    expect(blob).not.toContain(BAD_KEY);
  });

  it("logs login attempts without the code", async () => {
    const failed = await capture(() => {
      const form = new FormData();
      form.set("username", "Kelly");
      form.set("password", LOGIN_CODE);
      return loginPost(
        new Request("http://localhost/api/login", {
          method: "POST",
          body: form,
          headers: { "user-agent": `browser ${LOGIN_CODE}` },
        }),
      );
    });
    expect(failed.result.status).toBe(303);
    const failedLog = failed.lines.join("\n");
    expect(failedLog).toContain('"kind":"login"');
    expect(failedLog).toContain('"name":"Kelly"');
    expect(failedLog).toContain('"success":false');
    expect(failedLog).not.toContain(LOGIN_CODE);
    expect(failedLog).toContain("[redacted]");

    const ok = await capture(() => {
      const form = new FormData();
      form.set("username", "Kelly");
      form.set("password", "1234");
      return loginPost(
        new Request("http://localhost/api/login", {
          method: "POST",
          body: form,
          headers: { "user-agent": "browser" },
        }),
      );
    });
    expect(ok.result.status).toBe(303);
    const okLog = ok.lines.join("\n");
    expect(okLog).toContain('"success":true');
    expect(okLog).not.toContain("1234");
    expect(memoryUsage().some((event) => JSON.stringify(event).includes("1234"))).toBe(false);
  });

  it("redacts secret query parameters and rate limits a bad key", () => {
    expect(safeQueryString(`token=${SARAH_KEY}&estimate=WT-03533`, [SARAH_KEY])).not.toContain(SARAH_KEY);
    expect(safeQueryString("code=1234&estimate=WT-03533", [])).toContain("code=%5Bredacted%5D");
    resetRateLimits();
    rateLimits.invalidPerMinute = 1;
    expect(allowRequest("invalid:test", rateLimits.invalidPerMinute)).toBe(true);
    expect(allowRequest("invalid:test", rateLimits.invalidPerMinute)).toBe(false);
  });

  it("rejects a non-admin session on the usage route", async () => {
    const anonymous = await usageGet(new Request("http://localhost/api/admin/usage"));
    expect(anonymous.status).toBe(401);
    const kelly = createSessionToken("Kelly");
    const forbidden = await usageGet(
      new Request("http://localhost/api/admin/usage", {
        headers: { cookie: `${SESSION_COOKIE}=${kelly}` },
      }),
    );
    expect(forbidden.status).toBe(403);
  });
});
