import { NextResponse } from "next/server";
import { references } from "@innovate/db";
import { createImageUploadSchema } from "@innovate/shared";
import { parseJson, route } from "@/lib/api";
import { getBoard } from "@/lib/boards";
import { db, storage } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as const;

/**
 * Start an image/GIF upload: creates the reference and returns a signed PUT URL. Images need
 * no worker processing; POST /api/references/:id/ingest marks them ready once stored.
 * The ingest call queues the CLIP embedding. TODO(post-M8): perceptual-hash dedupe.
 */
export const POST = route(async (req: Request) => {
  const ctx = await requireApiSession({ write: true });
  const input = await parseJson(req, createImageUploadSchema);
  if (input.boardId) await getBoard(ctx.workspaceId, input.boardId);
  const id = crypto.randomUUID();
  const key = `ws/${ctx.workspaceId}/ref/${id}/original.${EXT[input.contentType]}`;
  await db()
    .insert(references)
    .values({
      id,
      workspaceId: ctx.workspaceId,
      type: input.contentType === "image/gif" ? "gif" : "image",
      status: "pending",
      stage: "uploading",
      title: input.filename.replace(/\.[a-z0-9]{2,4}$/i, "").slice(0, 200) || "Untitled",
      originalKey: key,
      thumbnailKey: key,
      contentType: input.contentType,
      bytes: input.size,
      width: input.width,
      height: input.height,
      sourcePlatform: "upload",
      createdBy: ctx.userId,
    });
  return NextResponse.json({ id, uploadUrl: await storage().signedPutUrl(key, input.contentType) }, { status: 201 });
});
