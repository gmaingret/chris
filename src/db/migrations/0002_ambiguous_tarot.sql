ALTER TABLE "pensieve_embeddings" DROP CONSTRAINT "pensieve_embeddings_entry_id_unique";--> statement-breakpoint
ALTER TABLE "pensieve_embeddings" ADD COLUMN "chunk_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pensieve_entries" ADD COLUMN "content_hash" varchar(64);--> statement-breakpoint
CREATE INDEX "pensieve_entries_content_hash_idx" ON "pensieve_entries" USING btree ("content_hash");