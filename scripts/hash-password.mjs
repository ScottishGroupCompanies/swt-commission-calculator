/**
 * Print a scrypt password hash for src/lib/auth/users.ts or AUTH_USERS.
 *
 *   node scripts/hash-password.mjs "a-new-password"
 *
 * Paste the printed line into that user's passwordHash. Each run uses a new salt.
 */
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/hash-password.mjs <password>");
  process.exit(1);
}

const salt = randomBytes(16);
const key = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
process.stdout.write(
  `scrypt$16384$8$1$${salt.toString("base64url")}$${key.toString("base64url")}\n`,
);
