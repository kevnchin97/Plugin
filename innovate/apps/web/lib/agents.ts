import "server-only";
import {
  type AgentTask,
  agentTasks,
  and,
  boardItems,
  boards,
  decks,
  desc,
  eq,
  inArray,
  mediaJobs,
  reelItems,
  reels,
  references,
  slides,
} from "@innovate/db";
import {
  AGENT_QUEUE,
  type AgentAction,
  type AgentApplied,
  type AgentJobData,
  agentKindFor,
  type AgentProposal,
  type AgentStep,
  describeAction,
} from "@innovate/shared";
import { openQueue, type QueueHandle } from "@innovate/shared/queue";
import { publish } from "@innovate/shared/realtime";
import { HttpError, notFound } from "./api";
import { getBoard, placeOnBoard } from "./boards";
import { upsertJob } from "./media";
import { saveFromWeb } from "./save";
import { saveExport } from "./save-export";
import { db } from "./server";

declare global {
  var __innovateAgentQueue: QueueHandle<AgentJobData> | undefined;
}
const agentQueue = () =>
  (globalThis.__innovateAgentQueue ??= openQueue<AgentJobData>(AGENT_QUEUE, { attempts: 1, removeOnComplete: { age: 24 * 3600 }, removeOnFail: { age: 7 * 24 * 3600 } }));

/** Agents run on Claude; without a key the UI says so instead of queuing runs that would fail. */
export const agentsEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

type Ctx = { workspaceId: string; userId: string };

export function serializeTask(t: AgentTask) {
  const proposal = (t.proposal ?? null) as AgentProposal | null;
  return {
    id: t.id,
    kind: t.kind,
    prompt: t.prompt,
    status: t.status,
    cancelRequested: t.cancelRequested,
    steps: t.steps as AgentStep[],
    proposal: proposal ? { summary: proposal.summary, actions: proposal.actions.map((a, i) => ({ index: i, description: describeAction(a), action: a })) } : null,
    applied: (t.applied ?? null) as AgentApplied | null,
    error: t.error,
    attempt: t.attempt,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}
export type AgentTaskDTO = ReturnType<typeof serializeTask>;

export async function getTask(workspaceId: string, id: string) {
  const [t] = await db().select().from(agentTasks).where(and(eq(agentTasks.id, id), eq(agentTasks.workspaceId, workspaceId)));
  if (!t) throw notFound("That agent task doesn't exist.");
  return t;
}

export async function listTasks(workspaceId: string, limit = 30) {
  const rows = await db().select().from(agentTasks).where(eq(agentTasks.workspaceId, workspaceId)).orderBy(desc(agentTasks.createdAt)).limit(limit);
  return rows.map(serializeTask);
}

export async function createTask(ctx: Ctx, prompt: string) {
  if (!agentsEnabled()) throw new HttpError(503, "Agents need ANTHROPIC_API_KEY on the server. Ask whoever runs Innovate to add it.");
  const [task] = await db().insert(agentTasks).values({ workspaceId: ctx.workspaceId, userId: ctx.userId, prompt, kind: agentKindFor(prompt) }).returning();
  await agentQueue().add("agent", { taskId: task!.id, workspaceId: ctx.workspaceId }, { jobId: `${task!.id}-1` });
  return task!;
}

export async function cancelTask(workspaceId: string, id: string) {
  const t = await getTask(workspaceId, id);
  if (t.status === "queued") {
    await db().update(agentTasks).set({ status: "cancelled", cancelRequested: true, error: "Cancelled" }).where(eq(agentTasks.id, id));
    await agentQueue().remove(`${id}-${t.attempt}`).catch(() => {});
  } else if (t.status === "running") await db().update(agentTasks).set({ cancelRequested: true }).where(eq(agentTasks.id, id));
  else throw new HttpError(409, "Only a queued or running task can be cancelled.");
}

/** Run the same prompt again from scratch (failed, cancelled, or a proposal you want redone). */
export async function retryTask(workspaceId: string, id: string) {
  const t = await getTask(workspaceId, id);
  if (!["failed", "cancelled", "proposed"].includes(t.status)) throw new HttpError(409, "This task can't be retried right now.");
  const attempt = t.attempt + 1;
  await db().update(agentTasks).set({ status: "queued", cancelRequested: false, steps: [], proposal: null, error: null, attempt }).where(eq(agentTasks.id, id));
  await agentQueue().add("agent", { taskId: id, workspaceId }, { jobId: `${id}-${attempt}` });
}

const emptyApplied = (indices: number[]): AgentApplied => ({ approvedActions: indices, boards: [], boardItems: [], references: [], decks: [], reels: [], pendingExports: [], errors: [] });

async function resolveTarget(ctx: Ctx, target: { boardId: string } | { newBoardTitle: string }, applied: AgentApplied) {
  if ("boardId" in target) {
    await getBoard(ctx.workspaceId, target.boardId);
    return target.boardId;
  }
  const [b] = await db().insert(boards).values({ workspaceId: ctx.workspaceId, title: target.newBoardTitle, createdBy: ctx.userId }).returning({ id: boards.id });
  applied.boards.push(b!.id);
  return b!.id;
}

async function applyAction(ctx: Ctx, a: AgentAction, applied: AgentApplied) {
  const d = db();
  switch (a.type) {
    case "create_board": {
      const boardId = await resolveTarget(ctx, { newBoardTitle: a.title }, applied);
      for (const ref of a.referenceIds) applied.boardItems.push(await placeOnBoard(d, ctx.workspaceId, boardId, ref, ctx.userId, 260));
      for (const [n, text] of a.notes.entries()) {
        const [item] = await d
          .insert(boardItems)
          .values({ workspaceId: ctx.workspaceId, boardId, kind: "note", x: 40 + n * 300, y: 520, w: 280, content: { text }, createdBy: ctx.userId })
          .returning({ id: boardItems.id });
        applied.boardItems.push(item!.id);
      }
      return;
    }
    case "add_to_board":
      await getBoard(ctx.workspaceId, a.boardId);
      for (const ref of a.referenceIds) applied.boardItems.push(await placeOnBoard(d, ctx.workspaceId, a.boardId, ref, ctx.userId, 260));
      return;
    case "save_links": {
      const boardId = await resolveTarget(ctx, a.target, applied);
      for (const p of a.picks) {
        const saved = await saveFromWeb(ctx, { kind: "page", url: p.url, title: p.title, imageUrl: p.thumbnailUrl ?? undefined, note: `Why: ${p.reason}`, boardId });
        applied.references.push(saved.referenceId);
      }
      return;
    }
    case "export_clips": {
      const boardId = await resolveTarget(ctx, a.target, applied);
      for (const r of a.ranges) {
        const request =
          r.kind === "gif"
            ? { kind: "gif" as const, referenceId: a.referenceId, inFrame: r.inFrame, outFrame: r.outFrame, options: { width: 480, fps: 15, loop: "loop" as const, quality: 70 } }
            : { kind: "clip" as const, referenceId: a.referenceId, inFrame: r.inFrame, outFrame: r.outFrame };
        const job = await upsertJob({
          workspaceId: ctx.workspaceId,
          referenceId: a.referenceId,
          type: "export",
          idempotencyKey: `agent-export:${a.referenceId}:${r.kind}:${r.inFrame}-${r.outFrame}:${crypto.randomUUID()}`,
          request,
          createdBy: ctx.userId,
        });
        applied.pendingExports.push({ jobId: job.id, title: r.title, boardId });
      }
      return;
    }
    case "create_deck": {
      const [deck] = await d.insert(decks).values({ workspaceId: ctx.workspaceId, title: a.title, boardId: a.boardId, createdBy: ctx.userId }).returning({ id: decks.id });
      await d
        .insert(slides)
        .values(a.slides.map((s, i) => ({ workspaceId: ctx.workspaceId, deckId: deck!.id, position: (i + 1) * 1024, layout: s.layout, heading: s.heading, body: s.body, mediaIds: s.referenceIds })));
      applied.decks.push(deck!.id);
      return;
    }
    case "create_reel": {
      const [reel] = await d.insert(reels).values({ workspaceId: ctx.workspaceId, title: a.title, titleCard: a.titleCard, endCard: a.endCard, createdBy: ctx.userId }).returning({ id: reels.id });
      await d
        .insert(reelItems)
        .values(a.items.map((it, i) => ({ workspaceId: ctx.workspaceId, reelId: reel!.id, referenceId: it.referenceId, inSec: it.inSec, outSec: it.outSec, position: (i + 1) * 1024 })));
      applied.reels.push(reel!.id);
      return;
    }
  }
}

/**
 * Apply the approved subset of a proposal. Each action is applied independently (one failure is
 * reported, the rest still apply); everything created is recorded for undo. Exports render on
 * the worker and are saved as they finish (`finalizeTask`).
 */
export async function approveTask(ctx: Ctx, id: string, indices: number[]) {
  const t = await getTask(ctx.workspaceId, id);
  if (t.status !== "proposed") throw new HttpError(409, t.status === "applied" || t.status === "applying" ? "This proposal was already applied." : "There's nothing to approve yet.");
  const proposal = t.proposal as AgentProposal;
  const chosen = [...new Set(indices)].filter((i) => i < proposal.actions.length);
  if (!chosen.length) throw new HttpError(400, "Pick at least one change to apply.");
  // Claim the task first so a double click can't apply twice.
  const [claimed] = await db()
    .update(agentTasks)
    .set({ status: "applying" })
    .where(and(eq(agentTasks.id, id), eq(agentTasks.status, "proposed")))
    .returning({ id: agentTasks.id });
  if (!claimed) throw new HttpError(409, "This proposal was already applied.");
  const applied = emptyApplied(chosen);
  for (const i of chosen) {
    try {
      await applyAction(ctx, proposal.actions[i]!, applied);
    } catch (err) {
      applied.errors.push(`${describeAction(proposal.actions[i]!)}: ${(err as Error).message}`);
    }
  }
  await db()
    .update(agentTasks)
    .set({ applied, status: applied.pendingExports.length ? "applying" : "applied" })
    .where(eq(agentTasks.id, id));
  await publish(`agent:${id}`, { type: "activity", entry: { status: "applied" } });
  return finalizeTask(ctx, id);
}

/** Save finished exports onto their boards; mark the task applied once none are pending. Idempotent. */
export async function finalizeTask(ctx: Ctx, id: string) {
  const t = await getTask(ctx.workspaceId, id);
  const applied = t.applied as AgentApplied | null;
  if (t.status !== "applying" || !applied?.pendingExports.length) return t;
  const jobs = await db()
    .select({ id: mediaJobs.id, status: mediaJobs.status, error: mediaJobs.error })
    .from(mediaJobs)
    .where(inArray(mediaJobs.id, applied.pendingExports.map((p) => p.jobId)));
  const pending: AgentApplied["pendingExports"] = [];
  for (const p of applied.pendingExports) {
    const job = jobs.find((j) => j.id === p.jobId);
    if (job?.status === "completed") {
      const saved = await saveExport(ctx, p.jobId, { title: p.title, boardId: p.boardId });
      if (!saved.alreadySaved) {
        applied.references.push(saved.referenceId);
        if (saved.boardItemId) applied.boardItems.push(saved.boardItemId);
      }
    } else if (job?.status === "failed" || !job) applied.errors.push(`Export “${p.title}” failed: ${job?.error ?? "job missing"}`);
    else pending.push(p);
  }
  applied.pendingExports = pending;
  const [row] = await db()
    .update(agentTasks)
    .set({ applied, status: pending.length ? "applying" : "applied" })
    .where(and(eq(agentTasks.id, id), eq(agentTasks.status, "applying")))
    .returning();
  return row ?? t;
}

/**
 * Undo an applied proposal: remove exactly what it created (boards, cards, saved links and
 * exports, decks, reels) plus anything the run imported into the library.
 */
export async function undoTask(ctx: Ctx, id: string) {
  const t = await getTask(ctx.workspaceId, id);
  if (t.status !== "applied" && t.status !== "applying") throw new HttpError(409, "Only an applied proposal can be undone.");
  const a = t.applied as AgentApplied;
  const ws = ctx.workspaceId;
  await db().transaction(async (tx) => {
    if (a.boardItems.length) await tx.delete(boardItems).where(and(eq(boardItems.workspaceId, ws), inArray(boardItems.id, a.boardItems)));
    const refs = [...a.references, ...((t.ingested as string[]) ?? [])];
    if (refs.length) await tx.delete(references).where(and(eq(references.workspaceId, ws), inArray(references.id, refs)));
    if (a.decks.length) await tx.delete(decks).where(and(eq(decks.workspaceId, ws), inArray(decks.id, a.decks)));
    if (a.reels.length) await tx.delete(reels).where(and(eq(reels.workspaceId, ws), inArray(reels.id, a.reels)));
    if (a.boards.length) await tx.delete(boards).where(and(eq(boards.workspaceId, ws), inArray(boards.id, a.boards)));
    await tx.update(agentTasks).set({ status: "undone", applied: { ...a, pendingExports: [] } }).where(eq(agentTasks.id, id));
  });
}
