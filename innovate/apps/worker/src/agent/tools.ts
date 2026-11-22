import type Anthropic from "@anthropic-ai/sdk";
import { openQueue } from "@innovate/shared/queue";
import { z } from "zod";
import { agentTasks, and, asc, boardItems, boards, desc, eq, inArray, isNull, mediaJobs, rankReferences, references, scenes, sql } from "@innovate/db";
import { type AgentAction, agentActionSchema, describeAction, MEDIA_QUEUE, type MediaJobData, REFERENCE_TYPES } from "@innovate/shared";
import { adapterFor, vimeoSearch } from "@innovate/shared/adapters";
import { embedTexts } from "../clip";
import { db } from "../context";

/**
 * The agent's tools (SPEC §5.8): Innovate's own operations. Read tools answer from the
 * workspace; `ingest_link` adds a video to the library (what Paste-a-link does); every change to
 * boards or decks is a `propose_*` tool that only records an action for the user to approve.
 */
export interface ToolContext {
  workspaceId: string;
  userId: string | null;
  taskId: string;
  actions: AgentAction[];
  signal: AbortSignal;
}

type ToolDef<S extends z.ZodType> = { name: string; description: string; input: S; run(input: z.infer<S>, ctx: ToolContext): Promise<unknown> };
const tool = <S extends z.ZodType>(t: ToolDef<S>) => t;

async function refsInWorkspace(workspaceId: string, ids: string[]) {
  const want = [...new Set(ids)];
  if (!want.length) return [];
  const rows = await db.select().from(references).where(and(eq(references.workspaceId, workspaceId), inArray(references.id, want)));
  const missing = want.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) throw new Error(`These reference ids aren't in this workspace: ${missing.join(", ")}. Use ids returned by the search or list tools.`);
  return rows;
}

async function assertBoard(workspaceId: string, id: string) {
  const [b] = await db.select({ id: boards.id }).from(boards).where(and(eq(boards.id, id), eq(boards.workspaceId, workspaceId)));
  if (!b) throw new Error(`Board ${id} isn't in this workspace. Use list_boards.`);
}

const refSummary = (r: typeof references.$inferSelect) => ({
  id: r.id,
  title: r.title,
  type: r.type,
  status: r.status,
  durationSec: r.duration,
  fps: r.fpsNum && r.fpsDen ? Math.round((r.fpsNum / r.fpsDen) * 1000) / 1000 : null,
  frameCount: r.frameCount,
  description: r.autoDescription,
  sourceUrl: r.sourceUrl,
  createdAt: r.createdAt.toISOString(),
});

const propose = (type: AgentAction["type"], description: string) =>
  tool({
    name: `propose_${type}`,
    description: `${description} This does NOT change anything: it adds a proposed change that the user reviews and approves. Call it once per change.`,
    input: (agentActionSchema.options.find((o) => o.shape.type.value === type) as unknown as z.ZodObject).omit({ type: true }),
    async run(input, ctx) {
      const action = agentActionSchema.parse({ ...(input as object), type });
      // Validate everything the action points at now, so the proposal can be applied as shown.
      if (action.type === "create_board" || action.type === "add_to_board") await refsInWorkspace(ctx.workspaceId, action.referenceIds);
      if (action.type === "add_to_board") await assertBoard(ctx.workspaceId, action.boardId);
      if ((action.type === "save_links" || action.type === "export_clips") && "boardId" in action.target) await assertBoard(ctx.workspaceId, action.target.boardId);
      if (action.type === "create_deck") {
        await refsInWorkspace(ctx.workspaceId, action.slides.flatMap((s) => s.referenceIds));
        if (action.boardId) await assertBoard(ctx.workspaceId, action.boardId);
      }
      if (action.type === "export_clips") {
        const [ref] = await refsInWorkspace(ctx.workspaceId, [action.referenceId]);
        if (ref!.type !== "video") throw new Error("export_clips needs a video reference (type video).");
        if (ref!.status !== "ready") throw new Error("That video is still processing.");
        const last = (ref!.frameCount ?? 0) - 1;
        const bad = action.ranges.find((r) => r.outFrame > last);
        if (bad) throw new Error(`Range ${bad.inFrame}–${bad.outFrame} runs past the last frame (${last}).`);
        const long = action.ranges.find((r) => r.kind === "gif" && ref!.fpsNum && (r.outFrame - r.inFrame + 1) / (ref!.fpsNum / (ref!.fpsDen ?? 1)) > 60);
        if (long) throw new Error("GIFs are limited to 60 seconds.");
      }
      if (action.type === "create_reel") {
        const rows = await refsInWorkspace(ctx.workspaceId, action.items.map((i) => i.referenceId));
        if (rows.some((r) => r.type !== "video" && r.type !== "clip")) throw new Error("Reels take videos and clips only.");
      }
      ctx.actions.push(action);
      return { proposed: ctx.actions.length - 1, change: describeAction(action), note: "Recorded for the user's approval. Nothing has changed yet." };
    },
  });

export const TOOLS = [
  tool({
    name: "search_library",
    description:
      "Search the workspace library by what things look like (CLIP image search over images and every video scene) plus keywords. Returns references with ids, type, duration and, for videos, the time of the best-matching scene.",
    input: z.object({
      query: z.string().min(1).max(300).describe("A visual description, e.g. 'rain on a windscreen at night, neon reflections'"),
      types: z.array(z.enum(REFERENCE_TYPES)).optional().describe("Only these reference types"),
      board_id: z.uuid().optional().describe("Only references on this board (and boards inside it)"),
      limit: z.number().int().min(1).max(40).optional(),
    }),
    async run(input, ctx) {
      const [vector] = await embedTexts([input.query]);
      const ranked = await rankReferences(db, ctx.workspaceId, { q: input.query, types: input.types ?? [], boardId: input.board_id, limit: input.limit ?? 20 }, vector ?? null);
      const rows = await refsInWorkspace(ctx.workspaceId, ranked.map((r) => r.id)).catch(() => []);
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ranked.map((r) => ({ ...refSummary(byId.get(r.id)!), similarity: r.sim === null ? null : Math.round(r.sim * 1000) / 1000, matchedAtSec: r.time, keywordMatch: r.keyword }));
    },
  }),
  tool({
    name: "list_boards",
    description: "List the workspace's boards (id, title, parent board, number of items).",
    input: z.object({}),
    async run(_input, ctx) {
      return db
        .select({ id: boards.id, title: boards.title, parentBoardId: boards.parentBoardId, items: sql<number>`(select count(*)::int from board_items i where i.board_id = ${boards.id})` })
        .from(boards)
        .where(eq(boards.workspaceId, ctx.workspaceId))
        .orderBy(desc(boards.updatedAt))
        .limit(200);
    },
  }),
  tool({
    name: "get_board",
    description: "The references on a board (id, title, type, duration).",
    input: z.object({ board_id: z.uuid() }),
    async run(input, ctx) {
      await assertBoard(ctx.workspaceId, input.board_id);
      const rows = await db
        .select({ ref: references })
        .from(boardItems)
        .innerJoin(references, eq(references.id, boardItems.referenceId))
        .where(eq(boardItems.boardId, input.board_id))
        .orderBy(asc(boardItems.createdAt));
      return rows.map((r) => refSummary(r.ref));
    },
  }),
  tool({
    name: "recent_uploads",
    description: "The most recent references the user uploaded or saved (newest first), optionally only some types.",
    input: z.object({ count: z.number().int().min(1).max(50), types: z.array(z.enum(REFERENCE_TYPES)).optional(), uploads_only: z.boolean().optional().describe("Only files the user uploaded (not saved from the web or made in the GIF Maker)") }),
    async run(input, ctx) {
      const rows = await db
        .select()
        .from(references)
        .where(
          and(
            eq(references.workspaceId, ctx.workspaceId),
            input.types?.length ? inArray(references.type, input.types) : undefined,
            input.uploads_only ? and(eq(references.sourcePlatform, "upload"), isNull(references.parentReferenceId)) : undefined,
          ),
        )
        .orderBy(desc(references.createdAt))
        .limit(input.count);
      return rows.map(refSummary);
    },
  }),
  tool({
    name: "get_scenes",
    description:
      "Detected scenes (shots) of a video: frame ranges (endFrame exclusive), seconds, and motion (0–1, how much the image changes: whip pans and fast moves score high) and contrast. Use frames from here for propose_export_clips.",
    input: z.object({ reference_id: z.uuid() }),
    async run(input, ctx) {
      const [ref] = await refsInWorkspace(ctx.workspaceId, [input.reference_id]);
      if (ref!.type !== "video") throw new Error("Scenes exist only for videos.");
      const rows = await db.select().from(scenes).where(eq(scenes.referenceId, ref!.id)).orderBy(asc(scenes.index)).limit(300);
      return {
        reference: refSummary(ref!),
        scenes: rows.map((s) => ({ index: s.index, startFrame: s.startFrame, endFrame: s.endFrame, startSec: s.start, endSec: s.end, motion: Math.round(s.motion * 100) / 100, contrast: Math.round(s.contrast * 100) / 100 })),
      };
    },
  }),
  tool({
    name: "search_vimeo",
    description: "Search Vimeo through its official API. Returns public videos: url, title, author, duration, description, thumbnail. Searching saves nothing.",
    input: z.object({ query: z.string().min(1).max(200), count: z.number().int().min(1).max(25).optional() }),
    async run(input) {
      const vimeo = vimeoSearch(process.env);
      if (!vimeo) throw new Error("Vimeo search isn't configured on this server (VIMEO_ACCESS_TOKEN). Tell the user.");
      return vimeo.search(input.query, input.count ?? 12);
    },
  }),
  tool({
    name: "ingest_link",
    description:
      "Import a video link into the user's library (like pasting it into the GIF Maker) and wait until it's processed, so you can read its scenes. Works for direct video files and enabled platforms (Vimeo). Returns the new reference id. It goes to the library only, never onto a board.",
    input: z.object({ url: z.url({ protocol: /^https?$/ }) }),
    async run(input, ctx) {
      const u = new URL(input.url);
      const adapter = adapterFor(u);
      if (!adapter && !/\.(mp4|mov|m4v|webm|mkv)$/i.test(u.pathname)) throw new Error("Only direct video files and enabled platforms (Vimeo) can be imported.");
      const [ref] = await db
        .insert(references)
        .values({ workspaceId: ctx.workspaceId, type: "video", status: "processing", stage: "fetching", title: "Untitled", sourceUrl: input.url, sourcePlatform: adapter?.id ?? "direct", createdBy: ctx.userId })
        .returning();
      const [job] = await db.insert(mediaJobs).values({ workspaceId: ctx.workspaceId, referenceId: ref!.id, type: "ingest", idempotencyKey: `ingest:${ref!.id}`, createdBy: ctx.userId }).returning();
      await db.update(agentTasks).set({ ingested: sql`${agentTasks.ingested} || ${JSON.stringify([ref!.id])}::jsonb` }).where(eq(agentTasks.id, ctx.taskId));
      const q = openQueue<MediaJobData>(MEDIA_QUEUE);
      await q.add("ingest", { type: "ingest", jobId: job!.id, referenceId: ref!.id, workspaceId: ctx.workspaceId }, { jobId: job!.id, attempts: 2 });
      await q.close();
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline && !ctx.signal.aborted) {
        const [r] = await db.select().from(references).where(eq(references.id, ref!.id));
        if (r?.status === "ready") return { ...refSummary(r), note: "Imported. Call get_scenes for its shots." };
        if (r?.status === "failed") throw new Error(`Import failed: ${r.error ?? "unknown error"}`);
        await new Promise((res) => setTimeout(res, 1500));
      }
      throw new Error("Import is taking too long; it continues in the background.");
    },
  }),
  propose("create_board", "Propose a new board holding these library references (and optional text notes)."),
  propose("add_to_board", "Propose adding library references to an existing board."),
  propose("save_links", "Propose saving web links (e.g. a Vimeo shortlist) as references on a board, each with a one-line reason the user will see."),
  propose("export_clips", "Propose exporting GIFs or clips from frame ranges of a video (use get_scenes for exact frames) onto a board."),
  propose("create_deck", "Propose a treatment or pitch deck. Layouts: title, text, media, media-text, grid. Use referenceIds for media."),
];

const byName = new Map(TOOLS.map((t) => [t.name, t as ToolDef<z.ZodType>]));

/** Tool definitions for the Messages API (JSON Schema from the same zod schemas that validate inputs). */
export const TOOL_PARAMS: Anthropic.Beta.BetaTool[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: z.toJSONSchema(t.input, { io: "input" }) as Anthropic.Beta.BetaTool["input_schema"],
}));

/** Run one tool call; errors come back as readable messages the model can act on. */
export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const t = byName.get(name);
  if (!t) return { ok: false, error: `Unknown tool ${name}.` };
  const parsed = t.input.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: `Invalid input: ${z.prettifyError(parsed.error)}` };
  try {
    return { ok: true, value: await t.run(parsed.data, ctx) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
