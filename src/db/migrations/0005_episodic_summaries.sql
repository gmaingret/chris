CREATE TABLE "episodic_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"summary_date" date NOT NULL,
	"summary" text NOT NULL,
	"importance" integer NOT NULL,
	"topics" text[] DEFAULT '{}' NOT NULL,
	"emotional_arc" text NOT NULL,
	"key_quotes" text[] DEFAULT '{}' NOT NULL,
	"source_entry_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "episodic_summaries_summary_date_unique" UNIQUE("summary_date"),
	CONSTRAINT "episodic_summaries_importance_bounds" CHECK ("episodic_summaries"."importance" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE INDEX "episodic_summaries_topics_idx" ON "episodic_summaries" USING gin ("topics");--> statement-breakpoint
CREATE INDEX "episodic_summaries_importance_idx" ON "episodic_summaries" USING btree ("importance");