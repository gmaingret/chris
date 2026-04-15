/**
 * Wave 0 RED test — optimistic concurrency race through shared pool.
 * Covers LIFE-03.
 *
 * Races via Promise.allSettled on the default postgres.js pool (max=10 → concurrent awaited
 * queries land on distinct connections). No second client, no injected sql override.
 *
 * Will fail until Plan 04 (lifecycle) lands the chokepoint with optimistic guard.
 *
 * Run: npx vitest run src/decisions/__tests__/concurrency.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, sql } from '../../db/connection.js';
// @ts-expect-error — tables not yet in schema.ts (Plan 02)
import { decisions, decisionEvents, decisionCaptureState } from '../../db/schema.js';
// @ts-expect-error — Plan 04 creates this module
import { transitionDecision } from '../lifecycle.js';
// @ts-expect-error — Plan 04 creates this module
import { OptimisticConcurrencyError } from '../errors.js';

async function seedDecision(status: string): Promise<string> {
  const [row] = await db
    .insert(decisions)
    .values({
      status: status as never,
      decisionText: 'seeded',
      resolveBy: new Date(Date.now() + 86_400_000),
      reasoning: 'seeded',
      prediction: 'seeded',
      falsificationCriterion: 'seeded',
    })
    .returning();
  return row.id as string;
}

describe('concurrency: real DB — optimistic concurrency race', () => {
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

  it('concurrent transitions: one winner, one OptimisticConcurrencyError, exactly one event', async () => {
    const id = await seedDecision('open');

    // Both callers pre-read status='open' and claim fromStatus='open'.
    // First tx's UPDATE wins (affects 1 row); second tx's UPDATE finds status != 'open' → 0 rows → throws.
    const results = await Promise.allSettled([
      transitionDecision(id, 'open', 'due', { actor: 'sweep' }),
      transitionDecision(id, 'open', 'due', { actor: 'sweep' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(OptimisticConcurrencyError);

    // Audit: exactly ONE decision_events row for this status change — loser's event was rolled back.
    const events = await db
      .select()
      .from(decisionEvents)
      .where(and(eq(decisionEvents.decisionId, id), eq(decisionEvents.toStatus, 'due')));
    expect(events).toHaveLength(1);

    // Final projection reflects the winner.
    const rows = await db.select().from(decisions).where(eq(decisions.id, id));
    expect(rows[0]!.status).toBe('due');
  });
});
