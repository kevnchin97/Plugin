CREATE TYPE "public"."reference_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reference_type" AS ENUM('image', 'gif', 'clip', 'still', 'video', 'link', 'note');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'editor', 'commenter', 'viewer');--> statement-breakpoint
CREATE TABLE "accounts" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "accounts_provider_provider_account_id_pk" PRIMARY KEY("provider","provider_account_id")
);
--> statement-breakpoint
CREATE TABLE "media_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"reference_id" uuid NOT NULL,
	"type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'queued' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"request" jsonb,
	"output" jsonb,
	"saved_reference_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" "reference_type" NOT NULL,
	"status" "reference_status" DEFAULT 'pending' NOT NULL,
	"stage" text,
	"error" text,
	"original_key" text,
	"proxy_key" text,
	"thumbnail_key" text,
	"filmstrip" jsonb,
	"content_type" text,
	"bytes" bigint,
	"width" integer,
	"height" integer,
	"duration" double precision,
	"fps_num" integer,
	"fps_den" integer,
	"frame_count" integer,
	"has_audio" boolean,
	"video_start_offset" double precision DEFAULT 0,
	"source_url" text,
	"source_platform" text,
	"source_in" double precision,
	"source_out" double precision,
	"parent_reference_id" uuid,
	"title" text DEFAULT 'Untitled' NOT NULL,
	"notes" text,
	"auto_description" text,
	"embedding" vector(512),
	"phash" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"start" double precision NOT NULL,
	"end" double precision NOT NULL,
	"start_frame" integer NOT NULL,
	"end_frame" integer NOT NULL,
	"thumbnail_key" text,
	"score" real DEFAULT 0 NOT NULL,
	"motion" real DEFAULT 0 NOT NULL,
	"contrast" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"email_verified" timestamp with time zone,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_reference_id_refs_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."refs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refs" ADD CONSTRAINT "refs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refs" ADD CONSTRAINT "refs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_reference_id_refs_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."refs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_jobs_idem_uq" ON "media_jobs" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "media_jobs_ref_idx" ON "media_jobs" USING btree ("reference_id","created_at");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refs_workspace_idx" ON "refs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "refs_parent_idx" ON "refs" USING btree ("parent_reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scenes_ref_index_uq" ON "scenes" USING btree ("reference_id","index");