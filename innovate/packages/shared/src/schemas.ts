import { z } from "zod";

export const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const VIDEO_EXTENSIONS = ["mp4", "mov", "webm", "m4v"] as const;
/** 4 GB. TODO(M2): resumable multipart uploads for larger files (SPEC §5.2). */
export const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;

export const referenceTypes = ["image", "gif", "clip", "still", "video", "link", "note"] as const;
export type ReferenceType = (typeof referenceTypes)[number];

export const ingestStages = ["uploading", "fetching", "probing", "proxy", "filmstrip", "scenes", "ready"] as const;
export type IngestStage = (typeof ingestStages)[number];

export const createUploadSchema = z.object({
  kind: z.literal("upload"),
  filename: z.string().min(1).max(255),
  contentType: z.enum(VIDEO_MIME_TYPES),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

export const createFromUrlSchema = z.object({
  kind: z.literal("url"),
  url: z.url({ protocol: /^https?$/ }).max(2048),
});

export const createReferenceSchema = z.discriminatedUnion("kind", [createUploadSchema, createFromUrlSchema]);
export type CreateReferenceInput = z.infer<typeof createReferenceSchema>;

export const gifLoopModes = ["loop", "boomerang"] as const;
export const GIF_WIDTHS = [320, 480, 640, 800, 1080] as const;
export const GIF_FPS = [10, 12, 15, 20, 24, 30] as const;

export const gifOptionsSchema = z.object({
  width: z.number().int().min(64).max(1920),
  fps: z.number().int().min(1).max(50),
  loop: z.enum(gifLoopModes),
  /** 0 = smallest file, 100 = best quality. */
  quality: z.number().int().min(0).max(100),
});
export type GifOptions = z.infer<typeof gifOptionsSchema>;

export const DEFAULT_GIF_OPTIONS: GifOptions = { width: 640, fps: 15, loop: "loop", quality: 70 };

const rangeShape = {
  referenceId: z.uuid(),
  /** Inclusive frame indices on the source's frame grid. */
  inFrame: z.number().int().min(0),
  outFrame: z.number().int().min(0),
};

export const exportRequestSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("still"), referenceId: z.uuid(), frame: z.number().int().min(0), format: z.enum(["png", "jpg"]) }),
    z.object({ kind: z.literal("gif"), ...rangeShape, options: gifOptionsSchema }),
    z.object({ kind: z.literal("clip"), ...rangeShape }),
  ])
  .refine((r) => r.kind === "still" || r.outFrame >= r.inFrame, { message: "Out point must be after the in point" });
export type ExportRequest = z.infer<typeof exportRequestSchema>;
export type ExportKind = ExportRequest["kind"];

/** Max range per export, keeps a stray I/O from rendering a 2-hour GIF. */
export const MAX_GIF_SECONDS = 60;
export const MAX_CLIP_SECONDS = 15 * 60;

export const saveExportSchema = z.object({
  title: z.string().max(200).optional(),
  /** Board to place the saved item on; omitted = Unsorted. */
  boardId: z.uuid().nullable().optional(),
});

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

export const createImageUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.enum(IMAGE_MIME_TYPES),
  size: z.number().int().positive().max(100 * 1024 ** 2),
  width: z.number().int().positive().max(20_000),
  height: z.number().int().positive().max(20_000),
  boardId: z.uuid().nullable().optional(),
});
