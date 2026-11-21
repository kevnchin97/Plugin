import { NextResponse } from "next/server";
import { searchQuerySchema } from "@innovate/shared";
import { HttpError, route } from "@/lib/api";
import { searchLibrary } from "@/lib/search";
import { requireApiSession } from "@/lib/session";

/** GET /api/search?q=…&type=gif&type=video&board=…&source=upload&from=YYYY-MM-DD&to=YYYY-MM-DD */
export const GET = route(async (req: Request) => {
  const ctx = await requireApiSession();
  const p = new URL(req.url).searchParams;
  const parsed = searchQuerySchema.safeParse({
    q: p.get("q") ?? "",
    types: p.getAll("type"),
    boardId: p.get("board") || undefined,
    source: p.get("source") || undefined,
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    limit: p.get("limit") || undefined,
  });
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "That search isn't valid.");
  const started = Date.now();
  const result = await searchLibrary(ctx.workspaceId, parsed.data);
  return NextResponse.json({ ...result, tookMs: Date.now() - started });
});
