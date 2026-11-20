/**
 * Constant-frame-rate masters for variable-frame-rate sources (phones, screen recordings).
 *
 * Frame-accurate editing needs every frame on a fixed grid. VFR footage is re-timed once at
 * ingest into a near-lossless CFR "master" (x264 CRF 12); the proxy, scenes and every export
 * then come from the master, so frame N means the same picture everywhere. The untouched
 * original is kept alongside it.
 */
import { type FrameRate, fpsValue } from "@innovate/shared";
import type { ProbeResult } from "./probe";
import { runFfmpeg } from "./run";

export const STANDARD_RATES: FrameRate[] = [
  { num: 24000, den: 1001 },
  { num: 24, den: 1 },
  { num: 25, den: 1 },
  { num: 30000, den: 1001 },
  { num: 30, den: 1 },
  { num: 48, den: 1 },
  { num: 50, den: 1 },
  { num: 60000, den: 1001 },
  { num: 60, den: 1 },
  { num: 120, den: 1 },
];

function nearestStandard(fps: number, tolerance: number): FrameRate | null {
  let best: FrameRate | null = null;
  let bestErr = Infinity;
  for (const r of STANDARD_RATES) {
    const err = Math.abs(fpsValue(r) - fps) / fpsValue(r);
    if (err < bestErr) [best, bestErr] = [r, err];
  }
  return bestErr <= tolerance ? best : null;
}

/**
 * Pick the master's frame rate. Phones record at a nominal rate (30, 60) and drop or stretch
 * frames under load, so the nominal rate is the capture rate when it's a standard one; gaps
 * become repeated frames. Otherwise snap the average rate to a standard, or keep it as-is.
 */
export function chooseMasterRate(p: Pick<ProbeResult, "nominalFps" | "avgFps">): FrameRate {
  const nominal = fpsValue(p.nominalFps);
  const avg = fpsValue(p.avgFps);
  const fromNominal = nominal <= 120 && nominal >= avg * 0.9 ? nearestStandard(nominal, 0.005) : null;
  if (fromNominal) return fromNominal;
  return nearestStandard(avg, 0.03) ?? { num: Math.round(avg * 1000), den: 1000 };
}

export function needsMaster(p: Pick<ProbeResult, "variableFrameRate">): boolean {
  return p.variableFrameRate;
}

export function masterArgs(input: string, output: string, rate: FrameRate, hasAudio: boolean): string[] {
  return [
    "-i",
    input,
    "-map",
    "0:v:0",
    ...(hasAudio ? ["-map", "0:a:0"] : []),
    "-vf",
    // fps= re-times onto the fixed grid (duplicating into gaps, dropping extras); square pixels.
    `fps=${rate.num}/${rate.den}:round=near,scale=w='trunc(iw*sar/2)*2':h='trunc(ih/2)*2',setsar=1,format=yuv420p`,
    "-fps_mode",
    "cfr",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "12",
    "-g",
    String(Math.max(1, Math.round(fpsValue(rate)))),
    ...(hasAudio ? ["-c:a", "aac", "-b:a", "256k"] : ["-an"]),
    "-movflags",
    "+faststart",
    output,
  ];
}

export function createMaster(
  input: string,
  output: string,
  rate: FrameRate,
  opts: { hasAudio: boolean; durationSec: number; onProgress?: (f: number) => void; signal?: AbortSignal },
) {
  return runFfmpeg(masterArgs(input, output, rate, opts.hasAudio), opts);
}
