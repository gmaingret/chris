/**
 * src/memory/profiles/psychological-schemas.ts — Phase 37 Plan 37-01 Task 1
 *                                                  (PSCH-06 substrate)
 *
 * Zod v3 + v4 dual schemas for the 3 M011 psychological profile dimensions:
 * HEXACO (6 dimensions), Schwartz (10 values), Attachment (3 dimensions).
 *
 * Schema discipline (mirrors src/memory/profiles/schemas.ts — operational):
 *   - v3 schemas use .strict() — rejects unknown jsonb keys at read boundary
 *     (defends against future psychological-shape drift in stored rows)
 *   - v4 mirrors OMIT .strict() per M009 D-29-02 (SDK doesn't parse
 *     strict-mode JSON Schema; v3 re-validates in the retry loop)
 *   - Both schemas MUST stay in lock-step (M009 D-29-02 discipline)
 *
 * Per-dimension shape (D-09):
 *   { score: number 1-5, confidence: number 0-1, last_updated: ISO string }
 *   wrapped in .nullable() at the FACTORY level so cold-start seed rows
 *   (jsonb DEFAULT 'null'::jsonb) parse successfully as the literal JSON
 *   `null` value.
 *
 * Per D-27 — nominal factory separation:
 *   - `hexacoSchwartzDimensionSchemaV3` (shared between HEXACO + Schwartz)
 *   - `attachmentDimensionSchemaV3` (separately named for nominal typing and
 *     future divergence post-D028 activation gate)
 *
 * Per D-11 — `evidence_count` is NOT included (deferred to v2.6.1+).
 *   Inter-period consistency is subsumed by `profile_history` rows +
 *   `prevHistorySnapshot` threaded to Sonnet in Phase 38 (PGEN-07).
 *
 * Per Pitfall 4 — Drizzle `.$type<HexacoProfileData['honesty_humility']>()`
 *   resolves to `HexacoDimension | null` because the factory uses
 *   `.nullable()`. Compile-time forces consumers to narrow before `.score`
 *   access.
 *
 * See 37-CONTEXT.md D-25..D-28 for the locked schema discipline.
 */
import { z } from 'zod';
import * as zV4 from 'zod/v4';

// ── Per-dimension shape factories (D-09 + D-27) ─────────────────────────

// Shared between HEXACO and Schwartz (identical shape).
const hexacoSchwartzDimensionSchemaV3 = z
  .object({
    score: z.number().min(1).max(5),
    confidence: z.number().min(0).max(1),
    last_updated: z.string().datetime(),
  })
  .strict()
  .nullable();

const hexacoSchwartzDimensionSchemaV4 = zV4
  .object({
    score: zV4.number().min(1).max(5),
    confidence: zV4.number().min(0).max(1),
    last_updated: zV4.string(),
  })
  .nullable();

// D-27 nominal separation — identical shape, separately named to allow
// future divergence (e.g., attachment-only `evidence_count` post-D028).
const attachmentDimensionSchemaV3 = z
  .object({
    score: z.number().min(1).max(5),
    confidence: z.number().min(0).max(1),
    last_updated: z.string().datetime(),
  })
  .strict()
  .nullable();

const attachmentDimensionSchemaV4 = zV4
  .object({
    score: zV4.number().min(1).max(5),
    confidence: zV4.number().min(0).max(1),
    last_updated: zV4.string(),
  })
  .nullable();

// ── HEXACO (6 dimensions, PSCH-02) ──────────────────────────────────────

export const HexacoProfileSchemaV3 = z
  .object({
    honesty_humility: hexacoSchwartzDimensionSchemaV3,
    emotionality: hexacoSchwartzDimensionSchemaV3,
    extraversion: hexacoSchwartzDimensionSchemaV3,
    agreeableness: hexacoSchwartzDimensionSchemaV3,
    conscientiousness: hexacoSchwartzDimensionSchemaV3,
    openness: hexacoSchwartzDimensionSchemaV3,
  })
  .strict();
export type HexacoProfileData = z.infer<typeof HexacoProfileSchemaV3>;

export const HexacoProfileSchemaV4 = zV4.object({
  honesty_humility: hexacoSchwartzDimensionSchemaV4,
  emotionality: hexacoSchwartzDimensionSchemaV4,
  extraversion: hexacoSchwartzDimensionSchemaV4,
  agreeableness: hexacoSchwartzDimensionSchemaV4,
  conscientiousness: hexacoSchwartzDimensionSchemaV4,
  openness: hexacoSchwartzDimensionSchemaV4,
});

// ── Schwartz (10 universal values, PSCH-03) ─────────────────────────────

export const SchwartzProfileSchemaV3 = z
  .object({
    self_direction: hexacoSchwartzDimensionSchemaV3,
    stimulation: hexacoSchwartzDimensionSchemaV3,
    hedonism: hexacoSchwartzDimensionSchemaV3,
    achievement: hexacoSchwartzDimensionSchemaV3,
    power: hexacoSchwartzDimensionSchemaV3,
    security: hexacoSchwartzDimensionSchemaV3,
    conformity: hexacoSchwartzDimensionSchemaV3,
    tradition: hexacoSchwartzDimensionSchemaV3,
    benevolence: hexacoSchwartzDimensionSchemaV3,
    universalism: hexacoSchwartzDimensionSchemaV3,
  })
  .strict();
export type SchwartzProfileData = z.infer<typeof SchwartzProfileSchemaV3>;

export const SchwartzProfileSchemaV4 = zV4.object({
  self_direction: hexacoSchwartzDimensionSchemaV4,
  stimulation: hexacoSchwartzDimensionSchemaV4,
  hedonism: hexacoSchwartzDimensionSchemaV4,
  achievement: hexacoSchwartzDimensionSchemaV4,
  power: hexacoSchwartzDimensionSchemaV4,
  security: hexacoSchwartzDimensionSchemaV4,
  conformity: hexacoSchwartzDimensionSchemaV4,
  tradition: hexacoSchwartzDimensionSchemaV4,
  benevolence: hexacoSchwartzDimensionSchemaV4,
  universalism: hexacoSchwartzDimensionSchemaV4,
});

// ── Attachment (3 dimensions, schema-only — PSCH-04, D028) ──────────────
// relational_word_count + activated live at the row level (not in jsonb);
// they are metadata columns stripped by the reader per Pitfall 7.

export const AttachmentProfileSchemaV3 = z
  .object({
    anxious: attachmentDimensionSchemaV3,
    avoidant: attachmentDimensionSchemaV3,
    secure: attachmentDimensionSchemaV3,
  })
  .strict();
export type AttachmentProfileData = z.infer<typeof AttachmentProfileSchemaV3>;

export const AttachmentProfileSchemaV4 = zV4.object({
  anxious: attachmentDimensionSchemaV4,
  avoidant: attachmentDimensionSchemaV4,
  secure: attachmentDimensionSchemaV4,
});
