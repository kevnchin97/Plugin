/** Enqueue CLIP embedding work (web and worker both call this; the worker processes EMBED_QUEUE). */
import { Queue, QueueEvents } from "bullmq";
import { EMBED_QUEUE, type EmbedJobData } from "../jobs";

declare global {
  var __innovateEmbedQueue: { queue: Queue<EmbedJobData>; events?: QueueEvents } | undefined;
}

export function redisOptions(url = process.env.REDIS_URL ?? "redis://localhost:6379") {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

/** BullMQ: lower runs first. A search query jumps ahead of any backlog of reference embeddings. */
export const EMBED_PRIORITY = { query: 1, reference: 10, sweep: 20 } as const;

function state() {
  globalThis.__innovateEmbedQueue ??= {
    queue: new Queue<EmbedJobData>(EMBED_QUEUE, {
      connection: redisOptions(),
      defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 3000 }, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } },
    }),
  };
  return globalThis.__innovateEmbedQueue;
}

export function embedQueue() {
  return state().queue;
}

export function embedQueueEvents() {
  const s = state();
  s.events ??= new QueueEvents(EMBED_QUEUE, { connection: redisOptions() });
  return s.events;
}

/**
 * (Re-)embed a reference. Deduped while waiting (job id per reference); completed jobs are removed,
 * so a later call re-embeds. Never throws: search is best-effort and the worker's sweep catches misses.
 */
export async function queueEmbed(referenceId: string, workspaceId: string, delayMs = 0): Promise<void> {
  try {
    await embedQueue().add("embed", { type: "embed", referenceId, workspaceId }, { jobId: `embed-${referenceId}`, delay: delayMs, priority: EMBED_PRIORITY.reference });
  } catch (err) {
    console.warn("[embed] couldn't queue:", (err as Error).message);
  }
}
