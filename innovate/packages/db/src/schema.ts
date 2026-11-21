/**
 * Database schema. M0/M1 tables only: auth, workspaces, references, scenes and media jobs.
 * Boards, shot lists, decks, shares and comments arrive with their milestones (SPEC §4, §7).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type { ExportOutput, ExportRequest, FilmstripInfo, JobStage, JobStatus } from "@innovate/shared";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/* ---------- Auth.js (shape required by @auth/drizzle-adapter) ---------- */

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date", withTimezone: true }),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/* ---------- Workspaces ---------- */

export const roleEnum = pgEnum("role", ["owner", "editor", "commenter", "viewer"]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ...timestamps,
});

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

/* ---------- References ---------- */

export const referenceTypeEnum = pgEnum("reference_type", ["image", "gif", "clip", "still", "video", "link", "note"]);
export const referenceStatusEnum = pgEnum("reference_status", ["pending", "processing", "ready", "failed"]);

export const references = pgTable(
  // "references" is a reserved word in SQL; the table is `refs`.
  "refs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    type: referenceTypeEnum("type").notNull(),
    status: referenceStatusEnum("status").notNull().default("pending"),
    /** Current ingest stage for the UI (uploading, fetching, proxy, filmstrip, scenes, ready). */
    stage: text("stage"),
    error: text("error"),

    // Media
    originalKey: text("original_key"),
    /** CFR re-time of a variable-frame-rate original; proxy, scenes and exports use it when set. */
    masterKey: text("master_key"),
    variableFrameRate: boolean("variable_frame_rate").notNull().default(false),
    proxyKey: text("proxy_key"),
    thumbnailKey: text("thumbnail_key"),
    filmstrip: jsonb("filmstrip").$type<FilmstripInfo>(),
    contentType: text("content_type"),
    bytes: bigint("bytes", { mode: "number" }),
    width: integer("width"),
    height: integer("height"),
    duration: doublePrecision("duration"),
    fpsNum: integer("fps_num"),
    fpsDen: integer("fps_den"),
    frameCount: integer("frame_count"),
    hasAudio: boolean("has_audio"),
    /** Seconds between the container start and the first video frame (for exact seeks). */
    videoStartOffset: doublePrecision("video_start_offset").default(0),

    // Source & lineage
    sourceUrl: text("source_url"),
    sourcePlatform: text("source_platform"),
    sourceIn: doublePrecision("source_in"),
    sourceOut: doublePrecision("source_out"),
    parentReferenceId: uuid("parent_reference_id"),

    // Content
    title: text("title").notNull().default("Untitled"),
    notes: text("notes"),
    autoDescription: text("auto_description"),
    /** Mean of the reference's CLIP embeddings (rows in `embeddings`), for "more like this". */
    embedding: vector("embedding", { dimensions: 512 }),
    /** Last time the embed job ran (null = never; the worker's sweep picks these up). */
    embeddedAt: timestamp("embedded_at", { withTimezone: true }),
    phash: text("phash"),

    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("refs_workspace_idx").on(t.workspaceId, t.createdAt),
    index("refs_parent_idx").on(t.parentReferenceId),
  ],
);

export const scenes = pgTable(
  "scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referenceId: uuid("reference_id").notNull().references(() => references.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    start: doublePrecision("start").notNull(),
    end: doublePrecision("end").notNull(),
    startFrame: integer("start_frame").notNull(),
    /** Exclusive. */
    endFrame: integer("end_frame").notNull(),
    thumbnailKey: text("thumbnail_key"),
    score: real("score").notNull().default(0),
    motion: real("motion").notNull().default(0),
    contrast: real("contrast").notNull().default(0),
    /** GIF cost measured on a 1 s sample (drives the size estimate): bytes per pixel for the
     *  first frame, and per pixel for each following frame. */
    gifFirstDensity: real("gif_first_density"),
    gifDensity: real("gif_density"),
  },
  (t) => [uniqueIndex("scenes_ref_index_uq").on(t.referenceId, t.index)],
);

/* ---------- Media jobs (mirror of BullMQ state the UI can query) ---------- */

export const mediaJobs = pgTable(
  "media_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    /** Null for jobs that aren't about one reference (e.g. a shot-list PDF). */
    referenceId: uuid("reference_id").references(() => references.id, { onDelete: "cascade" }),
    type: text("type").$type<"ingest" | "export" | "import" | "pdf" | "deck-pdf" | "reel-render">().notNull(),
    /** Same request => same key => same job and output (idempotency). */
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    stage: text("stage").$type<JobStage>().notNull().default("queued"),
    progress: real("progress").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    request: jsonb("request").$type<ExportRequest>(),
    output: jsonb("output").$type<ExportOutput>(),
    savedReferenceId: uuid("saved_reference_id"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("media_jobs_idem_uq").on(t.workspaceId, t.idempotencyKey),
    index("media_jobs_ref_idx").on(t.referenceId, t.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Reference = typeof references.$inferSelect;
export type NewReference = typeof references.$inferInsert;
export type Scene = typeof scenes.$inferSelect;
export type MediaJob = typeof mediaJobs.$inferSelect;

export const _sql = sql;

/* ---------- Boards (M2) ---------- */

export const boardViewEnum = pgEnum("board_view", ["canvas", "grid"]);

export const boards = pgTable(
  "boards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    /** Boards nest: a board card on a parent board opens this one. */
    parentBoardId: uuid("parent_board_id"),
    title: text("title").notNull().default("Untitled board"),
    view: boardViewEnum("view").notNull().default("canvas"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("boards_workspace_idx").on(t.workspaceId, t.updatedAt), index("boards_parent_idx").on(t.parentBoardId)],
);

export const boardVisits = pgTable(
  "board_visits",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
    visitedAt: timestamp("visited_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.boardId] })],
);

/**
 * Everything on a board. Columns are the spec's clusters: items with `columnId` stack inside
 * that column (ordered by `position`) and ignore x/y. Loose items sit at x/y on the canvas.
 */
export const boardItemKindEnum = pgEnum("board_item_kind", ["reference", "note", "link", "column", "board", "arrow"]);

export interface BoardItemContent {
  text?: string;
  url?: string;
  title?: string;
  host?: string;
  from?: string;
  to?: string;
}

export const boardItems = pgTable(
  "board_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }),
    kind: boardItemKindEnum("kind").notNull(),
    referenceId: uuid("reference_id").references(() => references.id, { onDelete: "cascade" }),
    childBoardId: uuid("child_board_id").references(() => boards.id, { onDelete: "cascade" }),
    columnId: uuid("column_id"),
    x: real("x").notNull().default(0),
    y: real("y").notNull().default(0),
    w: real("w").notNull().default(240),
    z: integer("z").notNull().default(0),
    position: real("position").notNull().default(0),
    content: jsonb("content").$type<BoardItemContent>().notNull().default({}),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("board_items_board_idx").on(t.boardId),
    index("board_items_ref_idx").on(t.referenceId),
    index("board_items_column_idx").on(t.columnId),
  ],
);

export type Board = typeof boards.$inferSelect;
export type BoardItem = typeof boardItems.$inferSelect;

/* ---------- Sharing and feedback (M3) ---------- */

export const sharePermissionEnum = pgEnum("share_permission", ["view", "favorite", "comment"]);
export const shareTargetEnum = pgEnum("share_target", ["board", "shot_list", "deck", "reel"]);

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    targetType: shareTargetEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    permission: sharePermissionEnum("permission").notNull().default("view"),
    /** scrypt$N$salt$hash; null = no password. */
    passwordHash: text("password_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("share_links_target_idx").on(t.targetType, t.targetId)],
);

export const guests = pgTable("guests", {
  id: uuid("id").primaryKey().defaultRandom(),
  shareLinkId: uuid("share_link_id").notNull().references(() => shareLinks.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const favorites = pgTable(
  "favorites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "cascade" }),
    referenceId: uuid("reference_id").notNull().references(() => references.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    guestId: uuid("guest_id").references(() => guests.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("favorites_user_uq").on(t.referenceId, t.boardId, t.userId),
    uniqueIndex("favorites_guest_uq").on(t.referenceId, t.boardId, t.guestId),
    index("favorites_board_idx").on(t.boardId),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    /** Where the conversation happens (a board for M3). */
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "cascade" }),
    referenceId: uuid("reference_id").notNull().references(() => references.id, { onDelete: "cascade" }),
    /** Seconds into the reference, for motion items. */
    timecode: doublePrecision("timecode"),
    parentId: uuid("parent_id"),
    body: text("body").notNull(),
    mentions: jsonb("mentions").$type<string[]>().notNull().default([]),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorGuestId: uuid("author_guest_id").references(() => guests.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comments_board_idx").on(t.boardId, t.createdAt), index("comments_ref_idx").on(t.referenceId)],
);

export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    actorName: text("actor_name").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_board_idx").on(t.boardId, t.createdAt)],
);

export const notifyModeEnum = pgEnum("notify_mode", ["immediate", "digest", "off"]);

export const notificationPrefs = pgTable("notification_prefs", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  mode: notifyModeEnum("mode").notNull().default("immediate"),
});

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<{ title: string; body: string; url: string }>().notNull(),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export type ShareLink = typeof shareLinks.$inferSelect;
export type Comment = typeof comments.$inferSelect;

/* ---------- Extension tokens (M4) ---------- */

/** Personal tokens for the browser extension. Only a SHA-256 hash of the token is stored. */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** First characters, so people can tell tokens apart. */
    prefix: text("prefix").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_tokens_user_idx").on(t.userId)],
);

/* ---------- Shot lists (M5) ---------- */

export const framingEnum = pgEnum("framing", ["ECU", "CU", "MCU", "MS", "MWS", "WS", "EWS", "OTS", "POV", "Insert"]);
export const shotStatusEnum = pgEnum("shot_status", ["idea", "planned", "approved", "shot"]);

export const shotLists = pgTable(
  "shot_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Untitled shot list"),
    /** The board this list was planned from (its references show in the side panel first). */
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("shot_lists_workspace_idx").on(t.workspaceId, t.updatedAt)],
);

export const shots = pgTable(
  "shots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    shotListId: uuid("shot_list_id").notNull().references(() => shotLists.id, { onDelete: "cascade" }),
    position: real("position").notNull().default(0),
    number: text("number").notNull().default(""),
    scene: text("scene").notNull().default(""),
    setting: text("setting").notNull().default(""),
    description: text("description").notNull().default(""),
    framing: framingEnum("framing"),
    movement: text("movement").notNull().default(""),
    lens: text("lens").notNull().default(""),
    rig: text("rig").notNull().default(""),
    durationSec: real("duration_sec"),
    status: shotStatusEnum("status").notNull().default("idea"),
    motionReferenceId: uuid("motion_reference_id").references(() => references.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("shots_list_idx").on(t.shotListId, t.position)],
);

export type ShotList = typeof shotLists.$inferSelect;
export type Shot = typeof shots.$inferSelect;

/* ---------- Search (M6) ---------- */

/**
 * CLIP ViT-B/32 image embeddings: one per image, and one per sampled keyframe of a video, clip or
 * GIF (`time` = seconds into the source). `source` is a stable key ("main", "scene:3", "t:12.5")
 * so re-embedding overwrites instead of duplicating. Vectors are L2-normalised.
 */
export const embeddings = pgTable(
  "embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    referenceId: uuid("reference_id").notNull().references(() => references.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    time: doublePrecision("time"),
    /** Storage key of the frame that was embedded (shown as the hit's thumbnail). */
    frameKey: text("frame_key"),
    model: text("model").notNull(),
    embedding: vector("embedding", { dimensions: 512 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("embeddings_ref_source_uq").on(t.referenceId, t.source),
    index("embeddings_workspace_idx").on(t.workspaceId),
    index("embeddings_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export type Embedding = typeof embeddings.$inferSelect;

/** The text the keyword fallback searches; matches the `refs_fts_idx` expression index (0007_search.sql). */
export const refSearchDocument = sql`to_tsvector('english', coalesce(${references.title}, '') || ' ' || coalesce(${references.notes}, '') || ' ' || coalesce(${references.autoDescription}, '') || ' ' || coalesce(${references.sourcePlatform}, ''))`;

/* ---------- Decks, reels and portfolio (M7) ---------- */

export const slideLayoutEnum = pgEnum("slide_layout", ["title", "text", "media", "media-text", "grid"]);

/** A treatment / pitch deck. Slides are saved as a whole with the deck (PUT /api/decks/:id). */
export const decks = pgTable(
  "decks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Untitled deck"),
    /** Board the deck was drafted from (its references show first in the media panel). */
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "set null" }),
    /** "paper" (warm light) or "night" (dark): maps to the app's light/dark tokens inside slides. */
    theme: text("theme").$type<"paper" | "night">().notNull().default("paper"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("decks_workspace_idx").on(t.workspaceId, t.updatedAt)],
);

export const slides = pgTable(
  "slides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    deckId: uuid("deck_id").notNull().references(() => decks.id, { onDelete: "cascade" }),
    position: real("position").notNull().default(0),
    layout: slideLayoutEnum("layout").notNull().default("text"),
    /** Treatment template section ("logline", "tone", …); empty for free slides. */
    section: text("section").notNull().default(""),
    heading: text("heading").notNull().default(""),
    body: text("body").notNull().default(""),
    /** Ordered reference ids shown on the slide (GIFs and clips play). */
    mediaIds: jsonb("media_ids").$type<string[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    ...timestamps,
  },
  (t) => [index("slides_deck_idx").on(t.deckId, t.position)],
);

/** A showreel: clips on a sequence with trims, optional title and end cards, optionally rendered to one MP4. */
export const reels = pgTable(
  "reels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Untitled reel"),
    titleCard: text("title_card").notNull().default(""),
    titleCardSub: text("title_card_sub").notNull().default(""),
    endCard: text("end_card").notNull().default(""),
    endCardSub: text("end_card_sub").notNull().default(""),
    /** Latest MP4 render (worker), with the content hash it was rendered from. */
    renderKey: text("render_key"),
    renderHash: text("render_hash"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("reels_workspace_idx").on(t.workspaceId, t.updatedAt)],
);

export const reelItems = pgTable(
  "reel_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    reelId: uuid("reel_id").notNull().references(() => reels.id, { onDelete: "cascade" }),
    referenceId: uuid("reference_id").notNull().references(() => references.id, { onDelete: "cascade" }),
    position: real("position").notNull().default(0),
    /** Trim in seconds within the reference (null = its start / end). */
    inSec: doublePrecision("in_sec"),
    outSec: doublePrecision("out_sec"),
    ...timestamps,
  },
  (t) => [index("reel_items_reel_idx").on(t.reelId, t.position)],
);

/** One public portfolio page per workspace, at /p/<slug>. */
export const portfolios = pgTable("portfolios", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .unique()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull().default(""),
  bio: text("bio").notNull().default(""),
  contactEmail: text("contact_email").notNull().default(""),
  website: text("website").notNull().default(""),
  template: text("template").$type<"grid" | "feature" | "list">().notNull().default("grid"),
  published: boolean("published").notNull().default(false),
  ...timestamps,
});

export const portfolioItems = pgTable(
  "portfolio_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    portfolioId: uuid("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
    referenceId: uuid("reference_id").references(() => references.id, { onDelete: "cascade" }),
    reelId: uuid("reel_id").references(() => reels.id, { onDelete: "cascade" }),
    caption: text("caption").notNull().default(""),
    position: real("position").notNull().default(0),
  },
  (t) => [index("portfolio_items_idx").on(t.portfolioId, t.position)],
);

export type Deck = typeof decks.$inferSelect;
export type Slide = typeof slides.$inferSelect;
export type Reel = typeof reels.$inferSelect;
export type ReelItem = typeof reelItems.$inferSelect;
export type Portfolio = typeof portfolios.$inferSelect;
export type PortfolioItem = typeof portfolioItems.$inferSelect;

/* ---------- Agents and text-to-save (M8) ---------- */

/**
 * One agent run (SPEC §5.8): the prompt, a live step log, the proposal the user reviews, and what
 * was applied (so it can be undone). Status: queued → running → proposed → applying → applied
 * (→ undone), or failed / cancelled. The run itself never writes to boards, decks or reels.
 */
export const agentTasks = pgTable(
  "agent_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind").$type<"research" | "general">().notNull().default("general"),
    prompt: text("prompt").notNull(),
    status: text("status").$type<"queued" | "running" | "proposed" | "applying" | "applied" | "undone" | "failed" | "cancelled">().notNull().default("queued"),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    /** Append-only log shown live: { at, kind: "thinking"|"tool"|"result"|"proposal"|"error"|"done", text, data? }. */
    steps: jsonb("steps").$type<unknown[]>().notNull().default([]),
    /** { summary, actions: AgentAction[] } once the agent finishes. */
    proposal: jsonb("proposal").$type<unknown>(),
    /** What approval created, for undo (+ exports still rendering). */
    applied: jsonb("applied").$type<unknown>(),
    /** References the run itself ingested into the library (allowed without approval; removed on undo). */
    ingested: jsonb("ingested").$type<string[]>().notNull().default([]),
    error: text("error"),
    attempt: integer("attempt").notNull().default(1),
    ...timestamps,
  },
  (t) => [index("agent_tasks_workspace_idx").on(t.workspaceId, t.createdAt)],
);

/** Phone numbers verified for text-to-save (SMS or WhatsApp via Twilio). E.164, one owner each. */
export const phoneNumbers = pgTable(
  "phone_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** scrypt hash of the 6-digit code, its expiry and failed attempts. */
    codeHash: text("code_hash"),
    codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("phone_numbers_phone_uq").on(t.phone), index("phone_numbers_user_idx").on(t.userId)],
);

export type AgentTask = typeof agentTasks.$inferSelect;
export type PhoneNumber = typeof phoneNumbers.$inferSelect;
