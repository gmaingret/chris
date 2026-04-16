/**
 * Wave 0 RED test — decision_capture_state helpers.
 * Covers Phase 13 capture-state table (from ROADMAP success criterion 1 / D-15).
 *
 * Will fail until Plan 02 (schema) and Plan 04/05 (helpers) land code.
 *
 * Run: npx vitest run src/decisions/__tests__/capture-state.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { db, sql } from '../../db/connection.js';
// @ts-expect-error — tables not yet in schema.ts (Plan 02)
import { decisions, decisionEvents, decisionCaptureState } from '../../db/schema.js';
// @ts-expect-error — Plan 04/05 creates this module
import { getActiveDecisionCapture, upsertAwaitingResolution } from '../capture-state.js';

describe('capture-state: real DB — decision_capture_state helpers', () => {
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
  });

  it('getActiveDecisionCapture returns null when the table is empty', async () => {
    const row = await getActiveDecisionCapture(42n);
    expect(row).toBeNull();
  });

  it('after insert, getActiveDecisionCapture returns the row with stage=DECISION', async () => {
    await db.insert(decisionCaptureState).values({
      chatId: 42n,
      stage: 'DECISION' as never,
      draft: {},
    });
    const row = await getActiveDecisionCapture(42n);
    expect(row).not.toBeNull();
    expect(row!.stage).toBe('DECISION');
    expect(row!.chatId).toBe(42n);
  });

  it('PK=chat_id enforces one active flow per chat: second insert throws unique violation', async () => {
    await db.insert(decisionCaptureState).values({
      chatId: 99n,
      stage: 'DECISION' as never,
      draft: {},
    });
    // Drizzle wraps the driver error; the underlying PostgresError (23505
    // unique_violation) is on err.cause. Assert via cause message.
    await expect(
      db.insert(decisionCaptureState).values({
        chatId: 99n,
        stage: 'ALTERNATIVES' as never,
        draft: {},
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringMatching(/duplicate key|unique constraint/i),
      }),
    });
  });

  // ── Phase 15: upsertAwaitingResolution ─────────────────────────────────────

  it('upsertAwaitingResolution inserts a row with stage=AWAITING_RESOLUTION and decisionId', async () => {
    const decisionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await upsertAwaitingResolution(42n, decisionId);

    const row = await getActiveDecisionCapture(42n);
    expect(row).not.toBeNull();
    expect(row!.stage).toBe('AWAITING_RESOLUTION');
    expect(row!.decisionId).toBe(decisionId);
    expect(row!.chatId).toBe(42n);
  });

  it('upsertAwaitingResolution upserts (replaces) if a row already exists for that chatId', async () => {
    const firstDecisionId = 'aaaaaaaa-bbbb-cccc-dddd-000000000001';
    const secondDecisionId = 'aaaaaaaa-bbbb-cccc-dddd-000000000002';

    // Insert an existing capture row first
    await db.insert(decisionCaptureState).values({
      chatId: 77n,
      stage: 'DECISION' as never,
      draft: { some: 'draft' },
      decisionId: firstDecisionId,
    });

    // Upsert should replace the row
    await upsertAwaitingResolution(77n, secondDecisionId);

    const row = await getActiveDecisionCapture(77n);
    expect(row).not.toBeNull();
    expect(row!.stage).toBe('AWAITING_RESOLUTION');
    expect(row!.decisionId).toBe(secondDecisionId);
    // draft should be reset to empty object
    expect(row!.draft).toEqual({});
  });
});
