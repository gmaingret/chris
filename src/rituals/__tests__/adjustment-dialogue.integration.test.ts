/**
 * src/rituals/__tests__/adjustment-dialogue.integration.test.ts
 * Phase 28 Plan 03 SKIP-04 — adjustment dialogue + Haiku 3-class classification
 *
 * Real-DB integration test. Mocks Anthropic (Haiku messages.parse only) and
 * Telegram (bot.api.sendMessage). Exercises the full adjustment-dialogue module
 * against live Docker postgres.
 *
 * Cumulative afterAll: mockAnthropicCreate.not.toHaveBeenCalled() — proves that
 * Sonnet/messages.create is NEVER invoked from this path (Pitfall 6 invariant).
 * Only Haiku messages.parse is allowed.
 *
 * Run via canonical Docker harness:
 *   bash scripts/test.sh src/rituals/__tests__/adjustment-dialogue.integration.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';

// ── Mock Anthropic client (load-bearing for Pitfall 6) ─────────────────────
const { mockAnthropicCreate, mockAnthropicParse, mockSendMessage } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockAnthropicParse: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue({ message_id: 9999 }),
}));

vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockAnthropicCreate, parse: mockAnthropicParse },
  },
  HAIKU_MODEL: 'claude-haiku-3',
  SONNET_MODEL: 'claude-sonnet',
  OPUS_MODEL: 'claude-opus',
}));

vi.mock('../../bot/bot.js', () => ({
  bot: {
    api: { sendMessage: mockSendMessage },
  },
}));

import { db, sql } from '../../db/connection.js';
import {
  rituals,
  ritualPendingResponses,
  ritualResponses,
  ritualFireEvents,
} from '../../db/schema.js';
import {
  fireAdjustmentDialogue,
  handleAdjustmentReply,
} from '../adjustment-dialogue.js';

const FIXTURE_RITUAL_NAME = 'adj-dialogue-integration-test-ritual';
const TEST_CHAT_ID = BigInt(99999);

async function createTestRitual(type: 'daily' | 'weekly' = 'daily') {
  const [ritual] = await db
    .insert(rituals)
    .values({
      name: FIXTURE_RITUAL_NAME,
      type,
      nextRunAt: new Date(),
      enabled: true,
      skipCount: 3,
      config: {
        fire_at: '21:00',
        prompt_bag: [1, 2, 3],
        skip_threshold: 3,
        mute_until: null,
        time_zone: 'Europe/Paris',
        prompt_set_version: 'v1',
        schema_version: 1,
      },
    })
    .returning();
  return ritual!;
}

async function cleanup() {
  await db.delete(ritualResponses);
  await db.delete(ritualPendingResponses);
  await db.delete(ritualFireEvents);
  await db.delete(rituals).where(eq(rituals.name, FIXTURE_RITUAL_NAME));
}

describe('Phase 28 Plan 03 SKIP-04 — adjustment dialogue + Haiku classification', () => {
  // Cumulative afterAll — Pitfall 6 invariant: Sonnet NEVER called.
  afterAll(async () => {
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    await cleanup();
    await sql.end({ timeout: 5 }).catch(() => {});
  });

  beforeEach(async () => {
    await cleanup();
    mockAnthropicCreate.mockReset();
    mockAnthropicParse.mockReset();
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue({ message_id: 9999 });
  });

  it('Test 1 (fire-side): fireAdjustmentDialogue sends Telegram message + inserts pending row with metadata.kind=adjustment_dialogue', async () => {
    const ritual = await createTestRitual('daily');

    const outcome = await fireAdjustmentDialogue(ritual);

    // 1. Returns in_dialogue outcome
    expect(outcome).toBe('in_dialogue');

    // 2. Telegram message sent in the Phase 41 ADJ-01 observational form,
    // referencing the ritual by its display name. The FIXTURE_RITUAL_NAME slug
    // is not present in RITUAL_DISPLAY_NAMES, so displayName() falls back to
    // the slug per the `?? slug` contract.
    expect(mockSendMessage).toHaveBeenCalledOnce();
    const [, sentText] = mockSendMessage.mock.calls[0]!;
    expect(sentText).toContain("I noticed we've missed");
    expect(sentText).toContain(FIXTURE_RITUAL_NAME);

    // 3. ritual_pending_responses row created with metadata.kind = 'adjustment_dialogue'
    const pendingRows = await db.select().from(ritualPendingResponses);
    expect(pendingRows).toHaveLength(1);
    const pending = pendingRows[0]!;
    expect((pending.metadata as { kind?: string } | null)?.kind).toBe('adjustment_dialogue');

    // 4. ritual_fire_events row with outcome = 'in_dialogue'
    const fireRows = await db.select().from(ritualFireEvents);
    expect(fireRows).toHaveLength(1);
    expect(fireRows[0]!.outcome).toBe('in_dialogue');
  });

  it('Test 2 (Haiku change_requested branch): handleAdjustmentReply creates confirmation pending row + sends echo', async () => {
    const ritual = await createTestRitual('daily');

    // Seed an adjustment_dialogue pending row
    const firedAt = new Date();
    const [pending] = await db
      .insert(ritualPendingResponses)
      .values({
        ritualId: ritual.id,
        chatId: TEST_CHAT_ID,
        firedAt,
        expiresAt: new Date(firedAt.getTime() + 18 * 3600 * 1000),
        promptText: 'This daily adj-dialogue-integration-test-ritual ritual isn\'t working — what should change?',
        metadata: { kind: 'adjustment_dialogue', cadence: 'daily', ritualName: FIXTURE_RITUAL_NAME },
      })
      .returning();

    // Mock Haiku: change_requested
    mockAnthropicParse.mockResolvedValue({
      parsed_output: {
        classification: 'change_requested',
        proposed_change: { field: 'fire_at', new_value: '19:30' },
        confidence: 0.95,
      },
    });

    await handleAdjustmentReply(pending!, Number(TEST_CHAT_ID), 'change the fire time to 19:30');

    // 1. Confirmation pending row created
    const pendingRows = await db.select().from(ritualPendingResponses);
    // Original consumed + new confirmation
    const confirmRows = pendingRows.filter(
      (r) => (r.metadata as { kind?: string } | null)?.kind === 'adjustment_confirmation',
    );
    expect(confirmRows).toHaveLength(1);
    const confirmRow = confirmRows[0]!;
    expect((confirmRow.metadata as { proposed_change?: unknown } | null)?.proposed_change).toMatchObject({
      field: 'fire_at',
      new_value: '19:30',
    });

    // expires_at = firedAt + 60s (within tolerance)
    const expiresMs = new Date(confirmRow.expiresAt).getTime();
    const firedMs = new Date(confirmRow.firedAt).getTime();
    expect(expiresMs - firedMs).toBeGreaterThanOrEqual(55_000);
    expect(expiresMs - firedMs).toBeLessThanOrEqual(65_000);

    // 2. Telegram echo sent. Phase 41 ADJ-02 / WR-09 routes the slug through
    // configFieldLabel — fire_at → "fire time" in the EN locale slot.
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const echoText = mockSendMessage.mock.calls[0]![1] as string;
    expect(echoText).toContain('fire time');
    expect(echoText).toContain('19:30');

    // 3. Original pending row consumed
    const [orig] = await db
      .select()
      .from(ritualPendingResponses)
      .where(eq(ritualPendingResponses.id, pending!.id));
    expect(orig!.consumedAt).not.toBeNull();
  });

  it('Test 3 (Haiku no_change branch): handleAdjustmentReply resets skip_count + writes responded event', async () => {
    const ritual = await createTestRitual('daily');

    const firedAt = new Date();
    const [pending] = await db
      .insert(ritualPendingResponses)
      .values({
        ritualId: ritual.id,
        chatId: TEST_CHAT_ID,
        firedAt,
        expiresAt: new Date(firedAt.getTime() + 18 * 3600 * 1000),
        promptText: 'What should change?',
        metadata: { kind: 'adjustment_dialogue', cadence: 'daily', ritualName: FIXTURE_RITUAL_NAME },
      })
      .returning();

    mockAnthropicParse.mockResolvedValue({
      parsed_output: { classification: 'no_change', proposed_change: null, confidence: 0.9 },
    });

    await handleAdjustmentReply(pending!, Number(TEST_CHAT_ID), 'no change, all good');

    // 1. skip_count reset to 0
    const [updatedRitual] = await db.select().from(rituals).where(eq(rituals.id, ritual.id));
    expect(updatedRitual!.skipCount).toBe(0);

    // 2. ritual_fire_events row with outcome='responded'
    const fireRows = await db.select().from(ritualFireEvents);
    expect(fireRows.some((r) => r.outcome === 'responded')).toBe(true);

    // 3. No confirmation pending row created
    const confirmRows = (await db.select().from(ritualPendingResponses)).filter(
      (r) => (r.metadata as { kind?: string } | null)?.kind === 'adjustment_confirmation',
    );
    expect(confirmRows).toHaveLength(0);
  });

  it('Test 4 (Haiku evasive branch): handleAdjustmentReply writes ritual_responses with evasive classification', async () => {
    const ritual = await createTestRitual('daily');

    const firedAt = new Date();
    const [pending] = await db
      .insert(ritualPendingResponses)
      .values({
        ritualId: ritual.id,
        chatId: TEST_CHAT_ID,
        firedAt,
        expiresAt: new Date(firedAt.getTime() + 18 * 3600 * 1000),
        promptText: 'What should change?',
        metadata: { kind: 'adjustment_dialogue', cadence: 'daily', ritualName: FIXTURE_RITUAL_NAME },
      })
      .returning();

    mockAnthropicParse.mockResolvedValue({
      parsed_output: { classification: 'evasive', proposed_change: null, confidence: 0.8 },
    });

    await handleAdjustmentReply(pending!, Number(TEST_CHAT_ID), 'whatever');

    // ritual_responses row with metadata.kind='adjustment_dialogue_response' + classification='evasive'
    const respRows = await db.select().from(ritualResponses);
    expect(respRows).toHaveLength(1);
    const resp = respRows[0]!;
    expect((resp.metadata as { kind?: string; classification?: string } | null)?.kind).toBe('adjustment_dialogue_response');
    expect((resp.metadata as { classification?: string } | null)?.classification).toBe('evasive');
  });

  it('Test 5 (low confidence default-evasive): confidence < 0.7 treated as evasive', async () => {
    const ritual = await createTestRitual('daily');

    const firedAt = new Date();
    const [pending] = await db
      .insert(ritualPendingResponses)
      .values({
        ritualId: ritual.id,
        chatId: TEST_CHAT_ID,
        firedAt,
        expiresAt: new Date(firedAt.getTime() + 18 * 3600 * 1000),
        promptText: 'What should change?',
        metadata: { kind: 'adjustment_dialogue', cadence: 'daily', ritualName: FIXTURE_RITUAL_NAME },
      })
      .returning();

    // Low confidence — would be change_requested if not for low confidence
    mockAnthropicParse.mockResolvedValue({
      parsed_output: {
        classification: 'change_requested',
        proposed_change: { field: 'fire_at', new_value: '20:00' },
        confidence: 0.4,
      },
    });

    await handleAdjustmentReply(pending!, Number(TEST_CHAT_ID), 'maybe 20:00 could work?');

    // Should behave as evasive — no confirmation pending row
    const confirmRows = (await db.select().from(ritualPendingResponses)).filter(
      (r) => (r.metadata as { kind?: string } | null)?.kind === 'adjustment_confirmation',
    );
    expect(confirmRows).toHaveLength(0);

    // ritual_responses row tagged classification='evasive'
    const respRows = await db.select().from(ritualResponses);
    expect(respRows).toHaveLength(1);
    expect((respRows[0]!.metadata as { classification?: string } | null)?.classification).toBe('evasive');
  });

  it('Test 6 (retry-cap-2): 2 Haiku failures → templated fallback (no_change)', async () => {
    const ritual = await createTestRitual('daily');

    const firedAt = new Date();
    const [pending] = await db
      .insert(ritualPendingResponses)
      .values({
        ritualId: ritual.id,
        chatId: TEST_CHAT_ID,
        firedAt,
        expiresAt: new Date(firedAt.getTime() + 18 * 3600 * 1000),
        promptText: 'What should change?',
        metadata: { kind: 'adjustment_dialogue', cadence: 'daily', ritualName: FIXTURE_RITUAL_NAME },
      })
      .returning();

    // Both Haiku calls throw — triggers templated fallback after retry-cap-2
    mockAnthropicParse
      .mockRejectedValueOnce(new Error('Haiku failure 1'))
      .mockRejectedValueOnce(new Error('Haiku failure 2'));

    await handleAdjustmentReply(pending!, Number(TEST_CHAT_ID), 'some vague reply');

    // Should fall back to no_change (templated fallback) — no confirmation row
    const confirmRows = (await db.select().from(ritualPendingResponses)).filter(
      (r) => (r.metadata as { kind?: string } | null)?.kind === 'adjustment_confirmation',
    );
    expect(confirmRows).toHaveLength(0);

    // Haiku was called exactly 2 times (retry-cap-2)
    expect(mockAnthropicParse).toHaveBeenCalledTimes(2);
  });
});
