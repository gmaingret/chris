CREATE TYPE "public"."decision_capture_stage" AS ENUM('DECISION', 'ALTERNATIVES', 'REASONING', 'PREDICTION', 'FALSIFICATION', 'AWAITING_RESOLUTION', 'AWAITING_POSTMORTEM', 'DONE');--> statement-breakpoint
CREATE TYPE "public"."decision_event_type" AS ENUM('created', 'status_changed', 'field_updated', 'classified');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('open-draft', 'open', 'due', 'resolved', 'reviewed', 'withdrawn', 'stale', 'abandoned');--> statement-breakpoint
CREATE TABLE "decision_capture_state" (
	"chat_id" bigint PRIMARY KEY NOT NULL,
	"stage" "decision_capture_stage" NOT NULL,
	"draft" jsonb NOT NULL,
	"decision_id" uuid,
	"started_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "decision_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"event_type" "decision_event_type" NOT NULL,
	"from_status" "decision_status",
	"to_status" "decision_status",
	"snapshot" jsonb NOT NULL,
	"actor" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sequence_no" bigserial NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "decision_status" DEFAULT 'open-draft' NOT NULL,
	"decision_text" text NOT NULL,
	"alternatives" jsonb,
	"reasoning" text NOT NULL,
	"prediction" text NOT NULL,
	"falsification_criterion" text NOT NULL,
	"resolve_by" timestamp with time zone NOT NULL,
	"domain_tag" text,
	"language_at_capture" varchar(3),
	"resolution" text,
	"resolution_notes" text,
	"resolved_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"accuracy_class" text,
	"accuracy_classified_at" timestamp with time zone,
	"accuracy_model_version" varchar(100),
	"withdrawn_at" timestamp with time zone,
	"stale_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	"chat_id" bigint,
	"source_ref_id" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "decision_events" ADD CONSTRAINT "decision_events_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_events_decision_id_created_at_sequence_no_idx" ON "decision_events" USING btree ("decision_id","created_at","sequence_no");--> statement-breakpoint
CREATE INDEX "decisions_status_resolve_by_idx" ON "decisions" USING btree ("status","resolve_by");--> statement-breakpoint
CREATE INDEX "decisions_chat_id_status_idx" ON "decisions" USING btree ("chat_id","status");