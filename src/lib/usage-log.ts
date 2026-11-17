import "server-only";
import { randomUUID } from "node:crypto";
import { get, list, put } from "@vercel/blob";

export type UsageEvent = {
  id: string;
  ts: string;
  kind: "api" | "login";
  keyName?: string;
  name?: string;
  success?: boolean;
  method?: string;
  path?: string;
  query?: string;
  status?: number;
  userAgent?: string | null;
  ip?: string | null;
};

const USAGE_PREFIX = "usage/";
const MEMORY_CAP = 200;
const memory: UsageEvent[] = [];

const SECRET_PARAM = /^(?:key|token|api[_-]?key|authorization|password|passwd|secret|code|bot[_-]?api[_-]?key)$/i;

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    if (!out.includes(secret)) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

function scrub(value: string | null | undefined, secrets: readonly string[]): string | null | undefined {
  if (value == null) return value;
  return redactSecrets(value, secrets);
}

/** Query string safe to store. Drops secret-looking parameter values, then scrubs known keys. */
export function safeQueryString(search: string, secrets: readonly string[]): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const name of [...params.keys()]) {
    if (SECRET_PARAM.test(name)) params.set(name, "[redacted]");
  }
  const rendered = params.toString();
  return redactSecrets(rendered, secrets).slice(0, 500);
}

export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 80);
  }
  const real = request.headers.get("x-real-ip")?.trim();
  return real ? real.slice(0, 80) : null;
}

export function userAgent(request: Request): string | null {
  const value = request.headers.get("user-agent");
  if (!value) return null;
  return value.slice(0, 300);
}

function remember(event: UsageEvent) {
  memory.push(event);
  if (memory.length > MEMORY_CAP) memory.splice(0, memory.length - MEMORY_CAP);
}

export function resetUsageForTests(): void {
  memory.length = 0;
}

export function memoryUsage(): UsageEvent[] {
  return [...memory];
}

function blobEnabled(): boolean {
  if (process.env.VITEST) return false;
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN ||
      (process.env.BLOB_STORE_ID && (process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN)),
  );
}

function pathnameFor(event: UsageEvent): string {
  const stamp = event.ts.replace(/[:.]/g, "-");
  return `${USAGE_PREFIX}${stamp}-${event.id}.json`;
}

async function persist(event: UsageEvent): Promise<void> {
  if (!blobEnabled()) return;
  try {
    await put(pathnameFor(event), JSON.stringify(event), {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      cacheControlMaxAge: 60,
    });
  } catch {
    console.error(JSON.stringify({ source: "swt-commission-usage", error: "persist-failed" }));
  }
}

async function readBlobText(pathname: string): Promise<string | null> {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  return new Response(result.stream).text();
}

async function readBlobUsage(limit: number): Promise<UsageEvent[]> {
  if (!blobEnabled()) return [];
  try {
    const blobs: { pathname: string; uploadedAt: Date }[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: USAGE_PREFIX, limit: 1000, cursor });
      blobs.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
      if (blobs.length >= 2000) break;
    } while (cursor);
    const newest = blobs
      .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
      .slice(0, limit);
    const events = await Promise.all(
      newest.map(async (blob) => {
        try {
          const text = await readBlobText(blob.pathname);
          if (!text) return null;
          const parsed = JSON.parse(text) as UsageEvent;
          if (!parsed || typeof parsed.id !== "string" || typeof parsed.ts !== "string") return null;
          if (parsed.kind !== "api" && parsed.kind !== "login") return null;
          return parsed;
        } catch {
          return null;
        }
      }),
    );
    return events.filter((event): event is UsageEvent => event != null);
  } catch {
    console.error(JSON.stringify({ source: "swt-commission-usage", error: "read-failed" }));
    return [];
  }
}

export async function readRecentUsage(limit = 100): Promise<UsageEvent[]> {
  const stored = await readBlobUsage(limit);
  const byId = new Map<string, UsageEvent>();
  for (const event of [...stored, ...memory]) byId.set(event.id, event);
  return [...byId.values()]
    .sort((a, b) => b.ts.localeCompare(a.ts) || b.id.localeCompare(a.id))
    .slice(0, limit);
}

type UsageInput = Omit<UsageEvent, "id" | "ts"> & { secrets?: readonly string[] };

/**
 * One structured console line (Vercel runtime logs) and a private Blob object.
 * `secrets` are scrubbed from every stored field. Callers must not pass raw keys.
 */
export async function recordUsage(input: UsageInput): Promise<void> {
  const { secrets = [], ...fields } = input;
  const event: UsageEvent = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    kind: fields.kind,
  };
  if (fields.keyName) event.keyName = scrub(fields.keyName.slice(0, 64), secrets) || undefined;
  if (fields.name) event.name = scrub(fields.name.slice(0, 80), secrets) || undefined;
  if (typeof fields.success === "boolean") event.success = fields.success;
  if (fields.method) event.method = fields.method.slice(0, 16);
  if (fields.path) event.path = scrub(fields.path.slice(0, 200), secrets) || undefined;
  if (fields.query) event.query = scrub(fields.query.slice(0, 500), secrets) || undefined;
  if (typeof fields.status === "number") event.status = fields.status;
  if (fields.userAgent) event.userAgent = scrub(fields.userAgent.slice(0, 300), secrets) ?? null;
  if (fields.ip) event.ip = scrub(fields.ip.slice(0, 80), secrets) ?? null;

  const line = JSON.stringify({ source: "swt-commission-usage", ...event });
  console.log(line);
  remember(event);
  await persist(event);
}
