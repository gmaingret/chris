CREATE TABLE "decision_trigger_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" bigint NOT NULL,
	"phrase" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_trigger_suppressions_chat_id_phrase_unique" UNIQUE("chat_id","phrase")
);
--> statement-breakpoint
CREATE INDEX "decision_trigger_suppressions_chat_id_idx" ON "decision_trigger_suppressions" USING btree ("chat_id");