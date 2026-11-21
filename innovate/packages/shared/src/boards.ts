/** Board API contract (M2). Positions are canvas pixels at zoom 1. */
import { z } from "zod";

export const boardItemKinds = ["reference", "note", "link", "column", "board", "arrow"] as const;
export type BoardItemKind = (typeof boardItemKinds)[number];

export const COLUMN_WIDTH = 252;
export const DEFAULT_CARD_WIDTH = 240;

const coord = z.number().finite().min(-1e6).max(1e6);
const content = z
  .object({
    text: z.string().max(20_000).optional(),
    url: z.url({ protocol: /^https?$/ }).max(2048).optional(),
    title: z.string().max(300).optional(),
    host: z.string().max(255).optional(),
    from: z.uuid().optional(),
    to: z.uuid().optional(),
    /** Notes: a colour (labels and stickies, Milanote-style). */
    color: z.enum(["white", "yellow", "green", "brown", "slate", "blue", "red", "ink"]).optional(),
    /** Colour swatch cards: the colour shown, as #rrggbb. */
    swatch: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  })
  .strict();

export const NOTE_COLORS = ["white", "yellow", "green", "brown", "slate", "blue", "red", "ink"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export const createBoardSchema = z.object({
  title: z.string().trim().min(1).max(200).default("Untitled board"),
  parentBoardId: z.uuid().nullable().optional(),
  /** Also put a board card for it on the parent (the canvas adds its own card, so it sends false). */
  placeCard: z.boolean().default(true),
});

export const updateBoardSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  view: z.enum(["canvas", "grid"]).optional(),
});

export const newItemSchema = z.object({
  /** Client-generated so optimistic UI and undo can refer to it before the server answers. */
  id: z.uuid(),
  kind: z.enum(boardItemKinds),
  referenceId: z.uuid().nullable().optional(),
  childBoardId: z.uuid().nullable().optional(),
  /** For kind "board": create a new child board with this title. */
  newBoardTitle: z.string().trim().min(1).max(200).optional(),
  columnId: z.uuid().nullable().optional(),
  x: coord.default(0),
  y: coord.default(0),
  w: z.number().min(80).max(2400).default(DEFAULT_CARD_WIDTH),
  z: z.number().int().default(0),
  position: z.number().finite().default(0),
  content: content.default({}),
});
export type NewBoardItem = z.infer<typeof newItemSchema>;

export const itemPatchSchema = z.object({
  id: z.uuid(),
  /** Move to another board (e.g. dropped onto a board card). */
  boardId: z.uuid().optional(),
  columnId: z.uuid().nullable().optional(),
  x: coord.optional(),
  y: coord.optional(),
  w: z.number().min(80).max(2400).optional(),
  z: z.number().int().optional(),
  position: z.number().finite().optional(),
  content: content.optional(),
});
export type BoardItemPatch = z.infer<typeof itemPatchSchema>;

export const boardOpsSchema = z.object({
  create: z.array(newItemSchema).max(500).default([]),
  update: z.array(itemPatchSchema).max(2000).default([]),
  delete: z.array(z.uuid()).max(2000).default([]),
});
export type BoardOps = z.infer<typeof boardOpsSchema>;

/** Order key between two neighbours in a column (floats; renumbered by the server when they get close). */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1024;
  if (before === null) return after! - 1024;
  if (after === null) return before + 1024;
  return (before + after) / 2;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
