import "server-only";
import { getDb } from "@innovate/db";
import { type AnyStorage, storageFromEnv } from "@innovate/shared/storage";
import { MEDIA_QUEUE, type MediaJobData } from "@innovate/shared";
import { openQueue, type QueueHandle } from "@innovate/shared/queue";
import { env } from "./env";

declare global {
  var __innovateWeb: { storage: AnyStorage; queue: QueueHandle<MediaJobData> } | undefined;
}

export const db = () => getDb(env().DATABASE_URL);

function singletons() {
  globalThis.__innovateWeb ??= {
    storage: storageFromEnv(),
    queue: openQueue<MediaJobData>(MEDIA_QUEUE, {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    }),
  };
  return globalThis.__innovateWeb;
}

export const storage = () => singletons().storage;

/**
 * Enqueue a media job. The BullMQ job id is the media_jobs row id, so adding a job that is
 * already waiting or running is a no-op. `rerun` replaces a finished/failed BullMQ job.
 */
export async function enqueue(data: MediaJobData, rerun = false) {
  const queue = singletons().queue;
  const state = await queue.state(data.jobId);
  if (state) {
    if (state === "failed") return void (await queue.retry(data.jobId));
    if (!rerun || state !== "completed") return;
    await queue.remove(data.jobId);
  }
  await queue.add(data.type, data, { jobId: data.jobId });
}
