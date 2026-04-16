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
import { addSuppression, isSuppressed, listSuppressions, removeSuppression } from '../suppressions.js';

async function cleanupTables() {
  await db.delete(decisionEvents);
  await db.delete(decisions);
  await db.delete(decisionCaptureState);
  await db.delete(decisionTriggerSuppressions);
}

describe('CAP-06: decision_trigger_suppressions persistence + match', () => {
  beforeAll(async () => {
    const result = await sql`SELECT 1 as ok`;
    expect(result[0]!.ok).toBe(1);
  });

  afterEach(async () => {
    await cleanupTables();
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

describe('CAP-06: removeSuppression', () => {
  afterAll(async () => {
    await sql.end();
  });

  afterEach(async () => {
    await cleanupTables();
    vi.restoreAllMocks();
  });

  it('removeSuppression deletes an existing phrase — listSuppressions no longer returns it', async () => {
    await addSuppression(200n, "i'm thinking about");
    const removed = await removeSuppression(200n, "i'm thinking about");
    expect(removed).toBe(true);
    const remaining = await listSuppressions(200n);
    expect(remaining).not.toContain("i'm thinking about");
  });

  it('removeSuppression on a non-existent phrase is a no-op (returns false)', async () => {
    // No suppression added — remove should not throw and returns false
    const removed = await removeSuppression(201n, "no such phrase");
    expect(removed).toBe(false);
  });

  it('removeSuppression normalizes input (trim + lowercase) before matching', async () => {
    await addSuppression(202n, "i'm thinking about");
    // Pass un-normalized version — should still match and delete
    const removed = await removeSuppression(202n, "  I'M THINKING ABOUT  ");
    expect(removed).toBe(true);
    const remaining = await listSuppressions(202n);
    expect(remaining).toHaveLength(0);
  });

  it('removeSuppression only removes for the specific chatId, not other chats', async () => {
    await addSuppression(203n, "i'm thinking about");
    await addSuppression(204n, "i'm thinking about");
    // Remove for chat 203 only
    await removeSuppression(203n, "i'm thinking about");
    const remaining203 = await listSuppressions(203n);
    const remaining204 = await listSuppressions(204n);
    expect(remaining203).toHaveLength(0);
    expect(remaining204).toContain("i'm thinking about");
  });
});
