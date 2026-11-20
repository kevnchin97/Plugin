/** GIF parameter resolution and size estimation, shared by the editor UI and the worker. */
import { type GifOptions } from "./schemas";

export interface GifParams {
  quality: number;
  width: number;
  height: number;
  fps: number;
  maxColors: number;
  dither: string;
  frames: number;
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export function qualityToPalette(quality: number): { maxColors: number; dither: string } {
  const q = Math.min(100, Math.max(0, quality));
  const maxColors = Math.round(48 + (q / 100) * 208); // 48..256
  // Error diffusion looks best but costs bytes; ordered dither compresses far better.
  const dither = q >= 75 ? "sierra2_4a" : q >= 45 ? "bayer:bayer_scale=2" : q >= 20 ? "bayer:bayer_scale=4" : "none";
  return { maxColors, dither };
}

export function resolveGifParams(
  options: GifOptions,
  source: { width: number; height: number; fps: number },
  durationSec: number,
): GifParams {
  const width = even(Math.min(options.width, source.width));
  const height = even((source.height * width) / source.width);
  const fps = Math.min(options.fps, Math.round(source.fps) || options.fps);
  const base = Math.max(1, Math.round(durationSec * fps));
  const frames = options.loop === "boomerang" ? Math.max(1, base * 2 - 2) : base;
  return { quality: options.quality, width, height, fps, frames, ...qualityToPalette(options.quality) };
}

/** Per-pixel cost changes slowly with output width (bigger frames compress a bit better or worse). */
const WIDTH_EXPONENT = 0;

/** Settings used to measure a scene's GIF density during ingest. */
export const GIF_SAMPLE = { width: 320, fps: 12, quality: 70, seconds: 1 } as const;

/**
 * Relative size vs quality 70, measured on the generated demo film (grain, gradients,
 * high-detail fractals): palette size and dither type barely matter above 70, a lot below.
 */
const QUALITY_CURVE: [number, number][] = [
  [0, 0.6],
  [30, 0.82],
  [70, 1],
  [90, 1.03],
  [100, 1.04],
];

function qualityFactor(q: number): number {
  for (let i = 1; i < QUALITY_CURVE.length; i++) {
    const [q1, f1] = QUALITY_CURVE[i]!;
    const [q0, f0] = QUALITY_CURVE[i - 1]!;
    if (q <= q1) return f0 + ((f1 - f0) * (q - q0)) / (q1 - q0);
  }
  return QUALITY_CURVE[QUALITY_CURVE.length - 1]![1];
}

/**
 * Pre-export size estimate.
 *
 * With `density` (first-frame and per-frame bytes per pixel, measured by encoding a 1 s
 * sample of the scene from the original during ingest) the estimate measured 0.66-1.46x
 * of the real size on grainy footage and 1.15-1.51x on clean synthetic sources. Without it we fall back to a
 * motion-based guess, which can be off by several times on grainy footage.
 */
export function estimateGifBytes(
  params: GifParams,
  opts: { density?: { first: number; perFrame: number } | null; motion?: number } = {},
): number {
  const pixels = params.width * params.height;
  const frames = Math.max(1, params.frames);
  const q = qualityFactor(params.quality);
  if (opts.density && opts.density.first > 0) {
    const widthFactor = Math.pow(params.width / GIF_SAMPLE.width, WIDTH_EXPONENT);
    return Math.round(pixels * q * widthFactor * (opts.density.first + opts.density.perFrame * (frames - 1)));
  }
  const change = Math.min(1, 0.15 + (opts.motion ?? 6) / 12);
  return Math.round(800 + pixels * frames * 0.45 * change * q);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
