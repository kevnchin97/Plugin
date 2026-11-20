/**
 * Frame and timecode math. Everything in the editor is addressed by integer frame index;
 * seconds are derived from a rational frame rate so 29.97 (30000/1001) stays exact.
 *
 * Timecodes are non-drop-frame HH:MM:SS:FF using the nominal (rounded) rate, which is what
 * most NLEs show for web footage. TODO(M2): drop-frame display (;) for 29.97/59.94 sources.
 */

export interface FrameRate {
  num: number;
  den: number;
}

export const DEFAULT_FPS: FrameRate = { num: 25, den: 1 };

/** Parse an ffprobe rate like "30000/1001" or "25". Falls back to 25 for "0/0". */
export function parseFrameRate(value: string | undefined | null): FrameRate {
  if (!value) return DEFAULT_FPS;
  const [n, d] = value.split("/").map(Number);
  const num = n ?? 0;
  const den = d ?? 1;
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return DEFAULT_FPS;
  return { num, den };
}

export function fpsValue(fps: FrameRate): number {
  return fps.num / fps.den;
}

/** Frames per timecode second (25, 24, 30 for 29.97, 60 for 59.94). */
export function nominalFps(fps: FrameRate): number {
  return Math.max(1, Math.round(fpsValue(fps)));
}

/** Presentation time (seconds) of the start of frame `frame`. */
export function frameToSeconds(frame: number, fps: FrameRate): number {
  return (frame * fps.den) / fps.num;
}

/**
 * Frame index displayed at time `seconds` (the last frame whose start is <= t).
 * A small epsilon absorbs float error so exact frame starts map to themselves.
 */
export function secondsToFrame(seconds: number, fps: FrameRate): number {
  return Math.max(0, Math.floor((seconds * fps.num) / fps.den + 1e-6));
}

/** Time to seek a <video> element to so it shows `frame`: the middle of the frame. */
export function frameSeekTime(frame: number, fps: FrameRate): number {
  return ((frame + 0.5) * fps.den) / fps.num;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function formatTimecode(frame: number, fps: FrameRate): string {
  const f = Math.max(0, Math.floor(frame));
  const base = nominalFps(fps);
  const ff = f % base;
  const totalSeconds = Math.floor(f / base);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

/** Inverse of formatTimecode. Returns null for malformed input. */
export function parseTimecode(tc: string, fps: FrameRate): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})[:;](\d{2})$/.exec(tc.trim());
  if (!m) return null;
  const [hh, mm, ss, ff] = m.slice(1).map(Number) as [number, number, number, number];
  const base = nominalFps(fps);
  if (mm > 59 || ss > 59 || ff >= base) return null;
  return ((hh * 60 + mm) * 60 + ss) * base + ff;
}

/** Human duration for a frame count, e.g. "3.20s" or "1m 04s". */
export function formatDuration(frames: number, fps: FrameRate): string {
  const s = frameToSeconds(frames, fps);
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${pad(Math.floor(s % 60))}s`;
}
