/** Enqueue CLIP embedding work (web and worker both call this; the worker processes EMBED_QUEUE). */
import { EMBED_QUEUE, type EmbedJobData } from "../jobs";
import { openQueue, type QueueHandle } from "./queue";

export { redisOptions } from "./queue";

declare global {
  var __innovateEmbedQueue: QueueHandle<EmbedJobData> | undefined;
}

/** Lower runs first. A search query jumps ahead of any backlog of reference embeddings. */
export const EMBED_PRIORITY = { query: 1, reference: 10, sweep: 20 } as const;

export function embedQueue() {
  globalThis.__innovateEmbedQueue ??= openQueue<EmbedJobData>(EMBED_QUEUE, {
    attempts: 3,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: true,
    removeOnFail: { age: 7 * 24 * 3600 },
  });
  return globalThis.__innovateEmbedQueue;
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
