import "server-only";
import { getDb } from "@innovate/db";
import { Storage, storageConfigFromEnv } from "@innovate/shared/storage";
import { MEDIA_QUEUE, type MediaJobData } from "@innovate/shared";
import { Queue } from "bullmq";
import { env } from "./env";

declare global {
  var __innovateWeb: { storage: Storage; queue: Queue<MediaJobData> } | undefined;
}

export const db = () => getDb(env().DATABASE_URL);

function singletons() {
  if (!globalThis.__innovateWeb) {
    const url = new URL(env().REDIS_URL);
    globalThis.__innovateWeb = {
      storage: new Storage(storageConfigFromEnv()),
      queue: new Queue<MediaJobData>(MEDIA_QUEUE, {
        connection: {
          host: url.hostname,
          port: Number(url.port || 6379),
          username: url.username || undefined,
          password: url.password || undefined,
          tls: url.protocol === "rediss:" ? {} : undefined,
          maxRetriesPerRequest: null,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: { age: 24 * 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      }),
    };
  }
  return globalThis.__innovateWeb;
}

export const storage = () => singletons().storage;

/**
 * Enqueue a media job. The BullMQ job id is the media_jobs row id, so adding a job that is
 * already waiting or running is a no-op. `rerun` replaces a finished/failed BullMQ job.
 */
export async function enqueue(data: MediaJobData, rerun = false) {
  const queue = singletons().queue;
  const existing = await queue.getJob(data.jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "failed") return void (await existing.retry());
    if (!rerun || state !== "completed") return;
    await existing.remove();
  }
  await queue.add(data.type, data, { jobId: data.jobId });
}
