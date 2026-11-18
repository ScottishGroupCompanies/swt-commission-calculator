import { NextResponse } from "next/server";
import { bearerToken, identifyBotKey, loadBotApiKeys } from "@/lib/bot-auth";
import {
  assertIdentifierLength,
  filterSnapshotJobs,
  findSnapshotJobs,
  isRealDate,
  toCommissionRecord,
  type CommissionRecord,
  type JobSelector,
} from "@/lib/commission-lookup";
import { findRep } from "@/lib/commission";
import { getCommissionDataSource } from "@/lib/data";
import { booksFreshnessIso } from "@/lib/freshness";
import { allowRequest, rateLimits } from "@/lib/rate-limit";
import { clientIp, recordUsage, safeQueryString, userAgent } from "@/lib/usage-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIST_LIMIT = 100;

function json(body: unknown, status: number, extraHeaders?: Record<string, string>) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
      ...extraHeaders,
    },
  });
}

function firstString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function selectorFrom(source: Record<string, unknown>): JobSelector & { rep?: string; since?: string } {
  return {
    estimate:
      firstString(source.estimate) || firstString(source.quote) || firstString(source.number),
    job: firstString(source.job) || firstString(source.jobNumber),
    jobId: firstString(source.jobId) || firstString(source.id),
    rep: firstString(source.rep),
    since: firstString(source.since),
  };
}

async function readBody(request: Request, raw: string | null): Promise<
  { fields: Record<string, unknown> } | { error: string }
> {
  if (raw == null) {
    const url = new URL(request.url);
    return { fields: Object.fromEntries(url.searchParams.entries()) };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    const url = new URL(request.url);
    return { fields: Object.fromEntries(url.searchParams.entries()) };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "Request body must be a JSON object." };
    }
    const url = new URL(request.url);
    return { fields: { ...Object.fromEntries(url.searchParams.entries()), ...parsed } };
  } catch {
    return { error: "Request body must be JSON." };
  }
}

export async function GET(request: Request) {
  return handle(request, null);
}

export async function POST(request: Request) {
  const raw = await request.text();
  return handle(request, raw);
}

async function handle(request: Request, rawBody: string | null) {
  const url = new URL(request.url);
  const loaded = loadBotApiKeys();
  if (loaded.error) {
    console.error(JSON.stringify({ source: "swt-commission-usage", error: "BOT_API_KEYS is invalid" }));
  }
  const presented = bearerToken(request.headers.get("authorization"));
  const secrets = [...loaded.keys.map((key) => key.secret), ...(presented ? [presented] : [])];
  const keyName = identifyBotKey(request.headers.get("authorization"), loaded.keys) ?? "invalid";
  const ip = clientIp(request);
  const agent = userAgent(request);
  let status = 500;
  let query = safeQueryString(url.search, secrets);

  try {
    if (keyName === "invalid") {
      const allowed = allowRequest(`invalid:${ip || "unknown"}`, rateLimits.invalidPerMinute);
      status = allowed ? 401 : 429;
      return json(
        { error: allowed ? "Unauthorized" : "Too many requests." },
        status,
        allowed ? undefined : { "retry-after": "60" },
      );
    }

    if (!allowRequest(`key:${keyName}`, rateLimits.validPerMinute)) {
      status = 429;
      return json({ error: "Too many requests." }, 429, { "retry-after": "60" });
    }

    const body = await readBody(request, rawBody);
    if ("error" in body) {
      status = 400;
      return json({ error: body.error }, 400);
    }
    const input = selectorFrom(body.fields);
    query = safeQueryString(
      new URLSearchParams(
        [
          ["estimate", input.estimate],
          ["job", input.job],
          ["jobId", input.jobId],
          ["rep", input.rep],
          ["since", input.since],
        ]
          .filter((entry): entry is [string, string] => Boolean(entry[1]))
          .map(([name, value]) => [name, value]),
      ).toString(),
      secrets,
    );

    for (const value of [input.estimate, input.job, input.jobId, input.rep]) {
      const tooLong = assertIdentifierLength(value);
      if (tooLong) {
        status = 400;
        return json({ error: tooLong }, 400);
      }
    }

    const lookup = Boolean(input.estimate || input.job || input.jobId);
    const listing = Boolean(input.rep || input.since);
    if (!lookup && !listing) {
      status = 400;
      return json(
        {
          error:
            "Provide an estimate number (estimate or quote), a job identifier (job or jobId), or a list filter (rep and/or since).",
        },
        400,
      );
    }
    if (input.since && !isRealDate(input.since)) {
      status = 400;
      return json({ error: "since must be a calendar date in YYYY-MM-DD form." }, 400);
    }

    let repId: string | null = null;
    if (input.rep) {
      const rep = findRep(input.rep);
      if (!rep) {
        status = 400;
        return json(
          { error: "Unknown rep. Commission reps are Dana, Amy, Blake, Scott, and John." },
          400,
        );
      }
      repId = rep.id;
    }

    const snapshot = await getCommissionDataSource().loadSnapshot();
    if (lookup && !listing) {
      const matches = findSnapshotJobs(snapshot.jobs, input);
      if (matches.length === 0) {
        status = 404;
        return json({ error: "No job in the commission snapshot matches that estimate or job." }, 404);
      }
      const results = matches.map((job) => toCommissionRecord(job, snapshot));
      status = 200;
      if (results.length === 1) return json(results[0], 200);
      return json(
        {
          fetchedAt: booksFreshnessIso(snapshot),
          dataAsOf: snapshot.asOf,
          count: results.length,
          results,
        },
        200,
      );
    }

    if (lookup && listing) {
      const matches = findSnapshotJobs(snapshot.jobs, input).filter((job) => {
        if (repId && findRep(job.salesperson)?.id !== repId) return false;
        if (input.since && (!job.acceptedDate || job.acceptedDate < input.since)) return false;
        return true;
      });
      if (matches.length === 0) {
        status = 404;
        return json({ error: "No job in the commission snapshot matches that estimate or job." }, 404);
      }
      const results = matches.map((job) => toCommissionRecord(job, snapshot));
      status = 200;
      if (results.length === 1) return json(results[0], 200);
      return json(
        {
          fetchedAt: booksFreshnessIso(snapshot),
          dataAsOf: snapshot.asOf,
          count: results.length,
          results,
        },
        200,
      );
    }

    const matched = filterSnapshotJobs(snapshot.jobs, { repId, since: input.since ?? null });
    const results: CommissionRecord[] = matched.slice(0, LIST_LIMIT).map((job) => toCommissionRecord(job, snapshot));
    status = 200;
    return json(
      {
        fetchedAt: booksFreshnessIso(snapshot),
        dataAsOf: snapshot.asOf,
        matched: matched.length,
        count: results.length,
        truncated: matched.length > results.length,
        results,
      },
      200,
    );
  } catch {
    status = 500;
    return json({ error: "Commission lookup failed." }, 500);
  } finally {
    try {
      await recordUsage({
        kind: "api",
        keyName,
        method: request.method,
        path: url.pathname,
        query,
        status,
        userAgent: agent,
        ip,
        secrets,
      });
    } catch {
      console.error(JSON.stringify({ source: "swt-commission-usage", error: "log-failed" }));
    }
  }
}
