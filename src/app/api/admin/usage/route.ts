import { NextResponse } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";
import { readRecentUsage } from "@/lib/usage-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (!username) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  if (username.toLowerCase() !== "admin") {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  const events = await readRecentUsage(100);
  return NextResponse.json(
    { events },
    { headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } },
  );
}
