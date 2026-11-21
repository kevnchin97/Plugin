/** Sharing, favorites and comments (M3). */
import { z } from "zod";

export const sharePermissions = ["view", "favorite", "comment"] as const;
export type SharePermission = (typeof sharePermissions)[number];

export const createShareSchema = z.object({
  permission: z.enum(sharePermissions).default("view"),
  password: z.string().min(4).max(200).optional(),
  /** ISO date or datetime; the link stops working after it. */
  expiresAt: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
});

export const guestSchema = z.object({ name: z.string().trim().min(1).max(60) });

export const commentSchema = z.object({
  referenceId: z.uuid(),
  body: z.string().trim().min(1).max(5000),
  /** Seconds into a motion reference. */
  timecode: z.number().min(0).max(86_400).nullable().optional(),
  parentId: z.uuid().nullable().optional(),
});

export const favoriteSchema = z.object({ referenceId: z.uuid() });

export const resolveSchema = z.object({ resolved: z.boolean() });

/** @mentions: "@Ana" or "@ana.k" (letters, digits, dot, dash, underscore). */
export function parseMentions(body: string): string[] {
  return [...new Set([...body.matchAll(/(?:^|\s)@([\p{L}\p{N}._-]{1,40})/gu)].map((m) => m[1]!))];
}

export const canFavorite = (p: SharePermission) => p === "favorite" || p === "comment";
export const canComment = (p: SharePermission) => p === "comment";
