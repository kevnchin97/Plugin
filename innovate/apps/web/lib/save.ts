import "server-only";
import { references } from "@innovate/db";
import { detectPlatform, extSaveSchema, hostOf } from "@innovate/shared";
import { adapterFor } from "@innovate/shared/adapters";
import type { z } from "zod";
import { HttpError } from "./api";
import { getBoard, placeOnBoard } from "./boards";
import { upsertJob } from "./media";
import { db } from "./server";
import { queueImport } from "./tokens";

const VIDEO_EXT = /\.(mp4|m4v|mov|webm)(?:$|[?#])/i;

/**
 * Save something from the web (extension, text-to-save): an image, a video (direct file or a
 * platform link with an enabled adapter) or a page. Source URL and platform are always kept.
 */
export async function saveFromWeb(ctx: { userId: string; workspaceId: string }, input: z.infer<typeof extSaveSchema>) {
  if (input.boardId) await getBoard(ctx.workspaceId, input.boardId);
  const id = crypto.randomUUID();
  const pageUrl = input.pageUrl ?? input.url;
  const platform = detectPlatform(new URL(pageUrl)) ?? hostOf(pageUrl);
  const title = (input.title || "").trim().slice(0, 200);

  let type: "image" | "video" | "link" = "link";
  let follow: (() => Promise<void>) | null = null;

  if (input.kind === "image") {
    type = "image";
    follow = () => queueImport(ctx.workspaceId, id, input.url, "original", ctx.userId);
  } else if (input.kind === "video") {
    const u = new URL(input.url);
    if (u.protocol === "blob:") throw new HttpError(422, "This video streams in pieces and can't be saved as a file. Save the page instead.");
    const viaAdapter = adapterFor(u);
    if (!viaAdapter && detectPlatform(u)) throw new HttpError(422, `${detectPlatform(u)} videos need an ingest adapter, which isn't enabled. The page was not saved.`);
    if (!viaAdapter && !VIDEO_EXT.test(u.pathname) && !input.assumeVideo) throw new HttpError(422, "That isn't a direct video file. Save the page instead.");
    type = "video";
    follow = async () => {
      await upsertJob({ workspaceId: ctx.workspaceId, referenceId: id, type: "ingest", idempotencyKey: `ingest:${id}`, createdBy: ctx.userId });
    };
  } else {
    // A page or link: ready immediately; its preview image (og:image) is imported if given.
    if (input.imageUrl) follow = () => queueImport(ctx.workspaceId, id, input.imageUrl!, "thumbnail", ctx.userId);
  }

  await db().transaction(async (tx) => {
    await tx.insert(references).values({
      id,
      workspaceId: ctx.workspaceId,
      type,
      status: type === "link" ? "ready" : "pending",
      stage: type === "link" ? "ready" : type === "video" ? "fetching" : "fetching",
      title: title || (type === "link" ? hostOf(pageUrl) : decodeURIComponent(new URL(input.url).pathname.split("/").pop() || "Untitled")).slice(0, 200),
      sourceUrl: type === "link" ? input.url : input.url,
      sourcePlatform: platform,
      notes: input.note ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      createdBy: ctx.userId,
    });
    if (input.boardId) await placeOnBoard(tx, ctx.workspaceId, input.boardId, id, ctx.userId, type === "link" ? 260 : 280);
  });
  if (follow) await follow();
  return { referenceId: id, type };
}
