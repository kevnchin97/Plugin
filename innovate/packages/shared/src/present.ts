/** Decks, reels and portfolio (SPEC §5.5): shared shapes, templates and validation. */
import { z } from "zod";

export const SLIDE_LAYOUTS = ["title", "text", "media", "media-text", "grid"] as const;
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number];
export const SLIDE_LAYOUT_LABEL: Record<SlideLayout, string> = {
  title: "Title",
  text: "Text",
  media: "Full-bleed media",
  "media-text": "Media + text",
  grid: "Grid of references",
};
export const DECK_THEMES = ["paper", "night"] as const;

/** SPEC §5.5 treatment template: title, logline, tone, look and feel, characters, locations, shot approach. */
export const TREATMENT_TEMPLATE: { section: string; layout: SlideLayout; heading: string; body: string }[] = [
  { section: "title", layout: "title", heading: "", body: "A treatment" },
  { section: "logline", layout: "text", heading: "Logline", body: "One sentence: who wants what, and what stands in the way." },
  { section: "tone", layout: "media-text", heading: "Tone", body: "How it should feel. The mood the audience leaves with." },
  { section: "look", layout: "grid", heading: "Look and feel", body: "Light, palette, texture, lensing." },
  { section: "characters", layout: "media-text", heading: "Characters", body: "Who we follow, and how we see them." },
  { section: "locations", layout: "grid", heading: "Locations", body: "Where it happens and why those places." },
  { section: "shots", layout: "media-text", heading: "Shot approach", body: "Camera, movement and coverage. How the motion references translate." },
];
export const DECK_TEMPLATES = ["treatment", "blank"] as const;

const text = (max: number) => z.string().max(max);

export const createDeckSchema = z.object({
  title: text(200).trim().min(1).default("Untitled deck"),
  template: z.enum(DECK_TEMPLATES).default("treatment"),
  /** Draft from a board: its references fill the template's media slots. */
  boardId: z.uuid().nullable().optional(),
});

export const slideInputSchema = z.object({
  id: z.uuid(),
  layout: z.enum(SLIDE_LAYOUTS),
  section: text(40).default(""),
  heading: text(300).default(""),
  body: text(4000).default(""),
  mediaIds: z.array(z.uuid()).max(12).default([]),
  notes: text(4000).default(""),
});
export type SlideInput = z.infer<typeof slideInputSchema>;

/** Whole-deck save (slides in order). Last write wins; decks have one editor at a time in practice. */
export const saveDeckSchema = z.object({
  title: text(200).trim().min(1),
  theme: z.enum(DECK_THEMES),
  slides: z.array(slideInputSchema).max(200),
});
export type SaveDeck = z.infer<typeof saveDeckSchema>;

export const createReelSchema = z.object({ title: text(200).trim().min(1).default("Untitled reel") });

export const reelItemInputSchema = z
  .object({
    id: z.uuid(),
    referenceId: z.uuid(),
    inSec: z.number().min(0).nullable(),
    outSec: z.number().min(0).nullable(),
  })
  .refine((i) => i.inSec === null || i.outSec === null || i.outSec > i.inSec, { message: "A trim's out point must be after its in point." });

export const saveReelSchema = z.object({
  title: text(200).trim().min(1),
  titleCard: text(120).default(""),
  titleCardSub: text(160).default(""),
  endCard: text(120).default(""),
  endCardSub: text(160).default(""),
  items: z.array(reelItemInputSchema).max(100),
});
export type SaveReel = z.infer<typeof saveReelSchema>;

/** Seconds a title or end card holds in the player and the rendered MP4. */
export const REEL_CARD_SECONDS = 2.5;

/** Duration of an item after trims. */
export function trimmedDuration(item: { inSec: number | null; outSec: number | null }, duration: number): number {
  const a = Math.max(0, Math.min(item.inSec ?? 0, duration));
  const b = Math.max(a, Math.min(item.outSec ?? duration, duration));
  return b - a;
}

export const PORTFOLIO_TEMPLATES = ["grid", "feature", "list"] as const;
export const PORTFOLIO_TEMPLATE_LABEL: Record<(typeof PORTFOLIO_TEMPLATES)[number], string> = {
  grid: "Grid",
  feature: "Feature (first item large)",
  list: "List with captions",
};
export const RESERVED_SLUGS = ["admin", "api", "app", "login", "new", "settings", "p", "s"];
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters.")
  .max(40, "Use at most 40 characters.")
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Use lowercase letters, numbers and dashes.")
  .refine((s) => !RESERVED_SLUGS.includes(s), "That address is reserved.");

export const savePortfolioSchema = z.object({
  slug: slugSchema,
  title: text(120).default(""),
  bio: text(2000).default(""),
  contactEmail: z.union([z.literal(""), z.email("That email address doesn't look right.")]).default(""),
  website: z.union([z.literal(""), z.url({ protocol: /^https?$/, message: "Use a full http(s) address." })]).default(""),
  template: z.enum(PORTFOLIO_TEMPLATES).default("grid"),
  published: z.boolean().default(false),
  items: z
    .array(
      z
        .object({ referenceId: z.uuid().nullable().default(null), reelId: z.uuid().nullable().default(null), caption: text(300).default("") })
        .refine((i) => Boolean(i.referenceId) !== Boolean(i.reelId), { message: "Each portfolio item is one reference or one reel." }),
    )
    .max(60),
});
export type SavePortfolio = z.infer<typeof savePortfolioSchema>;
