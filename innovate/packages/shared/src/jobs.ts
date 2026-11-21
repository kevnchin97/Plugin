/** Contract between apps/web (enqueues) and apps/worker (processes). */
import type { ExportRequest } from "./schemas";

export const MEDIA_QUEUE = "media";
/** CLIP embeddings run on their own queue (CPU-bound, one model in memory, never behind a long ffmpeg job). */
export const EMBED_QUEUE = "embed";

/** Embed a reference's images / keyframes (and describe it with Claude when configured). Job id: `embed:<refId>`. */
export interface EmbedRefJobData {
  type: "embed";
  referenceId: string;
  workspaceId: string;
}
/** Embed search text with the CLIP text encoder; the job's return value is the vector. */
export interface EmbedTextJobData {
  type: "embed-text";
  text: string;
}
/** Periodic: queue references that were never embedded. */
export interface EmbedSweepJobData {
  type: "embed-sweep";
}
export type EmbedJobData = EmbedRefJobData | EmbedTextJobData | EmbedSweepJobData;
export const CLIP_MODEL = "Xenova/clip-vit-base-patch32";
export const CLIP_DIMENSIONS = 512;

export type JobStatus = "queued" | "active" | "completed" | "failed";
export const jobStages = [
  "queued",
  "fetching",
  "probing",
  "master",
  "proxy",
  "filmstrip",
  "scenes",
  "downloading",
  "palette",
  "encoding",
  "uploading",
  "done",
] as const;
export type JobStage = (typeof jobStages)[number];

export interface IngestJobData {
  type: "ingest";
  jobId: string;
  referenceId: string;
  workspaceId: string;
}

export interface ExportJobData {
  type: "export";
  jobId: string;
  referenceId: string;
  workspaceId: string;
  request: ExportRequest;
}

/** Fetch an image from the web (extension saves, page preview images). */
export interface ImportJobData {
  type: "import";
  jobId: string;
  referenceId: string;
  workspaceId: string;
  url: string;
  /** "original": the reference IS this image. "thumbnail": a preview image for a link reference. */
  as: "original" | "thumbnail";
}

/** Render a shot list to PDF (first frames via ffmpeg, so it runs on the worker). */
export interface PdfJobData {
  type: "pdf";
  jobId: string;
  workspaceId: string;
  shotListId: string;
}

/** Render a deck to PDF (posters for motion items via ffmpeg). */
export interface DeckPdfJobData {
  type: "deck-pdf";
  jobId: string;
  workspaceId: string;
  deckId: string;
}

/** Render a reel (trims + title/end cards) to one MP4. */
export interface ReelRenderJobData {
  type: "reel-render";
  jobId: string;
  workspaceId: string;
  reelId: string;
}

/** Daily email digest of unsent notifications (repeatable, scheduled by the worker). */
export interface DigestJobData {
  type: "digest";
  jobId: string;
}

export type MediaJobData = IngestJobData | ExportJobData | DigestJobData | ImportJobData | PdfJobData | DeckPdfJobData | ReelRenderJobData;

export interface ExportOutput {
  key: string;
  filename: string;
  contentType: string;
  bytes: number;
  width: number;
  height: number;
  durationSec: number;
  sourceIn: number;
  sourceOut: number;
}

export interface FilmstripInfo {
  key: string;
  /** Seconds between tiles. Tile i shows the frame at i * interval. */
  interval: number;
  count: number;
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

/** Object storage layout. Keys are deterministic so reruns overwrite instead of duplicating. */
export const storageKeys = {
  original: (ws: string, ref: string, ext: string) => `ws/${ws}/ref/${ref}/original.${ext}`,
  master: (ws: string, ref: string) => `ws/${ws}/ref/${ref}/master.mp4`,
  proxy: (ws: string, ref: string) => `ws/${ws}/ref/${ref}/proxy.mp4`,
  filmstrip: (ws: string, ref: string) => `ws/${ws}/ref/${ref}/filmstrip.jpg`,
  thumbnail: (ws: string, ref: string) => `ws/${ws}/ref/${ref}/thumb.jpg`,
  scene: (ws: string, ref: string, index: number) => `ws/${ws}/ref/${ref}/scenes/${String(index).padStart(4, "0")}.jpg`,
  export: (ws: string, ref: string, hash: string, ext: string) => `ws/${ws}/ref/${ref}/exports/${hash}.${ext}`,
};
