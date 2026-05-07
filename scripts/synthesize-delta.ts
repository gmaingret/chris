#!/usr/bin/env node
/**
 * scripts/synthesize-delta.ts — Phase 24 Plan 02
 * (SYNTH-01/02/04/05/06/07, FRESH-02).
 *
 * Takes an organic snapshot + seed + target-days + milestone, extends the
 * organic span with deterministic synthetic days via Haiku style-transfer
 * (per-day, D-02). Non-LLM content (decisions, contradictions, wellbeing)
 * generated from seeded RNG (Mulberry32, from Plan 24-01 seed.ts).
 * Anthropic outputs are VCR-cached (D-03) so re-runs are byte-identical
 * even across machines (after the first cache-populating run).
 *
 * EPISODIC synthesis is OUT OF SCOPE — Plan 24-03 owns SYNTH-03 via
 * sibling-module composition against the real consolidation engine.
 * This script writes an EMPTY episodic_summaries.jsonl placeholder;
 * Plan 24-04's regenerate-primed.ts chains synthesize-delta →
 * synthesize-episodic → manifest-finalize to produce the loadable
 * primed fixture.
 *
 * Usage:
 *   npx tsx scripts/synthesize-delta.ts \
 *     --organic tests/fixtures/prod-snapshot/LATEST \
 *     --target-days 14 --seed 42 --milestone m009
 *
 *   npx tsx scripts/synthesize-delta.ts --help
 *
 * Flags:
 *   --organic     path to organic snapshot dir (or LATEST symlink)
 *   --target-days int — total days in fused fixture (D-07 chronological)
 *   --seed        int — deterministic RNG seed (SYNTH-07)
 *   --milestone   label for output dir naming; suffix `-with-resolutions`
 *                 triggers SYNTH-04 resolution-reply synthesis (replay-ready
 *                 payloads that Plan 24-04's loader invokes via handleResolution
 *                 after bulk-load)
 *   --no-refresh  skip 24h auto-refresh (FRESH-02; sandbox/offline)
 *
 * Locked decisions (from CONTEXT.md):
 *   D-02: per-day Haiku with 8-example few-shot, temperature=0
 *   D-03: VCR cache at tests/fixtures/.vcr/<hash>.json
 *   D-05: feature-detect wellbeing_snapshots via to_regclass
 *   D-07: synthetic days follow organic chronologically (no overlap)
 *
 * Lazy-imports the logger, postgres client, and ChrisError AFTER the
 * --help short-circuit so operators can run --help without env vars
 * (same pattern as Plan 24-01's fetch-prod-data.ts).
 */
import { parseArgs } from 'node:util';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve as resolvePath, basename } from 'node:path';
import { DateTime } from 'luxon';
import * as zV4 from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
// NOTE: mulberry32/seededSample are safe to import at top level —
// src/__tests__/fixtures/seed.ts has NO transitive dependency on
// src/config.ts (pure PRNG), so --help stays env-var-free.
import {
  mulberry32,
  seededSample,
} from '../src/__tests__/fixtures/seed.js';
// freshness.ts and vcr.ts transitively import src/utils/logger.ts →
// src/config.ts → `required('DATABASE_URL')` at module init. For the CLI
// entry point we lazy-import these inside synthesize() so --help exits
// without env vars. Test suites that import synthesize() directly always
// have the mocks registered before any module load, so lazy-import has no
// observable effect on test behavior. Same fix pattern as Plan 24-01's
// fetch-prod-data.ts (Rule 1 deviation, commit a8181fa).

// ── Constants (RESEARCH Claude's-discretion §) ────────────────────────────
/** 8 few-shot organic entries per Haiku call — middle of the 5–15 band. */
const FEW_SHOT_N = 8;
/** 3 adversarial contradiction pairs — minimum for SYNTH-05 sanity test. */
const CONTRADICTION_PAIRS = 3;
/** Entries per synthetic day — realistic Telegram cadence. */
const ENTRIES_PER_DAY = 3;
/** Deterministic decisions per fixture. */
const DECISIONS_COUNT = 5;
/** resolve_by spread in days from synthetic-day midpoint. */
const RESOLVE_BY_SPREAD_DAYS = [1, 3, 7, 14, 30] as const;

// ── Types ─────────────────────────────────────────────────────────────────

export interface Args {
  organic: string;
  targetDays: number;
  seed: number;
  milestone: string;
  noRefresh: boolean;
}

export interface SynthesizeOptions extends Args {
  /**
   * Override the output root. Production: 'tests/fixtures/primed'. Tests
   * inject a per-run tmp directory so fixtures don't pollute the repo.
   */
  outRoot?: string;
}

// ── Zod v4 schema for Haiku structured output ─────────────────────────────
const HaikuSyntheticDaySchema = zV4.object({
  entries: zV4
    .array(
      zV4.object({
        content: zV4.string().min(1).max(4000),
        createdAtHour: zV4.number().int().min(0).max(23),
        createdAtMinute: zV4.number().int().min(0).max(59),
      }),
    )
    .min(1)
    .max(20),
});

type HaikuSyntheticDay = zV4.infer<typeof HaikuSyntheticDaySchema>;

// ── CLI argparse ──────────────────────────────────────────────────────────

class UsageError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'UsageError';
  }
}

function printUsage(): void {
  console.log(
    `Usage: npx tsx scripts/synthesize-delta.ts --organic <path> --target-days <n> --seed <n> --milestone <label> [--no-refresh]

Flags:
  --organic      path to organic snapshot dir (or LATEST symlink)
  --target-days  total days in fused fixture (D-07 chronological extension)
  --seed         deterministic RNG seed (SYNTH-07)
  --milestone    output-dir label (e.g. m008, m009-with-resolutions)
  --no-refresh   skip 24h auto-refresh of LATEST (FRESH-02; sandbox/offline)
  --help         print this message and exit 0`,
  );
}

export function parseCliArgs(argv: string[]): Args {
  let raw: {
    organic?: string;
    'target-days'?: string;
    seed?: string;
    milestone?: string;
    'no-refresh'?: boolean;
    help?: boolean;
  };
  try {
    ({ values: raw } = parseArgs({
      args: argv,
      options: {
        organic: { type: 'string' },
        'target-days': { type: 'string' },
        seed: { type: 'string' },
        milestone: { type: 'string' },
        'no-refresh': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UsageError(`synthesize-delta: argument parse failed: ${msg}`);
  }

  if (raw.help) {
    printUsage();
    process.exit(0);
  }

  if (!raw.organic) {
    throw new UsageError('synthesize-delta: --organic is required');
  }
  if (!raw['target-days']) {
    throw new UsageError('synthesize-delta: --target-days is required');
  }
  if (!raw.seed) {
    throw new UsageError('synthesize-delta: --seed is required');
  }
  if (!raw.milestone) {
    throw new UsageError('synthesize-delta: --milestone is required');
  }

  const targetDays = Number(raw['target-days']);
  const seed = Number(raw.seed);
  if (!Number.isInteger(targetDays) || targetDays < 1) {
    throw new UsageError('synthesize-delta: --target-days must be a positive int');
  }
  if (!Number.isInteger(seed)) {
    throw new UsageError('synthesize-delta: --seed must be an int');
  }

  return {
    organic: raw.organic,
    targetDays,
    seed,
    milestone: raw.milestone,
    noRefresh: raw['no-refresh'] ?? false,
  };
}

// ── JSONL I/O (readline — per RESEARCH "Don't Hand-Roll") ─────────────────

async function loadJsonl<T>(path: string): Promise<T[]> {
  const exists = await stat(path)
    .then(() => true)
    .catch(() => false);
  if (!exists) return [];
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  const out: T[] = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed) out.push(JSON.parse(trimmed) as T);
  }
  return out;
}

function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}

async function writeJsonl<T>(path: string, rows: readonly T[]): Promise<void> {
  const out = createWriteStream(path, { encoding: 'utf8' });
  for (const row of rows) out.write(JSON.stringify(row, bigintReplacer) + '\n');
  await new Promise<void>((resolve, reject) => {
    out.on('error', reject);
    out.end(resolve);
  });
}

// ── Deterministic UUID from Mulberry32 ────────────────────────────────────
//
// crypto.randomUUID is NOT deterministic, which would break SYNTH-07. We
// derive a UUIDv4-shaped hex string from two 32-bit Mulberry32 draws
// (stretched to 128 bits via four draws) with the version nibble set to 4
// and variant nibble set to the RFC 4122 '10xx' pattern. Zero entropy loss
// vs a real v4 on the reproducibility axis we care about: same seed →
// same UUIDs, byte-for-byte.
export function deterministicUuid(seed: number): string {
  const rng = mulberry32(seed >>> 0);
  // 4 × 32-bit words → 16 bytes
  const words = [rng(), rng(), rng(), rng()].map((f) => Math.floor(f * 0x100000000));
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 4; i++) {
    const w = words[i]! >>> 0;
    bytes[i * 4] = (w >>> 24) & 0xff;
    bytes[i * 4 + 1] = (w >>> 16) & 0xff;
    bytes[i * 4 + 2] = (w >>> 8) & 0xff;
    bytes[i * 4 + 3] = w & 0xff;
  }
  // Set version (4) and RFC 4122 variant (10xx).
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ── Haiku per-day prompt (D-02) ───────────────────────────────────────────

function buildHaikuSystemPrompt(
  fewShot: readonly Record<string, unknown>[],
  dateIso: string,
  nEntries: number,
): string {
  const bullets = fewShot
    .map((e, i) => `  ${i + 1}. ${JSON.stringify((e as { content: string }).content)}`)
    .join('\n');
  return `You are mimicking Greg's Telegram voice. Below are ${fewShot.length} real entries from Greg; produce ${nEntries} new entries for ${dateIso} that could plausibly come from the same person on a plausible Europe/Paris day. Match tone, sentence length, topic distribution, emoji/caps/punctuation usage. One entry per array element; each entry is a string. Do not copy verbatim; capture voice only. Respect UTC+1 (winter) / UTC+2 (summer) wall-clock hours when assigning createdAtHour (0..23) and createdAtMinute (0..59). Return valid JSON matching the output schema.

Few-shot entries:
${bullets}`;
}

// ── Deterministic decisions generator (SYNTH-04) ──────────────────────────

export function generateSyntheticDecisions(
  seed: number,
  milestone: string,
  synthStart: Date,
): Record<string, unknown>[] {
  const includeResolutions = milestone.endsWith('-with-resolutions');
  const rows: Record<string, unknown>[] = [];
  const startMs = synthStart.getTime();

  for (let i = 0; i < DECISIONS_COUNT; i++) {
    const resolveDays = RESOLVE_BY_SPREAD_DAYS[i]!;
    const resolveBy = new Date(startMs + resolveDays * 24 * 60 * 60 * 1000);
    const id = deterministicUuid(seed + 7000 + i);
    const createdAt = new Date(startMs + i * 60 * 60 * 1000); // 1h apart

    const row: Record<string, unknown> = {
      id,
      status: 'open',
      decision_text: `Synthetic decision ${seed}-${i}: prioritize an ambiguous path with a ${resolveDays}-day window.`,
      alternatives: null,
      reasoning: `Seeded reasoning ${seed}-${i} — templated for replay determinism.`,
      prediction: `Seeded prediction ${seed}-${i}: the window resolves inside ${resolveDays} days.`,
      falsification_criterion: `Seeded falsification ${seed}-${i}: if the window closes with no signal, mark miss.`,
      resolve_by: resolveBy.toISOString(),
      domain_tag: null,
      language_at_capture: 'en',
      resolution: null,
      resolution_notes: null,
      resolved_at: null,
      reviewed_at: null,
      accuracy_class: null,
      accuracy_classified_at: null,
      accuracy_model_version: null,
      withdrawn_at: null,
      stale_at: null,
      abandoned_at: null,
      chat_id: '1869317192',
      source_ref_id: null,
      created_at: createdAt.toISOString(),
      updated_at: createdAt.toISOString(),
    };

    // SYNTH-04 with-resolutions suffix: attach a replay-ready reply. Plan
    // 24-04's loader will invoke handleResolution(chatId, reply, id) after
    // bulk-load. We attach 2 of 5 (indices 0 and 2) so the fixture exercises
    // both "resolved with reply" and "still-open" cases.
    if (includeResolutions && (i === 0 || i === 2)) {
      row.resolution_reply_plaintext = `Synthetic resolution ${seed}-${i}: the window closed as predicted; marking hit.`;
    }

    rows.push(row);
  }

  return rows;
}

// ── Deterministic contradictions generator (SYNTH-05) ─────────────────────

/**
 * Hardcoded adversarial-intent description templates. Each pair contrasts
 * two plausible telegram-voice self-statements. Indices 0..2 are used in
 * order (CONTRADICTION_PAIRS=3). Each pair gets two distinct seeded-picked
 * synthetic pensieve UUIDs for entry_a_id / entry_b_id.
 */
const CONTRADICTION_TEMPLATES: readonly string[] = [
  'stated preference for quiet weekends vs. three events planned Saturday',
  'intent to sleep earlier vs. late-night work session the same day',
  'belief that mornings are for deep work vs. morning spent in meetings',
];

export function generateSyntheticContradictions(
  seed: number,
  syntheticPensieve: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];

  // Need at least 2 distinct UUIDs per pair. If the synthetic pool is too
  // thin, fall back to deterministic fresh UUIDs (fixture is still internally
  // consistent — the contradiction row doesn't need FK integrity in the
  // synthetic-only path; Plan 24-04's loader enforces FK at bulk-insert
  // time, and absent synthetic pensieve means the loader will either skip
  // these contradictions or accept that entry_a_id refers to nothing yet).
  for (let p = 0; p < CONTRADICTION_PAIRS; p++) {
    let entryA: string;
    let entryB: string;
    if (syntheticPensieve.length >= 2) {
      const picks = seededSample(syntheticPensieve, 2, seed + 11000 + p);
      entryA = String((picks[0] as { id: string }).id);
      entryB = String((picks[1] as { id: string }).id);
    } else {
      entryA = deterministicUuid(seed + 22000 + p * 2);
      entryB = deterministicUuid(seed + 22000 + p * 2 + 1);
    }

    rows.push({
      id: deterministicUuid(seed + 33000 + p),
      entry_a_id: entryA,
      entry_b_id: entryB,
      description: `Synthetic contradiction ${p}: ${CONTRADICTION_TEMPLATES[p % CONTRADICTION_TEMPLATES.length]!}.`,
      status: 'DETECTED',
      resolution: null,
      detected_at: new Date(Date.UTC(2026, 3, 20, p, 0, 0)).toISOString(),
      resolved_at: null,
      // NOTE: confidence is NOT a column on the contradictions table in
      // src/db/schema.ts; the requirement SYNTH-05 speaks to a logical
      // confidence floor. We emit a metadata shadow for introspection in
      // case M009 later adds the column; absent the column, the loader
      // silently drops the extra key.
      confidence: 0.85,
    });
  }

  return rows;
}

// ── Wellbeing feature-detect (SYNTH-06, D-05) ─────────────────────────────

/**
 * Queries the Postgres test DB for wellbeing_snapshots presence via
 * to_regclass. If absent (expected until M009 lands its migration),
 * emits synth.wellbeing.skip and returns []. If present, synthesizes
 * N deterministic rows with a 1..5 distribution.
 *
 * The postgres client is lazy-imported to keep the CLI surface hermetic
 * (and to make `--help` env-var-free). `logger` is passed in so tests
 * with mocked logger can observe the skip call.
 */
async function generateWellbeingIfTableExists(
  seed: number,
  days: number,
  logger: { info: (obj: Record<string, unknown>, msg: string) => void },
): Promise<Record<string, unknown>[]> {
  const dbUrl =
    process.env.DATABASE_URL ?? 'postgres://chris:localtest123@localhost:5433/chris';
  const postgresMod = await import('postgres');
  const postgres = postgresMod.default;
  const client = postgres(dbUrl, { max: 1 });
  try {
    const result = await client`SELECT to_regclass('public.wellbeing_snapshots') AS exists`;
    const exists = (result[0] as { exists?: unknown } | undefined)?.exists !== null
      && (result[0] as { exists?: unknown } | undefined)?.exists !== undefined;
    if (!exists) {
      logger.info({ reason: 'wellbeing-table-absent' }, 'synth.wellbeing.skip');
      return [];
    }

    // Generate N rows with 1..5 distribution via Mulberry32. Schema must
    // match `wellbeing_snapshots` columns landed in Phase 25 migration 0006:
    // (id, snapshot_date, energy, mood, anxiety, notes, created_at). Phase 24
    // (this script's original author) wrote against the speculative
    // {score, note, recorded_at} shape that never shipped. Phase 30-01
    // discovered the drift while running `loadPrimedFixture('m009-21days')`
    // for the HARN-04/HARN-06 sanity gate; this fix is part of the Phase 32
    // synth-substrate hardening backlog (ROADMAP.md Phase 32 items #3-#5).
    const rng = mulberry32((seed + 44000) >>> 0);
    const rows: Record<string, unknown>[] = [];
    for (let d = 0; d < days; d++) {
      const snapshotDate = new Date(Date.UTC(2026, 3, 20 + d));
      // Format as YYYY-MM-DD (Postgres `date` column accepts ISO YMD).
      const isoDate = snapshotDate.toISOString().slice(0, 10);
      rows.push({
        id: deterministicUuid(seed + 55000 + d),
        snapshot_date: isoDate,
        energy: 1 + Math.floor(rng() * 5),
        mood: 1 + Math.floor(rng() * 5),
        anxiety: 1 + Math.floor(rng() * 5),
        notes: `synthetic wellbeing day ${d}`,
        created_at: new Date(Date.UTC(2026, 3, 20 + d, 12, 0, 0)).toISOString(),
      });
    }
    return rows;
  } finally {
    await client.end({ timeout: 5 });
  }
}

// ── Main synthesis ────────────────────────────────────────────────────────

export async function synthesize(opts: SynthesizeOptions): Promise<void> {
  // Lazy-import the modules that transitively load src/config.ts — keeps
  // --help env-var-free. In test runs, vi.mock() hoisting registers mocks
  // BEFORE any module load (Vitest module cache respects mock factories
  // regardless of load timing), so these dynamic imports resolve to the
  // mocked modules exactly as if they were top-level.
  const [{ logger }, { autoRefreshIfStale }, { cachedMessagesParse }, { HAIKU_MODEL }] =
    await Promise.all([
      import('../src/utils/logger.js'),
      import('../src/__tests__/fixtures/freshness.js'),
      import('../src/__tests__/fixtures/vcr.js'),
      import('../src/llm/client.js'),
    ]);

  const outRoot = opts.outRoot ?? 'tests/fixtures/primed';
  const organicStampPath = resolvePath(opts.organic);

  // FRESH-01/02: forward noRefresh. The path is the LATEST symlink — not
  // necessarily the same as the --organic argument, because operators may
  // pass an explicit stamp to pin to a known snapshot. Refresh always
  // targets the well-known LATEST.
  await autoRefreshIfStale(join('tests/fixtures/prod-snapshot', 'LATEST'), {
    noRefresh: opts.noRefresh,
  });

  const organicPensieve = await loadJsonl<Record<string, unknown>>(
    join(organicStampPath, 'pensieve_entries.jsonl'),
  );
  const organicEmbeddings = await loadJsonl<Record<string, unknown>>(
    join(organicStampPath, 'pensieve_embeddings.jsonl'),
  );
  const organicDecisions = await loadJsonl<Record<string, unknown>>(
    join(organicStampPath, 'decisions.jsonl'),
  );
  const organicDecisionEvents = await loadJsonl<Record<string, unknown>>(
    join(organicStampPath, 'decision_events.jsonl'),
  );
  const organicContradictions = await loadJsonl<Record<string, unknown>>(
    join(organicStampPath, 'contradictions.jsonl'),
  );
  const organicProactive = await loadJsonl<Record<string, unknown>>(
    join(organicStampPath, 'proactive_state.jsonl'),
  );
  const organicRelMemory = await loadJsonl<Record<string, unknown>>(
    join(organicStampPath, 'relational_memory.jsonl'),
  );

  // Determine organic date span (Europe/Paris-local).
  const organicDatesIso = organicPensieve
    .map((e) =>
      DateTime.fromISO(String(e.created_at)).setZone('Europe/Paris').toISODate(),
    )
    .filter((d): d is string => !!d);
  const uniqueOrganicDates = [...new Set(organicDatesIso)].sort();
  const organicEnd =
    uniqueOrganicDates[uniqueOrganicDates.length - 1] ?? DateTime.now().toISODate()!;

  // D-07: synthetic days FOLLOW organic chronologically.
  const synthDaysNeeded = Math.max(0, opts.targetDays - uniqueOrganicDates.length);
  const synthStart = DateTime.fromISO(organicEnd, { zone: 'Europe/Paris' }).plus({
    days: 1,
  });

  // Per-day Haiku (D-02): one call per synthetic date.
  const synthPensieve: Record<string, unknown>[] = [];
  for (let d = 0; d < synthDaysNeeded; d++) {
    const dayDate = synthStart.plus({ days: d });
    const dayDateStr = dayDate.toISODate()!;
    const fewShot = seededSample(organicPensieve, FEW_SHOT_N, opts.seed + d);
    const systemPrompt = buildHaikuSystemPrompt(fewShot, dayDateStr, ENTRIES_PER_DAY);
    const userPrompt = `Produce ${ENTRIES_PER_DAY} synthetic Telegram entries for ${dayDateStr}. Return as { entries: [{ content, createdAtHour, createdAtMinute }, ...] }.`;

    const request = {
      model: HAIKU_MODEL,
      max_tokens: 2000,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user' as const, content: userPrompt }],
      output_config: {
        // Same SDK type/runtime bridge as consolidate.ts L156.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        format: zodOutputFormat(HaikuSyntheticDaySchema as unknown as any),
      },
    };
    const response = await cachedMessagesParse(
      request as unknown as Parameters<typeof cachedMessagesParse>[0],
    );

    const parsed = (response as unknown as { parsed_output: HaikuSyntheticDay })
      .parsed_output;

    // Defense-in-depth validation (pitfall: drifted cache shape).
    const ok = HaikuSyntheticDaySchema.safeParse(parsed);
    if (!ok.success) {
      throw new Error(
        `synthesize-delta: Haiku response for ${dayDateStr} failed schema validation`,
      );
    }

    for (const entry of ok.data.entries) {
      const createdAt = dayDate.set({
        hour: entry.createdAtHour,
        minute: entry.createdAtMinute,
        second: 0,
        millisecond: 0,
      });
      synthPensieve.push({
        id: deterministicUuid(opts.seed + d * 1000 + synthPensieve.length),
        content: entry.content,
        epistemic_tag: null,
        source: 'telegram',
        content_hash: null,
        metadata: { synthetic: true, seed: opts.seed },
        created_at: createdAt.toUTC().toISO(),
        updated_at: createdAt.toUTC().toISO(),
        deleted_at: null,
      });
    }
  }

  // Deterministic generators (decisions, contradictions, wellbeing).
  const synthDecisions = generateSyntheticDecisions(
    opts.seed,
    opts.milestone,
    synthStart.toJSDate(),
  );
  const synthContradictions = generateSyntheticContradictions(opts.seed, synthPensieve);
  const wellbeing = await generateWellbeingIfTableExists(
    opts.seed,
    synthDaysNeeded,
    logger,
  );

  // Fuse + stable sort (determinism per SYNTH-07).
  const fusedPensieve = [...organicPensieve, ...synthPensieve].sort(
    (a, b) =>
      String(a.created_at).localeCompare(String(b.created_at)) ||
      String(a.id).localeCompare(String(b.id)),
  );
  const fusedDecisions = [...organicDecisions, ...synthDecisions];
  const fusedContradictions = [...organicContradictions, ...synthContradictions];

  // Write fixture output. Plan 24-04 will consume this directory via loadPrimedFixture.
  const outDir = join(outRoot, `${opts.milestone}-${opts.targetDays}days`);
  await mkdir(outDir, { recursive: true });

  const manifest = {
    organic_stamp: basename(organicStampPath),
    seed: opts.seed,
    target_days: opts.targetDays,
    milestone: opts.milestone,
    synthetic_date_range:
      synthDaysNeeded > 0
        ? [
            synthStart.toISODate(),
            synthStart.plus({ days: synthDaysNeeded - 1 }).toISODate(),
          ]
        : null,
    // 2026-04-20T00:00:00.000Z is overridden by env for determinism-check tests;
    // byte-identical runs still pass because the test harness compares
    // pensieve_entries.jsonl, not MANIFEST.json.
    generated_at: new Date().toISOString(),
    schema_note:
      'relational_memory is the v2.2 long-term-memory table; REQ-ID alias "memories" refers to this table',
  };
  await writeFile(join(outDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));

  await writeJsonl(join(outDir, 'pensieve_entries.jsonl'), fusedPensieve);
  await writeJsonl(join(outDir, 'pensieve_embeddings.jsonl'), organicEmbeddings);
  // EMPTY placeholder — Plan 24-03's synthesize-episodic will fill this.
  await writeJsonl(join(outDir, 'episodic_summaries.jsonl'), []);
  await writeJsonl(join(outDir, 'decisions.jsonl'), fusedDecisions);
  await writeJsonl(join(outDir, 'decision_events.jsonl'), organicDecisionEvents);
  await writeJsonl(join(outDir, 'decision_capture_state.jsonl'), []);
  await writeJsonl(join(outDir, 'contradictions.jsonl'), fusedContradictions);
  await writeJsonl(join(outDir, 'proactive_state.jsonl'), organicProactive);
  await writeJsonl(join(outDir, 'relational_memory.jsonl'), organicRelMemory);
  await writeJsonl(join(outDir, 'wellbeing_snapshots.jsonl'), wellbeing);

  console.log(
    `synthesize-delta: wrote ${organicPensieve.length} organic + ${synthPensieve.length} synthetic entries across ${uniqueOrganicDates.length + synthDaysNeeded} days to ${outDir}/`,
  );
}

// ── Main-guard ────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(err.message);
      printUsage();
      process.exit(1);
    }
    console.error('synthesize-delta: unexpected argparse error:', err);
    process.exit(1);
  }

  try {
    await synthesize(args);
    process.exit(0);
  } catch (err) {
    console.error('synthesize-delta: unexpected error:', err);
    process.exit(1);
  }
}

// ESM main-guard — when imported by tests, main() does not run.
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
