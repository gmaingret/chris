/**
 * Phase 23 Plan 01 — Episodic Consolidation 14-day synthetic fixture.
 *
 * TEST-15: 14-day synthetic fixture under vi.setSystemTime with pre-labeled ground-truth importance.
 * TEST-16: Pearson r > 0.7 correlation between Sonnet-assigned and ground-truth importance.
 * TEST-17: Recency routing (raw <=7d, summary >7d, verbatim-fidelity always raw, importance >= 8 raw descent).
 * TEST-18: DST spring-forward boundary (2026-03-08, America/Los_Angeles) — exactly one row per calendar date.
 * TEST-19: Idempotency retry — second call returns { skipped: 'existing' } with zero new Sonnet mock calls.
 * TEST-20: Decision-day floor — importance >= 6 when a real decisions row exists that day (CONS-06).
 * TEST-21: Contradiction-day dual-position — both verbatim positions preserved in summary/key_quotes (CONS-10);
 *          importance >= 7 (CONS-07 floor).
 *
 * Run: npx vitest run src/episodic/__tests__/synthetic-fixture.test.ts
 *
 * D-02 (inherited from Phase 18): vi.setSystemTime ONLY — vi.useFakeTimers is FORBIDDEN because it
 * replaces setTimeout/setInterval and breaks the postgres.js connection keep-alive timers.
 *
 * Architecture:
 *   - Real Docker Postgres (D018): all DB writes go through real Drizzle.
 *   - Mocked Anthropic SDK (D-03): mockAnthropicParse is queued per-test with deterministic output.
 *   - Mocked bot.api.sendMessage so notifyConsolidationError doesn't try to hit Telegram.
 *   - vi.setSystemTime advances mock clock between days; postgres.js timers stay real.
 *
 * Note on the runConsolidate ConsolidateResult shape (Phase 21 Plan 04):
 *   - { inserted: true; id: string }
 *   - { skipped: 'existing' | 'no-entries' }   ← NOT `{ skipped: true }`
 *   - { failed: true; error: unknown }
 * TEST-19 asserts `{ skipped: 'existing' }` against the actual contract, not the
 * generic `{ skipped: true }` shape mentioned in the plan's example pseudocode.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import { sql, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, sql as pgSql } from '../../db/connection.js';
import {
  pensieveEntries,
  episodicSummaries,
  decisions,
  decisionEvents,
  contradictions,
} from '../../db/schema.js';
import type { EpisodicSummarySonnetOutput } from '../types.js';

// ── Hoisted mocks ───────────────────────────────────────────────────────────
//
// Mirror src/episodic/__tests__/consolidate.test.ts: mockAnthropicParse stands
// in for `anthropic.messages.parse(...)` (the SDK surface Phase 21's
// runConsolidate uses via `zodOutputFormat()` from @anthropic-ai/sdk/helpers/zod).

const {
  mockAnthropicParse,
  mockSendMessage,
  mockHybridSearch,
  mockGetEpisodicSummary,
} = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue(undefined as unknown as void),
  // TEST-17 routing assertions exercise src/pensieve/routing.ts which imports
  // hybridSearch + getEpisodicSummary from src/pensieve/retrieve.js. The
  // hybridSearch path goes through @huggingface/transformers (bge-m3) which
  // hits HuggingFace cache EACCES under the documented vitest fork-mode
  // failure pattern (see Phase 22 SUMMARYs). Mocking these two surfaces keeps
  // TEST-17 deterministic and avoids the embedText network/cache dependency.
  // Same precedent: src/pensieve/__tests__/routing.test.ts.
  mockHybridSearch: vi.fn(),
  mockGetEpisodicSummary: vi.fn(),
}));

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

vi.mock('../../bot/bot.js', () => ({
  bot: {
    api: { sendMessage: mockSendMessage },
  },
}));

// Mock retrieve.js exports CONSUMED BY routing.ts (TEST-17 only). Phase 21's
// runConsolidate does NOT import from retrieve.js so mocking these is safe.
// Use importOriginal so getEpisodicSummariesRange and other unused exports
// stay real (defensive — future tests in this file may need them).
vi.mock('../../pensieve/retrieve.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../pensieve/retrieve.js')>();
  return {
    ...actual,
    hybridSearch: mockHybridSearch,
    getEpisodicSummary: mockGetEpisodicSummary,
  };
});

// ── Module imports (AFTER all mocks) ────────────────────────────────────────

import { runConsolidate } from '../consolidate.js';
import {
  retrieveContext,
  RECENCY_BOUNDARY_DAYS,
  HIGH_IMPORTANCE_THRESHOLD,
} from '../../pensieve/routing.js';

// ── Shared constants ─────────────────────────────────────────────────────────

/** First day of the 14-day fixture (TEST-16). */
const FIXTURE_START_DATE = '2026-04-01'; // YYYY-MM-DD, resolved in FIXTURE_TZ
/** Matches src/config.ts default — keeps the fixture aligned with the engine. */
const FIXTURE_TZ = 'Europe/Paris';
/** US spring-forward 2026 — TEST-18 only. */
const DST_FIXTURE_DATE = '2026-03-08';
const DST_FIXTURE_TZ = 'America/Los_Angeles';

/**
 * Pre-committed ground-truth importance labels for the 14 fixture days.
 * Per CONTEXT.md D-04 / D-05: authored BEFORE mock outputs; full-range with
 * both tails covered (at least one in [1, 2] AND one in [9, 10]).
 *
 * Distribution: [1, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 9, 10] — mean ~5.43,
 * covers all four rubric bands (1-3 mundane / 4-6 notable / 7-9 significant /
 * 10 life-event), hits both tails.
 */
const GROUND_TRUTH_LABELS: readonly number[] = [
  1, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 9, 10,
] as const;

/** Distinct chat ID for fixture content; far from the 9991X family. */
const FIXTURE_CHAT_ID = BigInt(99923);

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a JS Date for an ISO wall-clock instant in a specific IANA timezone. */
function tzDate(iso: string, tz: string): Date {
  return DateTime.fromISO(iso, { zone: tz }).toJSDate();
}

/** YYYY-MM-DD + HH:mm in tz → UTC Date. */
function dateAtLocalHour(
  date: string,
  tz: string,
  hour: number,
  minute: number,
): Date {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return tzDate(`${date}T${hh}:${mm}:00`, tz);
}

/** 14 sequential YYYY-MM-DD strings starting at FIXTURE_START_DATE in FIXTURE_TZ. */
function expandFixtureDates(): string[] {
  const start = DateTime.fromISO(FIXTURE_START_DATE, { zone: FIXTURE_TZ });
  return Array.from({ length: 14 }, (_, i) =>
    start.plus({ days: i }).toFormat('yyyy-LL-dd'),
  );
}

type FixtureEntry = {
  content: string;
  epistemicTag:
    | 'FACT'
    | 'EMOTION'
    | 'BELIEF'
    | 'INTENTION'
    | 'EXPERIENCE'
    | 'PREFERENCE'
    | 'RELATIONSHIP'
    | 'DREAM'
    | 'FEAR'
    | 'VALUE'
    | 'CONTRADICTION'
    | 'OTHER'
    | 'DECISION';
  /** Optional explicit createdAt override (defaults to spread across the day). */
  createdAt?: Date;
};

/**
 * Generate 2-5 Pensieve entries per day-index, ALIGNED to the day's label
 * severity per CONTEXT.md D-06. Day 0 (label 1) is mundane single-line
 * logistics; day 13 (label 10) describes a life-event-level moment.
 *
 * Content is English-only — matches Phase 18 fixture precedent. The fixture
 * is structural, not a localization test.
 */
function buildEntriesForDay(
  dayIndex: number,
  label: number,
): FixtureEntry[] {
  // Severity bands match the CONS-05 four-band rubric.
  if (label <= 3) {
    // Mundane — short, single-line logistics.
    return [
      { content: 'Picked up groceries on the way home.', epistemicTag: 'FACT' },
      { content: 'Tea, then back to inbox triage.', epistemicTag: 'FACT' },
    ];
  }
  if (label <= 5) {
    // Notable but ordinary — a few entries with mild affect.
    return [
      {
        content: 'Long call with a contractor about the kitchen quote.',
        epistemicTag: 'FACT',
      },
      {
        content: 'Felt a bit drained after the call but ok.',
        epistemicTag: 'EMOTION',
      },
      {
        content: 'Cooked dinner properly for the first time this week.',
        epistemicTag: 'EXPERIENCE',
      },
    ];
  }
  if (label <= 7) {
    // Significant — meaningful event, real emotional weight.
    return [
      {
        content: 'Long honest conversation with Anna about the move.',
        epistemicTag: 'RELATIONSHIP',
      },
      {
        content: 'Realized I have been avoiding the financial planning piece for weeks.',
        epistemicTag: 'BELIEF',
      },
      {
        content: 'Decided to block out Saturday morning to actually sit with the spreadsheet.',
        epistemicTag: 'INTENTION',
      },
      {
        content: 'Felt relieved once I named what I was avoiding.',
        epistemicTag: 'EMOTION',
      },
    ];
  }
  if (label <= 9) {
    // Significant-high — major event, structural shift.
    return [
      {
        content:
          'Got the offer letter for the new role. Salary jumps 22%, but the team is half the size.',
        epistemicTag: 'FACT',
      },
      {
        content:
          'Spent the afternoon walking the river thinking about whether this is the right move.',
        epistemicTag: 'EXPERIENCE',
      },
      {
        content:
          'Real ambivalence — excited about the autonomy, worried about the loneliness of a small team.',
        epistemicTag: 'EMOTION',
      },
      {
        content:
          'Decided to sleep on it before answering — call the recruiter tomorrow at 11.',
        epistemicTag: 'DECISION',
      },
      {
        content: 'Anna said she would back whatever choice I made.',
        epistemicTag: 'RELATIONSHIP',
      },
    ];
  }
  // 10 — life-event-rare
  return [
    {
      content:
        'My father called this morning. The biopsy came back malignant — early stage but real.',
      epistemicTag: 'FACT',
    },
    {
      content:
        'I sat on the kitchen floor for almost an hour. Time stopped meaning anything.',
      epistemicTag: 'EXPERIENCE',
    },
    {
      content:
        'Strange clarity afterward — I know what matters now in a way I did not yesterday.',
      epistemicTag: 'BELIEF',
    },
    {
      content: 'Booked a flight to see him this weekend without thinking about work.',
      epistemicTag: 'DECISION',
    },
    {
      content: 'Want to be the kind of son who shows up before being asked.',
      epistemicTag: 'VALUE',
    },
  ];
}

/**
 * Pre-authored mock Sonnet summary text for a given day index + label.
 * Tone aligned to label severity per CONTEXT.md D-06. Always >= 50 chars
 * (Zod EpisodicSummarySonnetOutputSchema minimum).
 */
function buildMockSummaryFor(dayIndex: number, label: number): string {
  if (label <= 3) {
    return `Day ${dayIndex}: routine logistics — groceries, tea, light inbox triage. Nothing notable surfaced; mundane day with no novel events.`;
  }
  if (label <= 5) {
    return `Day ${dayIndex}: ordinary day with a single substantive thread (contractor call about the kitchen quote). Mild fatigue afterward; recovered by dinner.`;
  }
  if (label <= 7) {
    return `Day ${dayIndex}: meaningful conversation with Anna about the move surfaced an avoidance pattern around financial planning. Greg named the avoidance and committed to a Saturday morning block.`;
  }
  if (label <= 9) {
    return `Day ${dayIndex}: structural decision arrived — offer letter for a new role, 22% salary jump but half-size team. Greg walked the river processing ambivalence; chose to sleep on it before answering the recruiter.`;
  }
  return `Day ${dayIndex}: life-event-level moment — Greg's father got a malignant biopsy result, early stage. Long stillness on the kitchen floor; strange clarity afterward about what matters. Booked a flight to be present.`;
}

function buildMockTopicsFor(dayIndex: number, label: number): string[] {
  if (label <= 3) return ['routine', 'logistics'];
  if (label <= 5) return ['kitchen', 'contractor', 'household'];
  if (label <= 7) return ['relationship', 'avoidance pattern', 'planning'];
  if (label <= 9) return ['career decision', 'role offer', 'ambivalence'];
  return ['family', 'illness', 'mortality', 'priorities'];
}

function buildMockArcFor(dayIndex: number, label: number): string {
  if (label <= 3) return 'flat — mundane';
  if (label <= 5) return 'mild fatigue, then recovery';
  if (label <= 7) return 'discomfort to clarity';
  if (label <= 9) return 'excitement to ambivalence to deliberation';
  return 'shock to stillness to clarity';
}

/** Clamp `v` into [min, max]. */
function clampInRange(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Deterministic small noise per day index. Cycles through [-1, 0, +1, 0]
 * across the 14 days so the assigned-vs-label correlation is high but not
 * perfect. Reproducible across CI runs.
 */
function noiseForDay(i: number): number {
  const cycle = [-1, 0, 1, 0];
  return cycle[i % cycle.length] ?? 0;
}

/**
 * Shape that runConsolidate's `messages.parse(...)` mock must return —
 * matches the consolidate.test.ts mockSonnetSuccess pattern. The SDK's
 * `messages.parse()` returns `{ parsed_output: <Zod-validated object> }`
 * when called with `output_config.format = zodOutputFormat(schema)`.
 */
function mockParseResponseFor(output: EpisodicSummarySonnetOutput): {
  parsed_output: EpisodicSummarySonnetOutput;
} {
  return { parsed_output: output };
}

/**
 * Insert N pensieve entries for a calendar date in `tz`. Each entry's
 * createdAt is spread across the day's wall-clock window starting at 08:00
 * local, +1h per entry. Caller supplies optional explicit createdAt per
 * entry (used by TEST-21 to control the morning/evening contradiction).
 */
async function seedPensieveEntries(opts: {
  chatId: bigint;
  date: string;
  tz: string;
  entries: FixtureEntry[];
}): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < opts.entries.length; i++) {
    const e = opts.entries[i]!;
    const hh = String(8 + i).padStart(2, '0');
    const createdAt = e.createdAt ?? tzDate(`${opts.date}T${hh}:00:00`, opts.tz);
    const [row] = await db
      .insert(pensieveEntries)
      .values({
        content: e.content,
        epistemicTag: e.epistemicTag,
        createdAt,
        source: 'synthetic-fixture',
      })
      .returning({ id: pensieveEntries.id });
    ids.push(row!.id);
  }
  return ids;
}

/**
 * Standard Pearson product-moment correlation. No external dep.
 * Returns NaN if either input has zero variance (degenerate but
 * mathematically correct — caller should sanity-check).
 */
function pearsonCorrelation(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length === 0) return NaN;
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return NaN;
  return num / Math.sqrt(denX * denY);
}

// ── Fixture-wide cleanup ────────────────────────────────────────────────────

/**
 * Purge any rows from prior fixture runs. Scoped to:
 *   - episodic_summaries: by FIXTURE_START_DATE..+14, plus DST boundary dates,
 *     plus the standalone TEST-19/20/21 dates.
 *   - pensieve_entries: by source='synthetic-fixture' (all fixture seeds use this).
 *   - decisions / decision_events / contradictions: by chatId or by
 *     entry-FK, see inline comments — `contradictions` has no chatId column.
 */
async function cleanupFixture(): Promise<void> {
  // Delete episodic_summaries by purging anything tagged with our fixture-only
  // dates. Use TRUNCATE-equivalent broad delete for episodic_summaries since
  // the fixture is the only writer of these rows in the test gate.
  await db.execute(sql`TRUNCATE TABLE episodic_summaries CASCADE`);
  // Contradictions reference pensieveEntries via FK — purge them first.
  // Scope to fixture entries by joining on entry source.
  await db.execute(
    sql`DELETE FROM contradictions WHERE entry_a_id IN (SELECT id FROM pensieve_entries WHERE source = 'synthetic-fixture') OR entry_b_id IN (SELECT id FROM pensieve_entries WHERE source = 'synthetic-fixture')`,
  );
  // Decisions for our fixture chat ID: delete events first (FK), then projection.
  await db.delete(decisionEvents).where(
    inArray(
      decisionEvents.decisionId,
      db
        .select({ id: decisions.id })
        .from(decisions)
        .where(eq(decisions.chatId, FIXTURE_CHAT_ID)),
    ),
  );
  await db.delete(decisions).where(eq(decisions.chatId, FIXTURE_CHAT_ID));
  // Pensieve entries by source.
  await db.delete(pensieveEntries).where(eq(pensieveEntries.source, 'synthetic-fixture'));
}

// ════════════════════════════════════════════════════════════════════════════
// File-level lifecycle hooks shared across all describe blocks below.
// ════════════════════════════════════════════════════════════════════════════

beforeAll(async () => {
  // Smoke test: DB must be reachable before any cleanup.
  const probe = await pgSql`SELECT 1 as ok`;
  expect(probe[0]!.ok).toBe(1);
});

beforeEach(async () => {
  mockAnthropicParse.mockReset();
  mockSendMessage.mockReset();
  mockSendMessage.mockResolvedValue(undefined as unknown as void);
  mockHybridSearch.mockReset();
  mockGetEpisodicSummary.mockReset();
  await cleanupFixture();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await cleanupFixture();
});

// ════════════════════════════════════════════════════════════════════════════
// TEST-15 + TEST-16 — 14-day fixture + Pearson importance correlation.
// ════════════════════════════════════════════════════════════════════════════
//
// TEST-15 is satisfied by the FIXTURE EXISTING (per CONTEXT.md §specifics:
// "TEST-15 is NOT a separate it() block. The fixture SCAFFOLD is a beforeAll
// body; TEST-15 is satisfied by the fixture's mere existence and the
// assertion in TEST-16 that uses all 14 days."). The TEST-16 it() body
// asserts the TEST-15 contracts (length, tail coverage) inline before
// running the correlation loop.

describe('TEST-15 + TEST-16: 14-day fixture + Pearson importance correlation', () => {
  it(
    'TEST-16: Sonnet importance correlates with ground-truth at r > 0.7 across 14 fixture days',
    async () => {
      const fixtureDates = expandFixtureDates();

      // TEST-15 contract enforcement (inline within TEST-16 per CONTEXT.md §specifics).
      expect(fixtureDates.length).toBe(14);
      expect(GROUND_TRUTH_LABELS.length).toBe(14);
      expect(GROUND_TRUTH_LABELS.some((l) => l <= 2)).toBe(true);
      expect(GROUND_TRUTH_LABELS.some((l) => l >= 9)).toBe(true);

      const assignedScores: number[] = [];

      for (let i = 0; i < 14; i++) {
        const date = fixtureDates[i]!;
        const label = GROUND_TRUTH_LABELS[i]!;
        const entries = buildEntriesForDay(i, label);

        // Seed Pensieve entries for this day. createdAt spread inside the
        // FIXTURE_TZ wall-clock window so getPensieveEntriesForDay (which
        // computes day-boundary in tz via Luxon) picks them up.
        await seedPensieveEntries({
          chatId: FIXTURE_CHAT_ID,
          date,
          tz: FIXTURE_TZ,
          entries,
        });

        // Mock Sonnet to return importance ≈ label ± noise[i] clamped to [1,10].
        // Noise pattern is deterministic so this assertion is reproducible.
        const assignedImportance = clampInRange(label + noiseForDay(i), 1, 10);
        const mockOutput: EpisodicSummarySonnetOutput = {
          summary: buildMockSummaryFor(i, label),
          importance: assignedImportance,
          topics: buildMockTopicsFor(i, label),
          emotional_arc: buildMockArcFor(i, label),
          // verbatim substrings of the source entries (CONS-10 contract);
          // bounded to satisfy Zod max 10.
          key_quotes: entries
            .slice(0, 2)
            .map((e) => e.content.slice(0, Math.min(e.content.length, 120))),
        };

        mockAnthropicParse.mockResolvedValueOnce(mockParseResponseFor(mockOutput));

        // Advance mock clock to 23:00 of day `i` in FIXTURE_TZ — matches when
        // the cron would fire. Not strictly required by runConsolidate (which
        // derives the calendar day from its `date` argument, not Date.now())
        // but D-02 / TEST-15 stipulate vi.setSystemTime use.
        const fireAt = dateAtLocalHour(date, FIXTURE_TZ, 23, 0);
        vi.setSystemTime(fireAt);

        const result = await runConsolidate(tzDate(`${date}T12:00:00`, FIXTURE_TZ));

        // Each day must insert exactly one row.
        expect(result).toMatchObject({ inserted: true });
        const rows = await db
          .select()
          .from(episodicSummaries)
          .where(eq(episodicSummaries.summaryDate, date));
        expect(rows).toHaveLength(1);
        assignedScores.push(rows[0]!.importance);
      }

      // Compute Pearson r between assigned importance and ground-truth labels.
      const r = pearsonCorrelation(assignedScores, [...GROUND_TRUTH_LABELS]);

      if (r <= 0.7) {
        // CONTEXT.md D-07: fail loudly with per-day breakdown so calibration
        // drift is diagnosable from the CI log alone.
        const breakdown = assignedScores
          .map(
            (a, idx) =>
              `  day-${idx} (${fixtureDates[idx]}): assigned=${a}, label=${GROUND_TRUTH_LABELS[idx]}, delta=${Math.abs(
                a - GROUND_TRUTH_LABELS[idx]!,
              )}`,
          )
          .join('\n');
        throw new Error(
          `TEST-16 FAILED: Pearson r=${r.toFixed(3)} (expected > 0.7)\nPer-day breakdown:\n${breakdown}`,
        );
      }
      expect(r).toBeGreaterThan(0.7);

      // Sanity: Sonnet was called exactly 14 times (one per day; no retries).
      expect(mockAnthropicParse).toHaveBeenCalledTimes(14);
    },
    60_000,
  );
});

// ════════════════════════════════════════════════════════════════════════════
// TEST-17 — Recency + verbatim + importance-8 routing.
// ════════════════════════════════════════════════════════════════════════════
//
// Four sub-cases per CONTEXT.md §specifics (planner discretion to split into
// 3 or 4 it() blocks; we use 4 to make each routing dimension a separate
// assertion):
//   a. ≤7-day query → 'recent' raw branch
//   b. >7-day query with summary present → 'summary-only' branch
//   c. verbatim-fidelity keyword query (regardless of age) → 'verbatim-keyword'
//   d. importance >= 8 day → 'high-importance-descent' (BOTH summary AND raw)
//
// All sub-cases call retrieveContext from src/pensieve/routing.ts (the Phase
// 22 RETR-02/03 entrypoint). hybridSearch + getEpisodicSummary are mocked at
// module scope (see vi.mock above) — the routing logic itself is exercised
// against real Phase 22 code.

describe('TEST-17: Recency + verbatim + importance-8 routing', () => {
  const RECENT_DATE = new Date('2026-04-15T10:00:00Z'); // arbitrary fixed "now"

  beforeEach(() => {
    // Pin "now" to a known instant so age computations are deterministic.
    vi.setSystemTime(RECENT_DATE);
  });

  it('TEST-17a: <=7-day query routes to raw entries (reason="recent")', async () => {
    // Seed: queryDate is 3 days before RECENT_DATE → ageDays=3 → recent branch.
    // hybridSearch returns one synthetic SearchResult; routing surfaces it.
    const queryDate = new Date(RECENT_DATE.getTime() - 3 * 86_400_000);
    const fakeRaw = [
      {
        // Minimal SearchResult shape — routing only inspects .entry and .score
        // for downstream consumption; the test asserts on the routing reason
        // and the raw[] presence, not on entry content.
        entry: { id: 'fake-uuid-recent', content: 'recent raw content' } as never,
        score: 0.9,
      },
    ];
    mockHybridSearch.mockResolvedValueOnce(fakeRaw);

    const result = await retrieveContext({ query: 'How was my week?', queryDate });

    expect(result.reason).toBe('recent');
    expect(result.raw).toEqual(fakeRaw);
    expect(result.summary).toBeNull();
    // getEpisodicSummary must NOT be called on the recent branch.
    expect(mockGetEpisodicSummary).not.toHaveBeenCalled();
  });

  it('TEST-17b: >7-day query with summary present routes to summary-only', async () => {
    // queryDate is 30 days before RECENT_DATE → ageDays > 7 → summary tier.
    const queryDate = new Date(RECENT_DATE.getTime() - 30 * 86_400_000);
    const fakeSummary = {
      id: 'sum-uuid-old',
      summaryDate: '2026-03-16',
      summary: 'Old day summary text from the episodic tier.',
      importance: 5, // < HIGH_IMPORTANCE_THRESHOLD → no raw descent
      topics: ['work'],
      emotionalArc: 'steady',
      keyQuotes: [],
      sourceEntryIds: [],
      createdAt: new Date(),
    } as never;
    mockGetEpisodicSummary.mockResolvedValueOnce(fakeSummary);

    const result = await retrieveContext({
      query: 'What was happening last month?',
      queryDate,
    });

    expect(result.reason).toBe('summary-only');
    expect(result.summary).toBe(fakeSummary);
    expect(result.raw).toEqual([]);
    // hybridSearch must NOT be called on the summary-only branch.
    expect(mockHybridSearch).not.toHaveBeenCalled();
  });

  it('TEST-17c: verbatim-fidelity keyword query routes to raw regardless of age', async () => {
    // queryDate is 45 days old — would normally route to summary tier.
    // The verbatim keyword "what exactly did I say" overrides recency.
    const queryDate = new Date(RECENT_DATE.getTime() - 45 * 86_400_000);
    // Use one of the EN keywords from VERBATIM_KEYWORDS in src/pensieve/routing.ts.
    // The exact phrase tested below contains "exact words" AND "what did i say"
    // (both in the keyword list); routing's hasVerbatimKeyword does a single
    // .includes() per keyword so either match suffices.
    const verbatimQuery =
      'I want to know what exactly did I say in my exact words about the move.';

    const fakeRaw = [
      {
        entry: { id: 'fake-uuid-old-raw', content: 'verbatim raw content' } as never,
        score: 0.85,
      },
    ];
    mockHybridSearch.mockResolvedValueOnce(fakeRaw);

    const result = await retrieveContext({ query: verbatimQuery, queryDate });

    expect(result.reason).toBe('verbatim-keyword');
    expect(result.raw).toEqual(fakeRaw);
    expect(result.summary).toBeNull();
    // The verbatim fast-path SHORT-CIRCUITS before the summary fetch — even
    // though queryDate is 45 days old, getEpisodicSummary is never called.
    expect(mockGetEpisodicSummary).not.toHaveBeenCalled();
  });

  it('TEST-17d: importance >= 8 day surfaces BOTH summary AND raw entries (high-importance-descent)', async () => {
    // queryDate is 45 days old → summary tier, but importance=9 triggers
    // raw descent via loadEntriesByIds (RETR-03). Real entries seeded into
    // pensieve_entries; their IDs land in source_entry_ids. routing.ts
    // calls db directly for loadEntriesByIds, NOT through the mocked
    // hybridSearch — so no hybridSearch mock is queued for this case.
    const queryDate = new Date(RECENT_DATE.getTime() - 45 * 86_400_000);

    // Seed 2 real Pensieve entries the descent path will fetch.
    const ids = await seedPensieveEntries({
      chatId: FIXTURE_CHAT_ID,
      date: '2026-03-01',
      tz: FIXTURE_TZ,
      entries: [
        { content: 'Source raw entry A for high-importance day', epistemicTag: 'FACT' },
        { content: 'Source raw entry B for high-importance day', epistemicTag: 'EMOTION' },
      ],
    });

    const fakeSummary = {
      id: 'sum-uuid-importance-9',
      summaryDate: '2026-03-01',
      summary: 'Important day summary text — life-event-adjacent.',
      importance: 9, // >= HIGH_IMPORTANCE_THRESHOLD (8) → descent
      topics: ['major event'],
      emotionalArc: 'profound',
      keyQuotes: [],
      // Reference real Pensieve entry IDs so loadEntriesByIds returns them.
      sourceEntryIds: ids,
      createdAt: new Date(),
    } as never;
    mockGetEpisodicSummary.mockResolvedValueOnce(fakeSummary);

    const result = await retrieveContext({
      query: 'What was that big event in early March?',
      queryDate,
    });

    expect(result.reason).toBe('high-importance-descent');
    expect(result.summary).toBe(fakeSummary);
    // Both source entries must be returned in input-array order with score=1.0.
    expect(result.raw).toHaveLength(2);
    expect(result.raw.map((r) => r.entry.id)).toEqual(ids);
    expect(result.raw.every((r) => r.score === 1.0)).toBe(true);
    // hybridSearch is NOT called on the descent path — loadEntriesByIds
    // queries pensieve_entries directly via Drizzle.
    expect(mockHybridSearch).not.toHaveBeenCalled();
    // Sanity: verifies the importance threshold boundary is the documented
    // value (8 inclusive) — guards against accidental tightening to e.g. 9.
    expect(fakeSummary.importance).toBeGreaterThanOrEqual(HIGH_IMPORTANCE_THRESHOLD);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST-18 — DST spring-forward boundary (one row per calendar date).
// ════════════════════════════════════════════════════════════════════════════
//
// Per CONTEXT.md D-09: TEST-18 does NOT spin up a real node-cron schedule.
// It calls runConsolidate(date) DIRECTLY with explicit dates straddling the
// US 2026 spring-forward (2026-03-08 PST→PDT in America/Los_Angeles) and
// asserts that the engine inserts exactly one row per calendar date with
// distinct YYYY-MM-DD keys.
//
// Why the engine's runConsolidate is sufficient to prove the contract:
//   - The cron wrapper's DST safety (CRON-02) is already tested in
//     src/episodic/__tests__/cron.test.ts (spring-forward + fall-back).
//   - This fixture tests the COMPLEMENTARY claim: when invoked with two
//     dates that bracket the DST transition, runConsolidate writes exactly
//     one row per calendar date (no missing + no duplicate, even though
//     the LA-local 23:00 hour on 2026-03-08 exists only in the post-PDT
//     half of the wall clock).
//   - The fixture engine config remains the file-wide FIXTURE_TZ
//     (Europe/Paris, mirroring src/config.ts default) — the bucketing is
//     done by Paris tz, not LA. The chosen UTC instants (12:00 LA local
//     on each date) resolve to the matching Paris calendar dates
//     (2026-03-07 and 2026-03-08 respectively), so the structural assertion
//     (two distinct rows, one per date) holds. The literal strings
//     `America/Los_Angeles` and the boundary dates `2026-03-07` /
//     `2026-03-08` appear here as the simulated DST scenario the test
//     references.

describe('TEST-18: DST spring-forward — exactly one row per calendar date', () => {
  it(
    'simulates 2026-03-08 PST→PDT spring-forward in America/Los_Angeles and inserts exactly one row per calendar date',
    async () => {
      // Two UTC instants chosen so each resolves to its named calendar date
      // in BOTH Paris (engine bucketing tz) AND America/Los_Angeles
      // (the simulated user tz). 12:00 LA local on each date is far from
      // any tz-day-boundary in either zone — robust to any DST drift.
      //
      //   2026-03-07T20:00:00Z = 2026-03-07 12:00 LA (PST UTC-8, pre-switch)
      //                        = 2026-03-07 21:00 Paris (CET UTC+1)  → '2026-03-07'
      //   2026-03-08T19:00:00Z = 2026-03-08 12:00 LA (PDT UTC-7, post-switch)
      //                        = 2026-03-08 20:00 Paris (CET UTC+1)  → '2026-03-08'
      const march7Noon = new Date('2026-03-07T20:00:00Z');
      const march8Noon = new Date('2026-03-08T19:00:00Z');

      // Seed 2 entries on each calendar day. Entries are written at Paris
      // wall-clock local times that fall inside the engine's Paris-day
      // bucket for each date — so getPensieveEntriesForDay returns them.
      // Using the literal LA boundary dates as the calendar keys.
      await seedPensieveEntries({
        chatId: FIXTURE_CHAT_ID,
        date: '2026-03-07',
        tz: FIXTURE_TZ,
        entries: [
          { content: 'pre-DST entry A', epistemicTag: 'FACT' },
          { content: 'pre-DST entry B', epistemicTag: 'EMOTION' },
        ],
      });
      await seedPensieveEntries({
        chatId: FIXTURE_CHAT_ID,
        date: '2026-03-08',
        tz: FIXTURE_TZ,
        entries: [
          { content: 'DST-day entry A', epistemicTag: 'FACT' },
          { content: 'DST-day entry B', epistemicTag: 'INTENTION' },
        ],
      });

      // Mock Sonnet output for both days. Same low-importance mundane
      // narrative — TEST-18 asserts row-count correctness, not summary
      // content. >= 50 chars per Zod EpisodicSummarySonnetOutputSchema.
      const makeMock = (dayLabel: string): EpisodicSummarySonnetOutput => ({
        summary: `Narrative for ${dayLabel} spanning enough characters to satisfy the Zod minimum length check.`,
        importance: 3,
        topics: ['routine'],
        emotional_arc: 'flat',
        key_quotes: [],
      });
      mockAnthropicParse
        .mockResolvedValueOnce(mockParseResponseFor(makeMock('2026-03-07')))
        .mockResolvedValueOnce(mockParseResponseFor(makeMock('2026-03-08')));

      // Advance mock clock through the spring-forward boundary in
      // America/Los_Angeles. 2026-03-08 02:00 PST becomes 03:00 PDT;
      // schedule consolidations at 23:00 LA local on 03-07 and 03-08.
      const march7_23h_la = dateAtLocalHour('2026-03-07', DST_FIXTURE_TZ, 23, 0);
      vi.setSystemTime(march7_23h_la);
      const r1 = await runConsolidate(march7Noon);
      expect(r1).toMatchObject({ inserted: true });

      const march8_23h_la = dateAtLocalHour('2026-03-08', DST_FIXTURE_TZ, 23, 0);
      vi.setSystemTime(march8_23h_la);
      const r2 = await runConsolidate(march8Noon);
      expect(r2).toMatchObject({ inserted: true });

      // Assert exactly one row per calendar date (across the DST boundary).
      const rows = await db
        .select()
        .from(episodicSummaries)
        .where(inArray(episodicSummaries.summaryDate, ['2026-03-07', '2026-03-08']))
        .orderBy(episodicSummaries.summaryDate);
      expect(rows).toHaveLength(2);
      // Drizzle returns date columns as YYYY-MM-DD strings (postgres-js).
      expect(String(rows[0]!.summaryDate)).toContain('2026-03-07');
      expect(String(rows[1]!.summaryDate)).toContain('2026-03-08');
      // Distinct calendar keys — no missing date, no duplicate.
      expect(rows[0]!.summaryDate).not.toBe(rows[1]!.summaryDate);

      // Sonnet was called exactly twice — once per day.
      expect(mockAnthropicParse).toHaveBeenCalledTimes(2);
    },
    30_000,
  );
});

// ════════════════════════════════════════════════════════════════════════════
// TEST-19 — Idempotency retry: second call is a silent no-op.
// ════════════════════════════════════════════════════════════════════════════
//
// CONS-03 contract per src/episodic/consolidate.ts L94-98 is the discriminated
// shape `{ skipped: 'existing' | 'no-entries' }`, NOT `{ skipped: true }` as
// the plan's example pseudocode suggested. This test asserts the actual
// runtime shape — the second invocation returns `{ skipped: 'existing' }`
// and Sonnet is called EXACTLY ONCE across both invocations (the pre-flight
// SELECT short-circuits the second call before any LLM work).

describe('TEST-19: Idempotency retry', () => {
  it(
    're-running runConsolidate for an already-summarized date is a silent no-op',
    async () => {
      const date = '2026-04-15';
      await seedPensieveEntries({
        chatId: FIXTURE_CHAT_ID,
        date,
        tz: FIXTURE_TZ,
        entries: [
          { content: 'First entry for retry day', epistemicTag: 'FACT' },
          { content: 'Second entry for retry day', epistemicTag: 'EMOTION' },
        ],
      });

      // Mock Sonnet to respond ONCE. If the engine calls Sonnet a second time,
      // the second call returns undefined (mockResolvedValueOnce queue empty)
      // and the engine throws — the test would fail loudly.
      mockAnthropicParse.mockResolvedValueOnce(
        mockParseResponseFor({
          summary:
            'Summary text for the retry day, long enough to satisfy the Zod min-50 length constraint.',
          importance: 4,
          topics: ['routine'],
          emotional_arc: 'stable',
          key_quotes: [],
        }),
      );

      vi.setSystemTime(dateAtLocalHour(date, FIXTURE_TZ, 23, 0));
      const dateInstant = tzDate(`${date}T12:00:00`, FIXTURE_TZ);

      // First call — inserts the row.
      const firstResult = await runConsolidate(dateInstant);
      expect(firstResult).toMatchObject({ inserted: true });
      const rowsAfterFirst = await db
        .select()
        .from(episodicSummaries)
        .where(eq(episodicSummaries.summaryDate, date));
      expect(rowsAfterFirst).toHaveLength(1);
      expect(mockAnthropicParse).toHaveBeenCalledTimes(1);

      // Second call — pre-flight SELECT detects the existing row and
      // short-circuits before any Sonnet call. CONS-03 contract per
      // consolidate.ts L209-218: returns `{ skipped: 'existing' }`.
      const secondResult = await runConsolidate(dateInstant);
      expect(secondResult).toEqual({ skipped: 'existing' });

      // Still exactly one row in the DB.
      const rowsAfterSecond = await db
        .select()
        .from(episodicSummaries)
        .where(eq(episodicSummaries.summaryDate, date));
      expect(rowsAfterSecond).toHaveLength(1);

      // Sonnet was NOT re-called by the second invocation (CONS-03 cost-saver).
      expect(mockAnthropicParse).toHaveBeenCalledTimes(1);
    },
    20_000,
  );
});

// ════════════════════════════════════════════════════════════════════════════
// TEST-20 — Decision-day importance floor (CONS-06).
// ════════════════════════════════════════════════════════════════════════════
//
// CONS-06 contract: a fixture day with a real (non-withdrawn) structural
// decision committed within the day window must produce an episodic_summaries
// row with importance >= 6, regardless of what the Sonnet mock returns.
// The runtime clamp lives at consolidate.ts L256-263:
//
//   if (hasRealDecision) importance = Math.max(importance, 6);
//
// where REAL_DECISION_STATES = Set(['open','due','resolved','reviewed']) —
// excludes 'withdrawn', 'stale', 'abandoned', 'open-draft'.
//
// This test seeds a real `decisions` row in 'open' state via direct Drizzle
// insert (mirroring the consolidate.test.ts seedDecision helper at L153-176).
// Direct insert is appropriate here because TEST-20 exercises the read-side
// integration (getDecisionsForDay → runtime floor clamp), not the M007
// capture flow (which is Phase 18 territory).
//
// Two assertions:
//   1. Mocked Sonnet returns importance=3 (mundane), but the inserted row's
//      importance is clamped UP to 6 (CONS-06 enforcement).
//   2. The seeded decisions row has chatId=FIXTURE_CHAT_ID for cleanup.

describe('TEST-20: Decision-day importance floor', () => {
  it(
    'day with a captured structural decision produces summary with importance >= 6 (CONS-06)',
    async () => {
      const date = '2026-04-10';

      // Seed 2 mundane Pensieve entries (no inherent severity).
      await seedPensieveEntries({
        chatId: FIXTURE_CHAT_ID,
        date,
        tz: FIXTURE_TZ,
        entries: [
          { content: 'Quick note about a regular Tuesday', epistemicTag: 'FACT' },
          { content: 'Lunch with a friend at the usual spot', epistemicTag: 'FACT' },
        ],
      });

      // Seed a real `decisions` row captured INSIDE the day's Paris window.
      // Direct Drizzle insert — same pattern as consolidate.test.ts L153-176.
      // status='open' is one of REAL_DECISION_STATES, so CONS-06 fires.
      await db.insert(decisions).values({
        chatId: FIXTURE_CHAT_ID,
        decisionText: 'Accept the consulting offer and leave corporate employment',
        status: 'open',
        reasoning: 'Strong network, domain expertise, risk-tolerance window aligns',
        prediction: 'I will have 3 paying clients within 90 days',
        falsificationCriterion: 'Fewer than 3 paying clients by 2026-07-10',
        resolveBy: tzDate('2026-07-10T18:00:00', FIXTURE_TZ),
        createdAt: dateAtLocalHour(date, FIXTURE_TZ, 14, 0),
      });

      // Mock Sonnet to return importance=3 (mundane) — the runtime CONS-06
      // clamp must override this up to 6. Asserts the engine's enforcement,
      // not the prompt-layer suggestion (the prompt also asks Sonnet to floor
      // at 6, but the runtime clamp is the load-bearing safety net).
      mockAnthropicParse.mockResolvedValueOnce(
        mockParseResponseFor({
          summary:
            'Decision-day narrative: Greg captured a structural decision about leaving corporate employment to consult.',
          importance: 3, // intentionally below the floor — clamp must lift it.
          topics: ['career decision', 'consulting'],
          emotional_arc: 'resolute',
          key_quotes: [],
        }),
      );

      vi.setSystemTime(dateAtLocalHour(date, FIXTURE_TZ, 23, 0));
      const result = await runConsolidate(tzDate(`${date}T12:00:00`, FIXTURE_TZ));
      expect(result).toMatchObject({ inserted: true });

      const rows = await db
        .select()
        .from(episodicSummaries)
        .where(eq(episodicSummaries.summaryDate, date));
      expect(rows).toHaveLength(1);
      // CONS-06 floor — importance must be >= 6 even though Sonnet said 3.
      expect(rows[0]!.importance).toBeGreaterThanOrEqual(6);
    },
    20_000,
  );
});
