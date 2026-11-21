CREATE TYPE "public"."framing" AS ENUM('ECU', 'CU', 'MCU', 'MS', 'MWS', 'WS', 'EWS', 'OTS', 'POV', 'Insert');--> statement-breakpoint
CREATE TYPE "public"."shot_status" AS ENUM('idea', 'planned', 'approved', 'shot');--> statement-breakpoint
CREATE TABLE "shot_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text DEFAULT 'Untitled shot list' NOT NULL,
	"board_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"shot_list_id" uuid NOT NULL,
	"position" real DEFAULT 0 NOT NULL,
	"number" text DEFAULT '' NOT NULL,
	"scene" text DEFAULT '' NOT NULL,
	"setting" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"framing" "framing",
	"movement" text DEFAULT '' NOT NULL,
	"lens" text DEFAULT '' NOT NULL,
	"rig" text DEFAULT '' NOT NULL,
	"duration_sec" real,
	"status" "shot_status" DEFAULT 'idea' NOT NULL,
	"motion_reference_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_jobs" ALTER COLUMN "reference_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shot_lists" ADD CONSTRAINT "shot_lists_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_lists" ADD CONSTRAINT "shot_lists_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_lists" ADD CONSTRAINT "shot_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_shot_list_id_shot_lists_id_fk" FOREIGN KEY ("shot_list_id") REFERENCES "public"."shot_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shots" ADD CONSTRAINT "shots_motion_reference_id_refs_id_fk" FOREIGN KEY ("motion_reference_id") REFERENCES "public"."refs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shot_lists_workspace_idx" ON "shot_lists" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "shots_list_idx" ON "shots" USING btree ("shot_list_id","position");