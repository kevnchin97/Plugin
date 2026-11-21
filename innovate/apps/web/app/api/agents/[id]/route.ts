import { NextResponse } from "next/server";
import { route, uuidParam } from "@/lib/api";
import { finalizeTask, serializeTask } from "@/lib/agents";
import { requireApiSession } from "@/lib/session";

/** The task with its live step log; also saves any approved exports that have finished rendering. */
export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession();
  return NextResponse.json({ task: serializeTask(await finalizeTask(ctx, uuidParam.parse((await params).id))) });
});
