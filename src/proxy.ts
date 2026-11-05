import { NextResponse, type NextRequest } from "next/server";
import { readSession, safeNextPath, SESSION_COOKIE } from "@/lib/auth/session";

function isPublic(pathname: string): boolean {
  return pathname === "/login" || pathname === "/api/login";
}

/**
 * Next.js 16 request gate (the file previously called middleware).
 * Every page and API route needs a valid signed session cookie.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = readSession(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    if (session) {
      const next = safeNextPath(request.nextUrl.searchParams.get("next"));
      return NextResponse.redirect(new URL(next, request.url));
    }
    return NextResponse.next();
  }

  if (isPublic(pathname)) return NextResponse.next();

  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|ico)$).*)"],
};
