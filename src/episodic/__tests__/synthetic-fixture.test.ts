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

const { mockAnthropicParse, mockSendMessage } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue(undefined as unknown as void),
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
// Placeholder describe — real test blocks land in Tasks 2-7.
// ════════════════════════════════════════════════════════════════════════════

describe('Phase 23 episodic synthetic fixture — scaffold', () => {
  beforeAll(async () => {
    // Smoke test: DB must be reachable before any cleanup.
    const probe = await pgSql`SELECT 1 as ok`;
    expect(probe[0]!.ok).toBe(1);
  });

  beforeEach(async () => {
    mockAnthropicParse.mockReset();
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue(undefined as unknown as void);
    await cleanupFixture();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await cleanupFixture();
  });

  it('scaffold sanity — ground truth labels, fixture date helpers, and exports load', () => {
    // GROUND_TRUTH_LABELS contract (CONTEXT.md D-04, D-05).
    expect(GROUND_TRUTH_LABELS.length).toBe(14);
    expect(GROUND_TRUTH_LABELS.some((l) => l <= 2)).toBe(true);
    expect(GROUND_TRUTH_LABELS.some((l) => l >= 9)).toBe(true);
    // expandFixtureDates produces 14 sequential YYYY-MM-DD strings.
    const dates = expandFixtureDates();
    expect(dates).toHaveLength(14);
    expect(dates[0]).toBe(FIXTURE_START_DATE);
    expect(dates[13]).toBe('2026-04-14');
    // Phase 22 routing constants imported successfully.
    expect(RECENCY_BOUNDARY_DAYS).toBe(7);
    expect(HIGH_IMPORTANCE_THRESHOLD).toBe(8);
    // DST fixture constants present.
    expect(DST_FIXTURE_DATE).toBe('2026-03-08');
    expect(DST_FIXTURE_TZ).toBe('America/Los_Angeles');
    // Pearson helper is sane on a perfect-correlation dataset.
    expect(pearsonCorrelation([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 5);
  });
});
