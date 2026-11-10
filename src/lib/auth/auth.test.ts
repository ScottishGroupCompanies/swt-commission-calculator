import { afterEach, describe, expect, it } from "vitest";
import { createSessionToken, readSession } from "./session";
import { authenticate, LOGIN_OPTIONS, verifyPassword } from "./users";

const ORIGINAL = process.env.AUTH_SECRET;

afterEach(() => {
  process.env.AUTH_SECRET = ORIGINAL;
});

describe("passwords", () => {
  it("lists Kelly, Sarah, and Admin in that order", () => {
    expect(LOGIN_OPTIONS.map((option) => option.label)).toEqual(["Kelly", "Sarah", "Admin"]);
    expect(LOGIN_OPTIONS.map((option) => option.value)).toEqual(["Kelly", "Sarah", "admin"]);
  });

  it("accepts Kelly and admin with 1234, and Sarah with 7807", () => {
    expect(authenticate("Kelly", "1234")?.username).toBe("Kelly");
    expect(authenticate("sarah", "7807")?.username).toBe("Sarah");
    expect(authenticate("ADMIN", "1234")?.username).toBe("admin");
    expect(authenticate("Sarah", "1234")).toBeNull();
  });

  it("rejects a wrong password and an unknown user", () => {
    expect(authenticate("Kelly", "12345")).toBeNull();
    expect(authenticate("Jenny", "1234")).toBeNull();
    expect(verifyPassword("1234", "not-a-hash")).toBe(false);
  });
});

describe("signed session cookie", () => {
  it("round-trips a username and rejects tampering and expiry", () => {
    process.env.AUTH_SECRET = "test-secret-value-123456";
    const token = createSessionToken("Kelly", 1_000);
    expect(token).toBeTruthy();
    expect(readSession(token, 1_000)?.username).toBe("Kelly");

    const [body, signature] = token!.split(".");
    expect(readSession(`${body}.${signature.slice(0, -1)}x`, 1_000)).toBeNull();
    expect(readSession(token, Date.now() + 1000 * 60 * 60 * 24)).toBeNull();
  });

  it("does not issue a token when AUTH_SECRET is missing", () => {
    delete process.env.AUTH_SECRET;
    expect(createSessionToken("Kelly")).toBeNull();
    expect(readSession("anything")).toBeNull();
  });
});
