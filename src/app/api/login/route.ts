import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth/users";
import {
  authSecret,
  createSessionToken,
  safeNextPath,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/session";

export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get("username") ?? "");
  const password = String(form.get("password") ?? "");
  const next = safeNextPath(String(form.get("next") ?? "/"));

  if (!authSecret()) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "config");
    return NextResponse.redirect(url, 303);
  }

  const user = authenticate(username, password);
  if (!user) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "1");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  }

  const token = createSessionToken(user.username);
  if (!token) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "config");
    return NextResponse.redirect(url, 303);
  }

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}
