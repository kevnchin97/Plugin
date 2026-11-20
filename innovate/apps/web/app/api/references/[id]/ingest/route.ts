import { NextResponse } from "next/server";
import { eq, references } from "@innovate/db";
import { HttpError, route, uuidParam } from "@/lib/api";
import { getReference, upsertJob } from "@/lib/media";
import { db, storage } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

/** Called after the browser finishes its PUT to storage. Safe to call twice. */
export const POST = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession({ write: true });
  const ref = await getReference(ctx.workspaceId, uuidParam.parse((await params).id));
  if (!ref.originalKey && !ref.sourceUrl) throw new HttpError(400, "Nothing to process.");
  if (ref.originalKey && !ref.sourceUrl) {
    const head = await storage().head(ref.originalKey);
    if (!head) throw new HttpError(409, "The upload hasn't reached storage. Try again.");
    await db().update(references).set({ bytes: head.size, stage: "proxy", status: "processing" }).where(eq(references.id, ref.id));
  }
  const job = await upsertJob({
    workspaceId: ctx.workspaceId,
    referenceId: ref.id,
    type: "ingest",
    idempotencyKey: `ingest:${ref.id}`,
    createdBy: ctx.userId,
  });
  return NextResponse.json({ jobId: job.id });
});
