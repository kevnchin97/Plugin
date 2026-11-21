import { NextResponse } from "next/server";
import { route, uuidParam } from "@/lib/api";
import { getTask, undoTask, serializeTask } from "@/lib/agents";
import { requireApiSession } from "@/lib/session";

export const POST = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession({ write: true });
  const id = uuidParam.parse((await params).id);
  await undoTask(ctx, id);
  return NextResponse.json({ task: serializeTask(await getTask(ctx.workspaceId, id)) });
});
