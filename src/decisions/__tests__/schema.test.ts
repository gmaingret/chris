/**
 * Wave 0 RED test — schema assertions for Phase 13.
 * Covers LIFE-01, LIFE-04, LIFE-06.
 *
 * Will fail until Plan 02 (schema) lands tables/enums/indexes.
 *
 * Run: npx vitest run src/decisions/__tests__/schema.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { db, sql } from '../../db/connection.js';
// These imports will be resolvable once schema.ts is extended in Plan 02.
// TypeScript errors at Wave 0 are expected.
// @ts-expect-error — tables not yet in schema (Plan 02 adds them)
import { decisions, decisionEvents, decisionCaptureState } from '../../db/schema.js';

describe('schema: real DB — Phase 13 tables, enums, and constraints', () => {
  beforeAll(async () => {
    const result = await sql`SELECT 1 as ok`;
    expect(result[0]!.ok).toBe(1);
  });

  afterAll(async () => {
    await sql.end();
  });

  afterEach(async () => {
    // children before parents — decision_events references decisions
    await db.delete(decisionEvents);
    await db.delete(decisions);
    await db.delete(decisionCaptureState);
  });

  describe('LIFE-01: tables exist post-migration', () => {
    it('tables decisions, decision_events, decision_capture_state exist in public schema', async () => {
      const rows = await sql<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('decisions', 'decision_events', 'decision_capture_state')
        ORDER BY table_name
      `;
      const names = rows.map((r) => r.table_name);
      expect(names).toEqual(['decision_capture_state', 'decision_events', 'decisions']);
    });
  });

  describe('LIFE-01: decision_status enum', () => {
    it('contains exactly 8 values: open-draft, open, due, resolved, reviewed, withdrawn, stale, abandoned', async () => {
      const rows = await sql<{ value: string }[]>`
        SELECT unnest(enum_range(NULL::decision_status))::text AS value ORDER BY 1
      `;
      const values = rows.map((r) => r.value).sort();
      expect(values).toEqual(
        ['abandoned', 'due', 'open', 'open-draft', 'resolved', 'reviewed', 'stale', 'withdrawn'].sort(),
      );
      expect(values).toHaveLength(8);
    });
  });

  describe('LIFE-01: decision_capture_stage enum', () => {
    it('contains exactly 8 values: DECISION, ALTERNATIVES, REASONING, PREDICTION, FALSIFICATION, AWAITING_RESOLUTION, AWAITING_POSTMORTEM, DONE', async () => {
      const rows = await sql<{ value: string }[]>`
        SELECT unnest(enum_range(NULL::decision_capture_stage))::text AS value ORDER BY 1
      `;
      const values = rows.map((r) => r.value).sort();
      expect(values).toEqual(
        [
          'ALTERNATIVES',
          'AWAITING_POSTMORTEM',
          'AWAITING_RESOLUTION',
          'DECISION',
          'DONE',
          'FALSIFICATION',
          'PREDICTION',
          'REASONING',
        ].sort(),
      );
      expect(values).toHaveLength(8);
    });
  });

  describe('LIFE-06: epistemic_tag enum contains DECISION', () => {
    it('DECISION is a value in epistemic_tag enum', async () => {
      const rows = await sql<{ value: string }[]>`
        SELECT unnest(enum_range(NULL::epistemic_tag))::text AS value
      `;
      const values = rows.map((r) => r.value);
      expect(values).toContain('DECISION');
    });
  });

  describe('LIFE-04: NOT NULL constraints', () => {
    it('decisions.falsification_criterion is NOT NULL (INSERT without it throws)', async () => {
      await expect(
        sql`INSERT INTO decisions (resolve_by, reasoning, prediction) VALUES (now(), 'x', 'y')`,
      ).rejects.toThrow(/null value in column "falsification_criterion"/i);
    });

    it('decisions.resolve_by is NOT NULL (INSERT without it throws)', async () => {
      await expect(
        sql`INSERT INTO decisions (reasoning, prediction, falsification_criterion) VALUES ('x', 'y', 'z')`,
      ).rejects.toThrow(/null value in column "resolve_by"/i);
    });
  });

  describe('LIFE-02: decision_events.sequence_no column exists (bigserial replay tiebreaker)', () => {
    it('decision_events has sequence_no column', async () => {
      const rows = await sql<{ column_name: string; data_type: string }[]>`
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='decision_events' AND column_name='sequence_no'
      `;
      expect(rows.length).toBe(1);
    });
  });

  describe('LIFE-02: replay index exists on decision_events(decision_id, created_at, sequence_no)', () => {
    it('index decision_events_decision_id_created_at_sequence_no_idx exists', async () => {
      const rows = await sql<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname='public' AND tablename='decision_events'
          AND indexname='decision_events_decision_id_created_at_sequence_no_idx'
      `;
      expect(rows.length).toBe(1);
    });
  });

  describe('LIFE-01: sweep index on decisions(status, resolve_by) exists for Phase 15', () => {
    it('an index covers (status, resolve_by) columns', async () => {
      const rows = await sql<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename='decisions'
      `;
      const hit = rows.find(
        (r) => /\(status.*resolve_by\)/i.test(r.indexdef) || /\(status.*,.*resolve_by\)/i.test(r.indexdef),
      );
      expect(hit, `expected an index on decisions(status, resolve_by); got: ${JSON.stringify(rows)}`).toBeDefined();
    });
  });
});
