import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth/users";
import {
  authSecret,
  createSessionToken,
  safeNextPath,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { clientIp, recordUsage, userAgent } from "@/lib/usage-log";

export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  const next = safeNextPath(String(form.get("next") ?? "/"));
  const name = username.trim().slice(0, 80) || "(blank)";
  let success = false;
  let response: NextResponse;

  if (!authSecret()) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "config");
    response = NextResponse.redirect(url, 303);
  } else {
    const user = authenticate(username, password);
    if (!user) {
      const url = new URL("/login", request.url);
      url.searchParams.set("error", "1");
      url.searchParams.set("next", next);
      response = NextResponse.redirect(url, 303);
    } else {
      const token = createSessionToken(user.username);
      if (!token) {
        const url = new URL("/login", request.url);
        url.searchParams.set("error", "config");
        response = NextResponse.redirect(url, 303);
      } else {
        success = true;
        response = NextResponse.redirect(new URL(next, request.url), 303);
        response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
      }
    }
  }

  await recordUsage({
    kind: "login",
    name,
    success,
    method: "POST",
    path: "/api/login",
    status: 303,
    userAgent: userAgent(request),
    ip: clientIp(request),
    secrets: password ? [password] : [],
  });
  return response;
}
