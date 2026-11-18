import "server-only";
import { get, list, put } from "@vercel/blob";
import {
  creditCardFlagKey,
  normalizeFlagKey,
  type FlagJob,
  type StoredCreditCardFlag,
} from "@/lib/credit-card-flag";

export type CreditCardFlag = StoredCreditCardFlag & { key: string };

/**
 * Private Vercel Blob prefix. Same store pattern as usage/, separate prefix
 * so a data-sync rebuild of the snapshot cannot wipe the toggles.
 * Nothing under this prefix is committed to the repo.
 */
export const CREDIT_CARD_FLAG_PREFIX = "swt-commission-flags/";

const memory = new Map<string, CreditCardFlag>();

export function resetCreditCardFlagsForTests(): void {
  memory.clear();
}

function blobEnabled(): boolean {
  if (process.env.VITEST) return false;
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.BLOB_STORE_ID && (process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN)),
  );
}

export function flagPathname(key: string): string {
  const safe = normalizeFlagKey(key).replace(/[^A-Z0-9._-]/g, "_").slice(0, 80);
  return `${CREDIT_CARD_FLAG_PREFIX}${safe}.json`;
}

function parseFlag(text: string, fallbackKey: string): CreditCardFlag | null {
  try {
    const parsed = JSON.parse(text) as Partial<CreditCardFlag>;
    const key = normalizeFlagKey(parsed.key) || normalizeFlagKey(fallbackKey);
    if (!key || typeof parsed.paidByCreditCard !== "boolean") return null;
    if (typeof parsed.updatedBy !== "string" || typeof parsed.updatedAt !== "string") return null;
    return {
      key,
      paidByCreditCard: parsed.paidByCreditCard,
      updatedBy: parsed.updatedBy.slice(0, 80),
      updatedAt: parsed.updatedAt,
      estimateNumber: parsed.estimateNumber ?? null,
      jobNumber: parsed.jobNumber ?? null,
      quoteNumber: parsed.quoteNumber ?? null,
      jobId: parsed.jobId ?? null,
    };
  } catch {
    return null;
  }
}

async function readBlobText(pathname: string): Promise<string | null> {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return new Response(result.stream).text();
}

async function readBlobFlags(): Promise<CreditCardFlag[]> {
  if (!blobEnabled()) return [];
  try {
    const blobs: { pathname: string }[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: CREDIT_CARD_FLAG_PREFIX, limit: 1000, cursor });
      blobs.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
      if (blobs.length >= 5000) break;
    } while (cursor);
    const flags = await Promise.all(
      blobs.map(async (blob) => {
        try {
          const text = await readBlobText(blob.pathname);
          if (!text) return null;
          const fallback = blob.pathname.slice(CREDIT_CARD_FLAG_PREFIX.length).replace(/\.json$/i, "");
          return parseFlag(text, fallback);
        } catch {
          return null;
        }
      }),
    );
    return flags.filter((flag): flag is CreditCardFlag => flag != null);
  } catch {
    console.error(JSON.stringify({ source: "swt-commission-flags", error: "read-failed" }));
    return [];
  }
}

/** Blob plus same-instance writes. Memory wins so a toggle is visible immediately. */
export async function readCreditCardFlags(): Promise<Record<string, CreditCardFlag>> {
  const merged: Record<string, CreditCardFlag> = {};
  for (const flag of await readBlobFlags()) merged[flag.key] = flag;
  for (const flag of memory.values()) merged[flag.key] = flag;
  return merged;
}

export async function readCreditCardFlag(job: FlagJob): Promise<CreditCardFlag | null> {
  const flags = await readCreditCardFlags();
  const primary = creditCardFlagKey(job);
  if (primary && flags[primary]) return flags[primary];
  const estimate = normalizeFlagKey(job.estimateNumber);
  const id = normalizeFlagKey(job.id);
  if (estimate && flags[estimate]) return flags[estimate];
  if (id && flags[id]) return flags[id];
  return null;
}

/**
 * Persist one toggle. Returns false when production has no private blob store,
 * so the caller does not tell the admin the flag was saved.
 */
export async function writeCreditCardFlag(flag: CreditCardFlag): Promise<boolean> {
  const key = normalizeFlagKey(flag.key);
  if (!key) return false;
  const stored: CreditCardFlag = { ...flag, key };
  const previous = memory.get(key);
  memory.set(key, stored);
  if (!blobEnabled()) {
    return process.env.NODE_ENV !== "production";
  }
  try {
    await put(flagPathname(key), JSON.stringify(stored), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
    });
    return true;
  } catch {
    if (previous) memory.set(key, previous);
    else memory.delete(key);
    console.error(JSON.stringify({ source: "swt-commission-flags", error: "persist-failed" }));
    return false;
  }
}
