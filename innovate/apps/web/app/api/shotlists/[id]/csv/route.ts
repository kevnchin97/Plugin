import { shotsToCsv, slugify } from "@innovate/shared";
import { route, uuidParam } from "@/lib/api";
import { requireApiSession } from "@/lib/session";
import { csvRows, getShotList } from "@/lib/shotlists";

/** CSV download: text only, so it's built in the request (no media work). */
export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession();
  const id = uuidParam.parse((await params).id);
  const list = await getShotList(ctx.workspaceId, id);
  const csv = shotsToCsv(await csvRows(ctx.workspaceId, id));
  return new Response("\uFEFF" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${slugify(list.title)}_shot-list.csv"`,
    },
  });
});
