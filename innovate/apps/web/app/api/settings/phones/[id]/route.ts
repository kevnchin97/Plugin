import { route, uuidParam } from "@/lib/api";
import { removePhone } from "@/lib/phones";
import { requireApiSession } from "@/lib/session";

export const DELETE = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiSession({ write: true });
  await removePhone(ctx.userId, uuidParam.parse((await params).id));
  return new Response(null, { status: 204 });
});
