import { NextResponse } from "next/server";
import { route, uuidParam } from "@/lib/api";
import { getReference, serializeReference } from "@/lib/media";
import { requireApiSession } from "@/lib/session";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession();
  const id = uuidParam.parse((await params).id);
  const ref = await getReference(ctx.workspaceId, id);
  return NextResponse.json({ reference: await serializeReference(ref) });
});
