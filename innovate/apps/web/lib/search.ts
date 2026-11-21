import "server-only";
import { createHash } from "node:crypto";
import { refSearchDocument, type Reference, references, sql } from "@innovate/db";
import { CLIP_MODEL, type SearchQuery } from "@innovate/shared";
import { EMBED_PRIORITY, embedQueue, embedQueueEvents } from "@innovate/shared/embed-queue";
import { redisClient as redis } from "@innovate/shared/realtime";
import { serializeRefLite } from "./boards";
import { db, storage } from "./server";

/** How long a search waits for the worker's text encoder before falling back to keywords only. */
const EMBED_TIMEOUT_MS = 15_000;
/**
 * CLIP similarities for ViT-B/32 sit in a narrow band (unrelated ~0.15–0.2, good matches ~0.25–0.35),
 * so results are cut relative to the best hit, with an absolute floor.
 */
const MIN_SIMILARITY = 0.19;
const RELATIVE_WINDOW = 0.05;
/** A keyword match on title, notes, description or platform is worth this much similarity. */
const KEYWORD_BOOST = 0.05;

/** The query's CLIP text embedding (computed on the worker, cached in Redis). Null if the worker is unavailable. */
export async function embedQuery(text: string): Promise<number[] | null> {
  const norm = text.trim().toLowerCase().replace(/\s+/g, " ");
  const hash = createHash("sha1").update(`${CLIP_MODEL}\n${norm}`).digest("hex");
  const cacheKey = `clipq:${hash}`;
  try {
    const hit = await redis().get(cacheKey);
    if (hit) return JSON.parse(hit) as number[];
    const job = await embedQueue().add("embed-text", { type: "embed-text", text: norm }, { jobId: `text-${hash}`, attempts: 1, priority: EMBED_PRIORITY.query });
    const vector = (await job.waitUntilFinished(embedQueueEvents(), EMBED_TIMEOUT_MS)) as number[];
    await redis().set(cacheKey, JSON.stringify(vector), "EX", 7 * 24 * 3600);
    return vector;
  } catch (err) {
    console.warn("[search] query embedding unavailable:", (err as Error).message);
    return null;
  }
}

function filters(workspaceId: string, q: SearchQuery) {
  const parts = [sql`r.workspace_id = ${workspaceId}`, sql`r.status = 'ready'`];
  if (q.types.length) parts.push(sql`r.type in (${sql.join(q.types.map((t) => sql`${t}::reference_type`), sql`, `)})`);
  if (q.source === "export") parts.push(sql`r.parent_reference_id is not null`);
  else if (q.source === "upload") parts.push(sql`r.parent_reference_id is null and r.source_platform = 'upload'`);
  else if (q.source === "vimeo") parts.push(sql`r.parent_reference_id is null and r.source_platform = 'vimeo'`);
  else if (q.source === "web") parts.push(sql`r.parent_reference_id is null and coalesce(r.source_platform, '') not in ('upload', 'vimeo')`);
  if (q.from) parts.push(sql`r.created_at >= ${q.from}::date`);
  if (q.to) parts.push(sql`r.created_at < ${q.to}::date + 1`);
  if (q.boardId)
    // The board and every board nested under it.
    parts.push(sql`r.id in (
      with recursive tree(id) as (
        select id from boards where id = ${q.boardId} and workspace_id = ${workspaceId}
        union select b.id from boards b join tree on b.parent_board_id = tree.id
      )
      select bi.reference_id from board_items bi join tree on bi.board_id = tree.id where bi.reference_id is not null)`);
  return sql.join(parts, sql` and `);
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
  const where = filters(workspaceId, q);
  const tsq = sql`websearch_to_tsquery('english', ${q.q})`;
  const vec = vector ? sql`${JSON.stringify(vector)}::vector` : null;

  const rows = (await db().execute(sql`
    with ${vec ? sql`nearest as (
      select e.reference_id, e.time, e.frame_key, e.embedding <=> ${vec} as dist
      from embeddings e
      where e.workspace_id = ${workspaceId}
      order by e.embedding <=> ${vec}
      limit 2000
    ), best as (
      select distinct on (reference_id) reference_id, time, frame_key, 1 - dist as sim
      from nearest order by reference_id, dist
    ), ` : sql``}kw as (
      select refs.id from refs where refs.workspace_id = ${workspaceId} and ${refSearchDocument} @@ ${tsq}
    )
    select r.id, ${vec ? sql`best.sim, best.time, best.frame_key,` : sql`null::float as sim, null::float as time, null::text as frame_key,`}
           (kw.id is not null) as keyword
    from refs r
    ${vec ? sql`left join best on best.reference_id = r.id` : sql``}
    left join kw on kw.id = r.id
    where ${where} and (${vec ? sql`best.reference_id is not null or ` : sql``}kw.id is not null)
    order by coalesce(${vec ? sql`best.sim` : sql`0`}, 0) + case when kw.id is not null then ${KEYWORD_BOOST}::float8 else 0 end desc, r.created_at desc
    limit 400
  `)) as unknown as { id: string; sim: number | null; time: number | null; frame_key: string | null; keyword: boolean }[];

  const scored = rows.map((r) => ({ ...r, score: (r.sim ?? 0) + (r.keyword ? KEYWORD_BOOST : 0) }));
  const top = scored[0]?.sim ?? 0;
  const cutoff = Math.max(MIN_SIMILARITY, top - RELATIVE_WINDOW);
  const kept = scored.filter((r) => r.keyword || (r.sim ?? 0) >= cutoff).slice(0, q.limit);
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
