CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"reference_id" uuid NOT NULL,
	"source" text NOT NULL,
	"time" double precision,
	"frame_key" text,
	"model" text NOT NULL,
	"embedding" vector(512) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refs" ADD COLUMN "embedded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_reference_id_refs_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."refs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_ref_source_uq" ON "embeddings" USING btree ("reference_id","source");--> statement-breakpoint
CREATE INDEX "embeddings_workspace_idx" ON "embeddings" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "embeddings_hnsw_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
-- Keyword fallback for search (hand-written: drizzle can't express expression indexes). Keep in sync with refSearchDocument in schema.ts.
CREATE INDEX "refs_fts_idx" ON "refs" USING gin (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("notes", '') || ' ' || coalesce("auto_description", '') || ' ' || coalesce("source_platform", '')));
