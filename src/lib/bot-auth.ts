import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

export type BotKey = {
  name: string;
  secret: string;
};

const NAME_PATTERN = /^[\w.-]{1,64}$/;

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** SHA-256 both sides so the compare stays constant-time for different lengths. */
export function secretsMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!NAME_PATTERN.test(trimmed)) {
    throw new Error("BOT_API_KEYS names must be 1–64 characters: letters, numbers, dot, underscore, or hyphen.");
  }
  return trimmed;
}

function cleanSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length < 16 || trimmed.length > 256) {
    throw new Error("Each bot API key must be between 16 and 256 characters.");
  }
  if (/\s/.test(trimmed)) {
    throw new Error("Bot API keys cannot contain whitespace.");
  }
  return trimmed;
}

/**
 * BOT_API_KEYS is either a JSON object {"sarah-bot":"<key>"}
 * or comma/newline separated name:key pairs.
 */
export function parseBotApiKeys(raw: string | undefined | null): BotKey[] {
  const text = raw?.trim() ?? "";
  if (!text) return [];
  let entries: Array<[string, string]>;
  if (text.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("BOT_API_KEYS must be a JSON object of name to key, or name:key pairs.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("BOT_API_KEYS JSON must be an object of name to key.");
    }
    entries = Object.entries(parsed).map(([name, secret]) => {
      if (typeof secret !== "string") {
        throw new Error("Each BOT_API_KEYS value must be a string.");
      }
      return [name, secret];
    });
  } else {
    entries = text
      .split(/[\n,]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const idx = part.indexOf(":");
        if (idx <= 0) {
          throw new Error("BOT_API_KEYS entries must be name:key pairs or a JSON object.");
        }
        return [part.slice(0, idx), part.slice(idx + 1)];
      });
  }
  if (entries.length === 0) {
    throw new Error("BOT_API_KEYS must contain at least one key.");
  }
  const seen = new Set<string>();
  return entries.map(([name, secret]) => {
    const cleanedName = cleanName(name);
    if (seen.has(cleanedName)) {
      throw new Error("BOT_API_KEYS names must be unique.");
    }
    seen.add(cleanedName);
    return { name: cleanedName, secret: cleanSecret(secret) };
  });
}

export function loadBotApiKeys(): { keys: BotKey[]; configured: boolean; error: boolean } {
  const raw = process.env.BOT_API_KEYS;
  if (!raw?.trim()) return { keys: [], configured: false, error: false };
  try {
    return { keys: parseBotApiKeys(raw), configured: true, error: false };
  } catch {
    return { keys: [], configured: false, error: true };
  }
}

export function bearerToken(authorization: string | null | undefined): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
  if (!match) return null;
  const token = match[1];
  if (token.length > 256) return null;
  return token;
}

/**
 * Returns the key name, or null when the bearer token is missing or wrong.
 * Every configured key is checked so a match is not faster than a miss.
 */
export function identifyBotKey(
  authorization: string | null | undefined,
  keys: readonly BotKey[],
): string | null {
  const provided = bearerToken(authorization);
  if (!provided || keys.length === 0) {
    secretsMatch(provided || "invalid", "invalid");
    return null;
  }
  let match: string | null = null;
  for (const key of keys) {
    if (secretsMatch(provided, key.secret) && match == null) match = key.name;
  }
  return match;
}
