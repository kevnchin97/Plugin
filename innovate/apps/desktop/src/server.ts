/**
 * Innovate desktop server: the whole app in one process, with no Docker. The embedded database
 * (PGlite), the in-process job queue and event bus, local file storage, the worker, the realtime
 * WebSocket server and the Next.js web app (standalone build) all run here. The Electron shell
 * (electron/main.cjs) starts this with Electron's own Node; `pnpm --filter @innovate/desktop start`
 * runs it with plain Node for development and tests.
 *
 * Everything that reads configuration at import time is imported dynamically, after the
 * environment below is set.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MediaJobData } from "@innovate/shared";

const here = fileURLToPath(new URL(".", import.meta.url));
const dataDir = resolve(process.env.INNOVATE_DATA_DIR ?? join(here, "../../../.data/desktop"));
const port = Number(process.env.INNOVATE_PORT ?? 47800);
const rtPort = Number(process.env.INNOVATE_REALTIME_PORT ?? port + 1);
const host = process.env.INNOVATE_HOST ?? "127.0.0.1";
/** The Next.js standalone server (`next build` with NEXT_OUTPUT=standalone). */
const nextServer = resolve(process.env.INNOVATE_NEXT_SERVER ?? join(here, "../../web/.next/standalone/apps/web/server.js"));
const migrations = resolve(process.env.INNOVATE_MIGRATIONS_DIR ?? join(here, "../../../packages/db/drizzle"));

for (const d of ["db", "files", "work", "models"]) mkdirSync(join(dataDir, d), { recursive: true });

/** ffmpeg/ffprobe: the copies shipped with the app (ffmpeg-static, ffprobe-static) when installed, else PATH. */
function bundledTools() {
  const req = createRequire(import.meta.url);
  try {
    process.env.FFMPEG_PATH ??= (req("ffmpeg-static") as string).replace("app.asar", "app.asar.unpacked");
    const probe = req("ffprobe-static") as { path: string };
    process.env.FFPROBE_PATH ??= probe.path.replace("app.asar", "app.asar.unpacked");
  } catch {
    // development: ffmpeg and ffprobe on the PATH
  }
}
bundledTools();

/** Per-install secret (sessions, signed file URLs, realtime tickets), created on first launch. */
function secret() {
  const file = join(dataDir, "secret");
  if (!existsSync(file)) writeFileSync(file, randomBytes(48).toString("base64url"), { mode: 0o600 });
  return readFileSync(file, "utf8").trim();
}

const origin = process.env.AUTH_URL ?? `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;
Object.assign(process.env, {
  NODE_ENV: "production",
  INNOVATE_DESKTOP: "1",
  INNOVATE_DESKTOP_TOKEN: process.env.INNOVATE_DESKTOP_TOKEN ?? randomBytes(24).toString("base64url"),
  DATABASE_URL: `pglite:${join(dataDir, "db")}`,
  STORAGE_DIR: join(dataDir, "files"),
  WORKER_TMP_DIR: join(dataDir, "work"),
  MODEL_CACHE_DIR: join(dataDir, "models"),
  AUTH_SECRET: process.env.AUTH_SECRET ?? secret(),
  AUTH_URL: origin,
  AUTH_TRUST_HOST: "true",
  // Not used in desktop mode (queues, cache and events are in-process), but the env schemas want them.
  REDIS_URL: "redis://desktop.invalid:6379",
  REALTIME_PORT: String(rtPort),
  REALTIME_PUBLIC_URL: process.env.REALTIME_PUBLIC_URL ?? `ws://${new URL(origin).hostname}:${rtPort}`,
  PORT: String(port),
  HOSTNAME: host,
});

const log = (msg: string) => console.log(`[desktop] ${msg}`);

const { openEmbeddedDb, closeDb, mediaJobs, references, inArray, eq, and } = await import("@innovate/db");
const started = Date.now();
const db = await openEmbeddedDb(join(dataDir, "db"), migrations);
log(`database ready in ${Date.now() - started} ms (${dataDir})`);

// Jobs live in memory: put back what was queued or running when the app last closed.
const { openQueue } = await import("@innovate/shared/queue");
const { MEDIA_QUEUE } = await import("@innovate/shared");
const interrupted = await db.select().from(mediaJobs).where(inArray(mediaJobs.status, ["queued", "active"]));
const media = openQueue<MediaJobData>(MEDIA_QUEUE, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });
for (const job of interrupted) {
  if ((job.type === "ingest" || job.type === "export") && job.referenceId) {
    await db.update(mediaJobs).set({ status: "queued", stage: "queued", progress: 0 }).where(eq(mediaJobs.id, job.id));
    await media.add(
      job.type,
      job.type === "ingest"
        ? { type: "ingest", jobId: job.id, referenceId: job.referenceId, workspaceId: job.workspaceId }
        : { type: "export", jobId: job.id, referenceId: job.referenceId, workspaceId: job.workspaceId, request: job.request! },
      { jobId: job.id },
    );
  } else {
    const error = "Innovate was closed before this finished. Try again.";
    await db.update(mediaJobs).set({ status: "failed", error }).where(eq(mediaJobs.id, job.id));
    if (job.type === "import" && job.referenceId)
      await db.update(references).set({ status: "failed", error }).where(and(eq(references.id, job.referenceId), inArray(references.status, ["pending", "processing"])));
  }
}
if (interrupted.length) log(`resumed ${interrupted.length} interrupted job(s)`);

const { localBus } = await import("@innovate/shared/realtime");
const { startRealtime } = await import("@innovate/realtime/server");
const realtime = await startRealtime({
  port: rtPort,
  host,
  async subscribe(on) {
    const bus = localBus().bus;
    bus.on("message", on);
    return () => void bus.off("message", on);
  },
});

const { startWorkers } = await import("@innovate/worker/workers");
const workers = await startWorkers();

// The web app. The standalone server chdirs to its own folder and listens on PORT/HOSTNAME.
createRequire(import.meta.url)(nextServer);
for (let i = 0; ; i++) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/login`, { redirect: "manual" });
    if (res.status < 500) break;
  } catch {
    // not listening yet
  }
  if (i > 600) throw new Error("The web server didn't start.");
  await new Promise((r) => setTimeout(r, 100));
}
const loginUrl = `${origin}/api/desktop/login?token=${encodeURIComponent(process.env.INNOVATE_DESKTOP_TOKEN!)}`;
log(`ready on ${origin} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.send?.({ type: "ready", url: origin, loginUrl });

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  log("shutting down");
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  await workers.close().catch(() => {});
  await realtime.close().catch(() => {});
  // Closing PGlite flushes the database to disk; the one thing that must happen before exit.
  await closeDb();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("message", (m: { type?: string }) => m?.type === "shutdown" && void shutdown());
process.on("disconnect", () => void shutdown());
