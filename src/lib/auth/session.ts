import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "sgc_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

type SessionPayload = {
  u: string;
  exp: number;
};

export function authSecret(): string | null {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 16) return null;
  return secret;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(username: string, now = Date.now()): string | null {
  const secret = authSecret();
  if (!secret) return null;
  const payload: SessionPayload = {
    u: username,
    exp: now + SESSION_MAX_AGE_SECONDS * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function readSession(
  token: string | undefined | null,
  now = Date.now(),
): { username: string } | null {
  const secret = authSecret();
  if (!secret || !token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(body, secret);
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }
  let parsed: SessionPayload;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed.u !== "string" || typeof parsed.exp !== "number") return null;
  if (parsed.exp <= now) return null;
  return { username: parsed.u };
}

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  if (value.startsWith("/login")) return "/";
  return value;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}
