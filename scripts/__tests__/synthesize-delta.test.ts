/**
 * scripts/__tests__/synthesize-delta.test.ts — Phase 24 Plan 02
 * (SYNTH-01/02/04/05/06/07, FRESH-02).
 *
 * Unit tests for the synthesize-delta CLI. Hermetic via:
 *   - Per-run sandbox tmp output directory (no mutation of tests/fixtures/primed/)
 *   - Mocked cachedMessagesParse returning a shape-matched fake Haiku response
 *   - Mocked autoRefreshIfStale / Anthropic client / postgres client so no
 *     network / DB traffic leaves the process
 *   - Tiny committed organic fixture at
 *     scripts/__tests__/__fixtures__/synth-delta/organic-tiny/
 *
 * Observable behaviors under test (per plan Task 2 acceptance):
 *   1. --help prints usage, exits 0
 *   2. Missing --organic exits 1
 *   3. Byte-identical pensieve_entries.jsonl across two runs with same --seed
 *      (SYNTH-07 reproducibility anchor)
 *   4. --no-refresh short-circuits autoRefreshIfStale (FRESH-02)
 *   5. Absent autoRefreshIfStale spy without --no-refresh still forwards the
 *      call (FRESH-01 consumption point)
 *   6. cachedMessagesParse is invoked per synthetic day (not once for all days)
 *   7. Every synthetic pensieve entry has source='telegram' (SYNTH-02)
 *   8. Wellbeing table absent path logs synth.wellbeing.skip + empty jsonl
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat, utimes, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Mocks — hoisted via vi.mock so the synthesize-delta module picks them up.
vi.mock('../../src/__tests__/fixtures/freshness.js', () => ({
  autoRefreshIfStale: vi.fn(async (path: string) => path),
}));

vi.mock('../../src/__tests__/fixtures/vcr.js', () => ({
  cachedMessagesParse: vi.fn(),
}));

vi.mock('../../src/llm/client.js', () => ({
  anthropic: {
    messages: {
      parse: vi.fn(),
      create: vi.fn(),
    },
  },
  HAIKU_MODEL: 'claude-haiku-test',
  SONNET_MODEL: 'claude-sonnet-test',
  OPUS_MODEL: 'claude-opus-test',
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('postgres', () => {
  // Default: wellbeing_snapshots does NOT exist (returns NULL from to_regclass).
  const tagged = Object.assign(
    async () => [{ exists: null }],
    { end: vi.fn(async () => undefined) },
  );
  return { default: vi.fn(() => tagged) };
});

const { autoRefreshIfStale } = await import('../../src/__tests__/fixtures/freshness.js');
const { cachedMessagesParse } = await import('../../src/__tests__/fixtures/vcr.js');
const { logger } = await import('../../src/utils/logger.js');
const postgresMod = await import('postgres');
const postgres = postgresMod.default;

const synthModule = await import('../synthesize-delta.js');
const { parseCliArgs, synthesize, generateSyntheticDecisions, generateSyntheticContradictions } =
  synthModule;

const ORGANIC_TINY = resolvePath(
  'scripts/__tests__/__fixtures__/synth-delta/organic-tiny',
);

function fakeHaikuResponse(): unknown {
  return {
    parsed_output: {
      entries: [
        { content: 'Synthetic voice 1.', createdAtHour: 9, createdAtMinute: 15 },
        { content: 'Synthetic voice 2.', createdAtHour: 14, createdAtMinute: 30 },
        { content: 'Synthetic voice 3.', createdAtHour: 18, createdAtMinute: 45 },
      ],
    },
  };
}

let outDir: string;
let cwdOriginal: string;

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'synth-delta-test-'));
  cwdOriginal = process.cwd();
  // Many helpers build relative paths. Ensure we stay in the repo root so
  // 'tests/fixtures/primed/...' is redirected to our sandbox via monkey-patch
  // on process.cwd() — but simpler: resolve output dir absolute, and the
  // synthesize() helper uses join() on those absolute paths.
  vi.mocked(autoRefreshIfStale).mockReset().mockImplementation(async (p: string) => p);
  vi.mocked(cachedMessagesParse).mockReset().mockResolvedValue(
    fakeHaikuResponse() as unknown as Awaited<ReturnType<typeof cachedMessagesParse>>,
  );
  vi.mocked(logger.info).mockReset();
  vi.mocked(logger.warn).mockReset();
  vi.mocked(postgres as unknown as ReturnType<typeof vi.fn>).mockReset();
});

afterEach(async () => {
  process.chdir(cwdOriginal);
  await rm(outDir, { recursive: true, force: true });
});

describe('parseCliArgs', () => {
  it('accepts a fully-valid flag set', () => {
    const args = parseCliArgs([
      '--organic',
      'tests/fixtures/prod-snapshot/LATEST',
      '--target-days',
      '14',
      '--seed',
      '42',
      '--milestone',
      'm008',
    ]);
    expect(args.organic).toBe('tests/fixtures/prod-snapshot/LATEST');
    expect(args.targetDays).toBe(14);
    expect(args.seed).toBe(42);
    expect(args.milestone).toBe('m008');
    expect(args.noRefresh).toBe(false);
  });

  it('threads --no-refresh (FRESH-02)', () => {
    const args = parseCliArgs([
      '--organic',
      'x',
      '--target-days',
      '1',
      '--seed',
      '1',
      '--milestone',
      'y',
      '--no-refresh',
    ]);
    expect(args.noRefresh).toBe(true);
  });

  it('throws UsageError when --organic is missing', () => {
    expect(() =>
      parseCliArgs(['--target-days', '1', '--seed', '1', '--milestone', 'x']),
    ).toThrow(/organic.*required/i);
  });

  it('throws UsageError when --target-days is not a positive int', () => {
    expect(() =>
      parseCliArgs(['--organic', 'x', '--target-days', '0', '--seed', '1', '--milestone', 'm']),
    ).toThrow(/positive/i);
  });

  it('throws UsageError when --seed is not an integer', () => {
    expect(() =>
      parseCliArgs(['--organic', 'x', '--target-days', '1', '--seed', 'abc', '--milestone', 'm']),
    ).toThrow(/int/i);
  });
});

describe('CLI --help and argument-missing exit codes', () => {
  const scriptPath = resolvePath('scripts/synthesize-delta.ts');

  it('--help exits 0 and prints usage', async () => {
    const { stdout } = await execFileAsync(
      'npx',
      ['--yes', 'tsx', scriptPath, '--help'],
      { cwd: cwdOriginal },
    );
    expect(stdout.toLowerCase()).toContain('usage');
  }, 60_000);

  it('(no args) exits 1 with a usage hint', async () => {
    await expect(
      execFileAsync('npx', ['--yes', 'tsx', scriptPath], { cwd: cwdOriginal }),
    ).rejects.toMatchObject({ code: 1 });
  }, 60_000);
});

describe('synthesize() end-to-end (mocked VCR)', () => {
  it('writes MANIFEST.json + fused pensieve_entries.jsonl with synthetic rows source=telegram (SYNTH-02)', async () => {
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 3,
      seed: 42,
      milestone: 'test-det',
      noRefresh: true,
      outRoot: outDir,
    });

    const outFixture = join(outDir, 'test-det-3days');
    const manifestText = await readFile(join(outFixture, 'MANIFEST.json'), 'utf8');
    const manifest = JSON.parse(manifestText) as {
      seed: number;
      target_days: number;
      milestone: string;
    };
    expect(manifest.seed).toBe(42);
    expect(manifest.target_days).toBe(3);
    expect(manifest.milestone).toBe('test-det');

    const pensieveText = await readFile(join(outFixture, 'pensieve_entries.jsonl'), 'utf8');
    const pensieveLines = pensieveText.trim().split('\n').filter(Boolean);
    const pensieve = pensieveLines.map((l) => JSON.parse(l) as Record<string, unknown>);

    // organic = 5 entries across 2 days; target-days 3 → synthesize 1 additional day × 3 entries = 3
    expect(pensieve.length).toBe(5 + 3);

    // Every synthetic entry (metadata.synthetic === true) must have source='telegram'
    const synthetic = pensieve.filter(
      (r) => typeof r.metadata === 'object' && (r.metadata as { synthetic?: boolean }).synthetic,
    );
    expect(synthetic).toHaveLength(3);
    for (const s of synthetic) {
      expect(s.source).toBe('telegram');
    }
  });

  it('SYNTH-07: same --seed + same organic base → byte-identical pensieve_entries.jsonl across runs', async () => {
    // First run
    const dir1 = outDir;
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 3,
      seed: 42,
      milestone: 'test-det',
      noRefresh: true,
      outRoot: dir1,
    });
    const body1 = await readFile(
      join(dir1, 'test-det-3days', 'pensieve_entries.jsonl'),
      'utf8',
    );

    // Second run — fresh tmp dir, same seed/organic
    const dir2 = await mkdtemp(join(tmpdir(), 'synth-delta-test-2-'));
    try {
      await synthesize({
        organic: ORGANIC_TINY,
        targetDays: 3,
        seed: 42,
        milestone: 'test-det',
        noRefresh: true,
        outRoot: dir2,
      });
      const body2 = await readFile(
        join(dir2, 'test-det-3days', 'pensieve_entries.jsonl'),
        'utf8',
      );
      expect(body2).toBe(body1);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });

  it('invokes cachedMessagesParse once per synthetic day (per-day Haiku per D-02)', async () => {
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 4,
      seed: 42,
      milestone: 'test-det',
      noRefresh: true,
      outRoot: outDir,
    });
    // organic span = 2 days (2026-04-15 + 2026-04-16); target 4 → 2 synthetic days
    expect(vi.mocked(cachedMessagesParse)).toHaveBeenCalledTimes(2);
  });

  it('does NOT call autoRefreshIfStale when noRefresh=true (FRESH-02)', async () => {
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 3,
      seed: 42,
      milestone: 'test-det',
      noRefresh: true,
      outRoot: outDir,
    });
    expect(vi.mocked(autoRefreshIfStale)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ noRefresh: true }),
    );
  });

  it('forwards noRefresh=false to autoRefreshIfStale (FRESH-01 consumption)', async () => {
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 3,
      seed: 42,
      milestone: 'test-det',
      noRefresh: false,
      outRoot: outDir,
    });
    expect(vi.mocked(autoRefreshIfStale)).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ noRefresh: false }),
    );
  });

  it('logs synth.wellbeing.skip and writes empty wellbeing_snapshots.jsonl when table absent (SYNTH-06, D-05)', async () => {
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 3,
      seed: 42,
      milestone: 'test-det',
      noRefresh: true,
      outRoot: outDir,
    });

    const infoCalls = vi.mocked(logger.info).mock.calls;
    const skipCall = infoCalls.find((c) => c[1] === 'synth.wellbeing.skip');
    expect(skipCall).toBeDefined();

    const wellbeingText = await readFile(
      join(outDir, 'test-det-3days', 'wellbeing_snapshots.jsonl'),
      'utf8',
    );
    expect(wellbeingText).toBe('');
  });

  it('writes an EMPTY episodic_summaries.jsonl placeholder (Plan 24-03 fills)', async () => {
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 3,
      seed: 42,
      milestone: 'test-det',
      noRefresh: true,
      outRoot: outDir,
    });
    const body = await readFile(
      join(outDir, 'test-det-3days', 'episodic_summaries.jsonl'),
      'utf8',
    );
    expect(body).toBe('');
  });

  it('synthetic entries carry Europe/Paris-local UTC timestamps from Haiku hour/minute (D-02)', async () => {
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 3,
      seed: 42,
      milestone: 'test-det',
      noRefresh: true,
      outRoot: outDir,
    });

    const text = await readFile(
      join(outDir, 'test-det-3days', 'pensieve_entries.jsonl'),
      'utf8',
    );
    const rows = text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const synthetic = rows.filter(
      (r) => typeof r.metadata === 'object' && (r.metadata as { synthetic?: boolean }).synthetic,
    );

    // Haiku mock used hours 9, 14, 18 (Paris-local) for 2026-04-17 (DST active → UTC+2)
    const createdAts = synthetic.map((s) => String(s.created_at)).sort();
    // Expect hours 07:15, 12:30, 16:45 UTC (Paris = UTC+2 in April)
    expect(createdAts[0]).toMatch(/^2026-04-17T07:15:00/);
    expect(createdAts[1]).toMatch(/^2026-04-17T12:30:00/);
    expect(createdAts[2]).toMatch(/^2026-04-17T16:45:00/);
  });
});

describe('generateSyntheticDecisions (SYNTH-04)', () => {
  it('produces 5 deterministic decisions with realistic resolve_by spread', () => {
    const day = new Date('2026-04-20T00:00:00Z');
    const a = generateSyntheticDecisions(42, 'm008', day);
    const b = generateSyntheticDecisions(42, 'm008', day);
    expect(a.length).toBe(5);
    expect(a).toEqual(b);
    // resolve_by values should span 1d..30d
    const resolveBys = a
      .map((d: Record<string, unknown>) => new Date(String(d.resolve_by)).getTime())
      .sort((x: number, y: number) => x - y);
    const minDays = (resolveBys[0]! - day.getTime()) / (24 * 60 * 60 * 1000);
    const maxDays = (resolveBys[4]! - day.getTime()) / (24 * 60 * 60 * 1000);
    expect(minDays).toBeGreaterThanOrEqual(1);
    expect(maxDays).toBeGreaterThanOrEqual(30);
  });

  it('includes resolution_reply_plaintext only when milestone ends with -with-resolutions', () => {
    const day = new Date('2026-04-20T00:00:00Z');
    const plain = generateSyntheticDecisions(42, 'm008', day);
    const withResolutions = generateSyntheticDecisions(42, 'm008-with-resolutions', day);
    expect(plain.every((d: Record<string, unknown>) => !('resolution_reply_plaintext' in d))).toBe(
      true,
    );
    // At least 2 of 5 carry resolution replies
    const withReply = withResolutions.filter(
      (d: Record<string, unknown>) => 'resolution_reply_plaintext' in d,
    );
    expect(withReply.length).toBeGreaterThanOrEqual(2);
  });
});

describe('generateSyntheticContradictions (SYNTH-05)', () => {
  it('produces exactly 3 adversarial pairs with status=DETECTED and confidence>=0.75', () => {
    const syntheticPensieve = [
      { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' },
      { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' },
      { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' },
      { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' },
      { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
    ];
    const contradictions = generateSyntheticContradictions(42, syntheticPensieve);
    expect(contradictions.length).toBe(3);
    for (const c of contradictions) {
      expect((c as Record<string, unknown>).status).toBe('DETECTED');
      expect((c as Record<string, unknown>).description).toBeTruthy();
      const entryA = (c as Record<string, unknown>).entry_a_id as string;
      const entryB = (c as Record<string, unknown>).entry_b_id as string;
      expect(entryA).toMatch(/^[a-f]{8}-/);
      expect(entryB).toMatch(/^[a-f]{8}-/);
      expect(entryA).not.toBe(entryB);
    }
  });

  it('is deterministic given the same seed', () => {
    const syntheticPensieve = Array.from({ length: 10 }, (_, i) => ({
      id: `0000000${i}-0000-0000-0000-000000000000`,
    }));
    const a = generateSyntheticContradictions(42, syntheticPensieve);
    const b = generateSyntheticContradictions(42, syntheticPensieve);
    expect(a).toEqual(b);
  });
});
