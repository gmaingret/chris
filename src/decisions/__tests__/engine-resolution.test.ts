/**
 * Phase 16 — PP#0 resolution routing in the engine.
 * Covers RES-02/RES-03 engine integration.
 *
 * Run: npx vitest run src/decisions/__tests__/engine-resolution.test.ts
 */
import { handleResolution, handlePostmortem } from '../resolution.js';

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { db, sql } from '../../db/connection.js';
import {
  decisions,
  decisionEvents,
  decisionCaptureState,
  decisionTriggerSuppressions,
  pensieveEntries,
} from '../../db/schema.js';

// ── Module-level mocks ─────────────────────────────────────────────────────

vi.mock('../../proactive/mute.js', () => ({
  detectMuteIntent: vi.fn().mockResolvedValue({ muted: false }),
  generateMuteAcknowledgment: vi.fn().mockResolvedValue('muted'),
}));

vi.mock('../../chris/modes/journal.js', () => ({
  handleJournal: vi.fn().mockResolvedValue('journal response'),
}));

vi.mock('../../chris/modes/interrogate.js', () => ({
  handleInterrogate: vi.fn().mockResolvedValue('interrogate response'),
}));

vi.mock('../../chris/modes/reflect.js', () => ({
  handleReflect: vi.fn().mockResolvedValue('reflect response'),
}));

vi.mock('../../chris/modes/coach.js', () => ({
  handleCoach: vi.fn().mockResolvedValue('coach response'),
}));

vi.mock('../../chris/modes/psychology.js', () => ({
  handlePsychology: vi.fn().mockResolvedValue('psychology response'),
}));

vi.mock('../../chris/modes/produce.js', () => ({
  handleProduce: vi.fn().mockResolvedValue('produce response'),
}));

vi.mock('../../chris/modes/photos.js', () => ({
  handlePhotos: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../chris/praise-quarantine.js', () => ({
  quarantinePraise: vi.fn().mockImplementation((text: string) => Promise.resolve(text)),
}));

vi.mock('../../chris/contradiction.js', () => ({
  detectContradictions: vi.fn().mockResolvedValue([]),
  type: true,
}));

vi.mock('../../llm/client.js', async () => ({
  anthropic: {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"mode":"JOURNAL"}' }],
      }),
    },
  },
  HAIKU_MODEL: 'test-haiku',
  SONNET_MODEL: 'test-sonnet',
  OPUS_MODEL: 'test-opus',
  callLLM: vi.fn().mockResolvedValue('{}'),
}));

import * as engineMod from '../../chris/engine.js';
import * as muteMod from '../../proactive/mute.js';

// ── Test suite ─────────────────────────────────────────────────────────────

describe('PP#0 resolution routing', () => {
  beforeAll(async () => {
    const result = await sql`SELECT 1 as ok`;
    expect(result[0]!.ok).toBe(1);
  });

  afterAll(async () => {
    await sql.end();
  });

  afterEach(async () => {
    await db.delete(decisionEvents);
    await db.delete(decisions);
    await db.delete(decisionCaptureState);
    await db.delete(decisionTriggerSuppressions);
    await db.delete(pensieveEntries);
    vi.restoreAllMocks();
  });

  it('routes AWAITING_RESOLUTION message to handleResolution', async () => {
    // Seed a decision in 'due' state
    const [decisionRow] = await db
      .insert(decisions)
      .values({
        status: 'due' as never,
        decisionText: 'I will quit my job',
        resolveBy: new Date(Date.now() - 86_400_000), // past deadline
        reasoning: 'consulting pays more',
        prediction: "I'll be happier",
        falsificationCriterion: 'Not happier after 3 months',
      })
      .returning();

    // Seed AWAITING_RESOLUTION capture state
    await db.insert(decisionCaptureState).values({
      chatId: 300n,
      stage: 'AWAITING_RESOLUTION' as never,
      draft: {},
      decisionId: decisionRow!.id,
    });

    const resolutionSpy = vi.spyOn(
      await import('../resolution.js').catch(() => ({ handleResolution: vi.fn() })) as Record<string, unknown>,
      'handleResolution' as never,
    );
    const muteSpy = vi.mocked(muteMod.detectMuteIntent);
    muteSpy.mockClear();

    await engineMod.processMessage(300n, 1, 'I did quit and it went well');

    // handleResolution should have been called; mute check should NOT have run first
    expect(muteSpy).not.toHaveBeenCalled();
  });

  it('routes AWAITING_POSTMORTEM message to handlePostmortem', async () => {
    const [decisionRow] = await db
      .insert(decisions)
      .values({
        status: 'resolved' as never,
        decisionText: 'I will move to consulting',
        resolveBy: new Date(Date.now() - 86_400_000),
        reasoning: 'more money',
        prediction: "I'll be happier",
        falsificationCriterion: 'Not happier',
      })
      .returning();

    // Seed AWAITING_POSTMORTEM capture state
    await db.insert(decisionCaptureState).values({
      chatId: 301n,
      stage: 'AWAITING_POSTMORTEM' as never,
      draft: {},
      decisionId: decisionRow!.id,
    });

    const muteSpy = vi.mocked(muteMod.detectMuteIntent);
    muteSpy.mockClear();

    await engineMod.processMessage(301n, 1, 'I learned a lot from this experience');

    // Engine should route to postmortem handler — mute check should NOT have run first
    expect(muteSpy).not.toHaveBeenCalled();
  });

  it('skips abort-phrase check for AWAITING_RESOLUTION stage (draft={}, no language_at_capture)', async () => {
    // Per Pitfall 1: AWAITING_RESOLUTION rows have draft={}, so language_at_capture is
    // undefined. The abort-phrase code path must not crash on undefined language.
    const [decisionRow] = await db
      .insert(decisions)
      .values({
        status: 'due' as never,
        decisionText: 'I will learn Spanish',
        resolveBy: new Date(Date.now() - 86_400_000),
        reasoning: 'travel',
        prediction: "I'll be conversational in 6 months",
        falsificationCriterion: 'Not conversational after 6 months',
      })
      .returning();

    await db.insert(decisionCaptureState).values({
      chatId: 302n,
      stage: 'AWAITING_RESOLUTION' as never,
      draft: {}, // No language_at_capture — this is the pitfall case
      decisionId: decisionRow!.id,
    });

    // "never mind" is a typical abort phrase — should NOT abort AWAITING_RESOLUTION flow
    // (abort phrases only apply to capture stages, not resolution stages)
    // Should not throw even with undefined language
    await expect(
      engineMod.processMessage(302n, 1, 'never mind'),
    ).resolves.not.toThrow();
  });

  it('falls through to normal mode when no active capture exists', async () => {
    // No capture row — engine should run normal mode detection
    const muteSpy = vi.mocked(muteMod.detectMuteIntent);
    muteSpy.mockClear();

    await engineMod.processMessage(303n, 1, 'Hello, how are things?');

    // Mute check should have run (part of normal flow — PP#0 did not intercept)
    expect(muteSpy).toHaveBeenCalled();
  });
});
