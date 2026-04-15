/**
 * Wave 0 RED test — regenerateDecisionFromEvents replay roundtrip.
 * Covers LIFE-02.
 *
 * Will fail until Plan 04 (lifecycle) and Plan 05 (regenerate) land code.
 *
 * Run: npx vitest run src/decisions/__tests__/regenerate.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../../db/connection.js';
// @ts-expect-error — tables not yet in schema.ts (Plan 02)
import { decisions, decisionEvents, decisionCaptureState } from '../../db/schema.js';
// @ts-expect-error — Plan 04 creates this module
import { transitionDecision } from '../lifecycle.js';
// @ts-expect-error — Plan 05 creates this module
import { regenerateDecisionFromEvents } from '../regenerate.js';

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

describe('regenerate: real DB — event replay roundtrip', () => {
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

  describe('LIFE-02: happy-path roundtrip (open-draft → open → due → resolved → reviewed)', () => {
    it('regenerateDecisionFromEvents deep-equals live projection', async () => {
      const id = await seedDecision('open-draft');
      await transitionDecision(id, 'open-draft', 'open', { actor: 'system' });
      await transitionDecision(id, 'open', 'due', { actor: 'sweep' });
      await transitionDecision(id, 'due', 'resolved', { actor: 'user' });
      await transitionDecision(id, 'resolved', 'reviewed', { actor: 'user' });

      const [projection] = await db.select().from(decisions).where(eq(decisions.id, id));
      const regenerated = await regenerateDecisionFromEvents(id);
      expect(regenerated).toEqual(projection);
      expect(regenerated.status).toBe('reviewed');
    });
  });

  describe('LIFE-02: side-path roundtrip (open → withdrawn)', () => {
    it('regenerated row deep-equals live projection with status=withdrawn', async () => {
      const id = await seedDecision('open');
      await transitionDecision(id, 'open', 'withdrawn', { actor: 'user' });

      const [projection] = await db.select().from(decisions).where(eq(decisions.id, id));
      const regenerated = await regenerateDecisionFromEvents(id);
      expect(regenerated).toEqual(projection);
      expect(regenerated.status).toBe('withdrawn');
      expect(projection!.status).toBe('withdrawn');
    });
  });

  describe('LIFE-02: deterministic replay under tied timestamps — sequence_no breaks tie', () => {
    it('two events with identical created_at replay in sequence_no ASC order', async () => {
      const id = await seedDecision('open');
      await transitionDecision(id, 'open', 'due', { actor: 'sweep' });
      // After the transition there's at least one event; now force a tied-timestamp on two new events
      // by direct INSERT (bypassing chokepoint — this is a test-only data forge for replay determinism).
      // postgres.js tagged-template bindings require string/Buffer for timestamptz;
      // ISO string coerces cleanly at the wire level.
      const tied = '2026-04-15T10:00:00.000Z';
      await sql`
        INSERT INTO decision_events (decision_id, event_type, from_status, to_status, snapshot, actor, created_at)
        VALUES (${id}, 'field_updated', NULL, NULL, ${JSON.stringify({ marker: 'first' })}::jsonb, 'system', ${tied}::timestamptz)
      `;
      await sql`
        INSERT INTO decision_events (decision_id, event_type, from_status, to_status, snapshot, actor, created_at)
        VALUES (${id}, 'field_updated', NULL, NULL, ${JSON.stringify({ marker: 'second' })}::jsonb, 'system', ${tied}::timestamptz)
      `;

      // Regenerate must order by (created_at ASC, sequence_no ASC) — 'second' was inserted later, so
      // its sequence_no is higher; it wins on replay.
      const rows = await sql<{ sequence_no: string; snapshot: { marker: string } }[]>`
        SELECT sequence_no, snapshot FROM decision_events
        WHERE decision_id = ${id} AND event_type = 'field_updated'
        ORDER BY created_at ASC, sequence_no ASC
      `;
      expect(rows).toHaveLength(2);
      expect(rows[0]!.snapshot.marker).toBe('first');
      expect(rows[1]!.snapshot.marker).toBe('second');
      expect(Number(rows[1]!.sequence_no)).toBeGreaterThan(Number(rows[0]!.sequence_no));

      // And regenerate completes without throwing (doesn't assert marker here because regenerate
      // uses last status_changed event as status anchor; this test guarantees ordering only).
      const regenerated = await regenerateDecisionFromEvents(id);
      expect(regenerated).toBeDefined();
    });
  });
});
