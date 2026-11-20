import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg, runFfprobe } from "../src/run";

export const tmp = () => mkdtempSync(join(tmpdir(), "innovate-media-"));

/** Mean luma (YAVG) of every decoded frame, in order. */
export async function frameLumas(file: string): Promise<number[]> {
  const lines: string[] = [];
  await runFfmpeg(["-i", file, "-an", "-vf", "signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"], {
    onStdoutLine: (l) => lines.push(l),
  });
  return lines.filter((l) => l.startsWith("lavfi.signalstats.YAVG=")).map((l) => Number(l.split("=")[1]));
}

export async function streams(file: string) {
  const raw = await runFfprobe(["-print_format", "json", "-count_frames", "-show_streams", "-show_format", file]);
  return JSON.parse(raw) as {
    streams: { codec_type: string; codec_name: string; width?: number; height?: number; nb_read_frames?: string; duration?: string }[];
    format: { duration: string; format_name: string; size: string };
  };
}

/** Recover the frame index (mod 55) the frames fixture encoded into a luma value. */
export const indexFromLuma = (y: number) => Math.round((y - 16) / 4);
