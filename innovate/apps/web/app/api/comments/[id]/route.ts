import { NextResponse } from "next/server";
import { resolveSchema } from "@innovate/shared";
import { parseJson, route, uuidParam } from "@/lib/api";
import { setResolved } from "@/lib/feedback";
import { requireApiSession } from "@/lib/session";

/** Resolve or reopen a comment thread (workspace members only). */
export const PATCH = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession({ write: true });
  const id = uuidParam.parse((await params).id);
  const { resolved } = await parseJson(req, resolveSchema);
  return NextResponse.json({ comment: await setResolved(ctx.workspaceId, id, resolved) });
});
