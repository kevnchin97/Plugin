/** Proxy, filmstrip and thumbnails: the ingest-side derivatives (SPEC §5.1 Processing). */
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { type FilmstripInfo, type FrameRate } from "@innovate/shared";
import { runFfmpeg } from "./run";
import { buildScenes, DEFAULT_CUT_OPTIONS, detectCuts, type DetectedScene, type FrameStat, parseFrameStats } from "./scenes";

export const PROXY_MAX_HEIGHT = 540;
/** Short GOP and no B-frames so the browser can seek and step frames quickly. */
export const PROXY_GOP = 12;

export function proxyArgs(input: string, output: string, hasAudio: boolean): string[] {
  const h = `min(${PROXY_MAX_HEIGHT},ih)`;
  return [
    "-i",
    input,
    "-map",
    "0:v:0",
    ...(hasAudio ? ["-map", "0:a:0"] : []),
    "-vf",
    // Square pixels, even dimensions, first frame at t=0 so frame n sits at n/fps.
    `scale=w='trunc(${h}*dar/2)*2':h='trunc(${h}/2)*2':flags=bicubic,setsar=1,setpts=PTS-STARTPTS,format=yuv420p`,
    "-fps_mode",
    "passthrough",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "26",
    "-g",
    String(PROXY_GOP),
    "-keyint_min",
    String(PROXY_GOP),
    "-sc_threshold",
    "0",
    "-bf",
    "0",
    ...(hasAudio ? ["-af", "asetpts=PTS-STARTPTS", "-c:a", "aac", "-b:a", "96k", "-ac", "2"] : ["-an"]),
    "-movflags",
    "+faststart",
    output,
  ];
}

export function createProxy(
  input: string,
  output: string,
  opts: { hasAudio: boolean; durationSec: number; onProgress?: (f: number) => void; signal?: AbortSignal },
) {
  return runFfmpeg(proxyArgs(input, output, opts.hasAudio), opts);
}

export const FILMSTRIP_TILE_HEIGHT = 108;
export const FILMSTRIP_COLUMNS = 12;
const INTERVALS = [0.25, 0.5, 1, 2, 4, 5, 10, 15, 30, 60, 120];
const MAX_TILES = 360;

export function planFilmstrip(durationSec: number, width: number, height: number): Omit<FilmstripInfo, "key"> {
  const interval = INTERVALS.find((i) => durationSec / i <= MAX_TILES) ?? INTERVALS[INTERVALS.length - 1]!;
  const count = Math.max(1, Math.ceil(durationSec / interval - 1e-6));
  const tileHeight = FILMSTRIP_TILE_HEIGHT;
  const tileWidth = Math.max(2, Math.round((tileHeight * width) / height / 2) * 2);
  const columns = Math.min(FILMSTRIP_COLUMNS, count);
  const rows = Math.ceil(count / columns);
  return { interval, count, columns, rows, tileWidth, tileHeight };
}

/** One JPEG sprite sheet; tile i is the frame nearest i * interval. */
export function filmstripArgs(input: string, output: string, plan: Omit<FilmstripInfo, "key">): string[] {
  return [
    "-i",
    input,
    "-an",
    "-vf",
    `fps=fps=1/${plan.interval}:start_time=0:round=near,scale=${plan.tileWidth}:${plan.tileHeight}:flags=lanczos,setsar=1,tile=${plan.columns}x${plan.rows}`,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    output,
  ];
}

export function createFilmstrip(
  input: string,
  output: string,
  plan: Omit<FilmstripInfo, "key">,
  opts: { durationSec: number; onProgress?: (f: number) => void; signal?: AbortSignal },
) {
  return runFfmpeg(filmstripArgs(input, output, plan), opts);
}

/** A JPEG thumbnail at `seconds` (input-side seek is fast; good enough for thumbnails). */
export function thumbnailArgs(input: string, output: string, seconds: number, width = 480): string[] {
  return ["-ss", seconds.toFixed(3), "-i", input, "-frames:v", "1", "-vf", `scale=${width}:-2:flags=lanczos`, "-q:v", "3", output];
}

export function createThumbnail(input: string, output: string, seconds: number, width?: number, signal?: AbortSignal) {
  return runFfmpeg(thumbnailArgs(input, output, seconds, width), { signal });
}

export interface AnalyzeOptions {
  hasAudio: boolean;
  durationSec: number;
  fps: FrameRate;
  /** Best guess of the frame count (from probe); the decoded count is what's returned. */
  frameCount: number;
  plan: Omit<FilmstripInfo, "key">;
  /** Chunks processed in parallel. Defaults to the CPU count. */
  segments?: number;
  /** Don't cut chunks shorter than this (seconds). */
  minSegmentSeconds?: number;
  videoStartOffset?: number;
  /** Scratch directory for chunk files. */
  workDir: string;
  onProgress?: (f: number) => void;
  signal?: AbortSignal;
}

interface Segment {
  index: number;
  start: number; // first frame (inclusive)
  end: number | null; // last frame (exclusive); null = to the end of the file
  overlap: 0 | 1; // decode one frame early so a cut on the boundary still has a "previous" frame
}

export function planSegments(frameCount: number, fps: FrameRate, wanted: number, minSeconds = 10): Segment[] {
  const seconds = (frameCount * fps.den) / fps.num;
  const n = Math.max(1, Math.min(wanted, Math.floor(seconds / minSeconds) || 1, frameCount));
  const bounds = Array.from({ length: n + 1 }, (_, k) => Math.round((k * frameCount) / n));
  return bounds.slice(0, -1).map((start, k) => ({
    index: k,
    start,
    end: k === n - 1 ? null : bounds[k + 1]!,
    overlap: start > 0 ? 1 : 0,
  }));
}

function tileFrames(plan: Omit<FilmstripInfo, "key">, fps: FrameRate): number[] {
  return Array.from({ length: plan.count }, (_, i) => Math.round((i * plan.interval * fps.num) / fps.den));
}

/** Chunk k: proxy video (no audio), selected filmstrip frames, and scene statistics. */
export function segmentArgs(
  input: string,
  seg: Segment,
  files: { proxy: string; stats: string; tiles: string },
  o: Pick<AnalyzeOptions, "fps" | "plan" | "videoStartOffset">,
  tilesInSegment: number[],
): string[] {
  const h = `min(${PROXY_MAX_HEIGHT},ih)`;
  const first = seg.start - seg.overlap;
  const len = seg.end === null ? null : seg.end - seg.start;
  const seek = first > 0 ? (o.videoStartOffset ?? 0) + ((first - 0.25) * o.fps.den) / o.fps.num : 0;
  const analysisEnd = len === null ? "" : `,trim=end_frame=${len + seg.overlap}`;
  const proxyTrim = `trim=start_frame=${seg.overlap}${len === null ? "" : `:end_frame=${len + seg.overlap}`},setpts=PTS-STARTPTS`;
  // Tile frames are addressed relative to the chunk's first decoded frame.
  const pick = tilesInSegment.map((f) => `eq(n\\,${f - first})`).join("+") || "0";
  const graph = [
    `[0:v]setpts=PTS-STARTPTS,scale=w='trunc(${h}*dar/2)*2':h='trunc(${h}/2)*2':flags=bicubic,setsar=1,format=yuv420p,split=3[p0][a0][f0]`,
    `[p0]${proxyTrim}[p]`,
    `[a0]${analysisEnd.slice(1) || "null"},scale=w=256:h=-2:flags=fast_bilinear,select='gte(scene,0)',signalstats,metadata=mode=print:file=${files.stats}[an]`,
    `[f0]select='${pick}',scale=${o.plan.tileWidth}:${o.plan.tileHeight}:flags=lanczos,setsar=1[tl]`,
  ].join(";");
  // trim= drops frames but doesn't stop the decoder; -t stops reading a few frames past the chunk.
  const readFor = len === null ? null : ((len + seg.overlap + 3) * o.fps.den) / o.fps.num;
  return [
    ...(seek > 0 ? ["-ss", seek.toFixed(6)] : []),
    ...(readFor !== null ? ["-t", readFor.toFixed(6)] : []),
    "-i",
    input,
    "-filter_complex",
    graph,
    "-map",
    "[p]",
    "-an",
    "-fps_mode",
    "passthrough",
    "-c:v",
    "libx264",
    "-preset",
    "superfast",
    "-crf",
    "26",
    "-g",
    String(PROXY_GOP),
    "-keyint_min",
    String(PROXY_GOP),
    "-sc_threshold",
    "0",
    "-bf",
    "0",
    files.proxy,
    "-map",
    "[an]",
    "-f",
    "null",
    "-",
    "-map",
    "[tl]",
    "-fps_mode",
    "passthrough",
    "-q:v",
    "3",
    "-start_number",
    "0",
    files.tiles,
  ];
}

/**
 * One decode per chunk, all chunks in parallel, three products: the scrubbing proxy, the
 * filmstrip sprite and per-frame scene statistics. Chunks are cut on exact frames (the same
 * quarter-frame-early seek as exports) and the video is concatenated without re-encoding;
 * audio is encoded once from the source. On a 4-core box this ingests a 3-minute 1080p30
 * video ~2.5x faster than decoding the source and then the proxy twice more.
 */
export async function analyzeSource(
  input: string,
  out: { proxy: string; filmstrip: string },
  o: AnalyzeOptions & Partial<typeof DEFAULT_CUT_OPTIONS>,
): Promise<{ scenes: DetectedScene[]; stats: FrameStat[] }> {
  const wanted = o.segments ?? Math.max(1, availableParallelism());
  const segs = planSegments(Math.max(1, o.frameCount), o.fps, wanted, o.minSegmentSeconds);
  const tiles = tileFrames(o.plan, o.fps);
  const progress = segs.map(() => 0);
  const report = () => o.onProgress?.((progress.reduce((a, b) => a + b, 0) / segs.length) * 0.92);
  await mkdir(o.workDir, { recursive: true });

  const results = await Promise.all(
    segs.map(async (seg) => {
      const files = {
        proxy: join(o.workDir, `seg-${seg.index}.mp4`),
        stats: join(o.workDir, `seg-${seg.index}.txt`),
        tiles: join(o.workDir, `seg-${seg.index}-tile-%04d.jpg`),
      };
      const mine = tiles.filter((f) => f >= seg.start && (seg.end === null || f < seg.end));
      const segSeconds = (((seg.end ?? o.frameCount) - seg.start) * o.fps.den) / o.fps.num;
      await runFfmpeg(segmentArgs(input, seg, files, o, mine), {
        durationSec: Math.max(0.1, segSeconds),
        signal: o.signal,
        onProgress: (f) => {
          progress[seg.index] = f;
          report();
        },
      });
      let rows = parseFrameStats(await readFile(files.stats, "utf8"));
      if (seg.overlap) rows = rows.slice(1);
      return { seg, files, rows, tileCount: mine.length };
    }),
  );

  // Stitch statistics onto the global frame grid.
  const stats: FrameStat[] = [];
  for (const r of results) {
    const offset = stats.length;
    r.rows.forEach((row, i) => stats.push({ ...row, frame: offset + i, time: ((offset + i) * o.fps.den) / o.fps.num }));
  }

  // Concatenate the video chunks without re-encoding; encode the audio once.
  const list = join(o.workDir, "segments.txt");
  await writeFile(list, results.map((r) => `file '${r.files.proxy.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  await runFfmpeg([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    ...(o.hasAudio ? ["-i", input, "-map", "0:v:0", "-map", "1:a:0", "-af", "asetpts=PTS-STARTPTS", "-c:a", "aac", "-b:a", "96k", "-ac", "2"] : ["-map", "0:v:0"]),
    "-c:v",
    "copy",
    "-movflags",
    "+faststart",
    out.proxy,
  ], { signal: o.signal });

  // Filmstrip: number the picked frames globally (repeat the last if the file ran short), then tile.
  const picked: string[] = [];
  for (const r of results) for (let i = 0; i < r.tileCount; i++) picked.push(join(o.workDir, `seg-${r.seg.index}-tile-${String(i).padStart(4, "0")}.jpg`));
  const ordered: string[] = [];
  let lastGood: string | null = null;
  for (const file of picked) {
    if (await exists(file)) lastGood = file;
    if (lastGood) ordered.push(lastGood);
  }
  for (const [i, file] of ordered.entries()) await copyFile(file, join(o.workDir, `strip-${String(i).padStart(4, "0")}.jpg`));
  await runFfmpeg([
    "-framerate",
    "1",
    "-i",
    join(o.workDir, "strip-%04d.jpg"),
    "-vf",
    `tile=${o.plan.columns}x${o.plan.rows}`,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    out.filmstrip,
  ], { signal: o.signal });
  o.onProgress?.(1);

  const fpsValue = o.fps.num / o.fps.den;
  const cuts = detectCuts(stats, {
    threshold: o.threshold ?? DEFAULT_CUT_OPTIONS.threshold,
    spikeRatio: o.spikeRatio ?? DEFAULT_CUT_OPTIONS.spikeRatio,
    minShotFrames: Math.max(1, Math.round((o.minShotSeconds ?? DEFAULT_CUT_OPTIONS.minShotSeconds) * fpsValue)),
  });
  return { scenes: buildScenes(stats, cuts, o.fps, stats.length), stats };
}

async function exists(file: string) {
  return access(file).then(
    () => true,
    () => false,
  );
}
