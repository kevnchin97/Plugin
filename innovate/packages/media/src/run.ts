import { spawn } from "node:child_process";

export const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
export const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "FfmpegError";
  }
}

export interface RunOptions {
  /** Expected output duration in seconds, used to turn `out_time` into 0..1 progress. */
  durationSec?: number;
  onProgress?: (fraction: number) => void;
  /** Receives stdout lines (when not used for progress). */
  onStdoutLine?: (line: string) => void;
  signal?: AbortSignal;
  /** Working directory (lets filter graphs name files without absolute paths, which break on Windows drive letters). */
  cwd?: string;
}

/** Turn ffmpeg's stderr into one readable sentence for the UI. */
export function explainFfmpegError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes("invalid data found when processing input") || s.includes("moov atom not found"))
    return "This file isn't a video we can read. It may be incomplete or in an unsupported format.";
  if (s.includes("no such file or directory")) return "The source file is missing on the worker.";
  if (s.includes("does not contain any stream") || s.includes("output file does not contain any stream"))
    return "The source has no video stream.";
  if (s.includes("decoder") && s.includes("not found")) return "This video uses a codec the worker can't decode.";
  if (s.includes("no space left on device")) return "The worker ran out of disk space.";
  const last = stderr.trim().split("\n").filter(Boolean).slice(-1)[0];
  return last ? `ffmpeg failed: ${last.slice(0, 300)}` : "ffmpeg failed";
}

function spawnTool(bin: string, args: string[], opts: RunOptions & { progress: boolean }): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], signal: opts.signal, cwd: opts.cwd });
    let stdout = "";
    let stderr = "";
    let partial = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (!opts.progress && !opts.onStdoutLine) {
        stdout += chunk;
        return;
      }
      partial += chunk;
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) {
        if (opts.onStdoutLine) opts.onStdoutLine(line);
        if (opts.progress && opts.onProgress && opts.durationSec && line.startsWith("out_time_us=")) {
          const us = Number(line.slice("out_time_us=".length));
          if (Number.isFinite(us)) opts.onProgress(Math.min(1, Math.max(0, us / 1e6 / opts.durationSec)));
        }
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });
    child.on("error", (err) => reject(new FfmpegError(`Could not start ${bin}: ${err.message}`, stderr, null)));
    child.on("close", (code) => {
      if (partial && opts.onStdoutLine) opts.onStdoutLine(partial);
      if (code === 0) {
        opts.onProgress?.(1);
        resolve(stdout);
      } else reject(new FfmpegError(explainFfmpegError(stderr), stderr, code));
    });
  });
}

/** Run ffmpeg with progress reporting on stdout. Never call this from a web request handler. */
export function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<string> {
  const useProgress = !opts.onStdoutLine;
  const full = ["-nostdin", "-hide_banner", "-v", "error", "-y", ...(useProgress ? ["-progress", "pipe:1", "-nostats"] : []), ...args];
  return spawnTool(FFMPEG, full, { ...opts, progress: useProgress });
}

export function runFfprobe(args: string[], signal?: AbortSignal): Promise<string> {
  return spawnTool(FFPROBE, ["-v", "error", ...args], { progress: false, signal });
}
