import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth/access";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";
import { creditCardFlagKey } from "@/lib/credit-card-flag";
import { readCreditCardFlags, writeCreditCardFlag } from "@/lib/credit-card-flags";
import { getCommissionDataSource } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}

function sessionUsername(request: Request): string | null {
  const header = request.headers.get("cookie") || "";
  const parts = header.split(";").map((part) => part.trim());
  const pair = parts.find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!pair) return null;
  const token = decodeURIComponent(pair.slice(SESSION_COOKIE.length + 1));
  return readSession(token)?.username ?? null;
}

export async function GET(request: Request) {
  const username = sessionUsername(request);
  if (!username) return json({ error: "Sign in required." }, 401);
  const flags = await readCreditCardFlags();
  return json({ flags }, 200);
}

export async function POST(request: Request) {
  const username = sessionUsername(request);
  if (!username) return json({ error: "Sign in required." }, 401);
  if (!isAdmin(username)) return json({ error: "Admin only." }, 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be JSON." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Request body must be a JSON object." }, 400);
  }
  const record = body as { jobId?: unknown; paidByCreditCard?: unknown };
  const jobId = record.jobId;
  const paidByCreditCard = record.paidByCreditCard;
  if (typeof jobId !== "string" || !jobId.trim()) {
    return json({ error: "jobId is required." }, 400);
  }
  if (typeof paidByCreditCard !== "boolean") {
    return json({ error: "paidByCreditCard must be true or false." }, 400);
  }

  const snapshot = await getCommissionDataSource().loadSnapshot();
  const job = snapshot.jobs.find((entry) => entry.id === jobId.trim());
  if (!job) return json({ error: "No job in the commission snapshot matches that id." }, 404);

  const key = creditCardFlagKey(job);
  if (!key) return json({ error: "This job has no estimate or job number to store." }, 400);

  const flag = {
    key,
    paidByCreditCard,
    updatedBy: username,
    updatedAt: new Date().toISOString(),
    estimateNumber: job.estimateNumber,
    jobNumber: job.jobNumber,
    quoteNumber: job.zoho,
    jobId: job.id,
  };
  const saved = await writeCreditCardFlag(flag);
  if (!saved) {
    return json({ error: "The credit card flag could not be saved." }, 503);
  }
  return json({ key, flag }, 200);
}
