import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { QueueJob as Job } from "@innovate/shared/queue";
import { and, asc, eq, inArray, mediaJobs, reelItems, reels, references } from "@innovate/db";
import { runFfmpeg } from "@innovate/media";
import { type ExportOutput, REEL_CARD_SECONDS, type ReelRenderJobData, slugify, trimmedDuration } from "@innovate/shared";
import { db, dirs, storage } from "../context";
import { localOriginal } from "../originals";
import { Progress } from "../progress";

const W = 1920;
const H = 1080;
const FPS = 24;
/** Every segment gets identical stream parameters so the concat demuxer can join them without re-encoding. */
const VIDEO_OUT = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-pix_fmt", "yuv420p", "-r", String(FPS), "-video_track_timescale", "12288"];
const AUDIO_OUT = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"];
const FIT = `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS},format=yuv420p`;

/** A title or end card: dark frame, centred title + subtitle (fontconfig "Sans"), short fades. */
async function card(out: string, work: string, name: string, title: string, sub: string) {
  const tf = join(work, `${name}-title.txt`);
  const sf = join(work, `${name}-sub.txt`);
  await writeFile(tf, title);
  await writeFile(sf, sub);
  const d = REEL_CARD_SECONDS;
  const text = [
    `drawtext=font=Sans:textfile='${tf}':fontcolor=0xf2ece2:fontsize=76:x=(w-text_w)/2:y=(h-text_h)/2-${sub ? 36 : 0}`,
    sub ? `drawtext=font=Sans:textfile='${sf}':fontcolor=0xa59c8f:fontsize=34:x=(w-text_w)/2:y=(h/2)+40` : null,
    `fade=t=in:st=0:d=0.4,fade=t=out:st=${d - 0.4}:d=0.4`,
  ]
    .filter(Boolean)
    .join(",");
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", `color=c=0x0a0a0b:s=${W}x${H}:r=${FPS}:d=${d}`,
    "-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo`,
    "-vf", `${text},format=yuv420p`,
    "-t", String(d),
    "-map", "0:v", "-map", "1:a",
    ...VIDEO_OUT, ...AUDIO_OUT,
    out,
  ]);
}

/**
 * Reel → one MP4 (SPEC §5.5, optional render): each item trimmed and conformed to 1080p24 with
 * stereo AAC (silence where a source has none), title and end cards, then joined by stream copy.
 * The output key is a hash of the reel's content, so an unchanged reel re-renders to the same file.
 */
export async function runReelRender(job: Job<ReelRenderJobData>): Promise<ExportOutput> {
  const { jobId, workspaceId, reelId } = job.data;
  const [reel] = await db.select().from(reels).where(and(eq(reels.id, reelId), eq(reels.workspaceId, workspaceId)));
  if (!reel) throw new Error("Reel not found");
  const items = await db.select().from(reelItems).where(eq(reelItems.reelId, reelId)).orderBy(asc(reelItems.position));
  if (!items.length) throw new Error("This reel has no clips to render.");
  const refs = await db.select().from(references).where(inArray(references.id, items.map((i) => i.referenceId)));
  const byId = new Map(refs.map((r) => [r.id, r]));

  const hash = createHash("sha256")
    .update(JSON.stringify({ v: 1, c: [reel.titleCard, reel.titleCardSub, reel.endCard, reel.endCardSub], i: items.map((i) => [i.referenceId, i.inSec, i.outSec]) }))
    .digest("hex")
    .slice(0, 16);
  const key = `ws/${workspaceId}/reels/${reelId}/${hash}.mp4`;
  const filename = `${slugify(reel.title)}_reel.mp4`;

  const work = join(dirs.work, `reel-${jobId}-${job.attemptsMade}`);
  await mkdir(work, { recursive: true });
  try {
    const segments: string[] = [];
    let total = 0;
    const steps = items.length + (reel.titleCard ? 1 : 0) + (reel.endCard ? 1 : 0) + 1;
    const progress = new Progress(job, jobId);
    await progress.setStage("encoding", 0);
    const step = async (n: number) => progress.setStage("encoding", (n / steps) * 95);

    if (reel.titleCard) {
      const out = join(work, "seg-title.mp4");
      await card(out, work, "title", reel.titleCard, reel.titleCardSub);
      segments.push(out);
      total += REEL_CARD_SECONDS;
      await step(segments.length);
    }
    for (const [n, item] of items.entries()) {
      const ref = byId.get(item.referenceId);
      const srcKey = ref ? (ref.masterKey ?? ref.originalKey) : null;
      if (!ref || !srcKey || !ref.duration) throw new Error(`A clip in this reel is missing its media (${ref?.title ?? item.referenceId}).`);
      const src = await localOriginal(ref.id, srcKey);
      const start = Math.max(0, Math.min(item.inSec ?? 0, ref.duration));
      const dur = trimmedDuration(item, ref.duration);
      if (dur <= 0.04) continue;
      const out = join(work, `seg-${n}.mp4`);
      await runFfmpeg([
        "-y",
        "-ss", start.toFixed(3), "-t", dur.toFixed(3), "-i", src,
        "-f", "lavfi", "-t", dur.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo",
        "-vf", FIT,
        "-map", "0:v:0", "-map", ref.hasAudio ? "0:a:0" : "1:a",
        "-af", "aresample=48000,aformat=channel_layouts=stereo",
        "-t", dur.toFixed(3),
        ...VIDEO_OUT, ...AUDIO_OUT,
        out,
      ]);
      segments.push(out);
      total += dur;
      await step(segments.length);
    }
    if (reel.endCard) {
      const out = join(work, "seg-end.mp4");
      await card(out, work, "end", reel.endCard, reel.endCardSub);
      segments.push(out);
      total += REEL_CARD_SECONDS;
    }

    const list = join(work, "list.txt");
    await writeFile(list, segments.map((s) => `file '${s}'`).join("\n"));
    const file = join(work, "reel.mp4");
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", file]);
    await progress.setStage("uploading", 97);
    const bytes = await storage.uploadFile(key, file, "video/mp4");
    await db.update(reels).set({ renderKey: key, renderHash: hash }).where(eq(reels.id, reelId));
    const output: ExportOutput = { key, filename, contentType: "video/mp4", bytes, width: W, height: H, durationSec: total, sourceIn: 0, sourceOut: total };
    await db.update(mediaJobs).set({ status: "completed", stage: "done", progress: 100, output, error: null }).where(eq(mediaJobs.id, jobId));
    return output;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
