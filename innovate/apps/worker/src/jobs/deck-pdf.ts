import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { QueueJob as Job } from "@innovate/shared/queue";
import PDFDocument from "pdfkit";
import { and, asc, decks, desc, eq, inArray, isNull, mediaJobs, references, shareLinks, slides, sql } from "@innovate/db";
import { runFfmpeg } from "@innovate/media";
import { type DeckPdfJobData, type ExportOutput, slugify } from "@innovate/shared";
import { db, dirs, storage } from "../context";

/** Slide palettes: the app's light and dark tokens (packages/shared/src/tokens.ts). */
const THEMES = {
  paper: { bg: "#efefef", ink: "#1e1e1e", muted: "#555555", accent: "#2a64d8", media: "#111111" },
  night: { bg: "#0a0a0b", ink: "#ececef", muted: "#9b9ba4", accent: "#6f9dff", media: "#000000" },
} as const;
const W = 960;
const H = 540;
const PAD = 48;

async function deckLink(workspaceId: string, deckId: string) {
  const app = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const [link] = await db
    .select({ token: shareLinks.token })
    .from(shareLinks)
    .where(
      and(
        eq(shareLinks.workspaceId, workspaceId),
        eq(shareLinks.targetType, "deck"),
        eq(shareLinks.targetId, deckId),
        isNull(shareLinks.revokedAt),
        sql`(${shareLinks.expiresAt} is null or ${shareLinks.expiresAt} > now())`,
      ),
    )
    .orderBy(desc(shareLinks.createdAt))
    .limit(1);
  return link ? `${app}/s/${link.token}` : `${app}/decks/${deckId}`;
}

/**
 * Deck → PDF (SPEC §5.5): one 16:9 page per slide, same layouts as the web presenter. Motion items
 * (GIFs, clips, videos) become posters (first frame) with a "plays in the live deck" link.
 */
export async function runDeckPdf(job: Job<DeckPdfJobData>): Promise<ExportOutput> {
  const { jobId, workspaceId, deckId } = job.data;
  const [deck] = await db.select().from(decks).where(and(eq(decks.id, deckId), eq(decks.workspaceId, workspaceId)));
  if (!deck) throw new Error("Deck not found");
  const rows = await db.select().from(slides).where(eq(slides.deckId, deckId)).orderBy(asc(slides.position));
  const ids = [...new Set(rows.flatMap((s) => s.mediaIds))];
  const refs = ids.length ? await db.select().from(references).where(inArray(references.id, ids)) : [];
  const byId = new Map(refs.map((r) => [r.id, r]));
  const live = await deckLink(workspaceId, deckId);
  const theme = THEMES[deck.theme] ?? THEMES.paper;

  const work = join(dirs.work, `deck-pdf-${jobId}`);
  await mkdir(work, { recursive: true });
  try {
    const posters = new Map<string, string>();
    for (const r of refs) {
      const key = r.type === "video" ? r.thumbnailKey : (r.originalKey ?? r.thumbnailKey);
      if (!key) continue;
      const src = join(work, `src-${r.id}`);
      const out = join(work, `poster-${r.id}.jpg`);
      try {
        await storage.downloadFile(key, src);
        await runFfmpeg(["-i", src, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2:flags=lanczos", "-q:v", "3", out]);
        posters.set(r.id, out);
      } catch (err) {
        console.warn(`[deck-pdf] no poster for ${r.id}: ${(err as Error).message}`);
      }
      await job.updateProgress({ stage: "encoding", progress: (posters.size / Math.max(1, refs.length)) * 60 });
    }

    const file = join(work, "deck.pdf");
    const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: false, info: { Title: deck.title, Creator: "Innovate" } });
    const done = new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(file);
      ws.on("finish", resolve);
      ws.on("error", reject);
      doc.pipe(ws);
    });

    /** Fit an image into a box (cover), with a motion badge + link for GIFs, clips and videos. */
    const media = (id: string, x: number, y: number, w: number, h: number) => {
      const r = byId.get(id);
      doc.save().rect(x, y, w, h).fill(theme.media).restore();
      const poster = posters.get(id);
      if (!r || !poster) return;
      doc.save().rect(x, y, w, h).clip();
      doc.image(poster, x, y, { cover: [w, h], align: "center", valign: "center" });
      doc.restore();
      if (r.type === "gif" || r.type === "clip" || r.type === "video") {
        const label = `${r.type === "gif" ? "GIF" : r.type === "clip" ? "Clip" : "Video"} › plays in the live deck`;
        doc.font("Helvetica-Bold").fontSize(8);
        const lw = doc.widthOfString(label) + 12;
        doc.save().roundedRect(x + 8, y + h - 24, lw, 16, 3).fillOpacity(0.75).fill("#000000").restore();
        doc.fillColor("#ffffff").text(label, x + 14, y + h - 20, { lineBreak: false });
        doc.link(x, y, w, h, `${live}#slide-${rows.findIndex((s) => s.mediaIds.includes(id)) + 1}`);
      }
    };
    const heading = (text: string, x: number, y: number, w: number, size: number) => {
      doc.fillColor(theme.ink).font("Helvetica-Bold").fontSize(size).text(text, x, y, { width: w });
      return doc.y;
    };
    const body = (text: string, x: number, y: number, w: number, h?: number) => {
      doc.fillColor(theme.muted).font("Helvetica").fontSize(13).text(text, x, y, { width: w, height: h, lineGap: 3, ellipsis: true });
    };
    const grid = (mediaIds: string[], x: number, y: number, w: number, h: number) => {
      const n = Math.max(1, Math.min(mediaIds.length, 6));
      const cols = n <= 2 ? n : n <= 4 ? 2 : 3;
      const rowsN = Math.ceil(n / cols);
      const gap = 8;
      const cw = (w - gap * (cols - 1)) / cols;
      const ch = (h - gap * (rowsN - 1)) / rowsN;
      mediaIds.slice(0, 6).forEach((id, i) => media(id, x + (i % cols) * (cw + gap), y + Math.floor(i / cols) * (ch + gap), cw, ch));
    };

    rows.forEach((s, i) => {
      doc.addPage({ size: [W, H], margin: 0 });
      doc.rect(0, 0, W, H).fill(theme.bg);
      const label = s.section && s.section !== "title" ? s.heading || s.section : "";
      if (s.layout === "title") {
        if (s.mediaIds[0]) {
          media(s.mediaIds[0], 0, 0, W, H);
          doc.save().rect(0, H * 0.55, W, H * 0.45).fillOpacity(0.55).fill("#000000").restore();
          doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(40).text(s.heading || deck.title, PAD, H - 150, { width: W - PAD * 2 });
          doc.fillColor("#ffffff").font("Helvetica").fontSize(15).text(s.body, PAD, doc.y + 6, { width: W - PAD * 2 });
        } else {
          heading(s.heading || deck.title, PAD, H / 2 - 50, W - PAD * 2, 44);
          body(s.body, PAD, doc.y + 8, W - PAD * 2);
          doc.save().rect(PAD, H / 2 - 70, 40, 3).fill(theme.accent).restore();
        }
      } else if (s.layout === "media") {
        if (s.mediaIds[0]) media(s.mediaIds[0], 0, 0, W, H);
        if (s.heading) {
          doc.save().rect(0, H - 64, W, 64).fillOpacity(0.55).fill("#000000").restore();
          doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(18).text(s.heading, PAD, H - 42, { width: W - PAD * 2, lineBreak: false, ellipsis: true });
        }
      } else if (s.layout === "media-text") {
        const mw = W * 0.56;
        if (s.mediaIds.length) grid(s.mediaIds.slice(0, 2), 0, 0, mw, H);
        const y = heading(s.heading, mw + 36, PAD + 20, W - mw - 36 - PAD, 26);
        body(s.body, mw + 36, y + 12, W - mw - 36 - PAD, H - y - PAD - 12);
      } else if (s.layout === "grid") {
        const y = heading(s.heading, PAD, PAD - 8, W * 0.45, 24);
        body(s.body, W * 0.5, PAD - 4, W * 0.5 - PAD, 60);
        grid(s.mediaIds, PAD, Math.max(y, PAD + 56) + 14, W - PAD * 2, H - Math.max(y, PAD + 56) - 14 - PAD);
      } else {
        const y = heading(s.heading, PAD * 2, PAD * 2, W - PAD * 4, 30);
        body(s.body, PAD * 2, y + 16, W - PAD * 4, H - y - PAD * 2);
      }
      // Footer: deck title, section and page number.
      doc.fillColor(s.layout === "media" || (s.layout === "title" && s.mediaIds[0]) ? "#ffffff" : theme.muted).font("Helvetica").fontSize(8);
      doc.text(`${deck.title}${label ? ` · ${label}` : ""}`, PAD, 16, { width: W / 2, lineBreak: false, ellipsis: true });
      doc.text(`${i + 1} / ${rows.length}`, W - PAD - 60, 16, { width: 60, align: "right", lineBreak: false });
    });
    if (!rows.length) {
      doc.addPage({ size: [W, H], margin: 0 });
      heading(deck.title, PAD, H / 2 - 20, W - PAD * 2, 32);
    }
    doc.end();
    await done;

    const key = `ws/${workspaceId}/decks/${deckId}/${jobId}.pdf`;
    const bytes = await storage.uploadFile(key, file, "application/pdf");
    const output: ExportOutput = { key, filename: `${slugify(deck.title)}_deck.pdf`, contentType: "application/pdf", bytes, width: W, height: H, durationSec: 0, sourceIn: 0, sourceOut: 0 };
    await db.update(mediaJobs).set({ status: "completed", stage: "done", progress: 100, output, error: null }).where(eq(mediaJobs.id, jobId));
    return output;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
