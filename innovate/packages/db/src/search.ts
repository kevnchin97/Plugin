/**
 * Library search ranking (SPEC §5.6), shared by the web search API and the worker's agents:
 * pgvector cosine similarity between a query's CLIP text embedding and each reference's
 * image/keyframe embeddings (a reference scores as its best keyframe), boosted by a full-text
 * match on title, notes, Claude description and platform. Keywords only when `vector` is null.
 */
import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { refSearchDocument } from "./schema";

export interface RankFilters {
  q: string;
  types: string[];
  boardId?: string;
  source?: "upload" | "web" | "vimeo" | "export";
  from?: string;
  to?: string;
  limit: number;
}
export interface RankedReference {
  id: string;
  sim: number | null;
  time: number | null;
  frame_key: string | null;
  keyword: boolean;
  score: number;
}

/**
 * CLIP similarities for ViT-B/32 sit in a narrow band (unrelated ~0.15–0.2, good matches ~0.25–0.35),
 * so results are cut relative to the best hit, with an absolute floor.
 */
const MIN_SIMILARITY = 0.19;
const RELATIVE_WINDOW = 0.06;
/** A keyword match on title, notes, description or platform is worth this much similarity. */
const KEYWORD_BOOST = 0.05;

function filters(workspaceId: string, q: RankFilters) {
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

export async function rankReferences(db: Db, workspaceId: string, q: RankFilters, vector: number[] | null): Promise<RankedReference[]> {
  const where = filters(workspaceId, q);
  const tsq = sql`websearch_to_tsquery('english', ${q.q})`;
  const vec = vector ? sql`${JSON.stringify(vector)}::vector` : null;

  const rows = (await db.execute(sql`
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
  return kept;
}
