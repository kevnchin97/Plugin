/**
 * Scene detection. One ffmpeg pass over the proxy prints, per frame, the scene-change score
 * (select's `scene` = how different this frame is from the previous one, 0..1) and
 * signalstats (YDIF = motion, YLOW/YHIGH = contrast). Cut picking and scoring are pure
 * functions over that table so they can be unit-tested without ffmpeg.
 */
import { type FrameRate, frameToSeconds } from "@innovate/shared";
import { runFfmpeg } from "./run";

export interface FrameStat {
  frame: number;
  time: number;
  scene: number;
  /** Mean abs luma difference to the previous frame (0..255). */
  ydif: number;
  /** YHIGH - YLOW (90th - 10th luma percentile). */
  contrast: number;
}

export interface CutOptions {
  /** Minimum scene score for a cut. ffmpeg's docs suggest 0.3-0.4 for hard cuts. */
  threshold: number;
  /** A cut must also stand out from its neighbours by this factor (rejects fast motion). */
  spikeRatio: number;
  /** Cuts closer than this are merged; the stronger one wins. */
  minShotFrames: number;
}

export const DEFAULT_CUT_OPTIONS = { threshold: 0.3, spikeRatio: 2.5, minShotSeconds: 0.5 };

export interface DetectedScene {
  index: number;
  startFrame: number;
  /** Exclusive. */
  endFrame: number;
  start: number;
  end: number;
  motion: number;
  contrast: number;
  score: number;
  /** Rank by score, 0 = most worth saving. */
  rank: number;
}

/** Parse `metadata=mode=print` output into one row per frame. */
export function parseFrameStats(text: string): FrameStat[] {
  const rows: FrameStat[] = [];
  let cur: FrameStat | null = null;
  let low = 0;
  let high = 0;
  const flush = () => {
    if (cur) {
      cur.contrast = Math.max(0, high - low);
      rows.push(cur);
    }
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("frame:")) {
      flush();
      const n = /frame:\s*(\d+)/.exec(line);
      const t = /pts_time:\s*([-\d.e]+)/.exec(line);
      cur = { frame: Number(n?.[1] ?? rows.length), time: Number(t?.[1] ?? 0), scene: 0, ydif: 0, contrast: 0 };
      low = 0;
      high = 0;
      continue;
    }
    if (!cur) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    const value = Number(line.slice(eq + 1));
    if (!Number.isFinite(value)) continue;
    if (key === "lavfi.scene_score") cur.scene = value;
    else if (key === "lavfi.signalstats.YDIF") cur.ydif = value;
    else if (key === "lavfi.signalstats.YLOW") low = value;
    else if (key === "lavfi.signalstats.YHIGH") high = value;
  }
  flush();
  return rows;
}

/** Returns cut frame indices (the first frame of each new shot), ascending. */
export function detectCuts(stats: FrameStat[], opts: CutOptions): number[] {
  const n = stats.length;
  const candidates: { frame: number; score: number }[] = [];
  for (let i = 1; i < n; i++) {
    const s = stats[i]!.scene;
    if (s < opts.threshold) continue;
    let sum = 0;
    let count = 0;
    for (let j = Math.max(1, i - 6); j <= Math.min(n - 1, i + 6); j++) {
      if (Math.abs(j - i) <= 1) continue;
      sum += stats[j]!.scene;
      count++;
    }
    const neighbourhood = count ? sum / count : 0;
    if (neighbourhood > 0 && s < neighbourhood * opts.spikeRatio) continue;
    candidates.push({ frame: stats[i]!.frame, score: s });
  }
  // Strongest first; accept a cut only if it leaves every shot at least minShotFrames long.
  candidates.sort((a, b) => b.score - a.score || a.frame - b.frame);
  const total = n ? stats[n - 1]!.frame + 1 : 0;
  const accepted: number[] = [];
  for (const c of candidates) {
    if (c.frame < opts.minShotFrames || total - c.frame < opts.minShotFrames) continue;
    if (accepted.some((a) => Math.abs(a - c.frame) < opts.minShotFrames)) continue;
    accepted.push(c.frame);
  }
  return accepted.sort((a, b) => a - b);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * "Worth saving" heuristic (SPEC §5.1): motion energy, duration and contrast.
 * Each term is squashed to 0..1; weights favour motion because that's what GIFs are for:
 * a static shot, however striking, is better saved as a still.
 */
export function scoreScene(motion: number, contrast: number, seconds: number): number {
  const motionScore = 1 - Math.exp(-motion / 3);
  const contrastScore = Math.min(1, Math.max(0, (contrast - 30) / 150));
  let durationScore: number;
  if (seconds < 0.75) durationScore = 0.15;
  else if (seconds < 2) durationScore = 0.15 + ((seconds - 0.75) / 1.25) * 0.85;
  else if (seconds <= 8) durationScore = 1;
  else durationScore = Math.max(0.55, 1 - (seconds - 8) / 40);
  return Math.round((0.55 * motionScore + 0.2 * contrastScore + 0.25 * durationScore) * 1000) / 1000;
}

export function buildScenes(stats: FrameStat[], cuts: number[], fps: FrameRate, frameCount?: number): DetectedScene[] {
  const total = frameCount ?? (stats.length ? stats[stats.length - 1]!.frame + 1 : 0);
  if (total <= 0) return [];
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < total), total];
  const byFrame = new Map(stats.map((s) => [s.frame, s]));
  const scenes: DetectedScene[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const startFrame = bounds[i]!;
    const endFrame = bounds[i + 1]!;
    const motion: number[] = [];
    const contrast: number[] = [];
    for (let f = startFrame; f < endFrame; f++) {
      const s = byFrame.get(f);
      if (!s) continue;
      if (f > startFrame) motion.push(s.ydif); // the cut frame's diff is the cut itself
      contrast.push(s.contrast);
    }
    const start = frameToSeconds(startFrame, fps);
    const end = frameToSeconds(endFrame, fps);
    const m = mean(motion);
    const c = mean(contrast);
    scenes.push({
      index: i,
      startFrame,
      endFrame,
      start,
      end,
      motion: Math.round(m * 100) / 100,
      contrast: Math.round(c * 10) / 10,
      score: scoreScene(m, c, end - start),
      rank: 0,
    });
  }
  [...scenes]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .forEach((s, rank) => {
      s.rank = rank;
    });
  return scenes;
}

/** Run the analysis pass. Use the proxy as input: it's small and has the same frame grid. */
export async function analyzeFrames(
  input: string,
  opts: { durationSec: number; onProgress?: (f: number) => void; signal?: AbortSignal },
): Promise<FrameStat[]> {
  const chunks: string[] = [];
  let lastReport = 0;
  await runFfmpeg(
    [
      "-i",
      input,
      "-an",
      "-sn",
      "-dn",
      "-vf",
      "scale=w=256:h=-2:flags=fast_bilinear,select='gte(scene,0)',signalstats,metadata=mode=print:file=-",
      "-fps_mode",
      "passthrough",
      "-f",
      "null",
      "-",
    ],
    {
      signal: opts.signal,
      onStdoutLine: (line) => {
        chunks.push(line);
        if (opts.onProgress && line.startsWith("frame:")) {
          const t = /pts_time:\s*([\d.]+)/.exec(line);
          const now = Date.now();
          if (t && now - lastReport > 250) {
            lastReport = now;
            opts.onProgress(Math.min(1, Number(t[1]) / Math.max(0.001, opts.durationSec)));
          }
        }
      },
    },
  );
  return parseFrameStats(chunks.join("\n"));
}

export async function detectScenes(
  input: string,
  fps: FrameRate,
  opts: { durationSec: number; frameCount?: number; onProgress?: (f: number) => void; signal?: AbortSignal } & Partial<
    typeof DEFAULT_CUT_OPTIONS
  >,
): Promise<{ scenes: DetectedScene[]; stats: FrameStat[] }> {
  const stats = await analyzeFrames(input, opts);
  const fpsValue = fps.num / fps.den;
  const cuts = detectCuts(stats, {
    threshold: opts.threshold ?? DEFAULT_CUT_OPTIONS.threshold,
    spikeRatio: opts.spikeRatio ?? DEFAULT_CUT_OPTIONS.spikeRatio,
    minShotFrames: Math.max(1, Math.round((opts.minShotSeconds ?? DEFAULT_CUT_OPTIONS.minShotSeconds) * fpsValue)),
  });
  // Decoded frame count is the truth; container nb_frames can be off by a few.
  return { scenes: buildScenes(stats, cuts, fps, stats.length || opts.frameCount), stats };
}
