type Bucket = { window: number; count: number };

const buckets = new Map<string, Bucket>();

export const rateLimits = {
  validPerMinute: 60,
  invalidPerMinute: 30,
};

const WINDOW_MS = 60_000;

/** Fixed one-minute window. Returns false when the bucket is already full. */
export function allowRequest(
  bucket: string,
  limit: number,
  now = Date.now(),
  windowMs = WINDOW_MS,
): boolean {
  const window = Math.floor(now / windowMs);
  const current = buckets.get(bucket);
  if (!current || current.window !== window) {
    buckets.set(bucket, { window, count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function resetRateLimits(): void {
  buckets.clear();
}
