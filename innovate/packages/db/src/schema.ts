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
    /** CLIP ViT-B/32 embedding. TODO(M6): populated by the embeddings job. */
    embedding: vector("embedding", { dimensions: 512 }),
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
    referenceId: uuid("reference_id").notNull().references(() => references.id, { onDelete: "cascade" }),
    type: text("type").$type<"ingest" | "export">().notNull(),
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
