/**
 * Demo boards (SPEC §9) built from the generated demo film: stills and GIFs are cut with the
 * real export code, saved as references linked to the film, and laid out on boards.
 * Idempotent: re-running replaces the seeded boards and their extracts.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, boardItems, boards, decks, eq, inArray, references, shotLists, shots, slides } from "@innovate/db";
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
  await put(night, [ref("ember", 40, 40, 320), ref("neon", 390, 40, 320), ref("cells", 740, 40, 320), { id: crypto.randomUUID(), kind: "note", x: 40, y: 300, w: 320, content: { text: "Exposure\nPush the blacks; protect the highlights on practicals." } }]);

  const handheld = await mkBoard("Handheld Intimacy");
  const close = crypto.randomUUID();
  await put(handheld, [
    { id: close, kind: "column", x: 40, y: 40, w: 252, content: { title: "Close-ups" } },
    ref("pushin", 0, 0, 236, { columnId: close, position: 1024 }),
    ref("fractal", 0, 0, 236, { columnId: close, position: 2048 }),
    { id: crypto.randomUUID(), kind: "note", x: 330, y: 40, w: 280, content: { text: "Breathing camera\nShoulder rig, 35mm, stay within arm's reach." } },
  ]);
  // A shot list with motion references (SPEC §9).
  await d.delete(shotLists).where(and(eq(shotLists.workspaceId, opts.workspaceId), eq(shotLists.title, "Commercial: Winter Ad, day 1")));
  const [list] = await d.insert(shotLists).values({ workspaceId: opts.workspaceId, title: "Commercial: Winter Ad, day 1", boardId: winter, createdBy: opts.userId }).returning({ id: shotLists.id });
  const plan: (Omit<typeof shots.$inferInsert, "workspaceId" | "shotListId" | "position"> & { ref?: string })[] = [
    { number: "1", scene: "1", setting: "Ridge road, dusk", description: "Car crests the ridge; sun drops behind the hills. Hold on the empty road after it passes.", framing: "EWS", movement: "Locked off", lens: "24mm", rig: "Sticks", durationSec: 8, status: "approved", ref: "dusk" },
    { number: "2", scene: "1", setting: "Ridge road, dusk", description: "Headlights sweep across frame as the car turns towards camera.", framing: "WS", movement: "Slow pan", lens: "35mm", rig: "Sticks", durationSec: 4, status: "approved", ref: "neon" },
    { number: "3", scene: "2", setting: "Cabin interior", description: "She lights the stove; tungsten bloom fills the room.", framing: "MS", movement: "Handheld drift", lens: "50mm", rig: "Shoulder", durationSec: 5, status: "planned", ref: "ember" },
    { number: "4", scene: "2", setting: "Cabin interior", description: "Slow push-in on the frosted window, cold blue outside.", framing: "CU", movement: "Push-in", lens: "85mm", rig: "Dolly", durationSec: 6, status: "planned", ref: "pushin" },
    { number: "5", scene: "3", setting: "Lake car park", description: "Snow catches the light; abstract texture for the logo reveal.", framing: "Insert", movement: "Static", lens: "100mm macro", rig: "Slider", durationSec: 3, status: "idea", ref: "cells" },
  ];
  await d.insert(shots).values(
    plan.map(({ ref: k, ...p }, i) => ({ ...p, workspaceId: opts.workspaceId, shotListId: list!.id, position: (i + 1) * 1024, motionReferenceId: k ? refIds[k] : null })),
  );
  // SPEC §8: a treatment deck, drafted from the Winter Ad board.
  const DECK = "Commercial: Winter Ad, treatment";
  await d.delete(decks).where(and(eq(decks.workspaceId, opts.workspaceId), eq(decks.title, DECK)));
  const [deck] = await d.insert(decks).values({ workspaceId: opts.workspaceId, title: DECK, boardId: winter, createdBy: opts.userId }).returning({ id: decks.id });
  const r = (k: string) => refIds[k]!;
  const deckSlides: { layout: (typeof slides.$inferInsert)["layout"]; section: string; heading: string; body: string; media?: string[] }[] = [
    { layout: "title", section: "title", heading: "Winter Ad", body: "Treatment · 60 s and 30 s", media: [r("dusk")] },
    { layout: "text", section: "logline", heading: "Logline", body: "A night-shift nurse drives home through the first snow of the year and finds, for once, that the whole town is quiet enough to hear." },
    { layout: "media-text", section: "tone", heading: "Tone", body: "Quiet, cold, a little lonely. Warmth only from practicals. Hold every shot longer than feels safe.", media: [r("ember")] },
    { layout: "grid", section: "look", heading: "Look and feel", body: "Tungsten practicals against blue windows. Grain kept, blacks pushed, highlights protected.", media: [r("dusk"), r("neon"), r("cells"), r("ember")] },
    { layout: "media-text", section: "characters", heading: "Characters", body: "Mara, 40s. Tired, kind, alone with the radio. We see her mostly through glass.", media: [r("fractal")] },
    { layout: "grid", section: "locations", heading: "Locations", body: "The ridge road, the closed petrol station, the lake car park.", media: [r("fractal"), r("dusk")] },
    { layout: "media-text", section: "shots", heading: "Shot approach", body: "Slow push-ins, locked-off wides, one handheld moment at the lake. Motion references play in the live deck.", media: [r("pushin"), r("neon")] },
    { layout: "media", section: "", heading: "The first snow", body: "", media: [r("neon")] },
  ];
  await d.insert(slides).values(
    deckSlides.map((s, i) => ({ workspaceId: opts.workspaceId, deckId: deck!.id, position: (i + 1) * 1024, layout: s.layout, section: s.section, heading: s.heading, body: s.body, mediaIds: s.media ?? [] })),
  );

  return { winter, night, handheld, locations, shotList: list!.id, deck: deck!.id };
}
