import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { QueueJob as Job } from "@innovate/shared/queue";
import { and, eq, mediaJobs, references } from "@innovate/db";
import { runFfprobe } from "@innovate/media";
import type { ImportJobData } from "@innovate/shared";
import { db, dirs, storage } from "../context";
import { env } from "../env";
import { assertPublicHost } from "../fetch-url";

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
const MAX_IMAGE_BYTES = 80 * 1024 ** 2;

/**
 * Import an image by URL (SSRF-guarded like direct video URLs). For an image reference it becomes
 * the original (and thumbnail); for a link reference it becomes the preview thumbnail.
 */
export async function runImport(job: Job<ImportJobData>) {
  const { jobId, referenceId, workspaceId, url, as } = job.data;
  const [ref] = await db.select().from(references).where(and(eq(references.id, referenceId), eq(references.workspaceId, workspaceId)));
  if (!ref) throw new Error("Reference not found");
  const work = join(dirs.work, `import-${jobId}-${job.attemptsMade}`);
  await mkdir(work, { recursive: true });
  try {
    let target = new URL(url);
    let res: Response | null = null;
    for (let hop = 0; hop < 5; hop++) {
      if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error("Only http and https images can be imported.");
      if (!env.INGEST_ALLOW_PRIVATE_URLS) await assertPublicHost(target);
      res = await fetch(target, { redirect: "manual", headers: { "user-agent": "InnovateBot/0.1 (+image import)", accept: "image/*" } });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        target = new URL(loc, target);
        continue;
      }
      break;
    }
    if (!res?.ok) throw new Error(`Couldn't download the image (HTTP ${res?.status ?? "error"}).`);
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const ext = IMAGE_TYPES[type];
    if (!ext) throw new Error(`That link isn't an image (server says "${type || "unknown"}").`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) throw new Error("That image is too large to import.");
    const file = join(work, `image.${ext}`);
    await (await import("node:fs/promises")).writeFile(file, buf);
    const probe = JSON.parse(await runFfprobe(["-print_format", "json", "-show_streams", file])) as { streams: { width?: number; height?: number }[] };
    const dims = probe.streams.find((s) => s.width && s.height);
    const key = `ws/${workspaceId}/ref/${referenceId}/${as === "original" ? "original" : "preview"}.${ext}`;
    await storage.uploadFile(key, file, type);
    const bytes = (await stat(file)).size;
    if (as === "original")
      await db
        .update(references)
        .set({ originalKey: key, thumbnailKey: key, contentType: type, bytes, width: dims?.width, height: dims?.height, status: "ready", stage: "ready", error: null, type: type === "image/gif" ? "gif" : "image" })
        .where(eq(references.id, referenceId));
    else await db.update(references).set({ thumbnailKey: key, width: dims?.width, height: dims?.height }).where(eq(references.id, referenceId));
    await db.update(mediaJobs).set({ status: "completed", stage: "done", progress: 100, error: null }).where(eq(mediaJobs.id, jobId));
    return { key };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
