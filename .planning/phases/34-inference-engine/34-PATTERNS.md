# Phase 34: Inference Engine — Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 13 new + 5 modified = 18 total
**Analogs found:** 17 / 18 (one file — `profile-updater.ts` Promise.allSettled orchestrator — is a NEW micro-pattern; closest precedents are `loadWeeklyReviewContext`'s `Promise.all` parallel-fetch and `cron.ts` fire-and-forget wrapper, but neither uses `Promise.allSettled` discriminated-outcome fan-out)
**Pattern extraction date:** 2026-05-12
**Codebase HEAD:** `720bccc` (Phase 33 deployed; M009 lt→lte fix shipped 2026-05-10)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/memory/profile-prompt.ts` | utility / pure-function builder | transform (substrate + prevState → {system, user}) | `src/rituals/weekly-review-prompt.ts` | exact |
| `src/memory/profiles/shared.ts` | service / loader + hash + types | request-response (Drizzle reads → typed object) | `src/rituals/weekly-review-sources.ts` | exact |
| `src/memory/profiles/jurisdictional.ts` | service / per-dimension generator | request-response (substrate → Sonnet → upsert) | `src/rituals/weekly-review.ts` (`generateWeeklyObservation` + `buildSonnetRequest`) | role-match (no Stage-2 judge / no fallback / single .refine() overlay) |
| `src/memory/profiles/capital.ts` | service / per-dimension generator | same | same | role-match |
| `src/memory/profiles/health.ts` | service / per-dimension generator | same | same | role-match |
| `src/memory/profiles/family.ts` | service / per-dimension generator | same | same | role-match |
| `src/memory/profile-updater.ts` | service / orchestrator | event-driven (cron tick → fan-out → log) | none exact (closest: `src/episodic/cron.ts` for fire-and-forget; `src/rituals/weekly-review-sources.ts:425` for `Promise.all`) | partial (NEW pattern: `Promise.allSettled` discriminated-outcome) |
| `src/memory/__tests__/profile-prompt.test.ts` | test / structural unit | n/a | `src/rituals/__tests__/weekly-review-prompt.test.ts` | exact |
| `src/memory/profiles/__tests__/shared.test.ts` | test / integration | n/a | `src/rituals/__tests__/weekly-review-sources.test.ts` | exact |
| `src/memory/profiles/__tests__/generators.sparse.test.ts` | test / integration | n/a | `src/rituals/__tests__/weekly-review.test.ts` (sparse-data short-circuit, lines 737-771) | role-match |
| `src/memory/profiles/__tests__/generators.two-cycle.test.ts` | test / integration | n/a | `src/rituals/__tests__/weekly-review.test.ts` (lines 613-799 — `vi.setSystemTime` + `mockAnthropicParse.toHaveBeenCalledTimes` assertions) | role-match (extends to multi-cycle hash idempotency) |
| `src/memory/profiles/__tests__/refine.test.ts` | test / unit | n/a | (Phase 33 schemas test if exists; otherwise standalone) | partial (closure-captured `entryCount` is novel) |
| `src/memory/__tests__/profile-updater.test.ts` | test / integration | n/a | none exact | partial |
| `src/config.ts` (modify) | config | n/a | line 73 `ritualSweepCron: validatedCron(...)` | exact 1-line extension |
| `src/cron-registration.ts` (modify) | infra / registration | n/a | self (existing 4 cron blocks) | exact additive extension |
| `src/index.ts` (modify) | entry point / wiring | n/a | self (line 89 deps object + line 64-69 health response) | exact additive extension |
| `src/__tests__/cron-registration.test.ts` (modify) | test extension | n/a | self (existing 5 `it` blocks at `src/rituals/__tests__/cron-registration.test.ts`) | exact extension — note: existing test lives at `src/rituals/__tests__/cron-registration.test.ts`, NOT `src/__tests__/cron-registration.test.ts` |
| `src/__tests__/config.test.ts` (modify) | test extension | n/a | self (existing `describe` block lines 18-52) | exact extension |

> **Path correction discovered during scout:** CONTEXT.md `<code_context>` references `src/__tests__/cron-registration.test.ts`, but the file actually lives at `src/rituals/__tests__/cron-registration.test.ts` (verified by `wc -l`; 157 lines, last extended at TEST-32). Planner MUST extend the existing file, not create a duplicate at the alternate path.

---

## Pattern Assignments

### `src/memory/profile-prompt.ts` (utility, pure-function builder)

**Role:** Shared prompt assembler — `assembleProfilePrompt(dimension, substrate, prevState, entryCount)` returns `{system, user}`. Zero side effects. Consumed by all 4 generators (HARD CO-LOC #M10-2 enforcement against per-dimension drift).

**Analog:** `src/rituals/weekly-review-prompt.ts:144-188` — `assembleWeeklyReviewPrompt(input): string`

**Data flow:** Substrate object + dimension constant + prevState jsonb → pre-rendered system+user strings. No I/O.

**Code excerpt — Section-list-then-join contract** (`src/rituals/weekly-review-prompt.ts:144-188`):

```typescript
export function assembleWeeklyReviewPrompt(
  input: WeeklyReviewPromptInput,
): string {
  const sections: string[] = [];

  // 1. Constitutional preamble — WEEK-02 (CONS-04 / D038 anti-sycophancy floor)
  sections.push(CONSTITUTIONAL_PREAMBLE.trimEnd());

  // 2. Role preamble — anti-flattery for weekly review specifically.
  sections.push(buildRolePreamble());

  // 2a. Language Directive (Phase 32 weekly_review prompt fix 2026-05-11).
  sections.push(buildLanguageDirective(input.language));

  // 3. Date-window block
  sections.push(buildDateWindowBlock(input.weekStart, input.weekEnd, input.tz));

  // 4. Pattern-only directive
  sections.push(buildPatternOnlyDirective());

  // 5. Wellbeing block — conditional
  if (input.includeWellbeing && input.wellbeingSnapshots && input.wellbeingSnapshots.length > 0) {
    sections.push(buildWellbeingBlock(input.wellbeingSnapshots));
  }

  // 6. Summaries block — always present
  sections.push(buildSummariesBlock(input.summaries));

  // 7. Resolved decisions block — conditional
  if (input.resolvedDecisions.length > 0) {
    sections.push(buildResolvedDecisionsBlock(input.resolvedDecisions));
  }

  // 8. Structured-output directive — LAST
  sections.push(buildStructuredOutputDirective());

  return sections.join('\n\n');
}
```

**Code excerpt — CONSTITUTIONAL_PREAMBLE first-section anchor** (`src/rituals/weekly-review-prompt.ts:45,207`):

```typescript
import { CONSTITUTIONAL_PREAMBLE } from '../chris/personality.js';
// ...
sections.push(CONSTITUTIONAL_PREAMBLE.trimEnd());
```

> **Verified at source:** `src/chris/personality.ts:30` exports `CONSTITUTIONAL_PREAMBLE` as a template literal whose first line is `## Core Principles (Always Active)`. The `.trimEnd()` is load-bearing (the constant ends with `\n\n`).

**Key constraints from CONTEXT.md/RESEARCH.md:**
- **D-03** signature locked: `assembleProfilePrompt(dimension, substrate, prevState, entryCount): {system: string, user: string}` — returns a **pair** (system + user), not a single string like the M009 analog. The M009 version returns a single string consumed at the `system` SDK slot AND a hardcoded `'Generate the weekly review observation for this week.'` at the `user` slot; Phase 34 surfaces both explicitly because each dimension's user prompt is dimension-named (`'Generate the operational profile for ${dimension}.'`).
- **D-04** CONSTITUTIONAL_PREAMBLE re-exported via `CONSTITUTIONAL_PREAMBLE.trimEnd()` → first section of `system`.
- **D-05** `DO_NOT_INFER_DIRECTIVE` is a NEW verbatim block exported from this file (the M009 analog has no equivalent — Phase 34 invention).
- **D-06** Volume-weight ceiling phrasing — verbatim text drafted in RESEARCH.md §OQ-2 (lines 854-882); planner locks the exact wording in Plan 34-01.
- **D-07** Previous-state injection conditional on `prevState !== null`; mirrors the M009 wellbeing/resolved-decisions conditional pattern (`if (input.resolvedDecisions.length > 0) sections.push(buildResolvedDecisionsBlock(...))`).
- **D-35** Structural test asserts CONSTITUTIONAL_PREAMBLE first + DO_NOT_INFER + volume-weight phrasing + previous-state-injection conditional — parametrized over all 4 dimensions.

**What to keep vs adapt:**
- **Keep 1:1:** Section-list-then-join idiom (lines 204-237 of analog). `CONSTITUTIONAL_PREAMBLE.trimEnd()` first. Conditional sections via `if (...) sections.push(...)`. Structured-output directive LAST (line 235).
- **Adapt:** Return type is `{system, user}` not `string` (D-03). Add `DO_NOT_INFER_DIRECTIVE` as section 3 (M010-02 mitigation; no analog in M009). Volume-weight ceiling text (D-06) is a new section type — not present in M009. Previous-state injection block (D-07) replaces M009's wellbeing/resolved-decisions conditional blocks. Per-dimension `dimensionSpecificDirective` (Claude's Discretion) inserts before the substrate block (drafted in Plan 34-01).
- **Skip:** M009's `buildLanguageDirective` (Phase 34 prompt is English-only — Greg's profile inference is internal, not user-facing).
- **Skip:** M009's `buildPatternOnlyDirective` (semantically irrelevant — profiles are facts-of-record, not pattern aggregation).

---

### `src/memory/profiles/shared.ts` (service, substrate loader + types + hash)

**Role:** Three responsibilities: (a) `ProfileSubstrate` type definition, (b) `loadProfileSubstrate(now?)` data loader (one query per fire, shared across 4 generators per D-14), (c) `computeSubstrateHash(substrate, prevStateMeta)` pure-function SHA-256 helper, (d) optional `runProfileGenerator(config, deps)` helper (Claude's Discretion).

**Analog:** `src/rituals/weekly-review-sources.ts:48-260` — `WeeklyReviewContext` type + `loadWeeklyReviewContext(start, end)` function

**Data flow:** Three parallel Drizzle reads (pensieve_entries WHERE tag IN (...), episodic_summaries via `getEpisodicSummariesRange`, decisions WHERE status='resolved') → typed object → consumed by 4 generators.

**Code excerpt — typed substrate output** (`src/rituals/weekly-review-sources.ts:48-54`):

```typescript
export type WeeklyReviewContext = {
  summaries: (typeof episodicSummaries.$inferSelect)[];
  resolvedDecisions: (typeof decisions.$inferSelect)[];
  wellbeingSnapshots: (typeof wellbeingSnapshots.$inferSelect)[];
  wellbeingVariance: { energy: number; mood: number; anxiety: number };
  includeWellbeing: boolean;
};
```

**Code excerpt — Promise.all parallel-fetch loader pattern** (RESEARCH.md §Pattern 4 reproduces `src/rituals/weekly-review-sources.ts:214-260` shape):

```typescript
const [summaries, resolvedDecisions, snapshots] = await Promise.all([
  getEpisodicSummariesRange(weekStart, weekEnd),
  db.select().from(decisions).where(
    and(
      eq(decisions.status, 'resolved'),
      gte(decisions.resolvedAt, weekStart),
      lte(decisions.resolvedAt, weekEnd),
    ),
  ).orderBy(asc(decisions.resolvedAt)),
  db.select().from(wellbeingSnapshots).where(
    and(
      gte(wellbeingSnapshots.snapshotDate, wellbeingStartStr),
      lte(wellbeingSnapshots.snapshotDate, wellbeingEndStr),
    ),
  ).orderBy(asc(wellbeingSnapshots.snapshotDate)),
]);
```

**Code excerpt — Pensieve tag-filter (existing pattern at `src/pensieve/retrieve.ts:208-214`, RESEARCH.md line 610-617):**

```typescript
const conditions = [isNull(pensieveEntries.deletedAt)];
if (options.tags && options.tags.length > 0) {
  conditions.push(
    inArray(pensieveEntries.epistemicTag, options.tags),
  );
}
```

**Key constraints from CONTEXT.md/RESEARCH.md:**
- **D-12 / D-13** Substrate sources fixed: `pensieve_entries` filtered by tags FACT/RELATIONSHIP/INTENTION/EXPERIENCE (via `inArray`, OR-semantics — verified in RESEARCH.md line 619); episodic summaries via `getEpisodicSummariesRange(windowStart, now)` (already exists, exported from `src/pensieve/retrieve.ts`); decisions WHERE `status='resolved'` over last 60 days.
- **D-14** `loadProfileSubstrate` called ONCE per fire — orchestrator passes single substrate object to all 4 generators.
- **D-15** `computeSubstrateHash(substrate, prevStateMeta)` SHA-256 of canonical-JSON `{pensieveIds: sorted, episodicDates: sorted, decisionIds: sorted, schemaVersion}` — ID-and-date-only (not full content); deterministic.
- **D-16** `schema_version` participates in hash → schema bump invalidates all hashes.
- **D-20** `entryCount = pensieveEntries.length` (Pensieve count gates threshold; episodic derived).
- **Claude's Discretion:** `SUBSTRATE_WINDOW_DAYS = 60` constant; canonical-JSON helper hand-rolled (RESEARCH.md line 991-994 recommends — no `fast-json-stable-stringify` dep); optional `runProfileGenerator(config, deps)` helper for ≥80% mechanical duplication elimination.

**What to keep vs adapt:**
- **Keep 1:1:** `Promise.all([...])` parallel-fetch idiom. Drizzle `select().from(...).where(and(eq(...), gte(...), lte(...))).orderBy(asc(...))` chain. `(typeof <table>.$inferSelect)[]` typing for substrate arrays. Pensieve `isNull(pensieveEntries.deletedAt)` defensive filter.
- **Adapt:** Window is rolling-60-days from `now`, not a fixed start/end pair like M009 (M009 is week-boundaried; M010 is rolling). Add `pensieveEntries` array (M009 has no Pensieve direct read — only `episodicSummaries`). Replace `wellbeingSnapshots` and `wellbeingVariance` with `entryCount` field. Add `inArray(pensieveEntries.epistemicTag, PROFILE_SUBSTRATE_TAGS)` filter (OQ-1 tag-only).
- **New code (no analog):** `computeSubstrateHash` SHA-256 + canonical-JSON helper. `PROFILE_SUBSTRATE_TAGS = ['FACT', 'RELATIONSHIP', 'INTENTION', 'EXPERIENCE'] as const`. `SUBSTRATE_WINDOW_DAYS = 60`. Optional `runProfileGenerator(config, deps)` helper.

---

### `src/memory/profiles/jurisdictional.ts` (service, per-dimension generator)

**Role:** Per-dimension Sonnet call + parse + upsert. Identical shape across the 4 files (`capital.ts`, `health.ts`, `family.ts`); only the imported v3/v4 schema + dimension config object vary.

**Analog:** `src/rituals/weekly-review.ts:362-481` — `buildSonnetRequest(prompt)` + `generateWeeklyObservation(input)`

**Data flow:** Shared substrate + dimension config → assembled prompt → Sonnet `messages.parse` with v4 schema → v3 re-validate → check threshold → check hash → write profile_history snapshot → upsert via `name='primary'` → return `ProfileGenerationOutcome`.

**Code excerpt — Sonnet request builder (the SDK boundary)** (`src/rituals/weekly-review.ts:372-395`):

```typescript
function buildSonnetRequest(prompt: string): Parameters<typeof anthropic.messages.parse>[0] {
  return {
    model: SONNET_MODEL,
    max_tokens: 800,
    system: [
      {
        type: 'text' as const,
        text: prompt,
        cache_control: { type: 'ephemeral' as const },
      },
    ],
    messages: [
      {
        role: 'user' as const,
        content: 'Generate the weekly review observation for this week.',
      },
    ],
    output_config: {
      // SDK runtime requires zod/v4; same cast as src/episodic/consolidate.ts:156.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      format: zodOutputFormat(WeeklyReviewSchemaV4 as unknown as any),
    },
  };
}
```

**Code excerpt — Parse-then-revalidate-v3 discipline** (`src/rituals/weekly-review.ts:428-434`):

```typescript
const response = await anthropic.messages.parse(buildSonnetRequest(prompt));
if (response.parsed_output === null || response.parsed_output === undefined) {
  throw new Error('Sonnet: parsed_output is null');
}

// 2. v3 re-validation runs Stage-1 .refine() — throws ZodError on multi-question
const sonnetOut = WeeklyReviewSchema.parse(response.parsed_output);
```

**Key constraints from CONTEXT.md/RESEARCH.md:**
- **D-08** Identical shape across 4 files; only the dimension config varies (or planner extracts `runProfileGenerator(config, deps)` per Claude's Discretion — RESEARCH.md endorses this if duplication is ≥80%).
- **D-09** `JURISDICTIONAL_PROFILE_CONFIG` constant: `{ dimension, v3Schema, v4Schema, table, dimensionSpecificDirective }` shape.
- **D-10** Model = `SONNET_MODEL` from `src/llm/client.ts`.
- **D-11** Discriminated outcome type: `{ dimension, outcome: 'profile_updated' | 'profile_skipped_no_change' | 'profile_below_threshold' | 'profile_generation_failed', error?, entryCount?, confidence?, durationMs }`.
- **D-19** Threshold check BEFORE hash compute (cheaper short-circuit).
- **D-22** NO retry loop. M009 has `MAX_RETRIES=2` + `TEMPLATED_FALLBACK_EN` — Phase 34 has NEITHER. Single attempt; failure logs and returns `'profile_generation_failed'`; weekly cron IS the retry.
- **D-29 / D-30** Write-before-upsert: read current row → insert profile_history snapshot (full row) → upsert via `onConflictDoUpdate({target: <table>.name, set: ...})`. NO history row on hash-skip path.
- **D-32** Volume-weight ceiling Zod `.refine()` overlay ON the v4 schema, constructed INSIDE the generator (RESEARCH.md line 676 — `entryCount` is closure-captured).
- **PITFALL FLAG (RESEARCH.md lines 938-941):** `.refine()` on a zod/v4 schema passed through `zodOutputFormat()` may silently drop the refinement from the JSON schema Sonnet sees. Test guardrail: assert `v4SchemaWithRefine.safeParse({data_consistency: 0.7, ...}, entryCount=15)` returns `success: false` (Plan 34-02 task).

**What to keep vs adapt:**
- **Keep 1:1:** `buildSonnetRequest`-style helper extracted as pure function (test-mockable). `anthropic.messages.parse(...)` shape with `system: [{type:'text', text:prompt, cache_control:{type:'ephemeral'}}]`, `messages: [{role:'user', content:...}]`, `output_config: {format: zodOutputFormat(v4Schema as unknown as any)}`. Null-parsed_output guard (`response.parsed_output === null || response.parsed_output === undefined`). v3 re-validate `<v3Schema>.parse(response.parsed_output)`.
- **Adapt:** SDK call signature consumes `prompt.system` and `prompt.user` separately (D-03 returns `{system, user}` pair, not a single string). `max_tokens: 2000` (RESEARCH.md line 379 — matches episodic consolidate budget, larger than M009's 800 because profiles are structurally larger). Single attempt — strip the `for (let attempt = 0; attempt <= MAX_RETRIES; attempt++)` loop.
- **New code (no analog):** Threshold short-circuit (`if (substrate.entryCount < MIN_ENTRIES_THRESHOLD) { logger.info(..., 'chris.profile.threshold.below_minimum'); return {outcome: 'profile_below_threshold', ...}; }`). Hash skip-if-match (`if (computedHash === prevState.substrate_hash) return {outcome: 'profile_skipped_no_change', ...};`). `profile_history` snapshot INSERT before upsert (D-29 — write-before-upsert ordering). `onConflictDoUpdate({target: <table>.name, set: upsertValues})` sentinel upsert (Phase 33 D-04). Per-generator v4-with-refine construction with `entryCount` closure-captured (D-32).
- **Skip:** Stage-2 Haiku judge (`runStage2HaikuJudge`). Date-grounding post-check (`runDateGroundingCheck`). Retry loop (`MAX_RETRIES = 2`). Templated fallback (`TEMPLATED_FALLBACK_EN`). User-facing message render (`WEEKLY_REVIEW_HEADER`). Telegram send. `ritual_responses` / `ritualFireEvents` writes. Pensieve persistence as `RITUAL_RESPONSE` (profiles don't write Pensieve entries).

---

### `src/memory/profiles/capital.ts`, `health.ts`, `family.ts` (service, per-dimension generators)

**Identical to `jurisdictional.ts` above** — only the dimension config and imported v3/v4 schemas vary (D-08).

**Per Phase 33 `src/memory/profiles/schemas.ts:23-241`:** Each dimension has a `<Name>ProfileSchemaV3` (lines 23, 72, 121, 186) and `<Name>ProfileSchemaV4` (lines 48, 97, 154, 214). Generator imports its matched pair.

**Planner decision (Claude's Discretion):** If `runProfileGenerator(config, deps)` helper is extracted into `shared.ts`, each dimension file collapses to a single export:

```typescript
// hypothetical post-extraction shape
import { runProfileGenerator } from './shared.js';
import { JurisdictionalProfileSchemaV3, JurisdictionalProfileSchemaV4 } from './schemas.js';
import { profileJurisdictional } from '../../db/schema.js';

const JURISDICTIONAL_PROFILE_CONFIG = {
  dimension: 'jurisdictional' as const,
  v3Schema: JurisdictionalProfileSchemaV3,
  v4Schema: JurisdictionalProfileSchemaV4,
  table: profileJurisdictional,
  dimensionSpecificDirective: '...',
};

export const generateJurisdictionalProfile = (deps) =>
  runProfileGenerator(JURISDICTIONAL_PROFILE_CONFIG, deps);
```

Default per CONTEXT.md "Default if unsure: extract the helper (research line 77 endorses uniform body shape)."

---

### `src/memory/profile-updater.ts` (service, orchestrator)

**Role:** `updateAllOperationalProfiles()` invokes all 4 generators concurrently via `Promise.allSettled`; logs per-dimension outcome + aggregate cron-complete summary. Returns void (D-23 fire-and-forget).

**Analog (partial):** No exact match. Three precedents combined:
1. `src/rituals/weekly-review-sources.ts:425` — `Promise.all([...])` parallel-fetch idiom (but `.all` not `.allSettled`)
2. `src/episodic/cron.ts:90-122` — fire-and-forget void return + try/catch + log key shape (`'episodic.cron.error'` → Phase 34 uses `'profile.cron.error'`)
3. `src/cron-registration.ts:56-160` — Aggregate status object pattern (per-cron `'registered' | 'failed'` per-dimension here)

**Data flow:** Cron tick → load substrate ONCE → fan-out 4 generators concurrently → collect `PromiseSettledResult<ProfileGenerationOutcome>[]` → log aggregate → return void.

**Code excerpt — fire-and-forget try/catch wrapper** (`src/episodic/cron.ts:90-122`):

```typescript
export async function runConsolidateYesterday(
  now: Date = new Date(),
): Promise<void> {
  let yesterdayIso = '';
  try {
    const yesterday = computeYesterday(now, config.proactiveTimezone);
    yesterdayIso = yesterday.toISOString().slice(0, 10);

    logger.info(
      { yesterdayIso, timezone: config.proactiveTimezone },
      'episodic.cron.invoked',
    );

    await runConsolidate(yesterday);
  } catch (error) {
    logger.warn(
      {
        yesterdayIso,
        error: error instanceof Error ? error.message : String(error),
      },
      'episodic.cron.error',
    );
  }
}
```

**Code excerpt — Promise.all parallel-fetch idiom** (`src/rituals/weekly-review-sources.ts:425`, paraphrased — RESEARCH.md §Pattern 4):

```typescript
const [summaries, resolvedDecisions, snapshots] = await Promise.all([...]);
```

**Pattern recipe (D-21 + D-22 + D-23) — NEW, planner drafts in 34-03:**

```typescript
export async function updateAllOperationalProfiles(): Promise<void> {
  const startMs = Date.now();
  try {
    const substrate = await loadProfileSubstrate();  // D-14: ONCE per fire

    const results = await Promise.allSettled([
      generateJurisdictionalProfile({ substrate }),
      generateCapitalProfile({ substrate }),
      generateHealthProfile({ substrate }),
      generateFamilyProfile({ substrate }),
    ]);

    // Discriminated outcome logging — per-dim + aggregate
    const counts = { updated: 0, skipped: 0, belowThreshold: 0, failed: 0 };
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const o = r.value;
        logger.info({ ...o }, `chris.profile.${o.outcome}`);
        // counts++ by outcome
      } else {
        logger.warn({ err: r.reason }, 'chris.profile.profile_generation_failed');
        counts.failed += 1;
      }
    }
    logger.info({ counts, durationMs: Date.now() - startMs }, 'chris.profile.cron.complete');
  } catch (err) {
    logger.error({ err }, 'profile.cron.error');
  }
}
```

**Key constraints from CONTEXT.md/RESEARCH.md:**
- **D-21** `Promise.allSettled` (not `.all`) — per-generator failure isolation. 4 calls / week is nowhere near the 200 RPM Anthropic rate limit (RESEARCH.md line 11).
- **D-22** NO retry within fire. Generator outcome `'profile_generation_failed'` is logged; next Sunday is the retry.
- **D-23** Returns void / fire-and-forget; outcomes via logs only.
- **D-34** Discriminated log keys + aggregate `'chris.profile.cron.complete'` with per-dimension counts.

**What to keep vs adapt:**
- **Keep 1:1 from `src/episodic/cron.ts:90-122`:** Fire-and-forget `async (): Promise<void>` signature. Outer try/catch logging `'profile.cron.error'` (matches lowercase infra-error convention per RESEARCH.md line 973).
- **Adapt:** Replace single `await runConsolidate(...)` with `Promise.allSettled([4 calls])`. Add per-result iteration with `r.status === 'fulfilled' ? r.value : r.reason` discrimination (NEW — no codebase precedent uses this pattern).
- **New code (no analog):** Aggregate counts collection. `'chris.profile.cron.complete'` aggregate log. `Promise.allSettled` discriminated-outcome handling.

---

### `src/memory/__tests__/profile-prompt.test.ts` (test, structural unit)

**Role:** Pure-function structural test — asserts CONSTITUTIONAL_PREAMBLE first, DO_NOT_INFER_DIRECTIVE present, volume-weight phrasing present, previous-state injection conditional. Parametrized over all 4 dimensions (D-35).

**Analog:** `src/rituals/__tests__/weekly-review-prompt.test.ts` (190 lines)

**Code excerpt — fixture-helper + first-section anchor** (`src/rituals/__tests__/weekly-review-prompt.test.ts:33-101`):

```typescript
function buildFixture(
  overrides?: Partial<WeeklyReviewPromptInput>,
): WeeklyReviewPromptInput {
  return {
    weekStart: '2026-04-20',
    weekEnd: '2026-04-26',
    // ...
    ...overrides,
  };
}

describe('assembleWeeklyReviewPrompt — pure prompt assembler (Phase 29 Plan 01)', () => {
  it('CONSTITUTIONAL_PREAMBLE first — output STARTS with "## Core Principles (Always Active)" (WEEK-02)', () => {
    const out = assembleWeeklyReviewPrompt(buildFixture());
    expect(out.startsWith('## Core Principles (Always Active)')).toBe(true);
    expect(CONSTITUTIONAL_PREAMBLE.startsWith('## Core Principles (Always Active)')).toBe(true);
  });
  // ...
});
```

**Code excerpt — conditional-block test pattern** (`src/rituals/__tests__/weekly-review-prompt.test.ts:120-132`):

```typescript
it('wellbeing block conditional (false) — includeWellbeing=false → block omitted (WEEK-09)', () => {
  const out = assembleWeeklyReviewPrompt(
    buildFixture({ includeWellbeing: false, wellbeingSnapshots: undefined }),
  );
  expect(out).not.toContain('Wellbeing Snapshots');
});
```

**Key constraints from CONTEXT.md/RESEARCH.md:**
- **D-35** Parametrized over all 4 dimensions (`['jurisdictional', 'capital', 'health', 'family'].forEach(d => it.each(...))`).
- Test must assert RESEARCH.md OQ-2 phrasing substrings (line 892-895): `'data_consistency'`, `'DO NOT emit a \`confidence\` field'`, `'fewer than 20 entries'`, `'MUST NOT exceed 0.5'`.
- Pure function — no DB, no LLM, no mocks.

**What to keep vs adapt:**
- **Keep 1:1:** `buildFixture(overrides?)` helper-with-spread pattern (lines 33-90). `describe`/`it` structure. `expect(out.startsWith(...)).toBe(true)` first-section anchor. `expect(out).toContain(...)` / `expect(out).not.toContain(...)` for conditional blocks. Imports CONSTITUTIONAL_PREAMBLE to double-check the source constant hasn't drifted.
- **Adapt:** Output is `{system, user}` not string — assertions target `out.system.startsWith(...)`. Replace single test with parametrized `describe.each(['jurisdictional', ...])` or `it.each([...])`. Replace fixture fields (summaries/decisions/wellbeing) with `{pensieveEntries, episodicSummaries, decisions, entryCount}` substrate shape.

---

### `src/memory/profiles/__tests__/shared.test.ts` (test, integration)

**Role:** Substrate loader integration test — real Docker Postgres, no mocks. Asserts tag-filter correctness, 60-day window, decisions status filter, hash determinism.

**Analog:** `src/rituals/__tests__/weekly-review-sources.test.ts` (442 lines — existing pattern for Docker-Postgres substrate loader test)

**Data flow:** Seed pensieve_entries + episodic_summaries + decisions → call `loadProfileSubstrate()` → assert returned shape matches expectations.

**Key constraints:**
- Window: rolling-60-days from injected `now` (not week-boundaried like M009).
- Tag filter assertion: seed entries with ALL tags from `epistemicTagEnum` (`src/db/schema.ts:31-46` lists 14 tags); assert only `FACT | RELATIONSHIP | INTENTION | EXPERIENCE` rows are returned.
- `entryCount` assertion: equals `pensieveEntries.length`, NOT inclusive of episodic/decisions (D-20).
- Hash determinism: same substrate object → same hash; different IDs/dates → different hash; same IDs but different content → SAME hash (D-15 ID-only); different `schemaVersion` → different hash (D-16).

**What to keep vs adapt:**
- **Keep 1:1:** Docker-Postgres integration test scaffolding from `weekly-review-sources.test.ts` (`beforeAll`/`beforeEach`/`afterEach` cleanup; real DB inserts via Drizzle; real reads via the loader under test).
- **Adapt:** Window math (60-day rolling vs 7-day fixed). Tag-filter assertions (no M009 analog — tag filter is novel to Phase 34). Hash-determinism unit-test block (no analog).

---

### `src/memory/profiles/__tests__/generators.sparse.test.ts` (test, integration)

**Role:** Threshold short-circuit test — seed <10 Pensieve entries; assert all 4 generators return `'profile_below_threshold'`, log `'chris.profile.threshold.below_minimum'` verbatim, NO Sonnet call (D-37 + GEN-06).

**Analog:** `src/rituals/__tests__/weekly-review.test.ts:737-771` — sparse-data short-circuit test (zero summaries → no Sonnet call → no Telegram send)

**Code excerpt** (`src/rituals/__tests__/weekly-review.test.ts:737-771`):

```typescript
it('sparse-data short-circuit: zero summaries AND zero decisions → no Sonnet call, no Telegram send, no DB writes', async () => {
  // ... cleanup the window
  const ritual = await seedFixtureRitual();
  const cfg = parseRitualConfig(ritual.config);

  const outcome = await fireWeeklyReview(ritual, cfg);

  expect(outcome).toBe('fired');
  expect(mockAnthropicParse).toHaveBeenCalledTimes(0);
  expect(mockSendMessage).toHaveBeenCalledTimes(0);

  const responses = await db
    .select()
    .from(ritualResponses)
    .where(eq(ritualResponses.ritualId, ritual.id));
  expect(responses).toHaveLength(0);

  // Skipped log emitted
  const skippedLogs = mockLoggerInfo.mock.calls.filter(
    (c) => c[1] === 'rituals.weekly.skipped.no_data',
  );
  expect(skippedLogs).toHaveLength(1);
});
```

**Key constraints:**
- **D-37** Seed 5 Pensieve entries (below 10 threshold from `MIN_ENTRIES_THRESHOLD` in `src/memory/confidence.ts`).
- **GEN-06** Log key VERBATIM `'chris.profile.threshold.below_minimum'`.
- **D-19** Threshold check happens BEFORE hash compute → `mockAnthropicParse` NOT called for ANY of the 4 dimensions.

**What to keep vs adapt:**
- **Keep 1:1:** `vi.mock('../../llm/client.js', ...)` ESM partial-spread for `anthropic.messages.parse` mocking. `mockLoggerInfo.mock.calls.filter((c) => c[1] === '<key>')` log-key assertion pattern. `expect(mockAnthropicParse).toHaveBeenCalledTimes(0)` no-call assertion.
- **Adapt:** Call `updateAllOperationalProfiles()` (the orchestrator) rather than `fireWeeklyReview(...)`. Assert profile rows unchanged from Phase 33 seed (confidence=0; fields are seed defaults).

---

### `src/memory/profiles/__tests__/generators.two-cycle.test.ts` (test, HARD CO-LOC #M10-3)

**Role:** Substrate-hash idempotency regression detector. M009's `lt→lte` second-fire-blindness bug is the direct ancestor — this test exists to catch the same class of bug in Phase 34 (D-36).

**Analog:** `src/rituals/__tests__/weekly-review.test.ts:613-799` — `vi.setSystemTime` + `mockAnthropicParse.toHaveBeenCalledTimes` pattern

**Code excerpt — `vi.setSystemTime` anchor + reset pattern** (`src/rituals/__tests__/weekly-review.test.ts:617-637`):

```typescript
beforeAll(async () => {
  await pgSql`SELECT 1 as ok`;
});

beforeEach(async () => {
  await cleanup();
  mockAnthropicParse.mockReset();
  mockSendMessage.mockReset();
  mockSendMessage.mockResolvedValue({ message_id: 12345 });
  mockLoggerInfo.mockReset();
  mockLoggerWarn.mockReset();
  // Anchor "now" inside the hardcoded fixture week
  vi.setSystemTime(new Date('2026-04-26T20:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});
```

**Code excerpt — primeFullSuccess (mock response staging)** (`src/rituals/__tests__/weekly-review.test.ts:647-657`):

```typescript
function primeFullSuccess(observation: string, question: string): void {
  mockAnthropicParse.mockResolvedValueOnce({
    parsed_output: { observation, question },
  });
  mockAnthropicParse.mockResolvedValueOnce({
    parsed_output: { question_count: 1, questions: [question] },
  });
  mockAnthropicParse.mockResolvedValueOnce({
    parsed_output: { references_outside_window: false, dates_referenced: [] },
  });
}
```

**Key constraints from CONTEXT.md/RESEARCH.md (lines 537-575 of RESEARCH.md):**
- **D-36** Three cycles in a single test:
  - **Cycle 1:** Seed 12+ tagged Pensieve entries; run `updateAllOperationalProfiles()`; assert `mockAnthropicParse.toHaveBeenCalledTimes(4)` (one Sonnet call per dimension); 4 `profile_history` rows inserted; all 4 outcomes are `'profile_updated'`.
  - **Cycle 2:** `vi.setSystemTime(+7d)` with IDENTICAL substrate; re-run; assert `mockAnthropicParse.toHaveBeenCalledTimes(4)` (NOT 8 — hash idempotency); `profile_history` still 4 rows; all 4 outcomes are `'profile_skipped_no_change'`.
  - **Cycle 3:** INSERT a NEW tagged Pensieve entry (NOT mutate existing — RESEARCH.md line 933-935 critical caveat: hash is over IDs not content; mutation of existing content won't trigger regen); re-run; assert `mockAnthropicParse.toHaveBeenCalledTimes(5+)`; one new `profile_history` row.
- **HARD CO-LOC #M10-3:** This test MUST ship in the same plan as the substrate-hash logic (gsd-plan-checker enforces).

**What to keep vs adapt:**
- **Keep 1:1:** `vi.hoisted` mock factory pattern (`weekly-review.test.ts:39-46`). `vi.mock('../../llm/client.js', ...)` ESM partial-spread. `vi.setSystemTime(new Date(...))` cycle-advance idiom. `mockAnthropicParse.mockResolvedValueOnce(...)` per-call response staging. `beforeAll/beforeEach/afterEach/afterAll` Docker-Postgres scaffolding (`pgSql\`SELECT 1 as ok\``, `cleanup()` helper, `vi.useRealTimers()`).
- **Adapt:** Replace 3 mock responses per fire (Sonnet + Stage-2 Haiku + date-grounding Haiku) with 4 per fire (one Sonnet call per dimension; no Haiku judges). Helper renamed `prime4DimensionalSuccess(profileFixtures)`. Replace `fireWeeklyReview(ritual, cfg)` with `updateAllOperationalProfiles()`. Add cross-cycle `vi.setSystemTime(new Date('+7d'))` advance.
- **New code (no analog):** Multi-cycle `mockAnthropicParse.toHaveBeenCalledTimes(...)` cross-cycle assertions. `profile_history` row-count assertions per cycle. Cycle 3 INSERT vs mutate discriminant.

---

### `src/memory/profiles/__tests__/refine.test.ts` (test, unit)

**Role:** Standalone unit test for the volume-weight ceiling Zod `.refine()` overlay — asserts `data_consistency > 0.5 && entryCount < 20` is rejected via `safeParse → {success: false}` (D-32, RESEARCH.md residual risk lines 938-941).

**Analog:** Partial — no codebase precedent for closure-captured Zod refine. Phase 33 schemas test (if exists; not verified) may contain `.refine()` assertions but without the closure pattern.

**Key constraints:**
- **D-32** Volume-weight ceiling: `data_consistency > 0.5 && entryCount < 20` rejected.
- **RESEARCH.md line 676:** `entryCount` is closure-captured — test constructs the refined schema with the same closure shape the generator uses (`(out) => !(out.data_consistency > 0.5 && entryCount < 20)`).
- Test ALSO verifies the refine is preserved through `zodOutputFormat()` cast (RESEARCH.md residual risk).

**What to keep vs adapt:**
- **No 1:1 analog.** Planner drafts from scratch. The 5–6 test cases are straightforward Zod `safeParse` assertions; complexity is in the closure-captured `entryCount` setup.

---

### `src/memory/__tests__/profile-updater.test.ts` (test, integration)

**Role:** Orchestrator `Promise.allSettled` isolation test — mock one of four generators to throw; assert other 3 succeed and orchestrator returns void without rethrowing (D-21).

**Analog:** No exact match — NEW pattern. Closest is the `cron-registration.test.ts:98-117` try/catch isolation assertion.

**Code excerpt — handler try/catch isolation pattern** (`src/rituals/__tests__/cron-registration.test.ts:98-117`):

```typescript
it('handler try/catch isolates errors — calling the registered handler with throwing fn does not propagate', async () => {
  const { registerCrons } = await import('../../cron-registration.js');

  const throwingRunRitualSweep = vi.fn().mockRejectedValue(new Error('synthetic'));
  registerCrons({
    config: baseConfig,
    runSweep: vi.fn(),
    runRitualSweep: throwingRunRitualSweep,
    runConsolidateYesterday: vi.fn(),
  });

  // Find the ritual cron handler from the spy calls
  const ritualCall = scheduleSpy.mock.calls.find((c) => c[0] === baseConfig.ritualSweepCron);
  expect(ritualCall).toBeDefined();
  const ritualHandler = ritualCall![1] as () => Promise<void>;

  // Invoke it directly — should NOT throw (the try/catch swallows)
  await expect(ritualHandler()).resolves.toBeUndefined();
  expect(throwingRunRitualSweep).toHaveBeenCalled();
});
```

**Key constraints:**
- **D-21** `Promise.allSettled` — one generator throws → other 3 still complete.
- **D-23** Orchestrator returns void; outcomes via logs only.

**What to keep vs adapt:**
- **Keep 1:1:** `vi.fn().mockRejectedValue(new Error('synthetic'))` injection pattern. `await expect(fn()).resolves.toBeUndefined()` no-rethrow assertion.
- **Adapt:** Mock one of the four generator imports (e.g., `vi.mock('../profiles/jurisdictional.js', ...)`) to throw; assert other 3 mock-imports succeed. Assert per-dimension log keys emitted with correct dimensions (`mockLoggerInfo.mock.calls.filter((c) => c[1] === 'chris.profile.profile_updated')` length 3, `'chris.profile.profile_generation_failed'` length 1).
- **New code:** No precedent — planner drafts from scratch.

---

### `src/config.ts` (modify — add `profileUpdaterCron`)

**Analog:** `src/config.ts:73` (existing `ritualSweepCron` line — the closest precedent)

**Code excerpt — existing `validatedCron` pattern** (`src/config.ts:53-78`):

```typescript
function validatedCron(envKey: string, fallback: string): string {
  const expr = process.env[envKey] || fallback;
  if (!validate(expr)) {
    throw new Error(`config: invalid ${envKey} expression "${expr}"`);
  }
  return expr;
}

export const config = {
  // ...
  // Background sync scheduler — D-03 cron.validate fail-fast at config load
  syncIntervalCron: validatedCron('SYNC_INTERVAL_CRON', '0 */6 * * *'),
  // Proactive messaging — D-03 cron.validate fail-fast at config load
  proactiveSweepCron: validatedCron('PROACTIVE_SWEEP_CRON', '0 10 * * *'),
  // ...
  ritualSweepCron: validatedCron('RITUAL_SWEEP_CRON', '* * * * *'),
  // Episodic consolidation (M008 Phase 20)
  episodicCron: validatedCron('EPISODIC_CRON', '0 23 * * *'),
} as const;
```

**Phase 34 addition (after line 77, before closing `} as const`):**

```typescript
// M010 Phase 34 GEN-01 — Sunday 22:00 Paris operational profile updater.
// 2h gap after Sunday 20:00 weekly_review (M010-04 timing-collision mitigation).
profileUpdaterCron: validatedCron('PROFILE_UPDATER_CRON', '0 22 * * 0'),
```

**Key constraints:**
- **D-25** Default `'0 22 * * 0'`; env-var override allows testing.
- **D-25** `validate(value)` returns false → `validatedCron` throws → container restart-loops (fail-fast).

**What to keep vs adapt:**
- **Keep 1:1:** Existing `validatedCron(envKey, fallback)` helper — no change needed.
- **Adapt:** Add ONE line in the `config` object literal alongside the existing cron fields.

---

### `src/cron-registration.ts` (modify — add `profileUpdate` field + cron block)

**Analog:** Self — same file, existing 4 cron blocks (lines 66-158)

**Code excerpts — existing extension points:**

**Interface extension point** (`src/cron-registration.ts:22-28`):

```typescript
export interface CronRegistrationStatus {
  proactive: 'registered' | 'failed';
  ritual: 'registered' | 'failed';
  ritualConfirmation: 'registered' | 'failed';
  episodic: 'registered' | 'failed';
  sync: 'registered' | 'failed' | 'disabled';
}
```

**Deps interface extension point** (`src/cron-registration.ts:30-45`):

```typescript
export interface RegisterCronsDeps {
  config: {
    proactiveSweepCron: string;
    ritualSweepCron: string;
    episodicCron: string;
    syncIntervalCron: string;
    proactiveTimezone: string;
  };
  runSweep: () => Promise<unknown>;
  runRitualSweep: () => Promise<unknown>;
  runConsolidateYesterday: () => Promise<void>;
  ritualConfirmationSweep: () => Promise<number | void>;
  runSync?: () => Promise<void>;
}
```

**Status-object initialization extension point** (`src/cron-registration.ts:57-63`):

```typescript
const status: CronRegistrationStatus = {
  proactive: 'failed',
  ritual: 'failed',
  ritualConfirmation: 'failed',
  episodic: 'failed',
  sync: deps.runSync ? 'failed' : 'disabled',
};
```

**Existing cron.schedule block to mirror (the episodic 23:00 block, `src/cron-registration.ts:142-158`):**

```typescript
// Existing 23:00 Paris episodic (mirrors src/index.ts:89-96)
cron.schedule(
  deps.config.episodicCron,
  async () => {
    try {
      await deps.runConsolidateYesterday();
    } catch (err) {
      logger.error({ err }, 'episodic.cron.error');
    }
  },
  { timezone: deps.config.proactiveTimezone },
);
status.episodic = 'registered';
logger.info(
  { cron: deps.config.episodicCron, timezone: deps.config.proactiveTimezone },
  'episodic.cron.scheduled',
);
```

**Phase 34 addition (per RESEARCH.md lines 740-758) — placed AFTER the episodic block (after line 158, before `return status`):**

```typescript
// M010 Phase 34 GEN-01 — Sunday 22:00 Paris profile updater cron.
// 2h gap after weekly_review at Sunday 20:00 (M010-04 timing-collision mitigation).
// CRON-01 try/catch belt-and-suspenders (mirrors lines 142-158 episodic block).
cron.schedule(
  deps.config.profileUpdaterCron,
  async () => {
    try {
      await deps.runProfileUpdate();
    } catch (err) {
      logger.error({ err }, 'profile.cron.error');
    }
  },
  { timezone: deps.config.proactiveTimezone },
);
status.profileUpdate = 'registered';
logger.info(
  { cron: deps.config.profileUpdaterCron, timezone: deps.config.proactiveTimezone },
  'profile.cron.scheduled',
);
```

**Three edits to existing interfaces (lines 22-28, 30-45, 57-63):**

```typescript
// Line 28 area — add field:
profileUpdate: 'registered' | 'failed';

// Line 36 area (inside config:) — add field:
profileUpdaterCron: string;

// Line 44 area — add field BEFORE optional `runSync?`:
runProfileUpdate: () => Promise<void>;

// Line 62 area — add field:
profileUpdate: 'failed',
```

**Key constraints:**
- **D-26** `'registered' | 'failed'` status field (no `'disabled'` — profile updater is not opt-out).
- **CRON-01** try/catch belt-and-suspenders — log key `'profile.cron.error'` (lowercase infra-error per RESEARCH.md line 973 convention).

**What to keep vs adapt:**
- **Keep 1:1:** Existing episodic-23:00 block (lines 142-158) is the EXACT template — copy the 17 lines with three substitutions: `episodicCron → profileUpdaterCron`, `runConsolidateYesterday → runProfileUpdate`, `episodic → profile` (in both the error log key and the status field name).
- **Adapt:** Update three interface declarations + one status initialization (4 small touch-ups).

---

### `src/index.ts` (modify — wire orchestrator + add `/health` field)

**Analog:** Self — line 89 deps object + lines 64-69 health response

**Code excerpt — existing `registerCrons` deps wiring** (`src/index.ts:89-95`):

```typescript
cronStatus = registerCrons({
  config,
  runSweep,
  runRitualSweep,
  runConsolidateYesterday,
  ritualConfirmationSweep,
});
```

**Code excerpt — existing `/health` response shape** (`src/index.ts:64-69`):

```typescript
res.status(statusCode).json({
  status: overallStatus,
  checks,
  ritual_cron_registered: effectiveCronStatus?.ritual === 'registered',
  timestamp: new Date().toISOString(),
});
```

**Phase 34 additions (per RESEARCH.md lines 815-823, 803-811):**

```typescript
// Top of file — add import:
import { updateAllOperationalProfiles } from './memory/profile-updater.js';

// Line 89-95 — add `runProfileUpdate` field:
cronStatus = registerCrons({
  config,
  runSweep,
  runRitualSweep,
  runConsolidateYesterday,
  ritualConfirmationSweep,
  runProfileUpdate: () => updateAllOperationalProfiles(),   // ← NEW (D-28)
});

// Lines 64-69 — add `profile_cron_registered` field:
res.status(statusCode).json({
  status: overallStatus,
  checks,
  ritual_cron_registered: effectiveCronStatus?.ritual === 'registered',
  profile_cron_registered: effectiveCronStatus?.profileUpdate === 'registered',   // ← NEW (D-27)
  timestamp: new Date().toISOString(),
});
```

**Key constraints:**
- **D-27** Key VERBATIM `profile_cron_registered` (REQUIREMENTS GEN-01 names this verbatim).
- **D-28** `runProfileUpdate: () => updateAllOperationalProfiles()` wired at line 89.
- `createApp` signature unchanged — `cronStatus` is read-only access via the module-scoped variable + the test-injectable `deps?.cronStatus` override.

**What to keep vs adapt:**
- **Keep 1:1:** Module-scoped `cronStatus` variable + `effectiveCronStatus` resolution at line 61 — no changes. `createApp(deps?)` signature unchanged.
- **Adapt:** Two single-line additions (one import, one deps field, one response field).

---

### `src/__tests__/cron-registration.test.ts` (modify — extend with 4th-cron tests)

> **Path note:** Per scout pass, the existing file is at `src/rituals/__tests__/cron-registration.test.ts` (157 lines), NOT `src/__tests__/cron-registration.test.ts`. The CONTEXT.md/RESEARCH.md path reference is inaccurate. Planner extends the **existing** file at its current location.

**Analog:** Self — `src/rituals/__tests__/cron-registration.test.ts:48-65` (the existing "registers the ritual sweep cron" `it` block)

**Code excerpt — existing it-block pattern to mirror** (`src/rituals/__tests__/cron-registration.test.ts:48-65`):

```typescript
it('registers the ritual sweep cron at the configured cadence (RIT-11; revised per-minute 2026-05-05)', async () => {
  const { registerCrons } = await import('../../cron-registration.js');

  const status = registerCrons({
    config: baseConfig,
    runSweep: vi.fn(),
    runRitualSweep: vi.fn(),
    runConsolidateYesterday: vi.fn(),
    ritualConfirmationSweep: vi.fn().mockResolvedValue(0),
  });

  expect(scheduleSpy).toHaveBeenCalledWith(
    baseConfig.ritualSweepCron,
    expect.any(Function),
    { timezone: 'Europe/Paris' },
  );
  expect(status.ritual).toBe('registered');
});
```

**Code excerpt — TEST-32 static-analysis precedent** (`src/rituals/__tests__/cron-registration.test.ts:119-156` — already extends `src/index.ts` regression assertions; Phase 34 piggybacks on this pattern):

```typescript
it('TEST-32: registerCrons invoked from src/index.ts main() with all M009 cron handlers (HARD CO-LOC #4)', async () => {
  const indexSource = await readFile('src/index.ts', 'utf8');

  expect(indexSource, 'src/index.ts must invoke registerCrons').toMatch(
    /cronStatus\s*=\s*registerCrons\(\{/,
  );
  // ... etc.
});
```

**Phase 34 additions:**
1. Extend `baseConfig` (line 33-41) to include `profileUpdaterCron: '0 22 * * 0'`.
2. Add new it-block mirroring lines 48-65: `'registers the profile updater cron at "0 22 * * 0" / Europe/Paris (GEN-01)'`.
3. Extend the `runProfileUpdate: vi.fn()` field across ALL existing it-block deps objects (lines 51-57, 71-75, 87-93, 101-107 — 4 sites).
4. Add new it-block asserting status.profileUpdate === 'registered'.
5. Add new it-block (or extend TEST-32) asserting `src/index.ts` passes `runProfileUpdate` to `registerCrons` (regex: `/runProfileUpdate/`).
6. Add new it-block asserting `/health` response includes `profile_cron_registered: true` after registration (test the createApp deps-override path).

**Key constraints:**
- **D-38** All 4 new test cases inside the existing `describe('registerCrons', ...)` block.

**What to keep vs adapt:**
- **Keep 1:1:** `vi.hoisted({ scheduleSpy, validateSpy })` mock factory. `vi.mock('node-cron', ...)` + `vi.mock('../../utils/logger.js', ...)`. Dynamic `await import('../../cron-registration.js')` for cache-bust. `expect(scheduleSpy).toHaveBeenCalledWith(<cron>, expect.any(Function), { timezone: 'Europe/Paris' })` assertion shape.
- **Adapt:** Add `profileUpdaterCron` to `baseConfig` + `runProfileUpdate: vi.fn()` to every existing test's deps object (the new required field will break all existing tests unless added; TypeScript strict mode flags it).

---

### `src/__tests__/config.test.ts` (modify — extend with `profileUpdaterCron` validation)

**Analog:** Self — `src/__tests__/config.test.ts:18-52` (the existing `describe('config: cron.validate fail-fast (RIT-12)', ...)` block)

**Code excerpt — existing test pattern to mirror** (`src/__tests__/config.test.ts:18-52`):

```typescript
describe('config: cron.validate fail-fast (RIT-12)', () => {
  beforeEach(() => {
    delete process.env.RITUAL_SWEEP_CRON;
  });

  afterEach(() => {
    if (ORIGINAL_RITUAL_SWEEP_CRON !== undefined) {
      process.env.RITUAL_SWEEP_CRON = ORIGINAL_RITUAL_SWEEP_CRON;
    } else {
      delete process.env.RITUAL_SWEEP_CRON;
    }
  });

  it('rejects invalid RITUAL_SWEEP_CRON at config load with /invalid RITUAL_SWEEP_CRON/ message', async () => {
    process.env.RITUAL_SWEEP_CRON = 'garbage';
    await expect(import('../config.js?reload=' + Date.now())).rejects.toThrow(
      /invalid RITUAL_SWEEP_CRON/,
    );
  });

  it('accepts valid RITUAL_SWEEP_CRON expression at config load', async () => {
    process.env.RITUAL_SWEEP_CRON = '0 21 * * *';
    await expect(import('../config.js?reload=' + Date.now())).resolves.toBeDefined();
  });

  it('default RITUAL_SWEEP_CRON is "* * * * *" when env unset', async () => {
    delete process.env.RITUAL_SWEEP_CRON;
    const mod = await import('../config.js?reload=' + Date.now());
    expect(mod.config.ritualSweepCron).toBe('* * * * *');
  });
});
```

**Phase 34 additions — new `describe` block (per D-39):**

```typescript
const ORIGINAL_PROFILE_UPDATER_CRON = process.env.PROFILE_UPDATER_CRON;

describe('config: cron.validate fail-fast (M010 GEN-01 profileUpdaterCron)', () => {
  beforeEach(() => {
    delete process.env.PROFILE_UPDATER_CRON;
  });

  afterEach(() => {
    if (ORIGINAL_PROFILE_UPDATER_CRON !== undefined) {
      process.env.PROFILE_UPDATER_CRON = ORIGINAL_PROFILE_UPDATER_CRON;
    } else {
      delete process.env.PROFILE_UPDATER_CRON;
    }
  });

  it('rejects invalid PROFILE_UPDATER_CRON at config load with /invalid PROFILE_UPDATER_CRON/ message', async () => {
    process.env.PROFILE_UPDATER_CRON = 'garbage';
    await expect(import('../config.js?reload=' + Date.now())).rejects.toThrow(
      /invalid PROFILE_UPDATER_CRON/,
    );
  });

  it('accepts valid PROFILE_UPDATER_CRON expression at config load', async () => {
    process.env.PROFILE_UPDATER_CRON = '0 22 * * 0';
    await expect(import('../config.js?reload=' + Date.now())).resolves.toBeDefined();
  });

  it('default PROFILE_UPDATER_CRON is "0 22 * * 0" when env unset', async () => {
    delete process.env.PROFILE_UPDATER_CRON;
    const mod = await import('../config.js?reload=' + Date.now());
    expect(mod.config.profileUpdaterCron).toBe('0 22 * * 0');
  });
});
```

**Key constraints:**
- **D-39** Cache-bust idiom `'../config.js?reload=' + Date.now()` — verbatim from the existing test.

**What to keep vs adapt:**
- **Keep 1:1:** Entire test scaffolding (beforeEach/afterEach env-var cache-bust + dynamic import pattern). Three test cases (rejects-invalid, accepts-valid, default-when-unset).
- **Adapt:** Substitute `RITUAL_SWEEP_CRON → PROFILE_UPDATER_CRON`, `* * * * * → 0 22 * * 0`, `ritualSweepCron → profileUpdaterCron`. Drop into a new sibling `describe` block in the same file.

---

## Shared Patterns

### Authentication
**N/A.** Cron-driven background pipelines run as system; no per-user auth. The Telegram-authorized-user-id (`config.telegramAuthorizedUserId`) is enforced at the bot ingress, not in cron handlers.

### Error Handling
**Source:** `src/cron-registration.ts:88-93` (canonical CRON-01 try/catch belt-and-suspenders)
**Apply to:** The cron-handler wrapper in `cron-registration.ts` (D-26); the orchestrator's outer try/catch in `profile-updater.ts` (D-23 belt-and-suspenders); each generator's discriminated-outcome return (D-11 — generators NEVER throw, they return `{outcome: 'profile_generation_failed', error}`).

```typescript
// Canonical shape — per-handler try/catch with log key matching '<channel>.cron.error':
cron.schedule(
  deps.config.<X>Cron,
  async () => {
    try {
      await deps.<runX>();
    } catch (err) {
      logger.error({ err }, '<channel>.cron.error');
    }
  },
  { timezone: deps.config.proactiveTimezone },
);
```

Phase 34 instance: `'profile.cron.error'` log key (matches lowercase infra-error convention per RESEARCH.md line 973 — DO NOT prefix with `chris.`).

### Logging Conventions
**Source:** `src/cron-registration.ts:73, 92, 110, 131, 149` (the existing `<channel>.cron.error` log keys); RESEARCH.md lines 960-973 (the Phase 34 log key table)
**Apply to:** All 4 generators + orchestrator + cron handler

| Event | Log key | Fields |
|-------|---------|--------|
| Generator success | `chris.profile.profile_updated` | dimension, entryCount, confidence, durationMs |
| Hash-skip path | `chris.profile.profile_skipped_no_change` | dimension, substrateHashPrefix |
| Below-threshold (GEN-06 verbatim) | `chris.profile.threshold.below_minimum` | dimension, entryCount, threshold (=10) |
| Generator failure | `chris.profile.profile_generation_failed` | dimension, error, durationMs |
| Aggregate cron complete | `chris.profile.cron.complete` | counts: {updated, skipped, belowThreshold, failed} |
| Cron handler exception (infra) | `profile.cron.error` (NO `chris.` prefix) | err |

### Validation
**Source:** `src/rituals/weekly-review.ts:434` (v3 re-validation discipline); `src/episodic/consolidate.ts:148-156` (v3/v4 dual-schema cast rationale, RESEARCH.md line 661)
**Apply to:** All 4 generators — Sonnet output parsed via v4 schema at SDK boundary, then v3 `.parse()` for authoritative shape check.

```typescript
const response = await anthropic.messages.parse(buildSonnetRequest(prompt));
if (response.parsed_output === null || response.parsed_output === undefined) {
  throw new Error('<dimension>.profile.sonnet: parsed_output is null');
}
const sonnetOut = <DimensionProfileSchemaV3>.parse(response.parsed_output);
```

### Drizzle Sentinel-Row Upsert (Phase 33 D-04)
**Source:** Phase 33 design (CONTEXT.md line 213: "`onConflictDoUpdate` sentinel-row upsert pattern: Phase 33 D-04 documents; precedent in `src/proactive/state.ts`")
**Apply to:** All 4 generators' upsert path (D-29 step 3)

```typescript
await db
  .insert(<profileTable>)
  .values({ name: 'primary', ...upsertValues })
  .onConflictDoUpdate({
    target: <profileTable>.name,
    set: upsertValues,
  });
```

### Write-Before-Upsert (Profile History)
**Source:** D-29 + Phase 33 D-17 (no direct codebase analog — Phase 34 introduces this discipline)
**Apply to:** All 4 generators' SUCCESS path ONLY (D-29 final clause: "On a no-change skip (D-15 hash match) NO history row is written")

```typescript
// 1. Read current row (the prevState used for previous-state injection)
const [currentRow] = await db.select().from(<profileTable>).where(eq(<profileTable>.name, 'primary'));

// 2. Insert profile_history snapshot
await db.insert(profileHistory).values({
  profileTableName: '<table_name_string>',
  profileId: currentRow.id,
  snapshot: currentRow,  // full jsonb including metadata
});

// 3. Upsert new row (sentinel pattern above)
await db.insert(<profileTable>).values({ name: 'primary', ...upsertValues }).onConflictDoUpdate({...});
```

### vitest Mock Hoisting (Common Test Scaffolding)
**Source:** `src/rituals/__tests__/weekly-review.test.ts:39-77`
**Apply to:** All Phase 34 mocked-SDK tests (`generators.sparse.test.ts`, `generators.two-cycle.test.ts`, `profile-updater.test.ts`)

```typescript
const { mockAnthropicParse, mockLoggerInfo, mockLoggerWarn } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
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

vi.mock('../../utils/logger.js', () => ({
  logger: { info: mockLoggerInfo, warn: mockLoggerWarn, error: vi.fn(), debug: vi.fn() },
}));
```

---

## No Analog Found

Files with no close match in the codebase:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/memory/profile-updater.ts` (Promise.allSettled fan-out) | service / orchestrator | event-driven | No existing orchestrator uses `Promise.allSettled` with discriminated outcomes. Existing parallel-fetch (`Promise.all` at `weekly-review-sources.ts:425`) lacks failure isolation. Planner drafts from D-21 spec + Pattern Catalog. |
| `src/memory/profiles/__tests__/refine.test.ts` (closure-captured `.refine()` test) | test / unit | n/a | No codebase precedent for Zod `.refine()` with closure-captured external state (`entryCount`). RESEARCH.md residual risk lines 938-941 flags this as a verification gap; planner drafts test from scratch. |
| `src/memory/__tests__/profile-updater.test.ts` (Promise.allSettled isolation) | test / integration | n/a | Closest analog (`cron-registration.test.ts:98-117`) tests single-handler try/catch, not multi-promise allSettled. Planner drafts the per-dimension fault-injection pattern from scratch. |

For these three files, the planner should reference RESEARCH.md §Pattern 5 + §Implementation Risks (lines 938-941) directly rather than mirroring a codebase analog.

---

## Trivial Extensions

These two files are self-analog (extension of their own existing patterns) — the planner just adds new it-blocks following the existing scaffolding:

- **`src/rituals/__tests__/cron-registration.test.ts`** — extend the existing `describe('registerCrons', ...)` block with 4 new test cases per D-38; mirror the `'registers the ritual sweep cron'` it-block at lines 48-65 verbatim, substituting `ritualSweepCron → profileUpdaterCron` and adding `runProfileUpdate: vi.fn()` to all existing deps objects (TypeScript will flag the missing field across the 4 existing tests until added).
- **`src/__tests__/config.test.ts`** — add a new sibling `describe('config: cron.validate fail-fast (M010 GEN-01 profileUpdaterCron)', ...)` block mirroring the existing RIT-12 block at lines 18-52 verbatim, substituting env-var names per D-39.

---

## Metadata

**Analog search scope:**
- `src/rituals/` (M009 weekly_review — primary precedent)
- `src/episodic/` (M008 episodic consolidate — secondary precedent)
- `src/memory/profiles/` (Phase 33 — substrate being consumed)
- `src/cron-registration.ts`, `src/config.ts`, `src/index.ts` (Phase 25 — cron infrastructure)
- `src/__tests__/`, `src/rituals/__tests__/`, `src/memory/__tests__/` (test scaffolding)
- `src/db/schema.ts` (enum + table verification)
- `src/pensieve/retrieve.ts` (tag-filter API verification per OQ-1)
- `src/chris/personality.ts` (CONSTITUTIONAL_PREAMBLE export verification)

**Files scanned:** 22 source files inspected; 8 read in detail for excerpt extraction
**Codebase HEAD verified:** `720bccc` (current `main` per gitStatus)
**Pattern extraction date:** 2026-05-12

---

## PATTERN MAPPING COMPLETE

**Phase:** 34 - Inference Engine (M010 Operational Profiles)
**Files classified:** 18 (13 new + 5 modified)
**Analogs found:** 17 / 18 exact-or-role-match; 1 file (`profile-updater.ts` Promise.allSettled fan-out) has NO direct codebase analog and is composed from three precedents.

### Coverage
- Files with exact analog: 12 (prompt builder, substrate loader, all 5 modified files, 4 test files, config.ts and cron-registration.ts extensions)
- Files with role-match analog: 5 (4 dimension generators + sparse-fixture test + two-cycle test)
- Files with no analog: 3 (orchestrator + refine.test.ts + profile-updater.test.ts)

### Key Patterns Identified
- **Pure-function prompt builders return either `string` (M009 style) or `{system, user}` pair (Phase 34 D-03).** All start with `CONSTITUTIONAL_PREAMBLE.trimEnd()` and end with a structured-output directive.
- **All Sonnet calls use the identical SDK boundary shape** (`messages.parse({system: [{type:'text', text, cache_control:{type:'ephemeral'}}], output_config: {format: zodOutputFormat(v4 as unknown as any)}})`) — M008 + M009 set this convention; Phase 34's 4 generators mirror it verbatim.
- **v3-after-v4 re-validation** is the codebase contract: v4 schema at the SDK boundary (JSON-schema emission), v3 schema at the authoritative shape check (post-parse).
- **CRON-01 belt-and-suspenders** is universal: every cron handler in `cron-registration.ts` wraps the body in try/catch logging `<channel>.cron.error`. Phase 34 extends with `profile.cron.error`.
- **`Promise.allSettled` discriminated outcomes** is a NEW pattern for Phase 34 (no codebase precedent uses it); generators NEVER throw, they return `{outcome: 'profile_generation_failed', ...}` — the orchestrator handles the `'rejected'` case for defense-in-depth only.
- **Substrate-hash idempotency via SHA-256 of canonical-JSON IDs+dates+schemaVersion** (D-15) is the M009 `lt→lte` lesson re-applied at the substrate level — the two-cycle test (HARD CO-LOC #M10-3) is the regression detector.
- **Sentinel-row upsert via `onConflictDoUpdate({target: <table>.name, ...})`** is the Phase 33 contract that Phase 34 generators consume; write-before-upsert (history snapshot before main upsert) is a NEW discipline introduced by Phase 34 D-29 with no codebase precedent.
- **Test scaffolding is uniform across mocked-SDK tests:** `vi.hoisted({mockAnthropicParse, ...})` factory + `vi.mock('../../llm/client.js', ...)` ESM partial-spread + Docker-Postgres `beforeAll/beforeEach/afterEach` cleanup pattern. All 3 new Phase 34 test files inherit this shape verbatim.

### File Created
`.planning/phases/34-inference-engine/34-PATTERNS.md`

### Critical Notes for Planner
1. **Path correction:** CONTEXT.md references `src/__tests__/cron-registration.test.ts`, but the existing file is at `src/rituals/__tests__/cron-registration.test.ts` (verified 157 lines on disk). Planner extends the existing file at its current location; do not create a duplicate.
2. **Refine closure-capture warning (RESEARCH.md residual risk lines 938-941):** `entryCount` in the volume-weight `.refine()` is closure-captured; the per-generator v4-with-refine schema MUST be constructed INSIDE the generator function, not at module scope. The `refine.test.ts` unit test exists specifically to catch a future zod/v4 version drift that breaks the JSON-schema emission of refines.
3. **Cycle 3 mutation discriminant (RESEARCH.md residual risk lines 932-935):** Two-cycle test's Cycle 3 MUST insert a NEW Pensieve entry (changing the ID set), NOT mutate an existing entry's text content (the hash is ID-only). Planner explicitly notes this in the Plan 34-02 task description.

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns in PLAN.md files for plans 34-01, 34-02, 34-03.
