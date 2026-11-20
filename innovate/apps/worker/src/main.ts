import { type Job, Worker } from "bullmq";
import { closeDb, eq, mediaJobs, references } from "@innovate/db";
import { MEDIA_QUEUE, type MediaJobData } from "@innovate/shared";
import { db, redisConnection, storage } from "./context";
import { env } from "./env";
import { runExport } from "./jobs/export";
import { runIngest } from "./jobs/ingest";

function readable(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 500 ? `${msg.slice(0, 500)}…` : msg;
}

async function handle(job: Job<MediaJobData>) {
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

const worker = new Worker<MediaJobData>(MEDIA_QUEUE, handle, {
  connection: redisConnection(),
  concurrency: env.WORKER_CONCURRENCY,
  // ffmpeg can hold a job for minutes; keep the lock alive.
  lockDuration: 120_000,
});

worker.on("failed", async (job, err) => {
  if (!job) return;
  const final = job.attemptsMade >= (job.opts.attempts ?? 1);
  const message = readable(err);
  console.error(`[worker] ${job.data.type} ${job.data.jobId} attempt ${job.attemptsMade} failed: ${message}`);
  await db
    .update(mediaJobs)
    .set(final ? { status: "failed", error: message } : { status: "queued", error: `Retrying: ${message}` })
    .where(eq(mediaJobs.id, job.data.jobId));
  if (final && job.data.type === "ingest")
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
