import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { unsorted } from "@/lib/boards";
import { requireApiSession } from "@/lib/session";

export const GET = route(async () => {
  const ctx = await requireApiSession();
  return NextResponse.json({ references: await unsorted(ctx.workspaceId) });
});
