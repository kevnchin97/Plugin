/** Proxy, filmstrip and thumbnails: the ingest-side derivatives (SPEC §5.1 Processing). */
import { type FilmstripInfo } from "@innovate/shared";
import { runFfmpeg } from "./run";

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
