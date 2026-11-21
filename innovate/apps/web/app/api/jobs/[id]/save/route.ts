import { NextResponse } from "next/server";
import { saveExportSchema } from "@innovate/shared";
import { route, uuidParam } from "@/lib/api";
import { saveExport } from "@/lib/save-export";
import { requireApiSession } from "@/lib/session";

/**
 * "Save to Innovate": turn a finished export into a library reference that points back to
 * its source (parentReferenceId) and keeps source URL, platform and timecodes. Idempotent.
 * With `boardId` the item is also placed on that board; without, it waits in Unsorted.
 */
export const POST = route(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession({ write: true });
  const id = uuidParam.parse((await params).id);
  const body = saveExportSchema.partial().parse(await req.json().catch(() => ({})));
  const result = await saveExport(ctx, id, body);
  return NextResponse.json(result, { status: result.alreadySaved ? 200 : 201 });
});
