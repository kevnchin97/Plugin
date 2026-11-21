import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Job } from "bullmq";
import PDFDocument from "pdfkit";
import { and, asc, desc, eq, inArray, isNull, mediaJobs, references, shareLinks, shotLists, shots, sql } from "@innovate/db";
import { runFfmpeg } from "@innovate/media";
import { type ExportOutput, FRAMING_LABEL, formatShotDuration, type PdfJobData, slugify } from "@innovate/shared";
import { db, dirs, storage } from "../context";

const INK = "#211d18";
const MUTED = "#6b6357";
const RULE = "#e3dccf";
const ACCENT = "#a4481a";

async function motionBase(workspaceId: string, listId: string) {
  const app = (process.env.AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const [link] = await db
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

/**
 * Shot list → PDF (SPEC §5.4): one row per shot with each motion reference's FIRST FRAME and a
 * link to the motion version (the list's live share link if it has one, else the app).
 */
export async function runPdf(job: Job<PdfJobData>): Promise<ExportOutput> {
  const { jobId, workspaceId, shotListId } = job.data;
  const [list] = await db.select().from(shotLists).where(and(eq(shotLists.id, shotListId), eq(shotLists.workspaceId, workspaceId)));
  if (!list) throw new Error("Shot list not found");
  const rows = await db.select().from(shots).where(eq(shots.shotListId, shotListId)).orderBy(asc(shots.position));
  const refIds = [...new Set(rows.map((r) => r.motionReferenceId).filter((x): x is string => Boolean(x)))];
  const refs = refIds.length ? await db.select().from(references).where(inArray(references.id, refIds)) : [];
  const byId = new Map(refs.map((r) => [r.id, r]));
  const base = await motionBase(workspaceId, shotListId);

  const work = join(dirs.work, `pdf-${jobId}`);
  await mkdir(work, { recursive: true });
  try {
    // First frames (scaled for print) for every motion reference.
    const frames = new Map<string, string>();
    for (const r of refs) {
      const key = r.type === "video" ? r.thumbnailKey : r.originalKey ?? r.thumbnailKey;
      if (!key) continue;
      const src = join(work, `src-${r.id}`);
      const out = join(work, `frame-${r.id}.jpg`);
      try {
        await storage.downloadFile(key, src);
        await runFfmpeg(["-i", src, "-frames:v", "1", "-vf", "scale=480:-2:flags=lanczos", "-q:v", "3", out]);
        frames.set(r.id, out);
      } catch (err) {
        console.warn(`[pdf] no frame for ${r.id}: ${(err as Error).message}`);
      }
      await job.updateProgress({ stage: "encoding", progress: (frames.size / Math.max(1, refs.length)) * 60 });
    }

    const file = join(work, "shot-list.pdf");
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, info: { Title: list.title, Creator: "Innovate" } });
    const done = new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(file);
      ws.on("finish", resolve);
      ws.on("error", reject);
      doc.pipe(ws);
    });

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const cols = [
      { key: "num", label: "#", w: 30 },
      { key: "setting", label: "Scene / setting", w: 110 },
      { key: "desc", label: "Description", w: 196 },
      { key: "framing", label: "Framing", w: 70 },
      { key: "camera", label: "Camera", w: 110 },
      { key: "dur", label: "Duration", w: 64 },
      { key: "status", label: "Status", w: 50 },
      { key: "motion", label: "Motion reference", w: 0 },
    ];
    cols[cols.length - 1]!.w = width - cols.reduce((a, c) => a + c.w, 0);

    const header = () => {
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(16).text(list.title, left, 36);
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`${rows.length} shots · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · motion versions: ${base}`, left, 58, { width });
      let x = left;
      const y = 80;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
      for (const c of cols) {
        doc.text(c.label.toUpperCase(), x + 4, y, { width: c.w - 8, characterSpacing: 0.5 });
        x += c.w;
      }
      doc.moveTo(left, y + 14).lineTo(left + width, y + 14).strokeColor(RULE).lineWidth(1).stroke();
      return y + 20;
    };

    let y = header();
    for (const s of rows) {
      const ref = s.motionReferenceId ? byId.get(s.motionReferenceId) : undefined;
      const frame = ref ? frames.get(ref.id) : undefined;
      const motionW = cols[cols.length - 1]!.w - 8;
      const imgH = frame && ref?.width && ref.height ? Math.min(110, (motionW * ref.height) / ref.width) : 0;
      const cells: Record<string, string> = {
        num: s.number,
        setting: [s.scene && `Sc. ${s.scene}`, s.setting].filter(Boolean).join("\n"),
        desc: s.description,
        framing: s.framing ? `${s.framing}\n${FRAMING_LABEL[s.framing]}` : "",
        camera: [s.movement, s.lens, s.rig].filter(Boolean).join("\n"),
        dur: formatShotDuration(s.durationSec),
        status: s.status,
      };
      doc.font("Helvetica").fontSize(9);
      const textH = Math.max(...cols.slice(0, -1).map((c) => doc.heightOfString(cells[c.key] ?? "", { width: c.w - 8 })));
      const rowH = Math.max(textH, imgH + (ref ? 14 : 0)) + 12;
      if (y + rowH > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = header();
      }
      let x = left;
      for (const c of cols.slice(0, -1)) {
        doc.fillColor(c.key === "num" ? INK : c.key === "status" ? MUTED : INK).font(c.key === "num" ? "Helvetica-Bold" : "Helvetica").fontSize(9);
        doc.text(cells[c.key] ?? "", x + 4, y + 6, { width: c.w - 8 });
        x += c.w;
      }
      if (ref) {
        const url = `${base}#shot-${s.id}`;
        if (frame) {
          doc.image(frame, x + 4, y + 6, { width: motionW, height: imgH });
          doc.link(x + 4, y + 6, motionW, imgH, url);
        }
        doc.fillColor(ACCENT).fontSize(8).text(`${ref.title} · watch the motion »`, x + 4, y + 8 + imgH, { width: motionW, link: url, underline: false });
      }
      y += rowH;
      doc.moveTo(left, y).lineTo(left + width, y).strokeColor(RULE).lineWidth(0.5).stroke();
    }
    if (!rows.length) doc.fillColor(MUTED).fontSize(10).text("No shots yet.", left, y + 10);
    doc.end();
    await done;

    const key = `ws/${workspaceId}/shotlists/${shotListId}/${jobId}.pdf`;
    const bytes = await storage.uploadFile(key, file, "application/pdf");
    const output: ExportOutput = { key, filename: `${slugify(list.title)}_shot-list.pdf`, contentType: "application/pdf", bytes, width: 0, height: 0, durationSec: 0, sourceIn: 0, sourceOut: 0 };
    await db.update(mediaJobs).set({ status: "completed", stage: "done", progress: 100, output, error: null }).where(eq(mediaJobs.id, jobId));
    return output;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
