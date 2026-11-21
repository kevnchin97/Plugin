import { NextResponse } from "next/server";
import { route, uuidParam } from "@/lib/api";
import { serializeRefLite } from "@/lib/boards";
import { getReference } from "@/lib/media";
import { storage } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

/** Playable media for the feedback panel: the proxy for source videos, the file for clips. */
export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession();
  const ref = await getReference(ctx.workspaceId, uuidParam.parse((await params).id));
  return NextResponse.json({
    reference: await serializeRefLite(ref),
    playUrl: ref.type === "video" ? (ref.proxyKey ? await storage().signedGetUrl(ref.proxyKey) : null) : ref.type === "clip" && ref.originalKey ? await storage().signedGetUrl(ref.originalKey) : null,
  });
});
