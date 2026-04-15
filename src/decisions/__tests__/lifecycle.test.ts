/**
 * Wave 0 RED test — lifecycle chokepoint (transitionDecision) assertions.
 * Covers LIFE-02, LIFE-03.
 *
 * Will fail until Plan 04 (lifecycle + errors) lands code.
 *
 * Run: npx vitest run src/decisions/__tests__/lifecycle.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import { db, sql } from '../../db/connection.js';
// @ts-expect-error — tables not yet in schema.ts (Plan 02)
import { decisions, decisionEvents, decisionCaptureState } from '../../db/schema.js';
// @ts-expect-error — Plan 04 creates these modules
import { transitionDecision } from '../lifecycle.js';
// @ts-expect-error — Plan 04 creates these modules
import { InvalidTransitionError, OptimisticConcurrencyError, DecisionNotFoundError } from '../errors.js';

// D-04 legal transition map
const LEGAL: ReadonlyArray<readonly [string, string]> = [
  ['open-draft', 'open'],
  ['open-draft', 'withdrawn'],
  ['open-draft', 'abandoned'],
  ['open', 'due'],
  ['open', 'withdrawn'],
  ['due', 'resolved'],
  ['due', 'stale'],
  ['due', 'withdrawn'],
  ['resolved', 'reviewed'],
];

const ALL_STATES = [
  'open-draft',
  'open',
  'due',
  'resolved',
  'reviewed',
  'withdrawn',
  'stale',
  'abandoned',
] as const;

const TERMINALS = ['reviewed', 'withdrawn', 'stale', 'abandoned'] as const;

function isLegal(from: string, to: string): boolean {
  return LEGAL.some(([f, t]) => f === from && t === to);
}

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

describe('lifecycle: real DB — transitionDecision chokepoint', () => {
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

  describe('LIFE-02: happy path writes projection + exactly one event', () => {
    it('open-draft → open transitions status and appends one status_changed event', async () => {
      const id = await seedDecision('open-draft');
      const updated = await transitionDecision(id, 'open-draft', 'open', { actor: 'system' });
      expect(updated.status).toBe('open');

      const events = await db
        .select()
        .from(decisionEvents)
        .where(eq(decisionEvents.decisionId, id));
      expect(events).toHaveLength(1);
      expect(events[0]!.eventType).toBe('status_changed');
      expect(events[0]!.fromStatus).toBe('open-draft');
      expect(events[0]!.toStatus).toBe('open');
    });

    it('append-first: event count increments by exactly 1 and snapshot deep-equals projection', async () => {
      const id = await seedDecision('open');
      const before = await db
        .select({ c: drizzleSql<number>`count(*)::int` })
        .from(decisionEvents)
        .where(eq(decisionEvents.decisionId, id));
      const beforeCount = Number(before[0]!.c);

      await transitionDecision(id, 'open', 'due', { actor: 'sweep' });

      const after = await db
        .select({ c: drizzleSql<number>`count(*)::int` })
        .from(decisionEvents)
        .where(eq(decisionEvents.decisionId, id));
      const afterCount = Number(after[0]!.c);
      expect(afterCount - beforeCount).toBe(1);

      const [row] = await db.select().from(decisions).where(eq(decisions.id, id));
      const [lastEvent] = await db
        .select()
        .from(decisionEvents)
        .where(eq(decisionEvents.decisionId, id))
        .orderBy(drizzleSql`created_at DESC, sequence_no DESC`)
        .limit(1);
      const snapshot = lastEvent!.snapshot as Record<string, unknown>;
      // Status must match current row; other fields deep-equal (ignoring timestamp ms noise).
      expect(snapshot.status).toBe(row!.status);
      expect(snapshot.id).toBe(row!.id);
      expect(snapshot.reasoning).toBe(row!.reasoning);
    });
  });

  describe('LIFE-03: full illegal transition enumeration throws InvalidTransitionError', () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        if (isLegal(from, to)) continue;
        it(`illegal: ${from} → ${to} throws InvalidTransitionError`, async () => {
          const id = await seedDecision(from);
          await expect(transitionDecision(id, from, to, { actor: 'system' })).rejects.toBeInstanceOf(
            InvalidTransitionError,
          );
        });
      }
    }
  });

  describe('LIFE-03: terminal states have zero outgoing edges', () => {
    for (const terminal of TERMINALS) {
      it(`${terminal} cannot transition to any other state`, async () => {
        const id = await seedDecision(terminal);
        for (const to of ALL_STATES) {
          if (to === terminal) continue;
          await expect(
            transitionDecision(id, terminal, to, { actor: 'system' }),
          ).rejects.toBeInstanceOf(InvalidTransitionError);
        }
      });
    }
  });

  describe('LIFE-03: no status self-loop', () => {
    it('transitionDecision(id, open, open, ...) throws InvalidTransitionError', async () => {
      const id = await seedDecision('open');
      await expect(transitionDecision(id, 'open', 'open', { actor: 'system' })).rejects.toBeInstanceOf(
        InvalidTransitionError,
      );
    });
  });

  describe('LIFE-03: DecisionNotFoundError', () => {
    it('throws DecisionNotFoundError when id does not exist', async () => {
      await expect(
        transitionDecision('00000000-0000-0000-0000-000000000000', 'open', 'due', { actor: 'sweep' }),
      ).rejects.toBeInstanceOf(DecisionNotFoundError);
    });
  });

  describe('LIFE-03: OptimisticConcurrencyError (stale fromStatus)', () => {
    it('seeded row status=open but caller claims fromStatus=open-draft throws OptimisticConcurrencyError', async () => {
      const id = await seedDecision('open');
      await expect(
        transitionDecision(id, 'open-draft', 'open', { actor: 'system' }),
      ).rejects.toBeInstanceOf(OptimisticConcurrencyError);
    });
  });

  describe('LIFE-03: error message mentions both status names', () => {
    it('InvalidTransitionError message contains from and to status names', async () => {
      const id = await seedDecision('open');
      try {
        await transitionDecision(id, 'open', 'resolved', { actor: 'system' });
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidTransitionError);
        const msg = (err as Error).message;
        expect(msg).toContain('open');
        expect(msg).toContain('resolved');
      }
    });
  });
});
