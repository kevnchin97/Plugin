import { NextResponse } from "next/server";
import { extSaveSchema } from "@innovate/shared";
import { parseJson, route } from "@/lib/api";
import { saveFromWeb } from "@/lib/save";
import { requireBearer } from "@/lib/tokens";

/** "Save to Innovate" from the browser extension (token auth). */
export const POST = route(async (req: Request) => {
  const who = await requireBearer(req);
  const input = await parseJson(req, extSaveSchema);
  return NextResponse.json(await saveFromWeb(who, input), { status: 201 });
});
