import { scryptSync, timingSafeEqual } from "node:crypto";

export type AuthUser = {
  username: string;
  passwordHash: string;
};

/**
 * Login accounts. Hashes are scrypt, not plaintext.
 * Kelly and admin use code 1234. Sarah uses code 7807.
 *
 * Change one user:
 *   node scripts/hash-password.mjs "their-new-password"
 * Then replace that user's passwordHash in this file.
 *
 * Replace the whole list without a code change by setting AUTH_USERS to a JSON
 * array of { "username", "passwordHash" }. Usernames are matched without case.
 *
 * Admin has no separate screens. It stays last so that login is not removed.
 */
export const LOGIN_OPTIONS = [
  { value: "Kelly", label: "Kelly" },
  { value: "Sarah", label: "Sarah" },
  { value: "admin", label: "Admin" },
] as const;

export const DEFAULT_USERS: readonly AuthUser[] = [
  {
    username: "Kelly",
    passwordHash:
      "scrypt$16384$8$1$5pYHn76mBVqYP8UHjH-9nQ$w56W0d1CllxVLrtU2VToHWO0A5kaUtCOhrOZrnJ-wvU",
  },
  {
    username: "Sarah",
    passwordHash:
      "scrypt$16384$8$1$whljgLiqosRELBMAjZqyTA$0zVcKkZSFspI5SXKBuT0lPfQU3tkEv82wso8eI-_Xjw",
  },
  {
    username: "admin",
    passwordHash:
      "scrypt$16384$8$1$2SQ9z-BG0pghJyRlb4ThrA$zBKJnHNwCxz58--iFCzjhwzG9MoPJUZdJ_jQNS9gBvU",
  },
];

/** Used when the username is unknown so the check still spends a scrypt. */
const DUMMY_HASH =
  "scrypt$16384$8$1$JHhNhoFc9tuTh0eE8HWmIg$f6P8wdTriFQms9wyhWhVl6sdwPdbV3bR9X8uBAvpHo4";

export function loadUsers(): AuthUser[] {
  const raw = process.env.AUTH_USERS?.trim();
  if (!raw) return [...DEFAULT_USERS];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AUTH_USERS must be a JSON array of { username, passwordHash }.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("AUTH_USERS must be a non-empty JSON array.");
  }
  return parsed.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as AuthUser).username !== "string" ||
      typeof (entry as AuthUser).passwordHash !== "string"
    ) {
      throw new Error("Each AUTH_USERS entry needs username and passwordHash.");
    }
    return {
      username: (entry as AuthUser).username.trim(),
      passwordHash: (entry as AuthUser).passwordHash.trim(),
    };
  });
}

export function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length, { N: n, r, p });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function authenticate(username: string, password: string): AuthUser | null {
  const key = username.trim().toLowerCase();
  const user = loadUsers().find((entry) => entry.username.toLowerCase() === key);
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const ok = verifyPassword(password, hash);
  if (!user || !ok) return null;
  return user;
}
