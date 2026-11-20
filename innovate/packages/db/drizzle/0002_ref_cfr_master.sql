ALTER TABLE "refs" ADD COLUMN "master_key" text;--> statement-breakpoint
ALTER TABLE "refs" ADD COLUMN "variable_frame_rate" boolean DEFAULT false NOT NULL;