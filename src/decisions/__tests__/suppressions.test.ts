/**
 * Phase 14 Wave 0 RED test — CAP-06 `/decisions suppress` persistence + match.
 *
 * Covers:
 *   - addSuppression trims + lowercases and stores a row.
 *   - isSuppressed matches case-insensitive substring against chat's full message.
 *   - isSuppressed is scoped per chat.
 *   - Duplicate adds are no-ops (unique constraint).
 *   - Suppressions survive a simulated process restart (DB-backed, D-17).
 *
 * Will fail until Wave 1 "suppressions" plan lands src/decisions/suppressions.ts.
 *
 * Run: npx vitest run src/decisions/__tests__/suppressions.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../../db/connection.js';
import {
  decisions,
  decisionEvents,
  decisionCaptureState,
  decisionTriggerSuppressions,
} from '../../db/schema.js';
// @ts-expect-error — Wave 1 creates this module
import { addSuppression, isSuppressed } from '../suppressions.js';

describe('CAP-06: decision_trigger_suppressions persistence + match', () => {
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
    vi.restoreAllMocks();
  });

  it('addSuppression persists row (trimmed + lowercased)', async () => {
    await addSuppression(100n, "  I'm Thinking About  ");
    const rows = await db
      .select()
      .from(decisionTriggerSuppressions)
      .where(eq(decisionTriggerSuppressions.chatId, 100n));
    expect(rows.length).toBe(1);
    expect(rows[0]!.phrase).toBe("i'm thinking about");
  });

  it('isSuppressed(text, chatId) matches case-insensitive substring', async () => {
    await addSuppression(101n, "i'm thinking about");
    const matched = await isSuppressed("Hey Chris, I'M THINKING ABOUT dinner tonight", 101n);
    expect(matched).toBe(true);
  });

  it('isSuppressed is scoped per chatId', async () => {
    await addSuppression(102n, "i'm thinking about");
    const matchedOther = await isSuppressed(
      "I'm thinking about leaving my job",
      103n,
    );
    expect(matchedOther).toBe(false);
  });

  it('adding the same phrase twice is a no-op (unique constraint)', async () => {
    await addSuppression(104n, "i'm thinking about");
    await addSuppression(104n, "I'm Thinking About"); // same after normalize
    const rows = await db
      .select()
      .from(decisionTriggerSuppressions)
      .where(eq(decisionTriggerSuppressions.chatId, 104n));
    expect(rows.length).toBe(1);
  });

  it('simulated restart preserves suppressions', async () => {
    await addSuppression(105n, "i'm thinking about");
    // Simulate "restart" by requesting fresh via DB directly, bypassing any
    // in-memory cache the implementation might have.
    const rows = await db
      .select()
      .from(decisionTriggerSuppressions)
      .where(eq(decisionTriggerSuppressions.chatId, 105n));
    expect(rows.length).toBe(1);
    // And the helper still sees it after a "cold" call.
    const matched = await isSuppressed("I'm THINKING about anything", 105n);
    expect(matched).toBe(true);
  });
});
