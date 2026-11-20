CREATE TYPE "public"."board_item_kind" AS ENUM('reference', 'note', 'link', 'column', 'board', 'arrow');--> statement-breakpoint
CREATE TYPE "public"."board_view" AS ENUM('canvas', 'grid');--> statement-breakpoint
CREATE TABLE "board_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"kind" "board_item_kind" NOT NULL,
	"reference_id" uuid,
	"child_board_id" uuid,
	"column_id" uuid,
	"x" real DEFAULT 0 NOT NULL,
	"y" real DEFAULT 0 NOT NULL,
	"w" real DEFAULT 240 NOT NULL,
	"z" integer DEFAULT 0 NOT NULL,
	"position" real DEFAULT 0 NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_visits" (
	"user_id" text NOT NULL,
	"board_id" uuid NOT NULL,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_visits_user_id_board_id_pk" PRIMARY KEY("user_id","board_id")
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parent_board_id" uuid,
	"title" text DEFAULT 'Untitled board' NOT NULL,
	"view" "board_view" DEFAULT 'canvas' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_reference_id_refs_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."refs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_child_board_id_boards_id_fk" FOREIGN KEY ("child_board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_items" ADD CONSTRAINT "board_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_visits" ADD CONSTRAINT "board_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_visits" ADD CONSTRAINT "board_visits_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_items_board_idx" ON "board_items" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "board_items_ref_idx" ON "board_items" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "board_items_column_idx" ON "board_items" USING btree ("column_id");--> statement-breakpoint
CREATE INDEX "boards_workspace_idx" ON "boards" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "boards_parent_idx" ON "boards" USING btree ("parent_board_id");