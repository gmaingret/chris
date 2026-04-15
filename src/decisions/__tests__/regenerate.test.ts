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
      expect(projection).toBeDefined();
      const regenerated = await regenerateDecisionFromEvents(id);
      expect(regenerated).not.toBeNull();
      expect(regenerated).toEqual(projection);
      expect(regenerated!.status).toBe('reviewed');
    });
  });

  describe('CR-01 regression: bigint chat_id round-trips through event snapshot', () => {
    it('seeded decision with chatId: 123n transitions successfully and regenerate deep-equals projection', async () => {
      // Seed directly (not via seedDecision helper) so we can set chatId.
      const [row] = await db
        .insert(decisions)
        .values({
          status: 'open' as never,
          decisionText: 'bigint-roundtrip',
          resolveBy: new Date(Date.now() + 86_400_000),
          reasoning: 'seeded',
          prediction: 'seeded',
          falsificationCriterion: 'seeded',
          chatId: 123n,
        })
        .returning();
      const id = row.id as string;

      // Without the CR-01 fix, this step throws `TypeError: Do not know how to
      // serialize a BigInt` from JSON.stringify during the jsonb snapshot insert,
      // which rolls back the whole transition.
      await transitionDecision(id, 'open', 'due', { actor: 'sweep' });

      const [projection] = await db.select().from(decisions).where(eq(decisions.id, id));
      expect(projection).toBeDefined();
      expect(projection!.chatId).toBe(123n);
      expect(projection!.status).toBe('due');

      const regenerated = await regenerateDecisionFromEvents(id);
      expect(regenerated).not.toBeNull();
      // Round-trip parity: regenerate.ts rehydrates the stringified chatId back
      // to BigInt, matching Drizzle's bigint-mode read on the live projection.
      expect(regenerated).toEqual(projection);
      expect(regenerated!.chatId).toBe(123n);
    });
  });

  describe('LIFE-02: side-path roundtrip (open → withdrawn)', () => {
    it('regenerated row deep-equals live projection with status=withdrawn', async () => {
      const id = await seedDecision('open');
      await transitionDecision(id, 'open', 'withdrawn', { actor: 'user' });

      const [projection] = await db.select().from(decisions).where(eq(decisions.id, id));
      expect(projection).toBeDefined();
      const regenerated = await regenerateDecisionFromEvents(id);
      expect(regenerated).not.toBeNull();
      expect(regenerated).toEqual(projection);
      expect(regenerated!.status).toBe('withdrawn');
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

      // WR-03: regenerate now filters to event_type = 'status_changed', so the
      // two tied-timestamp field_updated events above do NOT pollute the replay.
      // The last status_changed event (open → due) remains the anchor, and the
      // returned row deep-equals the live projection.
      const [projection] = await db.select().from(decisions).where(eq(decisions.id, id));
      const regenerated = await regenerateDecisionFromEvents(id);
      expect(regenerated).not.toBeNull();
      expect(regenerated).toEqual(projection);
      expect(regenerated!.status).toBe('due');
    });
  });

  describe('WR-03: regenerate ignores field_updated events and keys off last status_changed', () => {
    it('status_changed then later field_updated partial snapshot still yields full live projection', async () => {
      const id = await seedDecision('open');
      await transitionDecision(id, 'open', 'due', { actor: 'sweep' });

      // Forge a field_updated event AFTER the status_changed — partial snapshot
      // that would, if regenerate naïvely took the tail, return a malformed
      // "DecisionRow" missing required fields (CR-01 era bug that WR-03 fixes).
      await sql`
        INSERT INTO decision_events (decision_id, event_type, from_status, to_status, snapshot, actor)
        VALUES (${id}, 'field_updated', NULL, NULL, ${JSON.stringify({ marker: 'partial' })}::jsonb, 'system')
      `;

      const [projection] = await db.select().from(decisions).where(eq(decisions.id, id));
      const regenerated = await regenerateDecisionFromEvents(id);
      expect(regenerated).not.toBeNull();
      // Must match the live projection, not the partial field_updated snapshot.
      expect(regenerated).toEqual(projection);
      expect(regenerated!.status).toBe('due');
    });
  });
});
