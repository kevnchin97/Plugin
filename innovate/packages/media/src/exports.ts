/**
 * Exports rendered from the original (SPEC §5.1 Outputs). All are frame-accurate:
 *
 * - We seek with input-side `-ss` (fast keyframe seek + exact decode-and-discard), aiming a
 *   quarter frame *before* the in frame so container timestamp rounding (e.g. 29.97 in a
 *   1/600 MOV timebase) can never drop it.
 * - `setpts=PTS-STARTPTS` makes the in frame t=0; `-frames:v` takes exactly N frames.
 * - Audio is trimmed by the same quarter frame so it stays in sync, then cut to N/fps.
 */
import { type FrameRate, GIF_SAMPLE, type GifOptions, type GifParams, frameToSeconds, resolveGifParams } from "@innovate/shared";
import { stat } from "node:fs/promises";
import { runFfmpeg } from "./run";

export interface SourceInfo {
  fps: FrameRate;
  width: number;
  height: number;
  hasAudio: boolean;
  videoStartOffset?: number;
}

export interface Range {
  inFrame: number;
  /** Inclusive. */
  outFrame: number;
}

export function rangeTiming(range: Range, src: SourceInfo) {
  const frames = range.outFrame - range.inFrame + 1;
  if (frames < 1) throw new Error("Out point must be after the in point.");
  const frameDur = frameToSeconds(1, src.fps);
  const lead = range.inFrame > 0 ? frameDur / 4 : 0;
  const seek = Math.max(0, (src.videoStartOffset ?? 0) + frameToSeconds(range.inFrame, src.fps) - lead);
  return { frames, seek, lead, duration: frames * frameDur, start: frameToSeconds(range.inFrame, src.fps) };
}

const sec = (s: number) => s.toFixed(6);
/** Square pixels at full resolution, even dimensions for 4:2:0 encoders. */
const SQUARE_EVEN = "scale=w='trunc(iw*sar/2)*2':h='trunc(ih/2)*2',setsar=1";

export function stillArgs(input: string, output: string, frame: number, src: SourceInfo, format: "png" | "jpg"): string[] {
  const { seek } = rangeTiming({ inFrame: frame, outFrame: frame }, src);
  return [
    "-ss",
    sec(seek),
    "-i",
    input,
    "-map",
    "0:v:0",
    "-vf",
    `setpts=PTS-STARTPTS,scale=w='trunc(iw*sar)':h=ih,setsar=1`,
    "-frames:v",
    "1",
    ...(format === "png" ? ["-c:v", "png", "-pred", "mixed"] : ["-c:v", "mjpeg", "-q:v", "2", "-pix_fmt", "yuvj444p"]),
    "-update",
    "1",
    output,
  ];
}

export function clipArgs(input: string, output: string, range: Range, src: SourceInfo): string[] {
  const t = rangeTiming(range, src);
  return [
    "-ss",
    sec(t.seek),
    "-i",
    input,
    "-map",
    "0:v:0",
    ...(src.hasAudio ? ["-map", "0:a:0"] : []),
    "-vf",
    `setpts=PTS-STARTPTS,${SQUARE_EVEN},format=yuv420p`,
    "-frames:v",
    String(t.frames),
    "-fps_mode",
    "passthrough",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "17",
    "-profile:v",
    "high",
    ...(src.hasAudio
      ? ["-af", `atrim=start=${sec(t.lead)}:duration=${sec(t.duration)},asetpts=PTS-STARTPTS`, "-c:a", "aac", "-b:a", "192k"]
      : ["-an"]),
    "-movflags",
    "+faststart",
    output,
  ];
}

function gifChain(t: ReturnType<typeof rangeTiming>, p: GifParams): string {
  // Trim on timestamps after zeroing, then resample and scale with lanczos.
  return `setpts=PTS-STARTPTS,trim=end=${sec(t.duration)},fps=${p.fps},scale=${p.width}:${p.height}:flags=lanczos,setsar=1`;
}

/**
 * Pass 1: build an optimal palette (up to 256 colours) for exactly this range.
 * stats_mode=full, not diff: diff mode never counts the last frame's colours, which shows up as
 * a wrong-coloured final frame (caught by the boomerang test).
 */
export function gifPaletteArgs(input: string, palette: string, range: Range, src: SourceInfo, p: GifParams): string[] {
  const t = rangeTiming(range, src);
  return [
    "-ss",
    sec(t.seek),
    "-i",
    input,
    "-map",
    "0:v:0",
    "-vf",
    `${gifChain(t, p)},palettegen=max_colors=${p.maxColors}:stats_mode=full:reserve_transparent=0`,
    "-frames:v",
    "1",
    "-update",
    "1",
    palette,
  ];
}

/** Pass 2: map frames onto the palette. Boomerang plays forward then back without doubling the ends. */
export function gifEncodeArgs(
  input: string,
  palette: string,
  output: string,
  range: Range,
  src: SourceInfo,
  p: GifParams,
  loop: GifOptions["loop"],
): string[] {
  const t = rangeTiming(range, src);
  const base = Math.max(1, Math.round(t.duration * p.fps));
  const chain = gifChain(t, p);
  const motion =
    loop === "boomerang" && base > 2
      ? `[0:v]${chain},split[f][b];[b]reverse,trim=start_frame=1:end_frame=${base - 1},setpts=N/${p.fps}/TB[r];[f][r]concat=n=2:v=1:a=0[x]`
      : `[0:v]${chain}[x]`;
  return [
    "-ss",
    sec(t.seek),
    "-i",
    input,
    "-i",
    palette,
    "-filter_complex",
    `${motion};[x][1:v]paletteuse=dither=${p.dither}:diff_mode=rectangle`,
    "-loop",
    "0",
    "-f",
    "gif",
    output,
  ];
}

export async function exportStill(
  input: string,
  output: string,
  frame: number,
  src: SourceInfo,
  format: "png" | "jpg",
  signal?: AbortSignal,
) {
  await runFfmpeg(stillArgs(input, output, frame, src, format), { signal });
}

export async function exportClip(
  input: string,
  output: string,
  range: Range,
  src: SourceInfo,
  opts: { onProgress?: (f: number) => void; signal?: AbortSignal } = {},
) {
  const { duration } = rangeTiming(range, src);
  await runFfmpeg(clipArgs(input, output, range, src), { ...opts, durationSec: duration });
}

export async function exportGif(
  input: string,
  palette: string,
  output: string,
  range: Range,
  src: SourceInfo,
  options: GifOptions,
  opts: { onStage?: (stage: "palette" | "encoding") => void; onProgress?: (f: number) => void; signal?: AbortSignal } = {},
): Promise<GifParams> {
  const t = rangeTiming(range, src);
  const params = resolveGifParams(options, { width: src.width, height: src.height, fps: src.fps.num / src.fps.den }, t.duration);
  opts.onStage?.("palette");
  await runFfmpeg(gifPaletteArgs(input, palette, range, src, params), {
    signal: opts.signal,
    durationSec: t.duration,
    onProgress: (f) => opts.onProgress?.(f * 0.3),
  });
  opts.onStage?.("encoding");
  const outDuration = options.loop === "boomerang" ? t.duration * 2 : t.duration;
  await runFfmpeg(gifEncodeArgs(input, palette, output, range, src, params, options.loop), {
    signal: opts.signal,
    durationSec: outDuration,
    onProgress: (f) => opts.onProgress?.(0.3 + f * 0.7),
  });
  return params;
}

export interface GifDensity {
  /** Bytes per pixel of the first frame (palette + full frame). */
  first: number;
  /** Bytes per pixel of each following frame (only changed rectangles are stored). */
  perFrame: number;
}

/**
 * Measure how expensive this footage is as a GIF: encode the middle of the scene at
 * GIF_SAMPLE settings for ½ s and 1 s, and solve size = first + perFrame × (frames − 1). Must run on the original: the proxy's compression smooths grain and
 * under-reads by 1.3-2x.
 */
export async function sampleGifDensity(
  input: string,
  workDir: string,
  scene: { startFrame: number; endFrame: number },
  src: SourceInfo,
  signal?: AbortSignal,
): Promise<GifDensity> {
  const fps = src.fps.num / src.fps.den;
  const len = Math.max(4, Math.min(scene.endFrame - scene.startFrame, Math.round(GIF_SAMPLE.seconds * fps)));
  const inFrame = Math.max(0, scene.startFrame + Math.floor((scene.endFrame - scene.startFrame - len) / 2));
  const options = { width: GIF_SAMPLE.width, fps: GIF_SAMPLE.fps, quality: GIF_SAMPLE.quality, loop: "loop" as const };
  const encode = async (frames: number) => {
    const tag = `${scene.startFrame}-${scene.endFrame}-${frames}`;
    const out = `${workDir}/density-${tag}.gif`;
    const params = await exportGif(input, `${workDir}/density-${tag}.png`, out, { inFrame, outFrame: inFrame + frames - 1 }, src, options, { signal });
    return { bytes: (await stat(out)).size, pixels: params.width * params.height, frames: params.frames };
  };
  const half = await encode(Math.ceil(len / 2));
  const full = await encode(len);
  const extra = full.frames - half.frames;
  const perFrame = extra > 0 ? Math.max(0, full.bytes - half.bytes) / (full.pixels * extra) : full.bytes / (full.pixels * full.frames);
  const first = Math.max(perFrame, full.bytes / full.pixels - perFrame * (full.frames - 1));
  return { first, perFrame };
}
