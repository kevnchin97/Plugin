import { type Job, Queue, Worker } from "bullmq";
import { closeDb, eq, mediaJobs, references } from "@innovate/db";
import { MEDIA_QUEUE, type MediaJobData } from "@innovate/shared";
import { db, redisConnection, storage } from "./context";
import { env } from "./env";
import { runExport } from "./jobs/export";
import { sendDigests } from "./jobs/digest";
import { runImport } from "./jobs/import";
import { runIngest } from "./jobs/ingest";

function readable(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg;
}

async function handle(job: Job<MediaJobData>) {
  if (job.data.type === "digest") return sendDigests();
  if (job.data.type === "import") {
    await db.update(mediaJobs).set({ status: "active", attempts: job.attemptsMade + 1 }).where(eq(mediaJobs.id, job.data.jobId));
    return runImport(job as Job<never>);
  }
  await db
    .update(mediaJobs)
    .set({ status: "active", attempts: job.attemptsMade + 1, error: null })
    .where(eq(mediaJobs.id, job.data.jobId));
  const started = Date.now();
  const result = job.data.type === "ingest" ? await runIngest(job as Job<never>) : await runExport(job as Job<never>);
  console.log(`[worker] ${job.data.type} ${job.data.jobId} done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return result;
}

await storage.ensureBucket();

// Daily digest at 08:00 UTC (upsert is idempotent across restarts and multiple workers).
const scheduler = new Queue<MediaJobData>(MEDIA_QUEUE, { connection: redisConnection() });
await scheduler.upsertJobScheduler("daily-digest", { pattern: "0 8 * * *", tz: "UTC" }, { name: "digest", data: { type: "digest", jobId: "daily-digest" } });
await scheduler.close();


const worker = new Worker<MediaJobData>(MEDIA_QUEUE, handle, {
  connection: redisConnection(),
  concurrency: env.WORKER_CONCURRENCY,
  // ffmpeg can hold a job for minutes; keep the lock alive.
  lockDuration: 120_000,
});

worker.on("failed", async (job, err) => {
  if (!job || job.data.type === "digest") return;
  const final = job.attemptsMade >= (job.opts.attempts ?? 1);
  const message = readable(err);
  console.error(`[worker] ${job.data.type} ${job.data.jobId} attempt ${job.attemptsMade} failed: ${message}`);
  await db
    .update(mediaJobs)
    .set(final ? { status: "failed", error: message } : { status: "queued", error: `Retrying: ${message}` })
    .where(eq(mediaJobs.id, job.data.jobId));
  if (final && (job.data.type === "ingest" || (job.data.type === "import" && job.data.as === "original")))
    await db.update(references).set({ status: "failed", error: message }).where(eq(references.id, job.data.referenceId));
});

worker.on("ready", () => console.log(`[worker] listening on "${MEDIA_QUEUE}" (concurrency ${env.WORKER_CONCURRENCY})`));

const shutdown = async () => {
  console.log("[worker] shutting down");
  await worker.close();
  await closeDb();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
