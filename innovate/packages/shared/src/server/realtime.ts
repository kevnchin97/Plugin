/**
 * Publishing side of realtime: web and worker publish to Redis; apps/realtime fans out over WebSockets.
 * The desktop app (INNOVATE_DESKTOP=1) runs everything in one process: events go through an in-process
 * bus, and the cache and rate limits are in memory.
 */
import { EventEmitter } from "node:events";
import { Redis } from "ioredis";

export type RealtimeEvent =
  | { type: "comment"; comment: unknown }
  | { type: "comment-updated"; comment: unknown }
  | { type: "favorite"; referenceId: string; count: number; by: string; on: boolean }
  | { type: "ops"; clientId: string | null; ops: unknown }
  | { type: "activity"; entry: unknown }
  | { type: "presence"; members: { id: string; name: string; kind: string }[] };

declare global {
  var __innovateRedisPub: Redis | undefined;
  var __innovateLocalBus: { bus: EventEmitter; kv: Map<string, { value: string; until: number }> } | undefined;
}

const desktop = () => process.env.INNOVATE_DESKTOP === "1";

/** The desktop app's in-process bus: emits ("message", channel, payload) like a Redis pattern subscription. */
export function localBus() {
  globalThis.__innovateLocalBus ??= { bus: new EventEmitter().setMaxListeners(0), kv: new Map() };
  return globalThis.__innovateLocalBus;
}

function pub(): Redis {
  globalThis.__innovateRedisPub ??= new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: 2 });
  return globalThis.__innovateRedisPub;
}

/** Small string cache (e.g. search query embeddings): Redis, or memory in the desktop app. */
export async function cacheGet(key: string): Promise<string | null> {
  if (!desktop()) return pub().get(key);
  const hit = localBus().kv.get(key);
  if (!hit || hit.until < Date.now()) return null;
  return hit.value;
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (!desktop()) return void (await pub().set(key, value, "EX", ttlSeconds));
  const kv = localBus().kv;
  if (kv.size > 5000) kv.clear();
  kv.set(key, { value, until: Date.now() + ttlSeconds * 1000 });
}

export const channelFor = (room: string) => `rt:${room}`;

export async function publish(room: string, event: RealtimeEvent): Promise<void> {
  try {
    if (desktop()) return void localBus().bus.emit("message", channelFor(room), JSON.stringify(event));
    await pub().publish(channelFor(room), JSON.stringify(event));
  } catch (err) {
    // Realtime is best-effort: the change is already saved and shows on the next load.
    console.warn("[realtime] publish failed:", (err as Error).message);
  }
}

/** Fixed-window rate limit in Redis. Returns true when the call is allowed. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  if (desktop()) {
    const kv = localBus().kv;
    const k = `rl:${key}`;
    const cur = kv.get(k);
    const n = cur && cur.until > Date.now() ? Number(cur.value) + 1 : 1;
    kv.set(k, { value: String(n), until: cur && cur.until > Date.now() ? cur.until : Date.now() + windowSec * 1000 });
    return n <= limit;
  }
  try {
    const k = `rl:${key}`;
    const n = await pub().incr(k);
    if (n === 1) await pub().expire(k, windowSec);
    return n <= limit;
  } catch {
    return true; // fail open if Redis is unavailable; the app still works
  }
}
