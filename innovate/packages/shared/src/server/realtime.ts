/** Publishing side of realtime: web and worker publish to Redis; apps/realtime fans out over WebSockets. */
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
}

function pub(): Redis {
  globalThis.__innovateRedisPub ??= new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: 2 });
  return globalThis.__innovateRedisPub;
}

export const channelFor = (room: string) => `rt:${room}`;

export async function publish(room: string, event: RealtimeEvent): Promise<void> {
  try {
    await pub().publish(channelFor(room), JSON.stringify(event));
  } catch (err) {
    // Realtime is best-effort: the change is already saved and shows on the next load.
    console.warn("[realtime] publish failed:", (err as Error).message);
  }
}

/** Fixed-window rate limit in Redis. Returns true when the call is allowed. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  try {
    const k = `rl:${key}`;
    const n = await pub().incr(k);
    if (n === 1) await pub().expire(k, windowSec);
    return n <= limit;
  } catch {
    return true; // fail open if Redis is unavailable; the app still works
  }
}
