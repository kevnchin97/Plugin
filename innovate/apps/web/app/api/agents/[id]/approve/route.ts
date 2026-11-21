import { NextResponse } from "next/server";
import { approveAgentSchema } from "@innovate/shared";
import { parseJson, route, uuidParam } from "@/lib/api";
import { approveTask, serializeTask } from "@/lib/agents";
import { requireApiSession } from "@/lib/session";

/** Apply the chosen proposed changes (by index). Everything applied can be undone (POST …/undo). */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession({ write: true });
  const { actions } = await parseJson(req, approveAgentSchema);
  return NextResponse.json({ task: serializeTask(await approveTask(ctx, uuidParam.parse((await params).id), actions)) });
});
