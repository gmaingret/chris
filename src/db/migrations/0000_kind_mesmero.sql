CREATE TYPE "public"."contradiction_status" AS ENUM('DETECTED', 'RESOLVED', 'ACCEPTED');--> statement-breakpoint
CREATE TYPE "public"."conversation_mode" AS ENUM('JOURNAL', 'INTERROGATE', 'REFLECT', 'PRODUCE', 'COACH', 'PSYCHOLOGY');--> statement-breakpoint
CREATE TYPE "public"."conversation_role" AS ENUM('USER', 'ASSISTANT');--> statement-breakpoint
CREATE TYPE "public"."epistemic_tag" AS ENUM('FACT', 'EMOTION', 'BELIEF', 'INTENTION', 'EXPERIENCE', 'PREFERENCE', 'RELATIONSHIP', 'DREAM', 'FEAR', 'VALUE', 'CONTRADICTION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."relational_memory_type" AS ENUM('PATTERN', 'OBSERVATION', 'INSIGHT', 'CONCERN', 'EVOLUTION');--> statement-breakpoint
CREATE TABLE "contradictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_a_id" uuid,
	"entry_b_id" uuid,
	"description" text NOT NULL,
	"status" "contradiction_status" DEFAULT 'DETECTED',
	"resolution" text,
	"detected_at" timestamp with time zone DEFAULT now(),
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" bigint NOT NULL,
	"role" "conversation_role" NOT NULL,
	"content" text NOT NULL,
	"mode" "conversation_mode",
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pensieve_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"model" varchar(100) DEFAULT 'bge-m3',
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "pensieve_embeddings_entry_id_unique" UNIQUE("entry_id")
);
--> statement-breakpoint
CREATE TABLE "pensieve_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text NOT NULL,
	"epistemic_tag" "epistemic_tag",
	"source" varchar(50) DEFAULT 'telegram',
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "relational_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "relational_memory_type" NOT NULL,
	"content" text NOT NULL,
	"supporting_entries" uuid[],
	"confidence" real DEFAULT 0.5,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "contradictions" ADD CONSTRAINT "contradictions_entry_a_id_pensieve_entries_id_fk" FOREIGN KEY ("entry_a_id") REFERENCES "public"."pensieve_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contradictions" ADD CONSTRAINT "contradictions_entry_b_id_pensieve_entries_id_fk" FOREIGN KEY ("entry_b_id") REFERENCES "public"."pensieve_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pensieve_embeddings" ADD CONSTRAINT "pensieve_embeddings_entry_id_pensieve_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."pensieve_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_chat_id_created_at_idx" ON "conversations" USING btree ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "pensieve_embeddings_entry_id_idx" ON "pensieve_embeddings" USING btree ("entry_id");