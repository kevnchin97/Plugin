import { NextResponse } from "next/server";
import { createAgentTaskSchema } from "@innovate/shared";
import { parseJson, route } from "@/lib/api";
import { agentsEnabled, createTask, listTasks, serializeTask } from "@/lib/agents";
import { requireApiSession } from "@/lib/session";

export const GET = route(async () => {
  const ctx = await requireApiSession();
  return NextResponse.json({ enabled: agentsEnabled(), tasks: await listTasks(ctx.workspaceId) });
});

/** Start an agent run (Cmd+K). It proposes; nothing changes until POST …/approve. */
export const POST = route(async (req: Request) => {
  const ctx = await requireApiSession({ write: true });
  const { prompt } = await parseJson(req, createAgentTaskSchema);
  return NextResponse.json({ task: serializeTask(await createTask(ctx, prompt)) }, { status: 201 });
});
