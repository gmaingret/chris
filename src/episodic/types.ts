// Episodic consolidation types — M008 Phase 20 EPI-03
import { z } from 'zod';

/**
 * Layer 1: EpisodicSummarySonnetOutputSchema
 *
 * The strictest schema. Used with Anthropic SDK `messages.parse()` via `zodOutputFormat()`
 * in Phase 21's `runConsolidate()`. Sonnet generates these fields; engine supplies the rest.
 *
 * Per CONTEXT.md D-12:
 * - importance: integer in [1, 10] (matches DB CHECK from D-07)
 * - summary: min length 50 chars (catches trivially-empty output)
 * - topics: non-empty array of non-empty strings, max 10 (prevents topic-explosion hallucination)
 * - key_quotes: array of non-empty strings, max 10, CAN be empty (sparse-entry case per CONS-11)
 * - emotional_arc: non-empty string
 */
export const EpisodicSummarySonnetOutputSchema = z.object({
  summary: z.string().min(50),
  importance: z.number().int().min(1).max(10),
  topics: z.array(z.string().min(1)).min(1).max(10),
  emotional_arc: z.string().min(1),
  key_quotes: z.array(z.string().min(1)).max(10),
});

/**
 * Layer 2: EpisodicSummaryInsertSchema
 *
 * Layer 1 + engine-supplied fields. Used for `parseEpisodicSummary()` before Drizzle insert
 * in Phase 21's `runConsolidate()`.
 *
 * Per CONTEXT.md D-12:
 * - summary_date: z.date() (Phase 21 converts from timezone-aware ISO string to Date at engine boundary)
 * - source_entry_ids: non-empty array of uuid strings in practice (CONS-02 skips zero-entry days)
 */
export const EpisodicSummaryInsertSchema = EpisodicSummarySonnetOutputSchema.extend({
  summary_date: z.date(),
  source_entry_ids: z.array(z.string().uuid()),
});

/**
 * Layer 3: EpisodicSummarySchema
 *
 * Full row shape as read from the DB. Used by RETR-01 / Phase 22 retrieval code
 * (`getEpisodicSummary`, `getEpisodicSummariesRange`).
 */
export const EpisodicSummarySchema = EpisodicSummaryInsertSchema.extend({
  id: z.string().uuid(),
  created_at: z.date(),
});

// ── TypeScript types (D-13 export surface) ──────────────────────────────────
export type EpisodicSummarySonnetOutput = z.infer<typeof EpisodicSummarySonnetOutputSchema>;
export type EpisodicSummaryInsert = z.infer<typeof EpisodicSummaryInsertSchema>;
export type EpisodicSummary = z.infer<typeof EpisodicSummarySchema>;

/**
 * Helper: parse an unknown value into `EpisodicSummaryInsert` with a clear error prefix.
 *
 * Per CONTEXT.md "Claude's Discretion" bullet 5: surfaces `ZodError.format()` for Phase 21
 * `notifyError()` readability (CONS-12). No custom error class wrapping — Zod's native
 * error format is sufficient and already structured.
 *
 * Throws `ZodError` on failure — caller inspects `.format()` to render a Telegram-friendly message.
 */
export function parseEpisodicSummary(input: unknown): EpisodicSummaryInsert {
  return EpisodicSummaryInsertSchema.parse(input);
}
