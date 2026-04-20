/**
 * scripts/__tests__/synthesize-episodic.test.ts — Phase 24 Plan 03 (SYNTH-03).
 *
 * Integration test for the sibling-composition path: given a primed fixture,
 * invoke the real runConsolidate against each synthetic day with a mocked
 * Sonnet and assert that episodic_summaries is populated + dumped to JSONL.
 *
 * Runs against the port-5433 test DB provisioned by scripts/test.sh
 * (NOT a fresh port-5435 container — nested Docker inside vitest is
 * fragile; port 5435 is owned by scripts/synthesize-episodic.ts's main()
 * for operator-invocation paths).
 *
 * This test must NOT be added to scripts/test.sh's excluded-suite list.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterAll,
  vi,
} from 'vitest';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sql as drizzleSql, eq } from 'drizzle-orm';

// ── Hoisted Sonnet mock (matches synthetic-fixture.test.ts pattern) ─────
const { mockAnthropicParse, mockSendMessage } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue(undefined as unknown as void),
}));

vi.mock('../../src/llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../src/llm/client.js')>();
  return {
    ...orig,
    anthropic: {
      messages: { parse: mockAnthropicParse, create: vi.fn() },
    },
  };
});

// Mock telegram bot so failures don't try to hit the real API.
vi.mock('../../src/bot/bot.js', () => ({
  bot: { api: { sendMessage: mockSendMessage } },
}));

import { db, sql as pgSql } from '../../src/db/connection.js';
import {
  pensieveEntries,
  pensieveEmbeddings,
  episodicSummaries,
  decisions,
  decisionEvents,
  decisionCaptureState,
  contradictions,
  proactiveState,
  relationalMemory,
} from '../../src/db/schema.js';
import {
  parseCliArgs,
  loadFixtureIntoDb,
  runSiblingConsolidation,
  dumpEpisodicSummaries,
} from '../synthesize-episodic.js';

const FIXTURE_DIR = 'scripts/__tests__/__fixtures__/synth-episodic/tiny-primed';
const DUMPED_SUMMARIES_PATH = join(FIXTURE_DIR, 'episodic_summaries.jsonl');

function makeMockSonnetResponse(summaryDate: string): unknown {
  // Shape matches EpisodicSummarySonnetOutputSchemaV4 (consolidate.ts uses
  // `response.parsed_output` not `output_parsed`).
  return {
    parsed_output: {
      summary: `Synthetic test summary for ${summaryDate} — at least fifty characters long to satisfy the zod min(50) constraint okay.`,
      importance: 5,
      topics: ['test'],
      emotional_arc: 'neutral',
      key_quotes: [],
    },
  };
}

// FK-safe cleanup in REVERSE dependency order (matches D-11 rationale).
// Narrow to source='telegram' for pensieve_entries so we don't stomp on
// data written by other concurrent suites.
async function cleanup(): Promise<void> {
  await db.delete(pensieveEmbeddings);
  await db.delete(episodicSummaries);
  await db.delete(decisionEvents);
  await db.delete(decisionCaptureState);
  await db.delete(decisions);
  await db.delete(contradictions);
  await db
    .delete(pensieveEntries)
    .where(eq(pensieveEntries.source, 'telegram'));
  await db.delete(proactiveState);
  await db.delete(relationalMemory);
}

describe('synthesize-episodic (sibling composition)', () => {
  beforeEach(async () => {
    await cleanup();
    mockAnthropicParse.mockReset();
    // Make the placeholder empty again, in case a prior run wrote to it.
    if (existsSync(DUMPED_SUMMARIES_PATH)) {
      await rm(DUMPED_SUMMARIES_PATH);
    }
  });
  afterAll(async () => {
    await cleanup();
    // Restore empty placeholder so the fixture is clean for future runs.
    await rm(DUMPED_SUMMARIES_PATH, { force: true });
    // Write empty byte back (tests expect an empty placeholder, not missing file).
    await writeFile(DUMPED_SUMMARIES_PATH, '');
  });

  it('parseCliArgs happy path (Test 1)', () => {
    const args = parseCliArgs(['--primed', 'm008-14days', '--seed', '42']);
    expect(args).toEqual({ primed: 'm008-14days', seed: 42, dbPort: 5435 });
  });

  it('parseCliArgs missing --primed throws (Test 2)', () => {
    expect(() => parseCliArgs([])).toThrow(/SYNTH_EPISODIC_USAGE|required/);
  });

  it('runSiblingConsolidation inserts 2 rows against test DB (Test 3)', async () => {
    mockAnthropicParse.mockImplementation(
      (req: { system?: Array<{ text?: string }> | string }) => {
        const systemText =
          typeof req.system === 'string'
            ? req.system
            : (req.system?.[0]?.text ?? '');
        const match = systemText.match(/\d{4}-\d{2}-\d{2}/);
        const date = match?.[0] ?? '2026-04-19';
        return Promise.resolve(makeMockSonnetResponse(date));
      },
    );
    await loadFixtureIntoDb({ fixtureDir: FIXTURE_DIR, dbOverride: pgSql });
    await runSiblingConsolidation({
      fixtureDir: FIXTURE_DIR,
      dbOverride: pgSql,
    });
    const rows = await db.select().from(episodicSummaries);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect((r.sourceEntryIds as string[]).length).toBeGreaterThan(0);
    }
  });

  it('second call is idempotent (Test 4 — CONS-03)', async () => {
    mockAnthropicParse.mockImplementation(
      (req: { system?: Array<{ text?: string }> | string }) => {
        const systemText =
          typeof req.system === 'string'
            ? req.system
            : (req.system?.[0]?.text ?? '');
        const date =
          systemText.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '2026-04-19';
        return Promise.resolve(makeMockSonnetResponse(date));
      },
    );
    await loadFixtureIntoDb({ fixtureDir: FIXTURE_DIR, dbOverride: pgSql });
    await runSiblingConsolidation({
      fixtureDir: FIXTURE_DIR,
      dbOverride: pgSql,
    });
    const callsAfterFirst = mockAnthropicParse.mock.calls.length;
    await runSiblingConsolidation({
      fixtureDir: FIXTURE_DIR,
      dbOverride: pgSql,
    });
    // No new Sonnet calls — CONS-03 pre-flight skips existing rows.
    expect(mockAnthropicParse.mock.calls.length).toBe(callsAfterFirst);
    const rows = await db.select().from(episodicSummaries);
    expect(rows).toHaveLength(2); // still exactly 2
  });

  it('dumpEpisodicSummaries writes 2 rows to jsonl in date ASC order (Test 5 + 6)', async () => {
    mockAnthropicParse.mockImplementation(
      (req: { system?: Array<{ text?: string }> | string }) => {
        const systemText =
          typeof req.system === 'string'
            ? req.system
            : (req.system?.[0]?.text ?? '');
        const date =
          systemText.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '2026-04-19';
        return Promise.resolve(makeMockSonnetResponse(date));
      },
    );
    await loadFixtureIntoDb({ fixtureDir: FIXTURE_DIR, dbOverride: pgSql });
    await runSiblingConsolidation({
      fixtureDir: FIXTURE_DIR,
      dbOverride: pgSql,
    });
    await dumpEpisodicSummaries({
      fixtureDir: FIXTURE_DIR,
      dbOverride: pgSql,
    });
    const body = await readFile(DUMPED_SUMMARIES_PATH, 'utf8');
    const lines = body.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    const dates = lines.map((l) => JSON.parse(l).summary_date as string);
    // UNIQUE(summary_date)
    expect(new Set(dates).size).toBe(dates.length);
    // ASC order
    expect([...dates].sort()).toEqual(dates);
  });

  it('no non-telegram source leakage into pensieve_entries (Test 7)', async () => {
    await loadFixtureIntoDb({ fixtureDir: FIXTURE_DIR, dbOverride: pgSql });
    const nonTg = await db
      .select({ count: drizzleSql<number>`count(*)::int` })
      .from(pensieveEntries)
      .where(drizzleSql`${pensieveEntries.source} != 'telegram'`);
    expect(nonTg[0]?.count).toBe(0);
  });
});
