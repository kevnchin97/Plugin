import "server-only";
import { headers } from "next/headers";
import { rateLimit } from "@innovate/shared/realtime";
import { HttpError } from "./api";
import { boardInShare, requireShare } from "./feedback";

/** Rate-limited share access for guest API routes (SPEC §6: rate-limit share links). */
export async function shareRequest(token: string, opts: { boardId?: string | null; limit?: number } = {}) {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || h.get("x-real-ip") || "local";
  if (!(await rateLimit(`share:${token}:${ip}`, opts.limit ?? 240, 60))) throw new HttpError(429, "Too many requests. Wait a minute and try again.");
  const share = await requireShare(token);
  const boardId = opts.boardId ?? share.link.targetId;
  if (!(await boardInShare(share.link, boardId))) throw new HttpError(404, "That board isn't part of this link.");
  return { share, boardId, ip };
}
