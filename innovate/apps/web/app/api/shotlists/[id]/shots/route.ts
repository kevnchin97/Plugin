import { NextResponse } from "next/server";
import { createShotSchema } from "@innovate/shared";
import { parseJson, route, uuidParam } from "@/lib/api";
import { requireApiSession } from "@/lib/session";
import { createShot } from "@/lib/shotlists";

export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession({ write: true });
  const input = await parseJson(req, createShotSchema);
  return NextResponse.json(await createShot(ctx.workspaceId, uuidParam.parse((await params).id), input, req.headers.get("x-client-id")), { status: 201 });
});
