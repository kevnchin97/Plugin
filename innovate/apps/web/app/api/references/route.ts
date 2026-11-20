import { NextResponse } from "next/server";
import { desc, eq, references } from "@innovate/db";
import { createReferenceSchema, detectPlatform, enabledAdapters, storageKeys } from "@innovate/shared";
import { HttpError, parseJson, route } from "@/lib/api";
import { serializeReference, upsertJob } from "@/lib/media";
import { db, storage } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

const PLATFORM_NAMES: Record<string, string> = { youtube: "YouTube", vimeo: "Vimeo", instagram: "Instagram" };
const EXT = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" } as const;

export const GET = route(async () => {
  const ctx = await requireApiSession();
  // TODO(M2): pagination + TanStack Virtual masonry for 5,000+ items.
  const rows = await db()
    .select()
    .from(references)
    .where(eq(references.workspaceId, ctx.workspaceId))
    .orderBy(desc(references.createdAt))
    .limit(300);
  return NextResponse.json({ references: await Promise.all(rows.map(serializeReference)) });
});

/** Start an upload (returns a signed PUT URL) or a direct-URL ingest. */
export const POST = route(async (req: Request) => {
  const ctx = await requireApiSession({ write: true });
  const input = await parseJson(req, createReferenceSchema);
  const id = crypto.randomUUID();

  if (input.kind === "upload") {
    const originalKey = storageKeys.original(ctx.workspaceId, id, EXT[input.contentType]);
    await db()
      .insert(references)
      .values({
        id,
        workspaceId: ctx.workspaceId,
        type: "video",
        status: "pending",
        stage: "uploading",
        title: input.filename.replace(/\.[a-z0-9]{2,4}$/i, "").slice(0, 200) || "Untitled",
        originalKey,
        contentType: input.contentType,
        bytes: input.size,
        sourcePlatform: "upload",
        createdBy: ctx.userId,
      });
    // TODO(M2): S3 multipart for resumable uploads of very large files (SPEC §5.2).
    const uploadUrl = await storage().signedPutUrl(originalKey, input.contentType);
    return NextResponse.json({ id, uploadUrl }, { status: 201 });
  }

  const url = new URL(input.url);
  const platform = detectPlatform(url);
  if (platform && !enabledAdapters.some((a) => a.canHandle(url)))
    throw new HttpError(
      422,
      `${PLATFORM_NAMES[platform] ?? platform} links need an ingest adapter, which isn't enabled yet. Upload the file, or paste a direct link to a video file.`,
    );
  await db()
    .insert(references)
    .values({
      id,
      workspaceId: ctx.workspaceId,
      type: "video",
      status: "pending",
      stage: "fetching",
      title: decodeURIComponent(url.pathname.split("/").pop() || url.hostname).replace(/\.[a-z0-9]{2,4}$/i, "") || "Untitled",
      sourceUrl: url.toString(),
      sourcePlatform: "direct",
      createdBy: ctx.userId,
    });
  const job = await upsertJob({ workspaceId: ctx.workspaceId, referenceId: id, type: "ingest", idempotencyKey: `ingest:${id}`, createdBy: ctx.userId });
  return NextResponse.json({ id, jobId: job.id }, { status: 201 });
});
