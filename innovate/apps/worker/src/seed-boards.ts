/**
 * Demo boards (SPEC §9) built from the generated demo film: stills and GIFs are cut with the
 * real export code, saved as references linked to the film, and laid out on boards.
 * Idempotent: re-running replaces the seeded boards and their extracts.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, boardItems, boards, eq, inArray, references } from "@innovate/db";
import { exportGif, exportStill, type SourceInfo } from "@innovate/media";
import { frameToSeconds } from "@innovate/shared";
import { db, storage } from "./context";

export const SEED_BOARDS = ["Night Exteriors", "Handheld Intimacy", "Commercial: Winter Ad"] as const;

interface Extract {
  key: string;
  kind: "still" | "gif";
  title: string;
  inFrame: number;
  outFrame?: number;
}

const EXTRACTS: Extract[] = [
  { key: "dusk", kind: "still", title: "Dusk falloff", inFrame: 30 },
  { key: "neon", kind: "gif", title: "Neon sweep", inFrame: 100, outFrame: 135 },
  { key: "cells", kind: "gif", title: "Cells, amber on violet", inFrame: 170, outFrame: 205 },
  { key: "pushin", kind: "gif", title: "Slow push-in", inFrame: 245, outFrame: 290 },
  { key: "fractal", kind: "still", title: "Fractal edge", inFrame: 300 },
  { key: "ember", kind: "still", title: "Ember glow", inFrame: 355 },
];

export async function seedBoards(opts: { workspaceId: string; userId: string; filmId: string }) {
  const d = db;
  const [film] = await d.select().from(references).where(eq(references.id, opts.filmId));
  if (!film?.originalKey || !film.fpsNum || !film.fpsDen || !film.width || !film.height) throw new Error("Demo film isn't ingested yet.");
  const src: SourceInfo = { fps: { num: film.fpsNum, den: film.fpsDen }, width: film.width, height: film.height, hasAudio: false, videoStartOffset: film.videoStartOffset ?? 0 };

  // Replace earlier seeds.
  const old = await d.select({ id: boards.id }).from(boards).where(and(eq(boards.workspaceId, opts.workspaceId), inArray(boards.title, [...SEED_BOARDS])));
  if (old.length) await d.delete(boards).where(inArray(boards.id, old.map((b) => b.id)));
  await d.delete(references).where(and(eq(references.parentReferenceId, film.id), eq(references.sourcePlatform, "seed")));

  const work = await mkdtemp(join(tmpdir(), "innovate-seed-"));
  const local = join(work, "film.mp4");
  await storage.downloadFile(film.originalKey, local);
  const refIds: Record<string, string> = {};
  try {
    for (const x of EXTRACTS) {
      const id = crypto.randomUUID();
      const ext = x.kind === "still" ? "jpg" : "gif";
      const out = join(work, `${x.key}.${ext}`);
      let w = src.width;
      let h = src.height;
      if (x.kind === "still") await exportStill(local, out, x.inFrame, src, "jpg");
      else {
        const p = await exportGif(local, join(work, `${x.key}-pal.png`), out, { inFrame: x.inFrame, outFrame: x.outFrame! }, src, { width: 480, fps: 15, loop: "loop", quality: 70 });
        w = p.width;
        h = p.height;
      }
      const key = `ws/${opts.workspaceId}/ref/${id}/original.${ext}`;
      const bytes = await storage.uploadFile(key, out, x.kind === "still" ? "image/jpeg" : "image/gif");
      const sourceIn = frameToSeconds(x.inFrame, src.fps);
      const sourceOut = frameToSeconds((x.outFrame ?? x.inFrame) + 1, src.fps);
      await d.insert(references).values({
        id,
        workspaceId: opts.workspaceId,
        type: x.kind,
        status: "ready",
        stage: "ready",
        title: x.title,
        originalKey: key,
        thumbnailKey: key,
        contentType: x.kind === "still" ? "image/jpeg" : "image/gif",
        bytes,
        width: w,
        height: h,
        duration: x.kind === "gif" ? sourceOut - sourceIn : 0,
        fpsNum: film.fpsNum,
        fpsDen: film.fpsDen,
        sourceIn,
        sourceOut,
        sourcePlatform: "seed",
        parentReferenceId: film.id,
        createdBy: opts.userId,
      });
      refIds[x.key] = id;
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  const mkBoard = async (title: string, parentBoardId: string | null = null) => {
    const [b] = await d.insert(boards).values({ workspaceId: opts.workspaceId, title, parentBoardId, createdBy: opts.userId }).returning({ id: boards.id });
    return b!.id;
  };
  type Item = Omit<typeof boardItems.$inferInsert, "workspaceId" | "boardId">;
  const put = (boardId: string, list: Item[]) =>
    d.insert(boardItems).values(list.map((i, n) => ({ z: n + 1, createdBy: opts.userId, ...i, workspaceId: opts.workspaceId, boardId })));
  const ref = (k: string, x: number, y: number, w = 260, extra: Partial<Item> = {}): Item => ({ id: crypto.randomUUID(), kind: "reference", referenceId: refIds[k]!, x, y, w, ...extra });

  // Commercial: Winter Ad, with a nested Locations board.
  const winter = await mkBoard("Commercial: Winter Ad");
  const locations = await mkBoard("Locations", winter);
  const light = crypto.randomUUID();
  const motion = crypto.randomUUID();
  const tone = crypto.randomUUID();
  const hero = crypto.randomUUID();
  await put(winter, [
    { id: light, kind: "column", x: 40, y: 40, w: 252, content: { title: "Light & mood" } },
    ref("dusk", 0, 0, 236, { columnId: light, position: 1024 }),
    { id: crypto.randomUUID(), kind: "note", columnId: light, position: 2048, x: 0, y: 0, w: 236, content: { text: "Practicals only\nTungsten in frame, let the windows go blue. No fill on faces after sundown." } },
    ref("ember", 0, 0, 236, { columnId: light, position: 3072 }),
    { id: motion, kind: "column", x: 316, y: 40, w: 252, content: { title: "Movement" } },
    ref("neon", 0, 0, 236, { columnId: motion, position: 1024 }),
    ref("cells", 0, 0, 236, { columnId: motion, position: 2048 }),
    { id: tone, kind: "note", x: 600, y: 48, w: 300, content: { text: "Tone\nQuiet, cold, a little lonely.\nWarmth only from practicals.\nHold shots longer than feels safe." } },
    { ...ref("pushin", 960, 200, 340), id: hero },
    { id: crypto.randomUUID(), kind: "arrow", x: 0, y: 0, w: 80, content: { from: tone, to: hero } },
    { id: crypto.randomUUID(), kind: "board", childBoardId: locations, x: 600, y: 260, w: 220 },
    { id: crypto.randomUUID(), kind: "link", x: 600, y: 470, w: 240, content: { url: "https://example.com/journal/night-drive-lighting", host: "example.com", title: "Night drive lighting notes" } },
  ]);
  await put(locations, [ref("fractal", 40, 40, 300), ref("dusk", 380, 40, 300), { id: crypto.randomUUID(), kind: "note", x: 40, y: 280, w: 300, content: { text: "Recce shortlist\nRidge road, the closed petrol station, the lake car park." } }]);

  const night = await mkBoard("Night Exteriors");
  await put(night, [ref("ember", 40, 40, 320), ref("neon", 390, 40, 320), ref("cells", 740, 40, 320), { id: crypto.randomUUID(), kind: "note", x: 40, y: 260, w: 320, content: { text: "Exposure\nPush the blacks; protect the highlights on practicals." } }]);

  const handheld = await mkBoard("Handheld Intimacy");
  const close = crypto.randomUUID();
  await put(handheld, [
    { id: close, kind: "column", x: 40, y: 40, w: 252, content: { title: "Close-ups" } },
    ref("pushin", 0, 0, 236, { columnId: close, position: 1024 }),
    ref("fractal", 0, 0, 236, { columnId: close, position: 2048 }),
    { id: crypto.randomUUID(), kind: "note", x: 330, y: 40, w: 280, content: { text: "Breathing camera\nShoulder rig, 35mm, stay within arm's reach." } },
  ]);
  return { winter, night, handheld, locations };
}
