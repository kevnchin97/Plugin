import "server-only";
import { and, asc, desc, eq, inArray, isNull, references, shareLinks, type Shot, shotLists, shots, sql } from "@innovate/db";
import { type ShotPatch, type ShotRow } from "@innovate/shared";
import { publish } from "@innovate/shared/realtime";
import { HttpError, notFound } from "./api";
import { serializeRefLite } from "./boards";
import { db } from "./server";

export const shotListRoom = (id: string) => `shotlist:${id}`;

export async function getShotList(workspaceId: string, id: string) {
  const [list] = await db()
    .select()
    .from(shotLists)
    .where(and(eq(shotLists.id, id), eq(shotLists.workspaceId, workspaceId)));
  if (!list) throw notFound("That shot list doesn't exist in this workspace.");
  return list;
}

export function serializeShot(s: Shot) {
  return {
    id: s.id,
    position: s.position,
    number: s.number,
    scene: s.scene,
    setting: s.setting,
    description: s.description,
    framing: s.framing,
    movement: s.movement,
    lens: s.lens,
    rig: s.rig,
    durationSec: s.durationSec,
    status: s.status,
    motionReferenceId: s.motionReferenceId,
  };
}
export type ShotDTO = ReturnType<typeof serializeShot>;

export async function loadShotList(workspaceId: string, id: string) {
  const list = await getShotList(workspaceId, id);
  const rows = await db().select().from(shots).where(eq(shots.shotListId, id)).orderBy(asc(shots.position), asc(shots.createdAt));
  const refIds = [...new Set(rows.map((r) => r.motionReferenceId).filter((x): x is string => Boolean(x)))];
  const refs = refIds.length ? await db().select().from(references).where(and(eq(references.workspaceId, workspaceId), inArray(references.id, refIds))) : [];
  return {
    list: { id: list.id, title: list.title, boardId: list.boardId, updatedAt: list.updatedAt.toISOString() },
    shots: rows.map(serializeShot),
    references: Object.fromEntries(await Promise.all(refs.map(async (r) => [r.id, await serializeRefLite(r)] as const))),
  };
}
export type ShotListData = Awaited<ReturnType<typeof loadShotList>>;

export async function listShotLists(workspaceId: string) {
  const rows = await db()
    .select({ id: shotLists.id, title: shotLists.title, updatedAt: shotLists.updatedAt, count: sql<number>`(select count(*)::int from shots s where s.shot_list_id = ${shotLists.id})` })
    .from(shotLists)
    .where(eq(shotLists.workspaceId, workspaceId))
    .orderBy(desc(shotLists.updatedAt));
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

async function assertRef(workspaceId: string, refId: string | null | undefined) {
  if (!refId) return;
  const [r] = await db().select({ id: references.id }).from(references).where(and(eq(references.id, refId), eq(references.workspaceId, workspaceId)));
  if (!r) throw new HttpError(404, "That reference doesn't exist in this workspace.");
}

async function touch(listId: string, clientId: string | null, change: { type: "shots"; upsert?: ShotDTO[]; remove?: string[]; references?: Record<string, unknown> }) {
  await db().update(shotLists).set({ updatedAt: new Date() }).where(eq(shotLists.id, listId));
  await publish(shotListRoom(listId), { type: "ops", clientId, ops: change });
}

async function refsFor(workspaceId: string, ids: (string | null)[]) {
  const want = ids.filter((x): x is string => Boolean(x));
  if (!want.length) return {};
  const rows = await db().select().from(references).where(and(eq(references.workspaceId, workspaceId), inArray(references.id, want)));
  return Object.fromEntries(await Promise.all(rows.map(async (r) => [r.id, await serializeRefLite(r)] as const)));
}

export async function createShot(workspaceId: string, listId: string, input: ShotPatch & { id?: string }, clientId: string | null) {
  await getShotList(workspaceId, listId);
  await assertRef(workspaceId, input.motionReferenceId);
  const [last] = await db()
    .select({ position: shots.position, n: sql<number>`count(*) over ()::int` })
    .from(shots)
    .where(eq(shots.shotListId, listId))
    .orderBy(desc(shots.position))
    .limit(1);
  const [row] = await db()
    .insert(shots)
    .values({
      ...input,
      id: input.id,
      workspaceId,
      shotListId: listId,
      position: input.position ?? (last ? last.position + 1024 : 1024),
      number: input.number ?? String((last?.n ?? 0) + 1),
    })
    .returning();
  const dto = serializeShot(row!);
  const refs = await refsFor(workspaceId, [dto.motionReferenceId]);
  await touch(listId, clientId, { type: "shots", upsert: [dto], references: refs });
  return { shot: dto, references: refs };
}

export async function updateShot(workspaceId: string, shotId: string, patch: ShotPatch, clientId: string | null) {
  await assertRef(workspaceId, patch.motionReferenceId);
  const [row] = await db()
    .update(shots)
    .set(patch)
    .where(and(eq(shots.id, shotId), eq(shots.workspaceId, workspaceId)))
    .returning();
  if (!row) throw notFound("Shot not found");
  const dto = serializeShot(row);
  const refs = await refsFor(workspaceId, [dto.motionReferenceId]);
  await touch(row.shotListId, clientId, { type: "shots", upsert: [dto], references: refs });
  return { shot: dto, references: refs };
}

export async function deleteShot(workspaceId: string, shotId: string, clientId: string | null) {
  const [row] = await db()
    .delete(shots)
    .where(and(eq(shots.id, shotId), eq(shots.workspaceId, workspaceId)))
    .returning({ list: shots.shotListId });
  if (!row) throw notFound("Shot not found");
  await touch(row.list, clientId, { type: "shots", remove: [shotId] });
}

/** Where the "motion version" lives for exports: the list's live share link if it has one, else the app. */
export async function motionBaseUrl(workspaceId: string, listId: string) {
  const app = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const [link] = await db()
    .select({ token: shareLinks.token })
    .from(shareLinks)
    .where(
      and(
        eq(shareLinks.workspaceId, workspaceId),
        eq(shareLinks.targetType, "shot_list"),
        eq(shareLinks.targetId, listId),
        isNull(shareLinks.revokedAt),
        sql`(${shareLinks.expiresAt} is null or ${shareLinks.expiresAt} > now())`,
      ),
    )
    .orderBy(desc(shareLinks.createdAt))
    .limit(1);
  return link ? `${app}/s/${link.token}` : `${app}/shotlists/${listId}`;
}

export async function csvRows(workspaceId: string, listId: string): Promise<ShotRow[]> {
  const data = await loadShotList(workspaceId, listId);
  const base = await motionBaseUrl(workspaceId, listId);
  return data.shots.map((s) => ({
    ...s,
    motion: s.motionReferenceId && data.references[s.motionReferenceId] ? { title: data.references[s.motionReferenceId]!.title, url: `${base}#shot-${s.id}` } : null,
  }));
}
