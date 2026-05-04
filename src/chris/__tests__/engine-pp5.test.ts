/**
 * src/chris/__tests__/engine-pp5.test.ts — Phase 26 Plan 02 (VOICE-01, VOICE-06)
 *
 * Real-DB integration test for the PP#5 ritual-response detector. Exercises
 * the full processMessage pipeline against real Docker postgres on port 5434
 * with Anthropic client mocked at module top — proves the load-bearing
 * Pitfall 6 regression contract:
 *
 *   expect(mockAnthropicCreate).not.toHaveBeenCalled();
 *
 * cumulatively across the HIT-path describe block (afterAll-style). The
 * miss-path describe block lives in a separate top-level describe with no
 * cumulative assertion — it allows Anthropic invocation since the message
 * routes to JOURNAL/REFLECT mode after PP#5 falls through.
 *
 * Pitfall 24 mitigation: this test goes through the FULL processMessage
 * pipeline (NOT bypassing PP#5). The cumulative not-called assertion only
 * holds because PP#5 short-circuits BEFORE any LLM call.
 *
 * Run via canonical Docker harness:
 *   bash scripts/test.sh src/chris/__tests__/engine-pp5.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';

// ── Mock Anthropic client (load-bearing for Pitfall 6) ─────────────────────
// vi.hoisted ensures the mock fns are available when vi.mock factories run
// (factories are hoisted above all imports; non-hoisted top-level consts are
// not).
const { mockAnthropicCreate, mockAnthropicParse } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockAnthropicParse: vi.fn(),
}));
vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockAnthropicCreate, parse: mockAnthropicParse },
  },
  HAIKU_MODEL: 'claude-haiku',
  SONNET_MODEL: 'claude-sonnet',
  OPUS_MODEL: 'claude-opus',
}));

// ── Mock fire-and-forget pipeline modules so the MISS-path doesn't hang ───
// The MISS path falls through to the JOURNAL pipeline, which calls embeddings
// (HuggingFace transformers) and tagger (Anthropic). HuggingFace has a
// pre-existing EACCES baseline failure in this env; mocking it as no-op
// prevents the 5s hang. Tagger is also Anthropic — already short-circuited by
// the load-bearing not-called assertion in HIT path, but mocking it here as
// no-op is cleaner for the MISS-path describe (which allows Anthropic).
vi.mock('../../pensieve/embeddings.js', () => ({
  embedAndStore: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../pensieve/tagger.js', () => ({
  tagEntry: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../memory/relational.js', () => ({
  writeRelationalMemory: vi.fn().mockResolvedValue(undefined),
}));

import { db, sql } from '../../db/connection.js';
import {
  rituals,
  ritualPendingResponses,
  ritualResponses,
  ritualFireEvents,
  pensieveEntries,
} from '../../db/schema.js';
import { processMessage } from '../engine.js';

const FIXTURE_RITUAL_NAME = 'engine-pp5-test-ritual';

async function cleanup(): Promise<void> {
  // Ordered cleanup: child tables first (FK constraints), then rituals fixture.
  // Phase 28 Plan 28-01 extended recordRitualVoiceResponse to write ritual_fire_events
  // — add it to cleanup before rituals deletion to satisfy FK constraint.
  await db.delete(ritualResponses);
  await db.delete(ritualFireEvents);
  await db.delete(ritualPendingResponses);
  await db.delete(pensieveEntries);
  await db.delete(rituals).where(eq(rituals.name, FIXTURE_RITUAL_NAME));
}

describe('PP#5 HIT path (Phase 26 VOICE-01, VOICE-06) — Pitfall 6 contract', () => {
  // afterAll cumulative assertion — the load-bearing invariant.
  // If ANY hit-path test invokes Anthropic, this fails.
  afterAll(async () => {
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    await cleanup();
    // NOTE: do NOT call sql.end() here — pool must stay alive for the
    // sibling MISS-path describe below. File-level pool close happens in the
    // last describe's afterAll (TESTING.md afterAll convention).
  });

  beforeEach(async () => {
    await cleanup();
    mockAnthropicCreate.mockReset();
    mockAnthropicParse.mockReset();
  });

  it('journal response writes Pensieve entry as RITUAL_RESPONSE + source_subtype + prompt_text persisted', async () => {
    const [ritual] = await db
      .insert(rituals)
      .values({
        name: FIXTURE_RITUAL_NAME,
        type: 'daily',
        nextRunAt: new Date(),
        enabled: true,
        config: {
          fire_at: '21:00',
          prompt_bag: [1, 2, 3, 4, 5],
          skip_threshold: 3,
          mute_until: null,
          time_zone: 'Europe/Paris',
          prompt_set_version: 'v1',
          schema_version: 1,
        },
      })
      .returning();
    const chatId = BigInt(123456);
    const seedPrompt = 'What mattered today?';
    const [pending] = await db
      .insert(ritualPendingResponses)
      .values({
        ritualId: ritual!.id,
        chatId,
        firedAt: new Date(),
        expiresAt: new Date(Date.now() + 18 * 3600 * 1000),
        promptText: seedPrompt, // amended D-26-02
      })
      .returning();

    const response = await processMessage(
      chatId,
      99999,
      'today was about the team meeting',
    );

    // 1. Empty string return (IN-02 silent-skip).
    expect(response).toBe('');
    // 2. Anthropic NEVER called (Pitfall 6 mitigation).
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    // 3. Pensieve entry with correct tag + metadata (VOICE-06).
    const entries = await db.select().from(pensieveEntries);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.epistemicTag).toBe('RITUAL_RESPONSE');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((entries[0]!.metadata as any)?.source_subtype).toBe('ritual_journal');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((entries[0]!.metadata as any)?.ritual_id).toBe(ritual!.id);
    // 4. Pending row consumed.
    const [consumedPending] = await db
      .select()
      .from(ritualPendingResponses)
      .where(eq(ritualPendingResponses.id, pending!.id));
    expect(consumedPending!.consumedAt).not.toBeNull();
    // 5. ritual_responses link row inserted WITH prompt_text from consumed pending (amended D-26-02).
    const respRows = await db.select().from(ritualResponses);
    expect(respRows).toHaveLength(1);
    expect(respRows[0]!.ritualId).toBe(ritual!.id);
    expect(respRows[0]!.pensieveEntryId).toBe(entries[0]!.id);
    expect(respRows[0]!.promptText).toBe(seedPrompt); // checker B4 verification
  });
});

// ── Miss-path describe (no afterAll — Anthropic CAN be called) ────────────
// Per checker W5: concrete fall-through assertions for no-pending + expired-pending.
describe('PP#5 MISS path (Phase 26 — fall-through to normal pipeline)', () => {
  beforeEach(async () => {
    await cleanup();
    mockAnthropicCreate.mockReset();
    mockAnthropicParse.mockReset();
    // Miss-path mocks Anthropic to throw — engine bubbles up, preserves test
    // isolation (we don't want full pipeline persistence tested here, only
    // PP#5 fall-through behavior).
    mockAnthropicCreate.mockRejectedValue(new Error('test-pipeline-stop'));
  });

  afterAll(async () => {
    await cleanup();
    await sql.end({ timeout: 5 }).catch(() => {});
  });

  it('no pending row → PP#5 falls through, no Pensieve write, no consume mark', async () => {
    const chatId = BigInt(987654);
    // No ritual_pending_responses row for this chat.
    await expect(
      processMessage(chatId, 99999, 'random journal text'),
    ).rejects.toThrow();
    // Verify NO ritual-response side effects.
    const entries = await db
      .select()
      .from(pensieveEntries)
      .where(eq(pensieveEntries.epistemicTag, 'RITUAL_RESPONSE'));
    expect(entries).toHaveLength(0);
    const respRows = await db.select().from(ritualResponses);
    expect(respRows).toHaveLength(0);
  });

  it('expired pending row → PP#5 falls through, expired row stays unconsumed', async () => {
    const [ritual] = await db
      .insert(rituals)
      .values({
        name: FIXTURE_RITUAL_NAME,
        type: 'daily',
        nextRunAt: new Date(),
        enabled: true,
        config: {
          fire_at: '21:00',
          prompt_bag: [],
          skip_threshold: 3,
          mute_until: null,
          time_zone: 'Europe/Paris',
          prompt_set_version: 'v1',
          schema_version: 1,
        },
      })
      .returning();
    const chatId = BigInt(123456);
    const [expiredPending] = await db
      .insert(ritualPendingResponses)
      .values({
        ritualId: ritual!.id,
        chatId,
        firedAt: new Date(Date.now() - 24 * 3600 * 1000),
        expiresAt: new Date(Date.now() - 1000), // expired 1s ago
        promptText: 'What mattered today?',
      })
      .returning();

    await expect(processMessage(chatId, 99999, 'late reply')).rejects.toThrow();
    // Expired row NOT consumed (PP#5 query filters expires_at > now).
    const [unchanged] = await db
      .select()
      .from(ritualPendingResponses)
      .where(eq(ritualPendingResponses.id, expiredPending!.id));
    expect(unchanged!.consumedAt).toBeNull();
    // No ritual-response Pensieve entry written.
    const entries = await db
      .select()
      .from(pensieveEntries)
      .where(eq(pensieveEntries.epistemicTag, 'RITUAL_RESPONSE'));
    expect(entries).toHaveLength(0);
  });
});
