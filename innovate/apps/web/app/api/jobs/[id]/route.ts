import { NextResponse } from "next/server";
import { and, eq, mediaJobs } from "@innovate/db";
import { notFound, route, uuidParam } from "@/lib/api";
import { serializeJob } from "@/lib/media";
import { db } from "@/lib/server";
import { requireApiSession } from "@/lib/session";

export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession();
  const id = uuidParam.parse((await params).id);
  const [job] = await db()
    .select()
    .from(mediaJobs)
    .where(and(eq(mediaJobs.id, id), eq(mediaJobs.workspaceId, ctx.workspaceId)));
  if (!job) throw notFound("Job not found");
  return NextResponse.json({ job: await serializeJob(job) });
});
