/**
 * scripts/__tests__/synthesize-delta-profile-bias.test.ts — Phase 36 Plan 01
 * Task 1 (PTEST-01 unit half — paired with primed-sanity-m010.test.ts HARN
 * half in Task 4).
 *
 * Unit tests for the `--profile-bias` repeatable flag + PROFILE_BIAS_KEYWORDS
 * + PROFILE_BIAS_ROTATION + dimensionHintFor helper added to
 * scripts/synthesize-delta.ts in Phase 36 (M010-05 mitigation).
 *
 * Observable behaviors under test (per plan Task 1 acceptance):
 *   (a) `--profile-bias <dim>` accepted as repeatable; single or multiple
 *       values produce a parsed `profileBias` array
 *   (b) Unknown dim throws UsageError (T-36-02 mitigation, ASVS L1 V5.1)
 *   (c) Flag omitted → `profileBias` is an empty array
 *   (d) PROFILE_BIAS_ROTATION rotates jurisdictional → capital → health →
 *       family → wrap (D-09 round-robin)
 *   (e) Keyword hint appears in Haiku prompt for biased day → assert via the
 *       per-day cachedMessagesParse mock call args
 *   (f) NO hint appears in Haiku prompt when --profile-bias omitted (legacy
 *       byte-identical shape preserved → VCR cache hit unchanged)
 *
 * Run via Docker harness:
 *   bash scripts/test.sh scripts/__tests__/synthesize-delta-profile-bias.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

// Mocks — hoisted via vi.mock so the synthesize-delta module picks them up.
// Mirrors scripts/__tests__/synthesize-delta.test.ts:34-66 setup verbatim.
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
  // Default: wellbeing_snapshots does NOT exist (to_regclass returns NULL).
  const tagged = Object.assign(
    async () => [{ exists: null }],
    { end: vi.fn(async () => undefined) },
  );
  return { default: vi.fn(() => tagged) };
});

const { cachedMessagesParse } = await import('../../src/__tests__/fixtures/vcr.js');

const synthModule = await import('../synthesize-delta.js');
const {
  parseCliArgs,
  synthesize,
  PROFILE_BIAS_KEYWORDS,
  PROFILE_BIAS_ROTATION,
  dimensionHintFor,
} = synthModule;

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

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'synth-delta-pbias-test-'));
  vi.mocked(cachedMessagesParse).mockReset().mockResolvedValue(
    fakeHaikuResponse() as unknown as Awaited<ReturnType<typeof cachedMessagesParse>>,
  );
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

// ── (a) Repeatable flag — single + multiple values ──────────────────────────
describe('parseCliArgs --profile-bias (D-03 repeatable)', () => {
  it('(a-single) accepts a single --profile-bias value', () => {
    const args = parseCliArgs([
      '--organic', 'x',
      '--target-days', '1',
      '--seed', '1',
      '--milestone', 'm',
      '--profile-bias', 'jurisdictional',
    ]);
    expect(args.profileBias).toEqual(['jurisdictional']);
  });

  it('(a-multi) accepts repeated --profile-bias for multiple dimensions', () => {
    const args = parseCliArgs([
      '--organic', 'x',
      '--target-days', '1',
      '--seed', '1',
      '--milestone', 'm',
      '--profile-bias', 'jurisdictional',
      '--profile-bias', 'capital',
      '--profile-bias', 'health',
      '--profile-bias', 'family',
    ]);
    expect(args.profileBias).toEqual(['jurisdictional', 'capital', 'health', 'family']);
  });

  // ── (c) Omitted flag → empty array ────────────────────────────────────────
  it('(c) absent --profile-bias produces empty array (legacy behavior)', () => {
    const args = parseCliArgs([
      '--organic', 'x',
      '--target-days', '1',
      '--seed', '1',
      '--milestone', 'm',
    ]);
    expect(args.profileBias).toEqual([]);
  });

  // ── (b) Unknown dim → UsageError (T-36-02, ASVS L1 V5.1) ──────────────────
  it('(b) rejects unknown dimension with UsageError', () => {
    expect(() =>
      parseCliArgs([
        '--organic', 'x',
        '--target-days', '1',
        '--seed', '1',
        '--milestone', 'm',
        '--profile-bias', 'wealth', // typo / not in DIMENSIONS
      ]),
    ).toThrow(/--profile-bias 'wealth' is not one of/);
  });

  it('(b-bad-2) rejects an invalid dim even when valid ones precede', () => {
    expect(() =>
      parseCliArgs([
        '--organic', 'x',
        '--target-days', '1',
        '--seed', '1',
        '--milestone', 'm',
        '--profile-bias', 'jurisdictional',
        '--profile-bias', 'invalid_dim',
      ]),
    ).toThrow(/--profile-bias 'invalid_dim' is not one of/);
  });
});

// ── (d) PROFILE_BIAS_ROTATION round-robin behavior ──────────────────────────
describe('PROFILE_BIAS_ROTATION + dimensionHintFor (D-09)', () => {
  it('(d) rotation order is jurisdictional → capital → health → family', () => {
    expect(PROFILE_BIAS_ROTATION).toEqual([
      'jurisdictional', 'capital', 'health', 'family',
    ]);
    expect(PROFILE_BIAS_ROTATION).toHaveLength(4);
  });

  it('(d-wrap) dimensionHintFor wraps at modulo 4 — day 4 maps back to jurisdictional', () => {
    const allBiases = ['jurisdictional', 'capital', 'health', 'family'] as const;
    const day0 = dimensionHintFor(0, allBiases);
    const day4 = dimensionHintFor(4, allBiases);
    expect(day0).toBeDefined();
    expect(day4).toBe(day0); // same dim → same hint
    const day1 = dimensionHintFor(1, allBiases);
    const day5 = dimensionHintFor(5, allBiases);
    expect(day1).toBe(day5);
  });

  it('(d-keys) PROFILE_BIAS_KEYWORDS has all 4 dimensions with non-empty arrays', () => {
    for (const dim of PROFILE_BIAS_ROTATION) {
      expect(PROFILE_BIAS_KEYWORDS[dim]).toBeDefined();
      expect(PROFILE_BIAS_KEYWORDS[dim].length).toBeGreaterThan(0);
    }
  });

  it('(d-partial) dimensionHintFor returns undefined when rotated dim is not in biases', () => {
    // Only jurisdictional biased; day 1 (capital) → no hint
    expect(dimensionHintFor(0, ['jurisdictional'])).toBeDefined();
    expect(dimensionHintFor(1, ['jurisdictional'])).toBeUndefined();
    expect(dimensionHintFor(2, ['jurisdictional'])).toBeUndefined();
    expect(dimensionHintFor(3, ['jurisdictional'])).toBeUndefined();
    expect(dimensionHintFor(4, ['jurisdictional'])).toBeDefined(); // wraps back
  });

  it('(d-empty) dimensionHintFor returns undefined when biases is empty', () => {
    expect(dimensionHintFor(0, [])).toBeUndefined();
    expect(dimensionHintFor(1, [])).toBeUndefined();
    expect(dimensionHintFor(99, [])).toBeUndefined();
  });
});

// ── (e) Hint appears in Haiku prompt for biased day ─────────────────────────
// ── (f) No hint appears when --profile-bias omitted (legacy preserved) ──────
describe('synthesize() per-day Haiku prompt assembly with --profile-bias', () => {
  it('(e) hint sentence appears in the system prompt for biased days', async () => {
    // organic-tiny has 2 organic days; target-days=6 → 4 synth days
    // → cachedMessagesParse called 4 times (one per synthetic day).
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 6,
      seed: 42,
      milestone: 'pbias-all',
      noRefresh: true,
      outRoot: outDir,
      profileBias: ['jurisdictional', 'capital', 'health', 'family'],
    });

    const calls = vi.mocked(cachedMessagesParse).mock.calls;
    expect(calls.length).toBe(4);

    // Day 0 → jurisdictional; Day 1 → capital; Day 2 → health; Day 3 → family
    // System prompt is `request.system` (a plain string per buildHaikuSystemPrompt).
    const sysTexts = calls.map((c) => {
      const req = c[0] as { system: string };
      return req.system;
    });
    // Each system prompt has the "Focus today's entries on" footer.
    for (const text of sysTexts) {
      expect(text).toMatch(/Focus today's entries on /);
    }
    // Per-day dimension keyword check via at-least-one-keyword presence.
    expect(sysTexts[0]).toContain('residency status'); // jurisdictional
    expect(sysTexts[1]).toContain('FI target');         // capital
    expect(sysTexts[2]).toContain('clinical hypothesis'); // health
    expect(sysTexts[3]).toContain('relationship milestone'); // family
  });

  it('(e-partial) only days matching the bias rotation get hints', async () => {
    // Only jurisdictional → Day 0 hinted; Days 1/2/3 unhinted
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 6,
      seed: 42,
      milestone: 'pbias-j-only',
      noRefresh: true,
      outRoot: outDir,
      profileBias: ['jurisdictional'],
    });

    const calls = vi.mocked(cachedMessagesParse).mock.calls;
    const sysTexts = calls.map((c) => (c[0] as { system: string }).system);
    expect(sysTexts[0]).toMatch(/Focus today's entries on /);
    expect(sysTexts[0]).toContain('residency status');
    expect(sysTexts[1]).not.toMatch(/Focus today's entries on /);
    expect(sysTexts[2]).not.toMatch(/Focus today's entries on /);
    expect(sysTexts[3]).not.toMatch(/Focus today's entries on /);
  });

  it('(f) NO hint sentence appears when --profile-bias is omitted (legacy byte-identical shape preserved)', async () => {
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 4,
      seed: 42,
      milestone: 'pbias-omitted',
      noRefresh: true,
      outRoot: outDir,
      // profileBias intentionally omitted
    });

    const calls = vi.mocked(cachedMessagesParse).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const c of calls) {
      const req = c[0] as { system: string };
      expect(req.system).not.toMatch(/Focus today's entries on /);
    }
  });

  it('(f-legacy-equal) profileBias=[] produces byte-identical prompt to omitted (D-06 cache-hit invariant)', async () => {
    // Run 1 — omitted
    const outDir1 = await mkdtemp(join(tmpdir(), 'synth-delta-pbias-cmp1-'));
    try {
      await synthesize({
        organic: ORGANIC_TINY,
        targetDays: 4,
        seed: 42,
        milestone: 'pbias-omit',
        noRefresh: true,
        outRoot: outDir1,
      });
      const omittedCalls = vi.mocked(cachedMessagesParse).mock.calls.slice();
      const omittedSysTexts = omittedCalls.map((c) => (c[0] as { system: string }).system);

      // Run 2 — explicit profileBias=[]
      vi.mocked(cachedMessagesParse).mockClear();
      const outDir2 = await mkdtemp(join(tmpdir(), 'synth-delta-pbias-cmp2-'));
      try {
        await synthesize({
          organic: ORGANIC_TINY,
          targetDays: 4,
          seed: 42,
          milestone: 'pbias-empty',
          noRefresh: true,
          outRoot: outDir2,
          profileBias: [],
        });
        const emptyCalls = vi.mocked(cachedMessagesParse).mock.calls.slice();
        const emptySysTexts = emptyCalls.map((c) => (c[0] as { system: string }).system);
        expect(emptySysTexts).toEqual(omittedSysTexts);
      } finally {
        await rm(outDir2, { recursive: true, force: true });
      }
    } finally {
      await rm(outDir1, { recursive: true, force: true });
    }
  });
});

// ── Smoke: the test file actually writes pensieve_entries via the synth path ─
describe('end-to-end smoke with --profile-bias all 4 dims', () => {
  it('writes a populated fixture without throwing when all 4 biases supplied', async () => {
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 4,
      seed: 42,
      milestone: 'pbias-smoke',
      noRefresh: true,
      outRoot: outDir,
      profileBias: ['jurisdictional', 'capital', 'health', 'family'],
    });
    const text = await readFile(
      join(outDir, 'pbias-smoke-4days', 'pensieve_entries.jsonl'),
      'utf8',
    );
    // Organic-tiny has 5 entries (2 days); target-days=4 → +2 synth days × 3
    // entries = 5 + 6 = 11.
    const rows = text.trim().split('\n').filter(Boolean);
    expect(rows.length).toBeGreaterThanOrEqual(5 + 3); // at least 1 synth day's worth
  });
});
