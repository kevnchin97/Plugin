import "server-only";
import { createHash } from "node:crypto";
import { rankReferences, type Reference, references, sql } from "@innovate/db";
import { CLIP_MODEL, type SearchQuery } from "@innovate/shared";
import { EMBED_PRIORITY, embedQueue } from "@innovate/shared/embed-queue";
import { cacheGet, cacheSet } from "@innovate/shared/realtime";
import { serializeRefLite } from "./boards";
import { db, storage } from "./server";

/** How long a search waits for the worker's text encoder before falling back to keywords only. */
const EMBED_TIMEOUT_MS = 15_000;
/** The query's CLIP text embedding (computed on the worker, cached in Redis or memory). Null if the worker is unavailable. */
export async function embedQuery(text: string): Promise<number[] | null> {
  const norm = text.trim().toLowerCase().replace(/\s+/g, " ");
  const hash = createHash("sha1").update(`${CLIP_MODEL}\n${norm}`).digest("hex");
  const cacheKey = `clipq:${hash}`;
  try {
    const hit = await cacheGet(cacheKey);
    if (hit) return JSON.parse(hit) as number[];
    const job = await embedQueue().add("embed-text", { type: "embed-text", text: norm }, { jobId: `text-${hash}`, attempts: 1, priority: EMBED_PRIORITY.query });
    const vector = (await job.result(EMBED_TIMEOUT_MS)) as number[];
    await cacheSet(cacheKey, JSON.stringify(vector), 7 * 24 * 3600);
    return vector;
  } catch (err) {
    console.warn("[search] query embedding unavailable:", (err as Error).message);
    return null;
  }
}

export interface SearchHit {
  reference: Awaited<ReturnType<typeof serializeRefLite>>;
  score: number;
  similarity: number | null;
  keyword: boolean;
  /** Seconds into the reference of the best-matching keyframe (videos, clips, GIFs). */
  time: number | null;
  /** The best-matching keyframe, when it differs from the reference's own thumbnail. */
  frameUrl: string | null;
  description: string | null;
}

/**
 * SPEC §5.6: rank by pgvector cosine similarity between the query's CLIP text embedding and each
 * reference's image/keyframe embeddings (a reference scores as its best keyframe), boosted by a
 * full-text match on title, notes, Claude description and platform. Keywords alone when the
 * encoder is unavailable.
 */
export async function searchLibrary(workspaceId: string, q: SearchQuery): Promise<{ hits: SearchHit[]; semantic: boolean }> {
  const vector = await embedQuery(q.q);
  const kept = await rankReferences(db(), workspaceId, q, vector);
  if (!kept.length) return { hits: [], semantic: Boolean(vector) };

  const refs = (await db()
    .select()
    .from(references)
    .where(sql`${references.id} in (${sql.join(kept.map((k) => sql`${k.id}`), sql`, `)})`)) as Reference[];
  const byId = new Map(refs.map((r) => [r.id, r]));
  const s = storage();
  const hits: SearchHit[] = [];
  for (const k of kept) {
    const ref = byId.get(k.id);
    if (!ref) continue;
    hits.push({
      reference: await serializeRefLite(ref),
      score: Math.round(k.score * 1000) / 1000,
      similarity: k.sim === null ? null : Math.round(k.sim * 1000) / 1000,
      keyword: k.keyword,
      time: k.time,
      frameUrl: k.frame_key && k.frame_key !== ref.thumbnailKey ? await s.signedGetUrl(k.frame_key) : null,
      description: ref.autoDescription,
    });
  }
  return { hits, semantic: Boolean(vector) };
}
