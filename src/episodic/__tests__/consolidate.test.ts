/**
 * src/episodic/__tests__/consolidate.test.ts — Phase 21 Plan 04 Task 3
 *
 * Integration tests for `runConsolidate(date)`. Real Postgres + mocked
 * Anthropic SDK + mocked bot.api.sendMessage. Covers all six requirements
 * closed by Plan 21-04 (CONS-01, CONS-02, CONS-03, CONS-06, CONS-07, CONS-12).
 *
 * Coverage (12 tests):
 *  Test 1   — CONS-02 entry-count gate: zero entries → no Sonnet call, no row
 *  Test 2   — CONS-03 idempotency (pre-flight SELECT wins): existing row → skip
 *  Test 3   — CONS-03 idempotency (retry on existing day): second call skipped
 *  Test 4   — CONS-01 happy path: end-to-end insert with correct fields
 *  Test 5   — CONS-06 decision-day floor: importance clamped up to 6
 *  Test 6   — CONS-06 boundary: withdrawn decision does NOT trigger floor
 *  Test 7   — CONS-07 contradiction floor: importance clamped up to 7
 *  Test 8   — CONS-06 + CONS-07 combined: max(6, 7) = 7
 *  Test 9   — CONS-12 Sonnet error: notify called, returns failed
 *  Test 10  — CONS-12 retry success: parse error then valid → inserted
 *  Test 11  — CONS-12 notify itself throws: still returns failed cleanly
 *  Test 12  — CONS-01 schema validation: out-of-range importance → failed
 *
 * Anthropic SDK is mocked via vi.hoisted + vi.mock — running this file with
 * ANTHROPIC_API_KEY unset must still pass. Real Postgres via Docker (D018);
 * vitest's fileParallelism: false makes TRUNCATE between tests safe.
 *
 * Run in isolation:
 *   DATABASE_URL=postgresql://chris:localtest123@localhost:5433/chris \
 *     ANTHROPIC_API_KEY=test-key TELEGRAM_BOT_TOKEN=test-token \
 *     TELEGRAM_AUTHORIZED_USER_ID=99999 \
 *     npx vitest run src/episodic/__tests__/consolidate.test.ts
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { DateTime } from 'luxon';
import { db, sql as pgSql } from '../../db/connection.js';
import {
  pensieveEntries,
  contradictions,
  decisions,
  decisionEvents,
  episodicSummaries,
} from '../../db/schema.js';
import type { EpisodicSummarySonnetOutput } from '../types.js';

// ── Hoisted mocks ───────────────────────────────────────────────────────────
//
// Hoisted at vi.hoisted-time so the references are available inside vi.mock
// factories (which themselves are hoisted to the very top of the module
// transformation by Vitest). Same pattern as
// src/decisions/__tests__/synthetic-fixture.test.ts.

const { mockAnthropicParse, mockSendMessage } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  // sendMessage default: resolved void. Per-test override for the
  // notify-itself-throws case (Test 11).
  mockSendMessage: vi.fn().mockResolvedValue(undefined as unknown as void),
}));

// Mock the Anthropic singleton — the test file imports runConsolidate after
// these mocks are in place, so consolidate.ts gets the mocked anthropic.
vi.mock('../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../llm/client.js')>();
  return {
    ...orig,
    anthropic: {
      messages: {
        parse: mockAnthropicParse,
        create: vi.fn(),
      },
    },
  };
});

// Mock the bot — notifyConsolidationError calls bot.api.sendMessage.
vi.mock('../../bot/bot.js', () => ({
  bot: {
    api: { sendMessage: mockSendMessage },
  },
}));

// Imports AFTER vi.mock so the module under test sees the mocked values.
// Note: ESM-style top-level imports ARE hoisted even after vi.mock per Vitest's
// transformer, but for clarity (and to match the synthetic-fixture pattern)
// we import here.
import { runConsolidate } from '../consolidate.js';

// ── Fixture helpers ─────────────────────────────────────────────────────────

/** Build a JS Date for a wall-clock instant in a specific IANA timezone. */
function tzDate(iso: string, tz: string): Date {
  return DateTime.fromISO(iso, { zone: tz }).toJSDate();
}

/** Insert N pensieve entries on the given local-Paris date, ascending hours. */
async function seedEntries(
  localDate: string,
  count: number,
  tz = 'Europe/Paris',
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const hh = String(8 + i).padStart(2, '0');
    const [row] = await db
      .insert(pensieveEntries)
      .values({
        content: `Entry ${i + 1} for ${localDate}`,
        createdAt: tzDate(`${localDate}T${hh}:00:00`, tz),
        source: 'consolidate-test',
      })
      .returning({ id: pensieveEntries.id });
    ids.push(row!.id);
  }
  return ids;
}

/**
 * Build a valid Sonnet output payload for happy-path mocking. Pass overrides
 * to vary specific fields per test (e.g. importance=3 for floor tests).
 */
function makeSonnetOutput(
  overrides: Partial<EpisodicSummarySonnetOutput> = {},
): EpisodicSummarySonnetOutput {
  return {
    summary:
      'A normal day. Greg worked on Project Chris and made steady progress.',
    importance: 5,
    topics: ['work', 'project-chris'],
    emotional_arc: 'steady',
    key_quotes: [],
    ...overrides,
  };
}

/** Configure the next mockAnthropicParse call to resolve with a Sonnet payload. */
function mockSonnetSuccess(
  overrides: Partial<EpisodicSummarySonnetOutput> = {},
): void {
  mockAnthropicParse.mockResolvedValueOnce({
    parsed_output: makeSonnetOutput(overrides),
  });
}

/** Insert a real-state decision (NOT open-draft) into the day window. */
async function seedDecision(opts: {
  decisionText: string;
  status: 'open' | 'due' | 'resolved' | 'reviewed' | 'withdrawn';
  createdAt: Date;
  resolvedAt?: Date | null;
  resolveBy: Date;
  resolution?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(decisions)
    .values({
      decisionText: opts.decisionText,
      status: opts.status,
      reasoning: 'fixture reasoning',
      prediction: 'fixture prediction',
      falsificationCriterion: 'fixture criterion',
      resolveBy: opts.resolveBy,
      createdAt: opts.createdAt,
      resolvedAt: opts.resolvedAt ?? null,
      resolution: opts.resolution ?? null,
    })
    .returning({ id: decisions.id });
  return row!.id;
}

/** Insert a DETECTED contradiction between two pensieve entries. */
async function seedContradiction(opts: {
  entryAId: string;
  entryBId: string;
  detectedAt: Date;
}): Promise<string> {
  const [row] = await db
    .insert(contradictions)
    .values({
      entryAId: opts.entryAId,
      entryBId: opts.entryBId,
      description: 'fixture contradiction description',
      detectedAt: opts.detectedAt,
      status: 'DETECTED',
    })
    .returning({ id: contradictions.id });
  return row!.id;
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('episodic/consolidate — runConsolidate end-to-end (CONS-01/02/03/06/07/12)', () => {
  const TZ = 'Europe/Paris';
  const TEST_DATE_STR = '2026-04-15';
  const testDate = tzDate(`${TEST_DATE_STR}T12:00:00`, TZ);

  beforeAll(async () => {
    // Smoke test: DB must be reachable before any TRUNCATE.
    await pgSql`SELECT 1 as ok`;
  });

  beforeEach(async () => {
    // FK-safe truncation order. CASCADE handles transitive FKs.
    await db.execute(sql`TRUNCATE TABLE episodic_summaries CASCADE`);
    await db.execute(sql`TRUNCATE TABLE contradictions CASCADE`);
    await db.execute(sql`TRUNCATE TABLE decision_events CASCADE`);
    await db.execute(sql`TRUNCATE TABLE decisions CASCADE`);
    await db.execute(sql`TRUNCATE TABLE pensieve_entries CASCADE`);
    mockAnthropicParse.mockReset();
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue(undefined as unknown as void);
  });

  afterAll(async () => {
    // Final cleanup so the next test file sees an empty state.
    await db.execute(sql`TRUNCATE TABLE episodic_summaries CASCADE`);
    await db.execute(sql`TRUNCATE TABLE contradictions CASCADE`);
    await db.execute(sql`TRUNCATE TABLE decision_events CASCADE`);
    await db.execute(sql`TRUNCATE TABLE decisions CASCADE`);
    await db.execute(sql`TRUNCATE TABLE pensieve_entries CASCADE`);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 1 — CONS-02 entry-count gate
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 1 (CONS-02): zero entries returns skipped:no-entries with no Sonnet call, no row', async () => {
    // No entries seeded for the test date.
    const result = await runConsolidate(testDate);

    expect(result).toEqual({ skipped: 'no-entries' });
    expect(mockAnthropicParse).toHaveBeenCalledTimes(0);
    expect(mockSendMessage).toHaveBeenCalledTimes(0);

    const rows = await db
      .select({ id: episodicSummaries.id })
      .from(episodicSummaries);
    expect(rows).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2 — CONS-03 idempotency (pre-flight SELECT wins)
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 2 (CONS-03 pre-flight): existing row → skipped:existing with no Sonnet call', async () => {
    // Pre-insert a row for this date.
    await db.insert(episodicSummaries).values({
      summaryDate: TEST_DATE_STR,
      summary: 'pre-existing summary, at least fifty characters long for Zod.',
      importance: 4,
      topics: ['pre-existing'],
      emotionalArc: 'pre-existing',
      keyQuotes: [],
      sourceEntryIds: [],
    });
    // Seed entries — they should NOT trigger a Sonnet call because pre-flight
    // SELECT runs first.
    await seedEntries(TEST_DATE_STR, 2);

    const result = await runConsolidate(testDate);

    expect(result).toEqual({ skipped: 'existing' });
    expect(mockAnthropicParse).toHaveBeenCalledTimes(0);
    expect(mockSendMessage).toHaveBeenCalledTimes(0);

    const rows = await db
      .select({ id: episodicSummaries.id })
      .from(episodicSummaries);
    expect(rows).toHaveLength(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3 — CONS-03 idempotency (call twice, second is no-op)
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 3 (CONS-03 retry): second call returns skipped:existing, Anthropic called exactly once', async () => {
    await seedEntries(TEST_DATE_STR, 2);
    mockSonnetSuccess({ importance: 4 });

    const first = await runConsolidate(testDate);
    expect(first).toMatchObject({ inserted: true });

    const second = await runConsolidate(testDate);
    expect(second).toEqual({ skipped: 'existing' });

    expect(mockAnthropicParse).toHaveBeenCalledTimes(1);

    const rows = await db
      .select({ id: episodicSummaries.id })
      .from(episodicSummaries);
    expect(rows).toHaveLength(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4 — CONS-01 end-to-end happy path
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 4 (CONS-01): inserts a row with correct fields and source_entry_ids', async () => {
    const ids = await seedEntries(TEST_DATE_STR, 3);
    mockSonnetSuccess({
      summary:
        'Greg traveled to Paris and journaled about the trip throughout the day.',
      importance: 5,
      topics: ['travel', 'paris'],
      emotional_arc: 'enthusiastic',
      key_quotes: ['Entry 1 for 2026-04-15'],
    });

    const result = await runConsolidate(testDate);
    expect(result).toMatchObject({ inserted: true });

    const rows = await db
      .select()
      .from(episodicSummaries)
      .where(eq(episodicSummaries.summaryDate, TEST_DATE_STR));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.summary).toContain('Greg traveled to Paris');
    expect(row.importance).toBe(5);
    expect(row.topics).toEqual(['travel', 'paris']);
    expect(row.emotionalArc).toBe('enthusiastic');
    expect(row.keyQuotes).toEqual(['Entry 1 for 2026-04-15']);
    // source_entry_ids: must contain all 3 entry IDs.
    expect(row.sourceEntryIds).toHaveLength(3);
    expect(new Set(row.sourceEntryIds)).toEqual(new Set(ids));
    // summary_date is the local YYYY-MM-DD string.
    expect(row.summaryDate).toBe(TEST_DATE_STR);
    // Sonnet called exactly once.
    expect(mockAnthropicParse).toHaveBeenCalledTimes(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 5 — CONS-06 decision-day floor
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 5 (CONS-06): real decision today clamps importance up to 6', async () => {
    await seedEntries(TEST_DATE_STR, 2);
    await seedDecision({
      decisionText: 'Sign the new lease',
      status: 'open',
      createdAt: tzDate(`${TEST_DATE_STR}T11:00:00`, TZ),
      resolveBy: tzDate('2026-05-15T18:00:00', TZ),
    });
    mockSonnetSuccess({ importance: 3 });

    const result = await runConsolidate(testDate);
    expect(result).toMatchObject({ inserted: true });

    const rows = await db
      .select({ importance: episodicSummaries.importance })
      .from(episodicSummaries)
      .where(eq(episodicSummaries.summaryDate, TEST_DATE_STR));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.importance).toBe(6); // clamped up from 3
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6 — CONS-06 boundary: withdrawn decision does NOT trigger floor
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 6 (CONS-06 boundary): withdrawn decision does NOT trigger the importance floor', async () => {
    await seedEntries(TEST_DATE_STR, 2);
    await seedDecision({
      decisionText: 'Decided not to do the thing',
      status: 'withdrawn',
      createdAt: tzDate(`${TEST_DATE_STR}T11:00:00`, TZ),
      resolveBy: tzDate('2026-05-15T18:00:00', TZ),
    });
    mockSonnetSuccess({ importance: 3 });

    const result = await runConsolidate(testDate);
    expect(result).toMatchObject({ inserted: true });

    const rows = await db
      .select({ importance: episodicSummaries.importance })
      .from(episodicSummaries)
      .where(eq(episodicSummaries.summaryDate, TEST_DATE_STR));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.importance).toBe(3); // NOT clamped — withdrawn isn't a real state
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 7 — CONS-07 contradiction floor
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 7 (CONS-07): contradiction today clamps importance up to 7', async () => {
    const [aId, bId] = await seedEntries(TEST_DATE_STR, 2);
    await seedContradiction({
      entryAId: aId!,
      entryBId: bId!,
      detectedAt: tzDate(`${TEST_DATE_STR}T15:00:00`, TZ),
    });
    mockSonnetSuccess({ importance: 4 });

    const result = await runConsolidate(testDate);
    expect(result).toMatchObject({ inserted: true });

    const rows = await db
      .select({ importance: episodicSummaries.importance })
      .from(episodicSummaries)
      .where(eq(episodicSummaries.summaryDate, TEST_DATE_STR));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.importance).toBe(7); // clamped up from 4
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 8 — CONS-06 + CONS-07 combined: max(6, 7) = 7
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 8 (CONS-06 + CONS-07 combined): both floors apply, max(6, 7) = 7', async () => {
    const [aId, bId] = await seedEntries(TEST_DATE_STR, 2);
    await seedDecision({
      decisionText: 'Decision and contradiction same day',
      status: 'resolved',
      createdAt: tzDate(`${TEST_DATE_STR}T10:00:00`, TZ),
      resolvedAt: tzDate(`${TEST_DATE_STR}T17:00:00`, TZ),
      resolveBy: tzDate(`${TEST_DATE_STR}T18:00:00`, TZ),
      resolution: 'done',
    });
    await seedContradiction({
      entryAId: aId!,
      entryBId: bId!,
      detectedAt: tzDate(`${TEST_DATE_STR}T16:00:00`, TZ),
    });
    mockSonnetSuccess({ importance: 2 });

    const result = await runConsolidate(testDate);
    expect(result).toMatchObject({ inserted: true });

    const rows = await db
      .select({ importance: episodicSummaries.importance })
      .from(episodicSummaries)
      .where(eq(episodicSummaries.summaryDate, TEST_DATE_STR));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.importance).toBe(7); // max(2, 6, 7) = 7
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 9 — CONS-12 Sonnet error → notify + failed
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 9 (CONS-12): Sonnet rate-limit on both calls → notify + failed', async () => {
    await seedEntries(TEST_DATE_STR, 2);
    // Both first attempt and retry throw — propagates to top-level catch.
    mockAnthropicParse.mockRejectedValueOnce(
      new Error('rate limit exceeded'),
    );
    mockAnthropicParse.mockRejectedValueOnce(
      new Error('rate limit exceeded'),
    );

    const result = await runConsolidate(testDate);
    expect(result).toMatchObject({ failed: true });

    expect(mockAnthropicParse).toHaveBeenCalledTimes(2); // initial + 1 retry
    expect(mockSendMessage).toHaveBeenCalledTimes(1);

    const sendArgs = mockSendMessage.mock.calls[0];
    // Args: [chatId, messageText]
    expect(sendArgs).toBeDefined();
    const messageText = sendArgs![1] as string;
    expect(messageText).toContain('Episodic consolidation failed for');
    expect(messageText).toContain(TEST_DATE_STR);
    expect(messageText).toContain('rate limit exceeded');

    const rows = await db
      .select({ id: episodicSummaries.id })
      .from(episodicSummaries);
    expect(rows).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 10 — CONS-12 retry success: parse error then valid → inserted
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 10 (CONS-12 retry): first parse fails, retry succeeds → inserted, no notify', async () => {
    await seedEntries(TEST_DATE_STR, 2);
    // First call throws ZodError; retry returns valid payload.
    mockAnthropicParse.mockRejectedValueOnce(
      new ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'undefined',
          path: ['summary'],
          message: 'Required',
        } as never,
      ]),
    );
    mockAnthropicParse.mockResolvedValueOnce({
      parsed_output: makeSonnetOutput({ importance: 4 }),
    });

    const result = await runConsolidate(testDate);
    expect(result).toMatchObject({ inserted: true });

    expect(mockAnthropicParse).toHaveBeenCalledTimes(2);
    expect(mockSendMessage).toHaveBeenCalledTimes(0);

    const rows = await db
      .select({ id: episodicSummaries.id, importance: episodicSummaries.importance })
      .from(episodicSummaries);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.importance).toBe(4);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 11 — CONS-12 notify-itself-throws does NOT bubble
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 11 (CONS-12 notify failure): bot.api.sendMessage throws → still returns failed cleanly', async () => {
    await seedEntries(TEST_DATE_STR, 2);
    mockAnthropicParse.mockRejectedValueOnce(
      new Error('first sonnet error'),
    );
    mockAnthropicParse.mockRejectedValueOnce(
      new Error('second sonnet error'),
    );
    // The notify path will be entered — make sendMessage itself throw.
    mockSendMessage.mockReset();
    mockSendMessage.mockRejectedValueOnce(new Error('telegram api unreachable'));

    // Must NOT throw out of runConsolidate.
    const result = await runConsolidate(testDate);
    expect(result).toMatchObject({ failed: true });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);

    const rows = await db
      .select({ id: episodicSummaries.id })
      .from(episodicSummaries);
    expect(rows).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 12 — CONS-01 schema validation: out-of-range importance → failed
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 12 (CONS-01 schema validation): Sonnet returns importance=11 → failed + notify', async () => {
    await seedEntries(TEST_DATE_STR, 2);
    // The mocked parsed_output bypasses the SDK's own zodOutputFormat parser.
    // Step 8 (parseEpisodicSummary) catches the violation instead.
    mockAnthropicParse.mockResolvedValueOnce({
      parsed_output: {
        summary:
          'A summary at least fifty characters long to satisfy the min(50) Zod constraint.',
        importance: 11, // out of [1, 10] range
        topics: ['out-of-range'],
        emotional_arc: 'odd',
        key_quotes: [],
      },
    });

    const result = await runConsolidate(testDate);
    expect(result).toMatchObject({ failed: true });

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const messageText = mockSendMessage.mock.calls[0]![1] as string;
    expect(messageText).toContain('Episodic consolidation failed for');
    expect(messageText).toContain(TEST_DATE_STR);

    const rows = await db
      .select({ id: episodicSummaries.id })
      .from(episodicSummaries);
    expect(rows).toHaveLength(0);
  });
});
