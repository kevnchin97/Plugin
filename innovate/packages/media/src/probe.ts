import { type FrameRate, parseFrameRate } from "@innovate/shared";
import { runFfprobe } from "./run";

export interface ProbeResult {
  formatName: string;
  durationSec: number;
  /** Display dimensions (rotation and pixel aspect applied). */
  width: number;
  height: number;
  fps: FrameRate;
  /** Container's nominal rate (r_frame_rate) and the measured average rate. */
  nominalFps: FrameRate;
  avgFps: FrameRate;
  /** True when avg and nominal rates disagree (phone footage). Ingest makes a CFR master. */
  variableFrameRate: boolean;
  frameCount: number;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec: string | null;
  /** Seconds from container start to the first video frame. */
  videoStartOffset: number;
  rotation: number;
}

interface FfStream {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  nb_frames?: string;
  duration?: string;
  start_time?: string;
  sample_aspect_ratio?: string;
  side_data_list?: { rotation?: number }[];
  tags?: { rotate?: string };
}

export async function probe(file: string, signal?: AbortSignal): Promise<ProbeResult> {
  const raw = await runFfprobe(["-print_format", "json", "-show_format", "-show_streams", file], signal);
  const data = JSON.parse(raw) as { streams: FfStream[]; format: { duration?: string; format_name: string; start_time?: string } };
  const video = data.streams.find((s) => s.codec_type === "video" && s.codec_name !== "mjpeg" && s.codec_name !== "png");
  if (!video || !video.width || !video.height) throw new Error("The source has no video stream.");
  const audio = data.streams.find((s) => s.codec_type === "audio") ?? null;

  const nominal = parseFrameRate(video.r_frame_rate);
  const avg = parseFrameRate(video.avg_frame_rate);
  const avgValue = avg.num / avg.den;
  const nominalValue = nominal.num / nominal.den;
  const variableFrameRate = Math.abs(avgValue - nominalValue) / nominalValue > 0.01;
  const fps = variableFrameRate ? avg : nominal;

  const durationSec = Number(data.format.duration ?? video.duration ?? 0);
  const formatStart = Number(data.format.start_time ?? 0) || 0;
  const videoStart = Number(video.start_time ?? formatStart) || 0;

  const rotationRaw = video.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation ?? Number(video.tags?.rotate ?? 0);
  const rotation = ((Math.round(rotationRaw) % 360) + 360) % 360;
  const [sarN, sarD] = (video.sample_aspect_ratio ?? "1:1").split(":").map(Number);
  const sar = sarN && sarD ? sarN / sarD : 1;
  let width = Math.round(video.width * sar);
  let height = video.height;
  if (rotation === 90 || rotation === 270) [width, height] = [height, width];

  const nbFrames = Number(video.nb_frames);
  const frameCount = Number.isFinite(nbFrames) && nbFrames > 0 ? nbFrames : Math.round((durationSec * fps.num) / fps.den);

  return {
    formatName: data.format.format_name,
    durationSec,
    width,
    height,
    fps,
    nominalFps: nominal,
    avgFps: avg,
    variableFrameRate,
    frameCount,
    hasAudio: Boolean(audio),
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
    videoStartOffset: Math.max(0, videoStart - formatStart),
    rotation,
  };
}
