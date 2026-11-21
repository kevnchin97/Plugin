import "server-only";
import {
  and,
  asc,
  boardItems,
  boards,
  boardVisits,
  type Db,
  desc,
  eq,
  inArray,
  isNull,
  type Reference,
  references,
  sql,
} from "@innovate/db";
import type { BoardOps } from "@innovate/shared";
import { HttpError, notFound } from "./api";
import { db, storage } from "./server";

/** Cheap DTO for grids and boards: no per-item queries, just signed URLs. */
export async function serializeRefLite(ref: Reference) {
  const s = storage();
  const isMotionOrImage = ref.type !== "video" && ref.type !== "link" && ref.type !== "note";
  return {
    id: ref.id,
    type: ref.type,
    title: ref.title,
    status: ref.status,
    width: ref.width,
    height: ref.height,
    duration: ref.duration,
    fps: ref.fpsNum && ref.fpsDen ? { num: ref.fpsNum, den: ref.fpsDen } : null,
    hasAudio: Boolean(ref.hasAudio),
    parentReferenceId: ref.parentReferenceId,
    sourceIn: ref.sourceIn,
    sourceOut: ref.sourceOut,
    sourceUrl: ref.sourceUrl,
    createdAt: ref.createdAt.toISOString(),
    thumbnailUrl: ref.thumbnailKey ? await s.signedGetUrl(ref.thumbnailKey) : null,
    mediaUrl: isMotionOrImage && ref.originalKey ? await s.signedGetUrl(ref.originalKey) : null,
  };
}
export type RefLite = Awaited<ReturnType<typeof serializeRefLite>>;

export async function getBoard(workspaceId: string, id: string) {
  const [board] = await db()
    .select()
    .from(boards)
    .where(and(eq(boards.id, id), eq(boards.workspaceId, workspaceId)));
  if (!board) throw notFound("That board doesn't exist in this workspace.");
  return board;
}

export async function breadcrumbs(workspaceId: string, boardId: string) {
  const trail: { id: string; title: string }[] = [];
  let current: string | null = boardId;
  for (let depth = 0; current && depth < 32; depth++) {
    const [b] = await db()
      .select({ id: boards.id, title: boards.title, parent: boards.parentBoardId })
      .from(boards)
      .where(and(eq(boards.id, current), eq(boards.workspaceId, workspaceId)));
    if (!b) break;
    trail.unshift({ id: b.id, title: b.title });
    current = b.parent;
  }
  return trail;
}

/** Up to four thumbnails per board, for board-card covers. */
export async function boardCovers(workspaceId: string, boardIds: string[]) {
  const covers = new Map<string, { urls: string[]; count: number }>();
  if (!boardIds.length) return covers;
  const rows = await db()
    .select({ boardId: boardItems.boardId, thumb: references.thumbnailKey, created: boardItems.createdAt })
    .from(boardItems)
    .leftJoin(references, eq(references.id, boardItems.referenceId))
    .where(and(eq(boardItems.workspaceId, workspaceId), inArray(boardItems.boardId, boardIds)))
    .orderBy(asc(boardItems.createdAt));
  for (const id of boardIds) covers.set(id, { urls: [], count: 0 });
  for (const r of rows) {
    const c = covers.get(r.boardId)!;
    c.count++;
    if (r.thumb && c.urls.length < 4) c.urls.push(await storage().signedGetUrl(r.thumb));
  }
  return covers;
}

export async function loadBoard(workspaceId: string, boardId: string, userId: string | null) {
  const d = db();
  const board = await getBoard(workspaceId, boardId);
  const items = await d
    .select()
    .from(boardItems)
    .where(and(eq(boardItems.boardId, boardId), eq(boardItems.workspaceId, workspaceId)))
    .orderBy(asc(boardItems.z), asc(boardItems.createdAt));
  const refIds = [...new Set(items.map((i) => i.referenceId).filter((x): x is string => Boolean(x)))];
  const refRows = refIds.length ? await d.select().from(references).where(and(eq(references.workspaceId, workspaceId), inArray(references.id, refIds))) : [];
  const parentIds = [...new Set(refRows.map((r) => r.parentReferenceId).filter((x): x is string => Boolean(x)))];
  const parents = parentIds.length
    ? await d.select({ id: references.id, title: references.title }).from(references).where(inArray(references.id, parentIds))
    : [];
  const childIds = items.map((i) => i.childBoardId).filter((x): x is string => Boolean(x));
  const [childBoards, covers, trail] = await Promise.all([
    childIds.length ? d.select().from(boards).where(inArray(boards.id, childIds)) : Promise.resolve([]),
    boardCovers(workspaceId, childIds),
    breadcrumbs(workspaceId, boardId),
  ]);
  if (userId)
    await d
      .insert(boardVisits)
      .values({ userId, boardId })
      .onConflictDoUpdate({ target: [boardVisits.userId, boardVisits.boardId], set: { visitedAt: new Date() } });
  return {
    board: { id: board.id, title: board.title, view: board.view, parentBoardId: board.parentBoardId, isHome: board.isHome, updatedAt: board.updatedAt.toISOString() },
    breadcrumbs: trail,
    items: items.map((i) => ({
      id: i.id,
      kind: i.kind,
      referenceId: i.referenceId,
      childBoardId: i.childBoardId,
      columnId: i.columnId,
      x: i.x,
      y: i.y,
      w: i.w,
      z: i.z,
      position: i.position,
      content: i.content,
    })),
    references: Object.fromEntries(await Promise.all(refRows.map(async (r) => [r.id, await serializeRefLite(r)] as const))),
    parents: Object.fromEntries(parents.map((p) => [p.id, p.title])),
    childBoards: Object.fromEntries(
      childBoards.map((b) => [b.id, { id: b.id, title: b.title, cover: covers.get(b.id)?.urls ?? [], count: covers.get(b.id)?.count ?? 0 }]),
    ),
  };
}
export type BoardData = Awaited<ReturnType<typeof loadBoard>>;
export type BoardItemDTO = BoardData["items"][number];

/** Apply a batch of creates/updates/deletes atomically, scoped to the workspace. */
export async function applyOps(workspaceId: string, boardId: string, ops: BoardOps, userId: string) {
  await getBoard(workspaceId, boardId);
  const d = db();
  // Every board and reference mentioned must belong to this workspace.
  const boardIds = [...new Set([...ops.update.map((u) => u.boardId), ...ops.create.map((c) => c.childBoardId)].filter((x): x is string => Boolean(x)))];
  if (boardIds.length) {
    const found = await d.select({ id: boards.id }).from(boards).where(and(eq(boards.workspaceId, workspaceId), inArray(boards.id, boardIds)));
    if (found.length !== boardIds.length) throw new HttpError(404, "One of those boards doesn't exist in this workspace.");
  }
  const refIds = [...new Set(ops.create.map((c) => c.referenceId).filter((x): x is string => Boolean(x)))];
  if (refIds.length) {
    const found = await d.select({ id: references.id }).from(references).where(and(eq(references.workspaceId, workspaceId), inArray(references.id, refIds)));
    if (found.length !== refIds.length) throw new HttpError(404, "One of those references doesn't exist in this workspace.");
  }

  await d.transaction(async (tx) => {
    for (const c of ops.create) {
      let childBoardId = c.childBoardId ?? null;
      if (c.kind === "board" && !childBoardId) {
        const [child] = await tx
          .insert(boards)
          .values({ workspaceId, parentBoardId: boardId, title: c.newBoardTitle ?? "Untitled board", createdBy: userId })
          .returning({ id: boards.id });
        childBoardId = child!.id;
      }
      await tx.insert(boardItems).values({
        id: c.id,
        workspaceId,
        boardId,
        kind: c.kind,
        referenceId: c.referenceId ?? null,
        childBoardId,
        columnId: c.columnId ?? null,
        x: c.x,
        y: c.y,
        w: c.w,
        z: c.z,
        position: c.position,
        content: c.content,
        createdBy: userId,
      });
    }
    for (const u of ops.update) {
      const { id, ...patch } = u;
      const moved = patch.boardId && patch.boardId !== boardId;
      await tx
        .update(boardItems)
        .set(moved ? { ...patch, columnId: patch.columnId ?? null } : patch)
        .where(and(eq(boardItems.id, id), eq(boardItems.workspaceId, workspaceId)));
      if (moved) {
        // A column carries its cards; arrows don't survive leaving the board.
        await tx.update(boardItems).set({ boardId: patch.boardId }).where(and(eq(boardItems.columnId, id), eq(boardItems.workspaceId, workspaceId)));
        await tx
          .delete(boardItems)
          .where(and(eq(boardItems.boardId, boardId), eq(boardItems.kind, "arrow"), sql`(${boardItems.content}->>'from' = ${id} or ${boardItems.content}->>'to' = ${id})`));
      }
    }
    if (ops.delete.length) {
      const doomed = await tx
        .select()
        .from(boardItems)
        .where(and(eq(boardItems.workspaceId, workspaceId), eq(boardItems.boardId, boardId), inArray(boardItems.id, ops.delete)));
      // Deleting a column releases its cards onto the canvas where the column was.
      for (const col of doomed.filter((i) => i.kind === "column")) {
        const kids = await tx.select().from(boardItems).where(eq(boardItems.columnId, col.id)).orderBy(asc(boardItems.position));
        for (const [n, k] of kids.entries())
          await tx.update(boardItems).set({ columnId: null, x: col.x + 12, y: col.y + 40 + n * 24, z: col.z + 1 + n }).where(eq(boardItems.id, k.id));
      }
      await tx.delete(boardItems).where(and(eq(boardItems.workspaceId, workspaceId), eq(boardItems.boardId, boardId), inArray(boardItems.id, ops.delete)));
      for (const id of ops.delete)
        await tx
          .delete(boardItems)
          .where(and(eq(boardItems.boardId, boardId), eq(boardItems.kind, "arrow"), sql`(${boardItems.content}->>'from' = ${id} or ${boardItems.content}->>'to' = ${id})`));
      // Deleting a board card deletes the board it opens (and, by cascade, its items).
      const childBoards = doomed.map((i) => i.childBoardId).filter((x): x is string => Boolean(x));
      if (childBoards.length) await tx.delete(boards).where(and(eq(boards.workspaceId, workspaceId), inArray(boards.id, childBoards)));
    }
    await tx.update(boards).set({ updatedAt: new Date() }).where(eq(boards.id, boardId));
  });
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Put a reference on a board below everything else (used by "Save to board" and uploads). */
/** Where a new card goes: to the right of everything loose on the board (top-aligned), wrapping when wide. */
async function nextSpot(tx: Db | Tx, boardId: string) {
  // The server doesn't know rendered card heights, so place new cards to the right of everything
  // loose on the board, wrapping to a new band once the board gets wide.
  const loose = await tx
    .select({ x: boardItems.x, y: boardItems.y, w: boardItems.w, z: boardItems.z })
    .from(boardItems)
    .where(and(eq(boardItems.boardId, boardId), sql`${boardItems.columnId} is null`, sql`${boardItems.kind} <> 'arrow'`));
  const maxZ = Math.max(0, ...loose.map((i) => i.z));
  const bandTop = loose.length ? Math.max(...loose.map((i) => i.y)) : 40;
  const band = loose.filter((i) => i.y >= bandTop - 400);
  let x = band.length ? Math.max(...band.map((i) => i.x + i.w)) + 32 : 40;
  let y = band.length ? Math.min(...band.map((i) => i.y)) : 40;
  if (x > 2200) {
    x = 40;
    y = bandTop + 520;
  }
  return { x: Math.round(x), y: Math.round(y), z: maxZ + 1 };
}

export async function placeOnBoard(tx: Db | Tx, workspaceId: string, boardId: string, referenceId: string, userId: string, width = 240) {
  const [b] = await tx.select({ id: boards.id }).from(boards).where(and(eq(boards.id, boardId), eq(boards.workspaceId, workspaceId)));
  if (!b) throw new HttpError(404, "That board doesn't exist in this workspace.");
  const spot = await nextSpot(tx, boardId);
  const [item] = await tx
    .insert(boardItems)
    .values({ workspaceId, boardId, kind: "reference", referenceId, ...spot, w: width, createdBy: userId })
    .returning({ id: boardItems.id });
  await tx.update(boards).set({ updatedAt: new Date() }).where(eq(boards.id, boardId));
  return item!.id;
}

/** Create a board as a card on its parent board (Home when none is given). */
export async function createBoardOn(workspaceId: string, userId: string, title: string, parentBoardId?: string | null, placeCard = true) {
  const parent = parentBoardId ? await getBoard(workspaceId, parentBoardId) : await homeBoard(workspaceId, userId);
  return db().transaction(async (tx) => {
    const [board] = await tx.insert(boards).values({ workspaceId, title, parentBoardId: parent.id, createdBy: userId }).returning();
    if (!placeCard) return board!;
    const spot = await nextSpot(tx, parent.id);
    await tx.insert(boardItems).values({ workspaceId, boardId: parent.id, kind: "board", childBoardId: board!.id, ...spot, w: 200, createdBy: userId });
    return board!;
  });
}

/**
 * The workspace's Home board (Milanote-style: the app opens on a board, and every top-level board
 * is a card on it). Created on first use; boards with no parent (made before Home existed, or by
 * the agent, text-to-save or the API) are adopted onto it as board cards. Idempotent and safe to
 * call concurrently (row lock on Home while adopting).
 */
export async function homeBoard(workspaceId: string, userId: string | null) {
  const d = db();
  const find = async () => (await d.select().from(boards).where(and(eq(boards.workspaceId, workspaceId), eq(boards.isHome, true))))[0];
  let home = await find();
  if (!home) {
    await d.insert(boards).values({ workspaceId, title: "Home", isHome: true, createdBy: userId }).onConflictDoNothing();
    home = (await find())!;
  }
  const orphan = and(eq(boards.workspaceId, workspaceId), isNull(boards.parentBoardId), eq(boards.isHome, false));
  const [any] = await d.select({ id: boards.id }).from(boards).where(orphan).limit(1);
  if (any) {
    await d.transaction(async (tx) => {
      await tx.select({ id: boards.id }).from(boards).where(eq(boards.id, home.id)).for("update");
      const orphans = await tx.select({ id: boards.id }).from(boards).where(orphan).orderBy(asc(boards.createdAt));
      if (!orphans.length) return;
      const loose = await tx
        .select({ y: boardItems.y, z: boardItems.z })
        .from(boardItems)
        .where(and(eq(boardItems.boardId, home.id), sql`${boardItems.columnId} is null`));
      const top = loose.length ? Math.max(...loose.map((i) => i.y)) + 240 : 40;
      const z = Math.max(0, ...loose.map((i) => i.z));
      await tx.insert(boardItems).values(
        orphans.map((b, i) => ({ workspaceId, boardId: home.id, kind: "board" as const, childBoardId: b.id, x: 40 + (i % 6) * 232, y: top + Math.floor(i / 6) * 220, w: 200, z: z + i + 1, createdBy: userId })),
      );
      await tx.update(boards).set({ parentBoardId: home.id }).where(inArray(boards.id, orphans.map((b) => b.id)));
    });
  }
  return home;
}

/** References on no board yet: the Unsorted tray. */
export async function unsorted(workspaceId: string, limit = 100) {
  const rows = await db()
    .select()
    .from(references)
    .where(
      and(
        eq(references.workspaceId, workspaceId),
        sql`not exists (select 1 from ${boardItems} bi where bi.reference_id = ${references.id})`,
      ),
    )
    .orderBy(desc(references.createdAt))
    .limit(limit);
  return Promise.all(rows.map(serializeRefLite));
}

export async function listBoards(workspaceId: string, userId: string) {
  const d = db();
  const all = await d.select().from(boards).where(eq(boards.workspaceId, workspaceId)).orderBy(desc(boards.updatedAt));
  const visits = await d
    .select({ boardId: boardVisits.boardId, at: boardVisits.visitedAt })
    .from(boardVisits)
    .where(eq(boardVisits.userId, userId))
    .orderBy(desc(boardVisits.visitedAt))
    .limit(6);
  const covers = await boardCovers(workspaceId, all.map((b) => b.id));
  const dto = (b: (typeof all)[number]) => ({
    id: b.id,
    title: b.title,
    parentBoardId: b.parentBoardId,
    updatedAt: b.updatedAt.toISOString(),
    cover: covers.get(b.id)?.urls ?? [],
    count: covers.get(b.id)?.count ?? 0,
  });
  const byId = new Map(all.map((b) => [b.id, b]));
  return {
    top: all.filter((b) => !b.isHome && (!b.parentBoardId || byId.get(b.parentBoardId)?.isHome)).map(dto),
    recent: visits.map((v) => byId.get(v.boardId)).filter((b): b is (typeof all)[number] => Boolean(b)).map(dto),
    all: all.map((b) => ({ id: b.id, title: b.title, parentBoardId: b.parentBoardId, isHome: b.isHome })),
  };
}
export type BoardsList = Awaited<ReturnType<typeof listBoards>>;
