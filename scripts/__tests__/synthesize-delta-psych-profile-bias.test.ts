/**
 * scripts/__tests__/synthesize-delta-psych-profile-bias.test.ts — Phase 40
 * Plan 01 Task 1 (PMT-01 unit half — paired with primed-sanity-m011.test.ts
 * HARN half in Task 4).
 *
 * Unit tests for the `--psych-profile-bias` boolean flag + PSYCH_PROFILE_BIAS_KEYWORDS
 * + OPENNESS_SIGNAL_PHRASES + psychDimensionHintFor helper added to
 * scripts/synthesize-delta.ts in Phase 40 (Pitfall §7 mitigation).
 *
 * Observable behaviors under test (per plan Task 1 acceptance):
 *   (a) `--psych-profile-bias` accepted as boolean (presence = true, absence = false)
 *   (b) `psychDimensionHintFor(0, true)` returns the joined PSYCH_PROFILE_BIAS_KEYWORDS
 *   (c) `psychDimensionHintFor(0, false)` returns undefined
 *   (d) `psychDimensionHintFor(N, true)` returns the SAME hint for any N
 *       (no rotation — D-03 single signature)
 *   (e) When BOTH `--profile-bias jurisdictional` AND `--psych-profile-bias`
 *       are set, the per-day Haiku prompt receives the PSYCH hint (precedence)
 *   (f) When neither flag is set, the Haiku prompt is byte-identical to the
 *       pre-change shape (legacy parity per D-08; VCR cache hit preserved)
 *
 * Also asserts OPENNESS_SIGNAL_PHRASES contains exactly the 6 D-07 phrases
 * (load-bearing for HARN signal-phrase gate — Pitfall §7 / Pitfall 10
 * PITFALLS.md).
 *
 * Run via Docker harness:
 *   bash scripts/test.sh scripts/__tests__/synthesize-delta-psych-profile-bias.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

// Mocks — hoisted via vi.mock so the synthesize-delta module picks them up.
// Mirrors scripts/__tests__/synthesize-delta-profile-bias.test.ts:32-63 setup verbatim.
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
  PSYCH_PROFILE_BIAS_KEYWORDS,
  OPENNESS_SIGNAL_PHRASES,
  psychDimensionHintFor,
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
  outDir = await mkdtemp(join(tmpdir(), 'synth-delta-pbias-psych-test-'));
  vi.mocked(cachedMessagesParse).mockReset().mockResolvedValue(
    fakeHaikuResponse() as unknown as Awaited<ReturnType<typeof cachedMessagesParse>>,
  );
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

// ── OPENNESS_SIGNAL_PHRASES content gate (HARN load-bearing per D-07) ───────
describe('OPENNESS_SIGNAL_PHRASES (D-07 verbatim)', () => {
  it('contains exactly the 6 D-07 canonical phrases', () => {
    const want = [
      'worth exploring',
      "I'd be curious",
      'different angle',
      'I wonder if',
      'have you considered',
      'another perspective',
    ];
    expect(OPENNESS_SIGNAL_PHRASES.length).toBe(6);
    for (const phrase of want) {
      expect(OPENNESS_SIGNAL_PHRASES).toContain(phrase);
    }
  });
});

// ── PSYCH_PROFILE_BIAS_KEYWORDS content gate ────────────────────────────────
describe('PSYCH_PROFILE_BIAS_KEYWORDS (D-05 6 trait categories)', () => {
  it('is a non-empty flat readonly string array', () => {
    expect(Array.isArray(PSYCH_PROFILE_BIAS_KEYWORDS)).toBe(true);
    expect(PSYCH_PROFILE_BIAS_KEYWORDS.length).toBeGreaterThan(0);
    for (const k of PSYCH_PROFILE_BIAS_KEYWORDS) {
      expect(typeof k).toBe('string');
    }
  });

  it('contains keywords spanning all 6 D-05 trait categories', () => {
    // Spot-check one canonical keyword per D-05 trait category.
    expect(PSYCH_PROFILE_BIAS_KEYWORDS).toContain('intellectual curiosity'); // Openness
    expect(PSYCH_PROFILE_BIAS_KEYWORDS).toContain('planning');                // Conscientiousness
    expect(PSYCH_PROFILE_BIAS_KEYWORDS).toContain('self-aware doubt');        // Honesty-Humility
    expect(PSYCH_PROFILE_BIAS_KEYWORDS).toContain('autonomous choice');       // Self-Direction
    expect(PSYCH_PROFILE_BIAS_KEYWORDS).toContain('generosity');              // Benevolence
    expect(PSYCH_PROFILE_BIAS_KEYWORDS).toContain('fairness across people');  // Universalism
  });
});

// ── (a) Boolean flag — presence/absence ─────────────────────────────────────
describe('parseCliArgs --psych-profile-bias (D-03 boolean)', () => {
  it('(a-present) accepts --psych-profile-bias as boolean true', () => {
    const args = parseCliArgs([
      '--organic', 'x',
      '--target-days', '1',
      '--seed', '1',
      '--milestone', 'm',
      '--psych-profile-bias',
    ]);
    expect(args.psychProfileBias).toBe(true);
  });

  it('(a-absent) defaults to false when --psych-profile-bias omitted', () => {
    const args = parseCliArgs([
      '--organic', 'x',
      '--target-days', '1',
      '--seed', '1',
      '--milestone', 'm',
    ]);
    expect(args.psychProfileBias).toBe(false);
  });

  it('co-exists with --profile-bias (both flags accepted together)', () => {
    const args = parseCliArgs([
      '--organic', 'x',
      '--target-days', '1',
      '--seed', '1',
      '--milestone', 'm',
      '--profile-bias', 'jurisdictional',
      '--psych-profile-bias',
    ]);
    expect(args.profileBias).toEqual(['jurisdictional']);
    expect(args.psychProfileBias).toBe(true);
  });
});

// ── (b)(c)(d) psychDimensionHintFor helper ──────────────────────────────────
describe('psychDimensionHintFor (D-03 single signature; no rotation)', () => {
  it('(b) returns the joined PSYCH_PROFILE_BIAS_KEYWORDS when enabled=true', () => {
    const hint = psychDimensionHintFor(0, true);
    expect(hint).toBeDefined();
    expect(hint).toBe(PSYCH_PROFILE_BIAS_KEYWORDS.join(', '));
  });

  it('(c) returns undefined when enabled=false', () => {
    expect(psychDimensionHintFor(0, false)).toBeUndefined();
    expect(psychDimensionHintFor(99, false)).toBeUndefined();
  });

  it('(d) returns the SAME hint for any dayIndex (no rotation per D-03)', () => {
    const day0 = psychDimensionHintFor(0, true);
    const day1 = psychDimensionHintFor(1, true);
    const day7 = psychDimensionHintFor(7, true);
    const day99 = psychDimensionHintFor(99, true);
    expect(day0).toBeDefined();
    expect(day1).toBe(day0);
    expect(day7).toBe(day0);
    expect(day99).toBe(day0);
  });
});

// ── (e) Precedence: psych wins when both flags set ──────────────────────────
// ── (f) Legacy parity: byte-identical prompt when neither flag set ──────────
describe('synthesize() per-day Haiku prompt assembly with --psych-profile-bias', () => {
  it('(e) psych hint appears in Haiku prompt when --psych-profile-bias enabled', async () => {
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 4,
      seed: 42,
      milestone: 'psych-bias-on',
      noRefresh: true,
      outRoot: outDir,
      psychProfileBias: true,
    });

    const calls = vi.mocked(cachedMessagesParse).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);

    // Every system prompt has the "Focus today's entries on" footer.
    for (const c of calls) {
      const req = c[0] as { system: string };
      expect(req.system).toMatch(/Focus today's entries on /);
      // Should contain at least one psych keyword (e.g., 'intellectual curiosity')
      expect(req.system).toContain('intellectual curiosity');
    }
  });

  it('(e-precedence) psych hint wins over m010 hint when both flags set', async () => {
    // M010 jurisdictional hint contains 'residency status'; M011 psych hint
    // does NOT. With both flags set, the system prompt should contain the
    // psych keywords NOT the jurisdictional ones (psychHint ?? m010Hint).
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 4,
      seed: 42,
      milestone: 'psych-precedence',
      noRefresh: true,
      outRoot: outDir,
      profileBias: ['jurisdictional', 'capital', 'health', 'family'],
      psychProfileBias: true,
    });

    const calls = vi.mocked(cachedMessagesParse).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const c of calls) {
      const req = c[0] as { system: string };
      // Psych hint MUST be present
      expect(req.system).toContain('intellectual curiosity');
      // M010 jurisdictional hint MUST NOT be present (psych wins)
      expect(req.system).not.toContain('residency status');
      // M010 capital hint MUST NOT be present (psych wins)
      expect(req.system).not.toContain('FI target');
    }
  });

  it('(f) NO psych hint appears when --psych-profile-bias is omitted (legacy byte-identical shape preserved)', async () => {
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 4,
      seed: 42,
      milestone: 'psych-omitted',
      noRefresh: true,
      outRoot: outDir,
      // psychProfileBias intentionally omitted
    });

    const calls = vi.mocked(cachedMessagesParse).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const c of calls) {
      const req = c[0] as { system: string };
      // No 'Focus today's entries on' footer at all (legacy byte-identical)
      expect(req.system).not.toMatch(/Focus today's entries on /);
      // Specifically no psych keywords
      expect(req.system).not.toContain('intellectual curiosity');
    }
  });

  it('(f-legacy-equal) psychProfileBias=false produces byte-identical prompt to omitted (D-08 cache-hit invariant)', async () => {
    // Run 1 — omitted
    const outDir1 = await mkdtemp(join(tmpdir(), 'synth-delta-psych-cmp1-'));
    try {
      await synthesize({
        organic: ORGANIC_TINY,
        targetDays: 4,
        seed: 42,
        milestone: 'psych-omit',
        noRefresh: true,
        outRoot: outDir1,
      });
      const omittedSysTexts = vi.mocked(cachedMessagesParse).mock.calls.map(
        (c) => (c[0] as { system: string }).system,
      );

      // Run 2 — explicit psychProfileBias=false
      vi.mocked(cachedMessagesParse).mockClear();
      const outDir2 = await mkdtemp(join(tmpdir(), 'synth-delta-psych-cmp2-'));
      try {
        await synthesize({
          organic: ORGANIC_TINY,
          targetDays: 4,
          seed: 42,
          milestone: 'psych-explicit-false',
          noRefresh: true,
          outRoot: outDir2,
          psychProfileBias: false,
        });
        const falseSysTexts = vi.mocked(cachedMessagesParse).mock.calls.map(
          (c) => (c[0] as { system: string }).system,
        );
        expect(falseSysTexts).toEqual(omittedSysTexts);
      } finally {
        await rm(outDir2, { recursive: true, force: true });
      }
    } finally {
      await rm(outDir1, { recursive: true, force: true });
    }
  });
});
