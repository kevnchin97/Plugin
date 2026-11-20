/**
 * Upload the generated demo film into the demo workspace and queue its ingest, so a fresh
 * checkout has something to open in the GIF Maker. Run after `pnpm db:seed`.
 * Uses only generated media (packages/media fixtures), never downloaded footage.
 */
import { Queue } from "bullmq";
import { and, closeDb, eq, mediaJobs, references, users, memberships } from "@innovate/db";
import { DEMO_FIXTURE, ensureFixtures, fixturePath } from "@innovate/media";
import { MEDIA_QUEUE, type MediaJobData, storageKeys } from "@innovate/shared";
import { db, redisConnection, storage } from "./context";

await ensureFixtures({ only: [DEMO_FIXTURE.file], log: console.log });
const [owner] = await db
  .select({ userId: users.id, workspaceId: memberships.workspaceId })
  .from(users)
  .innerJoin(memberships, eq(memberships.userId, users.id))
  .where(eq(users.email, "demo@innovate.local"));
if (!owner) throw new Error("Run `pnpm db:seed` first.");

const title = "Innovate demo film";
const [existing] = await db
  .select()
  .from(references)
  .where(and(eq(references.workspaceId, owner.workspaceId), eq(references.title, title)));
const id = existing?.id ?? crypto.randomUUID();
const originalKey = storageKeys.original(owner.workspaceId, id, "mp4");
await storage.uploadFile(originalKey, fixturePath(DEMO_FIXTURE.file), "video/mp4");
if (!existing)
  await db.insert(references).values({
    id,
    workspaceId: owner.workspaceId,
    type: "video",
    status: "processing",
    stage: "proxy",
    title,
    originalKey,
    contentType: "video/mp4",
    sourcePlatform: "upload",
    createdBy: owner.userId,
  });
const [job] = await db
  .insert(mediaJobs)
  .values({ workspaceId: owner.workspaceId, referenceId: id, type: "ingest", idempotencyKey: `ingest:${id}`, createdBy: owner.userId })
  .onConflictDoUpdate({ target: [mediaJobs.workspaceId, mediaJobs.idempotencyKey], set: { status: "queued", stage: "queued", progress: 0, error: null } })
  .returning();
const queue = new Queue<MediaJobData>(MEDIA_QUEUE, { connection: redisConnection() });
await queue.remove(job!.id).catch(() => {});
await queue.add("ingest", { type: "ingest", jobId: job!.id, referenceId: id, workspaceId: owner.workspaceId }, { jobId: job!.id, attempts: 3 });
await queue.close();
console.log(`queued ingest for "${title}" (${id}); sign in as demo@innovate.local and open /make/${id}`);
await closeDb();
process.exit(0);
