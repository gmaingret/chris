# Phase 34: Inference Engine — Research

**Researched:** 2026-05-12
**Domain:** LLM-driven structured inference, Promise-allSettled orchestration, SHA-256 substrate idempotency, 4th-cron registration, write-before-upsert with profile_history
**Confidence:** HIGH (all findings grounded in direct codebase inspection — M008 episodic + M009 weekly-review precedents + Phase 33 as-built artifacts; no speculative web sources)

---

## Summary

Phase 34 is the inference engine that turns Phase 33's seeded substrate into Sonnet-generated structured profiles. The implementation has **zero new dependencies**, mirrors the M009 `weekly-review.ts` pure-function-prompt + `messages.parse` + zodOutputFormat + retry-loop pattern, and adds exactly one 4th cron alongside the existing four (proactive, ritual, ritualConfirmation, episodic). The 41 decisions locked in `34-CONTEXT.md` resolve every gray area; the only items requiring phase-level resolution here are the two open questions — both narrow.

The five load-bearing constraints from the milestone research are already in Phase 33's substrate: `substrate_hash text NOT NULL DEFAULT ''` (seed-row '' guarantees first-fire regen), `schema_version int NOT NULL DEFAULT 1` (participates in the hash → schema bumps invalidate cache), `data_consistency real` is a column AND a Zod v3/v4 schema field at the SDK boundary, `profile_history` table exists with `profile_table_name` + `profile_id` polymorphic discriminator, and `name='primary'` is the `ON CONFLICT` upsert sentinel. The generator's job is purely to write the inference; the schema does all the heavy lifting structurally.

**Primary recommendation:** Mirror `src/rituals/weekly-review.ts` almost verbatim for the per-dimension generator body. Same SDK call shape (`anthropic.messages.parse({model: SONNET_MODEL, system: [{type:'text', text: prompt, cache_control: {type:'ephemeral'}}], messages: [...], output_config: {format: zodOutputFormat(v4Schema as unknown as any)}})`), same v3-after-v4-parse re-validation discipline, same `buildSonnetRequest()` pure-function extraction for test mocking. Skip the M009 Stage-2 Haiku judge — Phase 34's only refinement is the volume-weight ceiling Zod `.refine()` overlay (D-32), and it lives inside the v4 schema at the SDK boundary, not as a separate LLM call.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Sunday 22:00 cron tick | Node host (node-cron) | — | Background data pipeline, no user-facing UX; mirrors existing 4 crons in `src/cron-registration.ts` |
| Substrate loading (Pensieve tag filter + episodic range + decisions) | Application — Drizzle/Postgres | — | All three readers already exist; thin composition in `src/memory/profiles/shared.ts` |
| Sonnet inference call | Anthropic SDK boundary | Application (v3 re-validate) | Same v3/v4 dual pattern as M008 consolidate + M009 weekly-review; cast at SDK boundary, v3 is the contract |
| Substrate-hash computation | Application — pure function | — | SHA-256 over canonical-JSON of IDs+dates+schema_version; deterministic, no I/O |
| Threshold + skip-if-match short-circuits | Application — per-generator | — | Both gates run inside each generator before the Sonnet call |
| `Promise.allSettled` fan-out | Application — orchestrator | — | Per-dimension error isolation, 4× wall-clock improvement vs sequential |
| profile_history snapshot write | Database — Drizzle insert | — | App-level discipline; no FK (polymorphic profile_id) |
| Upsert via `name='primary'` sentinel | Database — `onConflictDoUpdate` | — | Phase 33 D-04 precedent (`src/proactive/state.ts`) |
| `/health` field surface | Express handler in `src/index.ts` | Module-scoped `cronStatus` | One-line addition to the existing response shape |

---

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Plan split (D-01, D-02):**
- 3 plans, strict ordering: 34-01 (prompt builder + structural test) → 34-02 (4 generators + substrate + hash + two-cycle test) → 34-03 (orchestrator + cron + config + /health)
- 34-01 MUST ship before 34-02 (HARD CO-LOC #M10-2)
- Substrate-hash logic + two-cycle test MUST ship in the same plan (HARD CO-LOC #M10-3)

**Shared prompt builder (D-03..D-07):**
- `assembleProfilePrompt(dimension, substrate, prevState, entryCount)` in `src/memory/profile-prompt.ts`
- Pure function, returns `{system, user}` pair; mirrors M009 `assembleWeeklyReviewPrompt`
- `dimension` typed as `'jurisdictional' | 'capital' | 'health' | 'family'`
- CONSTITUTIONAL_PREAMBLE re-imported from `src/chris/personality.ts`; first section of `system`
- New `DO_NOT_INFER_DIRECTIVE` constant exported
- Volume-weight ceiling text: prompt tells Sonnet to emit `data_consistency: number(0-1)`, NOT `confidence`; host computes final
- Previous-state injection block when prevState non-null, with "3+ supporting entries to change a high-confidence field" instruction

**Per-dimension generators (D-08..D-11):**
- 4 files in `src/memory/profiles/{jurisdictional,capital,health,family}.ts`, identical shape
- Each exports `generate<Dimension>Profile(deps): Promise<ProfileGenerationOutcome>`
- Body: load substrate → check threshold → compute hash → skip-if-match → call Sonnet → parse v4 → re-validate v3 → write history snapshot → upsert
- Model: `SONNET_MODEL` (from `src/llm/client.ts`)
- Discriminated outcome: `{dimension, outcome: 'profile_updated' | 'profile_skipped_no_change' | 'profile_below_threshold' | 'profile_generation_failed', error?, entryCount?, confidence?, durationMs}`

**Substrate loader (D-12..D-14):**
- `src/memory/profiles/shared.ts` exports `loadProfileSubstrate(): Promise<ProfileSubstrate>`
- Returns `{pensieveEntries, episodicSummaries, decisions, entryCount}`
- Pensieve filter: tags FACT, RELATIONSHIP, INTENTION, EXPERIENCE only
- Episodic via existing `getEpisodicSummariesRange(start, end)` over **last 60 days**
- Decisions: `status='resolved'` filtered over last 60 days
- `entryCount = pensieveEntries.length` (Pensieve count gates the threshold; episodic summaries are derived)
- Called ONCE per fire, shared object across all 4 generators

**Substrate-hash idempotency (D-15..D-18):**
- `computeSubstrateHash(substrate, prevStateMeta): string`
- SHA-256 of canonicalJSON({pensieveIds: sorted, episodicDates: sorted, decisionIds: sorted, schemaVersion})
- Per-dimension comparison against `profile.substrate_hash` column
- Phase 33 seed-row `substrate_hash = ''` always triggers regen (empty never matches a real SHA-256)

**Threshold enforcement (D-19, D-20):**
- Check happens BEFORE substrate-hash computation (cheaper short-circuit)
- `entryCount < 10` → log `'chris.profile.threshold.below_minimum'` (verbatim — GEN-06 names this), return `{outcome: 'profile_below_threshold'}`
- NO Sonnet call

**Orchestrator (D-21..D-23):**
- `Promise.allSettled` invocation; per-generator failure isolated
- NO retry loop within a fire; weekly cadence IS the retry
- Returns void / fire-and-forget; outcomes via logs only

**Cron registration (D-24..D-28):**
- 4th cron, `'0 22 * * 0'`, `{timezone: config.proactiveTimezone}` ('Europe/Paris')
- `config.profileUpdaterCron` env var with `validatedCron` fail-fast
- `CronRegistrationStatus.profileUpdate: 'registered' | 'failed'` added
- `RegisterCronsDeps.runProfileUpdate: () => Promise<void>` added
- `/health` response gains `profile_cron_registered: status.profileUpdate === 'registered'`
- Wired into `src/index.ts:89` `registerCrons({...})` deps

**profile_history write-before-upsert (D-29, D-30):**
- Success path only: (1) read current row, (2) insert profile_history row with full jsonb snapshot, (3) upsert via `onConflictDoUpdate({target: <table>.name, ...})`
- NO history row on hash-skip path
- Full row snapshot, not diff

**Schemas (D-31..D-33):**
- v4 schemas from Phase 33 `src/memory/profiles/schemas.ts` consumed verbatim
- Volume-weight ceiling: Zod v4 `.refine()` overlay rejecting `data_consistency > 0.5 && entryCount < 20`
- Per-field source citation (`sources: uuid[]`) DEFERRED to v2.5.1

**Logging (D-34):**
- Discriminated log keys: `chris.profile.<outcome>` per outcome value
- Threshold case names verbatim `chris.profile.threshold.below_minimum`
- Aggregate orchestrator log: `'chris.profile.cron.complete'` with per-dimension outcome counts

**Test strategy (D-35..D-40):**
- Structural test in Plan 34-01
- Two-cycle Docker-Postgres + mocked Anthropic integration test in Plan 34-02 (HARD CO-LOC #M10-3)
- Sparse-fixture test in Plan 34-02
- Cron registration test + config fail-fast test in Plan 34-03
- NO live Sonnet calls in Phase 34 (Phase 36 PTEST-05)

### Claude's Discretion

- Helper extraction within generators (`runProfileGenerator(config, deps)` in `shared.ts`) — recommended if duplication is mechanical
- Substrate window length — 60 days default; planner may tune to 90 if Phase 33 ground-truth seed suggests
- Canonical-JSON helper choice — reuse existing `src/utils/`, add `fast-json-stable-stringify` if already transitive, or hand-roll
- Dimension-specific directive content — draft in plan 34-01 alongside `DO_NOT_INFER_DIRECTIVE`

### Deferred Ideas (OUT OF SCOPE)

- Per-field `sources: uuid[]` arrays in Sonnet output (v2.5.1)
- Per-dimension substrate views (single shared substrate object stays in v1)
- Optional Haiku post-check after Sonnet output (v2.5.1)
- SATURATION constant tuning (post-ship, OQ-5)
- Per-field confidence (M013)
- `/profile` Telegram command + mode-handler injection (Phase 35)
- m010-30days + m010-5days primed fixtures + live 3-of-3 anti-hallucination test (Phase 36)

---

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GEN-01 | Sunday 22:00 Paris cron registered; `profileUpdaterCron` env validated; `/health` reports `profile_cron_registered` | §4 Cron Registration API — exact `cron.schedule(...)` site identified; §4 Config Fail-Fast — exact `validatedCron(...)` pattern shown |
| GEN-02 | `updateAllOperationalProfiles()` orchestrator via `Promise.allSettled` | §3 Pattern Catalog — orchestrator template + M008 episodic cron error-isolation precedent |
| GEN-03 | 4 per-dimension generators load substrate + call Sonnet + upsert | §3 Pattern Catalog — `messages.parse + zodOutputFormat` call site from M008/M009 reproduced verbatim; §4 Pensieve Tag-Filter API — `hybridSearch` with `tags` already exists |
| GEN-04 | `assembleProfilePrompt(dimension, substrate, prevState, entryCount)` shared builder | §3 Pattern Catalog — M009 `assembleWeeklyReviewPrompt` pure-function shape mirrored; §5 OQ-2 — confidence calibration prompt phrasing drafted |
| GEN-05 | `computeProfileConfidence` + `isAboveThreshold` + thresholds — Phase 33 shipped | Already shipped — `src/memory/confidence.ts`; Phase 34 imports |
| GEN-06 | 10-entry threshold short-circuits Sonnet call; logs `'chris.profile.threshold.below_minimum'` | D-19+D-20 lock the contract; §3 Pattern Catalog shows the call shape |
| GEN-07 | SHA-256 substrate hash idempotency | §3 Pattern Catalog — canonical JSON computation + comparison shape; §5 two-cycle test design |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.x (per project standard) |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `bash scripts/test.sh src/memory/__tests__/profile-prompt.test.ts` |
| Full suite command | `bash scripts/test.sh` (Docker Postgres on port 5433 + vitest full run) |
| Phase gate | Full Docker test suite green before `/gsd-verify-work` (per CLAUDE.md memory: "Always run full Docker tests") |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GEN-04 | `assembleProfilePrompt` output contains CONSTITUTIONAL_PREAMBLE + DO_NOT_INFER_DIRECTIVE for all 4 dimensions | structural (pure-function, no DB/mocks) | `bash scripts/test.sh src/memory/__tests__/profile-prompt.test.ts` | ❌ Plan 34-01 creates |
| GEN-04 | Previous-state injection present when prevState non-null, absent when null | structural | same | ❌ Plan 34-01 |
| GEN-04 | Volume-weight ceiling phrasing present in all 4 dimensions | structural | same | ❌ Plan 34-01 |
| GEN-02 | `updateAllOperationalProfiles` isolates per-generator failure (simulated throw on one of four) | integration (mocked Sonnet, one generator throws) | `bash scripts/test.sh src/memory/__tests__/profile-updater.test.ts` | ❌ Plan 34-03 |
| GEN-06 | `entryCount < 10` short-circuits before Sonnet call (sparse fixture) | integration (real Docker Postgres + mocked Sonnet; `expect(mockAnthropicParse).not.toHaveBeenCalled()`) | `bash scripts/test.sh src/memory/profiles/__tests__/generators.sparse.test.ts` | ❌ Plan 34-02 |
| GEN-07 | SHA-256 substrate hash skip on identical input (two-cycle) | integration: Cycle 1 (4 calls) → `vi.setSystemTime(+7d)` → Cycle 2 identical substrate (still 4 total calls, not 8) → Cycle 3 mutated substrate (8 calls total) | `bash scripts/test.sh src/memory/profiles/__tests__/generators.two-cycle.test.ts` | ❌ Plan 34-02 (HARD CO-LOC #M10-3) |
| GEN-07 | profile_history row count = 4 after Cycle 1, still 4 after Cycle 2 (no row on skip), 5 after Cycle 3 (one update) | integration row-count assertion | same | ❌ Plan 34-02 |
| GEN-01 | Cron registered with `'0 22 * * 0'` + `Europe/Paris` + correct status field | unit (vi.mock node-cron, spy on schedule) | `bash scripts/test.sh src/rituals/__tests__/cron-registration.test.ts` | ✓ EXISTS at `src/rituals/__tests__/cron-registration.test.ts` — Plan 34-03 EXTENDS with new test cases |
| GEN-01 | `/health` reports `profile_cron_registered: true` after registration | unit (createApp with injected cronStatus) | `bash scripts/test.sh src/__tests__/index.health.test.ts` (or extension to existing health test) | partial — `createApp` exists; new test or extension to `cron-registration.test.ts` |
| GEN-01 | Config fail-fast on invalid `profileUpdaterCron` env | unit (env-var cache-bust pattern) | `bash scripts/test.sh src/__tests__/config.test.ts` | ✓ EXISTS at `src/__tests__/config.test.ts` — Plan 34-03 EXTENDS with new test cases |
| (overlay) | Volume-weight ceiling Zod refine rejects inflated `data_consistency` | unit (schemas.test.ts or generator-internal v4 refine test) | `bash scripts/test.sh src/memory/profiles/__tests__/schemas.test.ts` (existing from Phase 33) | partial — Phase 33 schemas test exists; Plan 34-02 ADDS `.refine()` overlay AT SDK BOUNDARY in the generator file, not on the v3 schema |

### Sampling Rate

- **Per task commit:** `bash scripts/test.sh <affected-test-file>` (single test file, ~5–15s)
- **Per wave merge:** `bash scripts/test.sh src/memory/` + `bash scripts/test.sh src/rituals/__tests__/cron-registration.test.ts` + config test (~30s)
- **Phase gate:** Full Docker suite green — per CLAUDE.md memory, all 1412 passed + 53 skipped target

### Wave 0 Gaps

- [ ] `src/memory/__tests__/profile-prompt.test.ts` — covers GEN-04 (Plan 34-01)
- [ ] `src/memory/profiles/__tests__/generators.sparse.test.ts` — covers GEN-06 (Plan 34-02)
- [ ] `src/memory/profiles/__tests__/generators.two-cycle.test.ts` — covers GEN-07 (Plan 34-02)
- [ ] `src/memory/__tests__/profile-updater.test.ts` — covers GEN-02 (Plan 34-03)
- [ ] No framework install needed (vitest already configured)

---

## Pattern Catalog — Code Excerpts from M009 + M008 Precedents

These are the verbatim shapes the planner specifies in each task. Line numbers anchor to the code state on 2026-05-12 (current `main` HEAD `22793b4`).

### Pattern 1: Pure-function prompt builder (M009 `assembleWeeklyReviewPrompt`)

**Source:** `src/rituals/weekly-review-prompt.ts:144-188`

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

**Phase 34 mirror — `assembleProfilePrompt` shape:**

```typescript
// src/memory/profile-prompt.ts (Plan 34-01)
import { CONSTITUTIONAL_PREAMBLE } from '../chris/personality.js';
import type { ProfileSubstrate } from './profiles/shared.js';

export type ProfilePromptDimension = 'jurisdictional' | 'capital' | 'health' | 'family';

export type AssembledProfilePrompt = { system: string; user: string };

export function assembleProfilePrompt(
  dimension: ProfilePromptDimension,
  substrate: ProfileSubstrate,
  prevState: unknown | null,      // typed in plan; jsonb shape per dimension
  entryCount: number,
): AssembledProfilePrompt {
  const systemSections: string[] = [];

  // 1. CONSTITUTIONAL_PREAMBLE (D-04 + M010-06 first section anchor)
  systemSections.push(CONSTITUTIONAL_PREAMBLE.trimEnd());

  // 2. Role preamble — operational profile inference framing
  systemSections.push(buildRolePreamble(dimension));

  // 3. DO_NOT_INFER_DIRECTIVE (D-05; M010-02 mitigation)
  systemSections.push(DO_NOT_INFER_DIRECTIVE);

  // 4. Volume-weight ceiling phrasing (D-06; M010-01 mitigation)
  systemSections.push(buildVolumeWeightCeilingDirective(entryCount));

  // 5. Previous-state injection (D-07; M010-03 mitigation; conditional)
  if (prevState !== null) {
    systemSections.push(buildPreviousStateBlock(prevState, dimension));
  }

  // 6. Dimension-specific directive (Claude's Discretion in CONTEXT.md)
  systemSections.push(getDimensionSpecificDirective(dimension));

  // 7. Substrate block — last so schema directive immediately follows
  systemSections.push(buildSubstrateBlock(substrate));

  // 8. Structured-output directive — LAST
  systemSections.push(buildStructuredOutputDirective(dimension));

  return {
    system: systemSections.join('\n\n'),
    user: `Generate the operational profile for ${dimension}.`,
  };
}
```

**Required structural test assertions (D-35 in CONTEXT.md):**
- `system.startsWith('## Core Principles (Always Active)')` for all 4 dimensions
- `system.includes(DO_NOT_INFER_DIRECTIVE)` for all 4 dimensions
- `system.includes('data_consistency')` (volume-weight phrasing — uses the field name)
- `prevState=null` → `!system.includes('## CURRENT PROFILE STATE')`
- `prevState!=null` → `system.includes('## CURRENT PROFILE STATE')`

### Pattern 2: messages.parse + zodOutputFormat call site (M009 buildSonnetRequest)

**Source:** `src/rituals/weekly-review.ts:372-395`

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

**Source:** `src/episodic/consolidate.ts:129-183` — same shape, slightly more aggressive retry policy:

```typescript
async function callSonnetWithRetry(
  prompt: string,
): Promise<EpisodicSummarySonnetOutput> {
  const buildRequest = () => ({
    model: SONNET_MODEL,
    max_tokens: MAX_TOKENS,  // 2000
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
        content: 'Generate the episodic summary for this day.',
      },
    ],
    output_config: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      format: zodOutputFormat(EpisodicSummarySonnetOutputSchemaV4 as unknown as any),
    },
  });
  // ... first attempt + one retry on any throw
}
```

**Phase 34 application (per-generator, e.g. jurisdictional.ts):**

```typescript
// src/memory/profiles/jurisdictional.ts (Plan 34-02)
import { JurisdictionalProfileSchemaV3, JurisdictionalProfileSchemaV4 } from './schemas.js';

const JURISDICTIONAL_PROFILE_CONFIG = {
  dimension: 'jurisdictional' as const,
  v3Schema: JurisdictionalProfileSchemaV3,
  v4Schema: JurisdictionalProfileSchemaV4,   // overlay .refine() at SDK boundary
  table: profileJurisdictional,
  dimensionSpecificDirective: '...',          // drafted in Plan 34-01
};

async function callSonnetForProfile(prompt: AssembledProfilePrompt): Promise<unknown> {
  const response = await anthropic.messages.parse({
    model: SONNET_MODEL,
    max_tokens: 2000,
    system: [{ type: 'text' as const, text: prompt.system, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user' as const, content: prompt.user }],
    output_config: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      format: zodOutputFormat(JURISDICTIONAL_PROFILE_CONFIG.v4SchemaWithRefine as unknown as any),
    },
  });
  if (response.parsed_output === null || response.parsed_output === undefined) {
    throw new Error('jurisdictional.profile.sonnet: parsed_output is null');
  }
  return response.parsed_output;
}
```

**Why no Stage-2 Haiku judge:** M009's Stage-2 judge counts distinct questions to enforce a one-question contract. Phase 34 has no analogous structural property to verify post-Sonnet that isn't already captured by the v4 Zod refine. The `.refine()` is the host-side defense; one Sonnet call per dimension is sufficient.

### Pattern 3: v3-after-v4 re-validation (M008 episodic + M009 weekly-review)

**Source:** `src/rituals/weekly-review.ts:434`

```typescript
// 2. v3 re-validation runs Stage-1 .refine() — throws ZodError on multi-question
const sonnetOut = WeeklyReviewSchema.parse(response.parsed_output);
```

**Phase 34 application:**

```typescript
// In the generator after callSonnetForProfile:
const sonnetOut = JURISDICTIONAL_PROFILE_CONFIG.v3Schema.parse(rawOutput);
// v3 is the authoritative shape check; v4 is the SDK-boundary JSON-Schema emitter
```

### Pattern 4: Substrate loader (M009 `loadWeeklyReviewContext`)

**Source:** `src/rituals/weekly-review-sources.ts:214-260`

```typescript
export async function loadWeeklyReviewContext(
  weekStart: Date,
  weekEnd: Date,
): Promise<WeeklyReviewContext> {
  const wellbeingStartStr = formatLocalDate(weekStart, config.proactiveTimezone);
  const wellbeingEndStr = formatLocalDate(weekEnd, config.proactiveTimezone);

  const [summaries, resolvedDecisions, snapshots] = await Promise.all([
    getEpisodicSummariesRange(weekStart, weekEnd),
    db
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.status, 'resolved'),
          gte(decisions.resolvedAt, weekStart),
          lte(decisions.resolvedAt, weekEnd),
        ),
      )
      .orderBy(asc(decisions.resolvedAt)),
    db
      .select()
      .from(wellbeingSnapshots)
      .where(
        and(
          gte(wellbeingSnapshots.snapshotDate, wellbeingStartStr),
          lte(wellbeingSnapshots.snapshotDate, wellbeingEndStr),
        ),
      )
      .orderBy(asc(wellbeingSnapshots.snapshotDate)),
  ]);

  return { summaries, resolvedDecisions, wellbeingSnapshots: snapshots, /* ... */ };
}
```

**Phase 34 mirror — `loadProfileSubstrate`:**

```typescript
// src/memory/profiles/shared.ts (Plan 34-02)
export type ProfileSubstrate = {
  pensieveEntries: Array<typeof pensieveEntries.$inferSelect>;
  episodicSummaries: Array<typeof episodicSummaries.$inferSelect>;
  decisions: Array<typeof decisions.$inferSelect>;
  entryCount: number;
};

export const SUBSTRATE_WINDOW_DAYS = 60;  // Claude's Discretion lock (CONTEXT.md)
export const PROFILE_SUBSTRATE_TAGS = ['FACT', 'RELATIONSHIP', 'INTENTION', 'EXPERIENCE'] as const;

export async function loadProfileSubstrate(now: Date = new Date()): Promise<ProfileSubstrate> {
  const windowStart = new Date(now.getTime() - SUBSTRATE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [pensieveRows, episodicRows, decisionRows] = await Promise.all([
    db
      .select()
      .from(pensieveEntries)
      .where(
        and(
          isNull(pensieveEntries.deletedAt),
          inArray(pensieveEntries.epistemicTag, PROFILE_SUBSTRATE_TAGS as unknown as string[]),
          gte(pensieveEntries.createdAt, windowStart),
        ),
      )
      .orderBy(asc(pensieveEntries.createdAt)),
    getEpisodicSummariesRange(windowStart, now),
    db
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.status, 'resolved'),
          gte(decisions.resolvedAt, windowStart),
          lte(decisions.resolvedAt, now),
        ),
      )
      .orderBy(asc(decisions.resolvedAt)),
  ]);

  return {
    pensieveEntries: pensieveRows,
    episodicSummaries: episodicRows,
    decisions: decisionRows,
    entryCount: pensieveRows.length,   // D-20 — Pensieve count gates the threshold
  };
}
```

**Note for planner:** Phase 33's seed data is consumed via `getOperationalProfiles()` (read path), NOT `loadProfileSubstrate()`. The substrate is the *input* to inference, not the prior profile state. Prior state for the previous-state injection comes from the profile rows themselves (D-29 step 1: read current row before insert into profile_history).

### Pattern 5: Two-cycle test (M009 weekly-review.test.ts)

**Source:** `src/rituals/__tests__/weekly-review.test.ts:613-799` — anchors the second-fire-blindness regression detector pattern.

Key shape — single test with `vi.setSystemTime`, `mockAnthropicParse` count assertions across cycles:

```typescript
describe('fireWeeklyReview integration (real DB + mocked Anthropic + mocked bot)', () => {
  beforeAll(async () => { await pgSql`SELECT 1 as ok`; });

  beforeEach(async () => {
    await cleanup();
    mockAnthropicParse.mockReset();
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue({ message_id: 12345 });
    // Anchor "now" inside the fixture week
    vi.setSystemTime(new Date('2026-04-26T20:00:00.000Z'));
  });

  afterEach(() => { vi.useRealTimers(); });

  // ... happy-path test asserts mockAnthropicParse.toHaveBeenCalledTimes(3)
  // (Sonnet + Stage-2 Haiku + date-grounding Haiku)
});
```

**Phase 34 mirror — `generators.two-cycle.test.ts` skeleton:**

```typescript
describe('M010 two-cycle substrate-hash idempotency (HARD CO-LOC #M10-3)', () => {
  beforeEach(async () => {
    await cleanup();
    mockAnthropicParse.mockReset();
    // Seed 12+ Pensieve entries with FACT/RELATIONSHIP/INTENTION/EXPERIENCE tags
    // across all 4 dimensions
    await seedProfileSubstrate(12);
    vi.setSystemTime(new Date('2026-05-17T22:00:00.000Z'));   // first Sunday 22:00
    // Prime mockAnthropicParse to return 4 valid v3-shape profiles
  });

  it('Cycle 1: empty seed → 4 profiles populated; 4 Sonnet calls; profile_history has 4 rows', async () => {
    await updateAllOperationalProfiles();
    expect(mockAnthropicParse).toHaveBeenCalledTimes(4);
    const historyRows = await db.select().from(profileHistory);
    expect(historyRows).toHaveLength(4);
  });

  it('Cycle 2: identical substrate, +7d → 0 new Sonnet calls (still 4 total); profile_history still 4 rows', async () => {
    await updateAllOperationalProfiles();
    vi.setSystemTime(new Date('2026-05-24T22:00:00.000Z'));
    // SAME substrate — no insert/delete between cycles
    await updateAllOperationalProfiles();
    expect(mockAnthropicParse).toHaveBeenCalledTimes(4);   // NOT 8
    const historyRows = await db.select().from(profileHistory);
    expect(historyRows).toHaveLength(4);  // No new snapshots on hash-skip
    // All 4 outcomes are 'profile_skipped_no_change'
  });

  it('Cycle 3: mutate one Pensieve entry → 1 dimension regens (5 total); 1 new profile_history row', async () => {
    await updateAllOperationalProfiles();
    vi.setSystemTime(new Date('2026-05-24T22:00:00.000Z'));
    await mutateOnePensieveEntryForDimension('jurisdictional');
    await updateAllOperationalProfiles();
    expect(mockAnthropicParse).toHaveBeenCalledTimes(5);   // 4 cycle 1 + 1 cycle 2 regen
    // Other 3 outcomes were 'profile_skipped_no_change'
  });
});
```

### Pattern 6: ON CONFLICT DO UPDATE upsert (Phase 33 D-04, src/proactive/state.ts precedent)

The Phase 33 `name='primary'` sentinel column is the `onConflictDoUpdate` target. Phase 34 generator's success-path upsert:

```typescript
// In the generator success path (after profile_history insert):
const upsertValues = {
  schemaVersion: 1,
  substrateHash: computedHash,
  confidence: hostComputedConfidence,           // from computeProfileConfidence
  dataConsistency: sonnetOut.data_consistency,  // from Sonnet output
  ...flattenedJsonbFields,                       // per-dimension columns
  lastUpdated: new Date(),
};

await db
  .insert(profileJurisdictional)
  .values({ name: 'primary', ...upsertValues })
  .onConflictDoUpdate({
    target: profileJurisdictional.name,
    set: upsertValues,
  });
```

---

## API Surface Inventory — What Exists vs What's Needed

### Pensieve tag-filter API (OQ-1 RESOLUTION)

**EXISTS — no wrapper needed.** Phase 33 RESEARCH cited `hybridSearch` but the relevant pattern for substrate loading is plain Drizzle (no semantic search, just a WHERE filter on `epistemic_tag`). The pattern is well-established:

```typescript
// src/pensieve/retrieve.ts:208-214 — already proven WHERE pattern
const conditions = [isNull(pensieveEntries.deletedAt)];
if (options.tags && options.tags.length > 0) {
  conditions.push(
    inArray(pensieveEntries.epistemicTag, options.tags),
  );
}
```

`inArray` is the **OR semantics across multiple tags** — matches any row where `epistemic_tag ∈ {FACT, RELATIONSHIP, INTENTION, EXPERIENCE}`. This is exactly what GEN-03 needs. **No new wrapper required**; the substrate loader inlines the Drizzle query.

**PensieveTag enum verified** (`src/db/schema.ts:31-46`):
```typescript
export const epistemicTagEnum = pgEnum('epistemic_tag', [
  'FACT', 'EMOTION', 'BELIEF', 'INTENTION', 'EXPERIENCE',
  'PREFERENCE', 'RELATIONSHIP', 'DREAM', 'FEAR', 'VALUE',
  'CONTRADICTION', 'OTHER', 'DECISION', 'RITUAL_RESPONSE',
]);
```

All four tags (FACT, RELATIONSHIP, INTENTION, EXPERIENCE) exist verbatim. The `PROFILE_SUBSTRATE_TAGS` constant uses these exact case-sensitive strings.

### Episodic summaries range API

**EXISTS — verbatim from M008.** `src/pensieve/retrieve.ts:390-433`:

```typescript
export async function getEpisodicSummariesRange(
  from: Date,
  to: Date,
): Promise<(typeof episodicSummaries.$inferSelect)[]>
```

Already consumed by M009's `weekly-review-sources.ts:222`. Inclusive-on-both-bounds. Tz-aware via `formatLocalDate(date, config.proactiveTimezone)`. **No changes needed**.

### Decisions reader

**EXISTS implicitly** — `decisions` table has `status` enum with `'resolved'` value (`src/db/schema.ts:84-93`) and `resolvedAt` column. Phase 34's substrate loader inlines the query (`src/rituals/weekly-review-sources.ts:223-233` shows the exact pattern). **No new wrapper needed**.

### Anthropic SDK call signature

**Verified via direct inspection (`src/rituals/weekly-review.ts:372-395` and `src/episodic/consolidate.ts:129-158`).** Both use the IDENTICAL shape:

```typescript
{
  model: SONNET_MODEL,
  max_tokens: <2000>,
  system: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: '<user prompt>' }],
  output_config: {
    format: zodOutputFormat(v4Schema as unknown as any),  // SDK type/runtime mismatch cast
  },
}
```

The `cache_control: { type: 'ephemeral' }` on the system block is the prompt-caching opt-in — important for cost (the dimensional substrate is large and stable across the 4 calls per fire). Per CONTEXT.md D-32 the volume-weight ceiling is the v4 `.refine()` overlay; this requires a per-generator schema variant rather than the bare Phase 33 schema. The exact pattern:

```typescript
const JurisdictionalSchemaV4WithRefine = JurisdictionalProfileSchemaV4.refine(
  (out) => !(out.data_consistency > 0.5 && entryCount < 20),
  { message: 'M010-01 volume-weight ceiling: data_consistency > 0.5 requires entryCount >= 20' },
);
```

⚠️ **Critical caveat:** `zod/v4`'s `.refine()` is applied at JSON-schema emission AND at parse time. The SDK's `zodOutputFormat()` passes the refine through to JSON-schema as a description-level constraint; if Sonnet violates it, the Anthropic SDK raises a parse failure that the generator catches → returns `'profile_generation_failed'` (D-22: no retry within fire). The retry IS the next week's cron.

⚠️ **`entryCount` is closure-captured.** The refine reads `entryCount` from the calling scope; this means the per-generator v4 schema is constructed INSIDE the generator function, not as a module-level constant. The planner needs to specify this in the plan task or the structural test will not catch this constraint.

### Cron Registration API (`src/cron-registration.ts`)

**EXISTS — extension only.** Current shape (verbatim from `src/cron-registration.ts:22-45`):

```typescript
export interface CronRegistrationStatus {
  proactive: 'registered' | 'failed';
  ritual: 'registered' | 'failed';
  ritualConfirmation: 'registered' | 'failed';
  episodic: 'registered' | 'failed';
  sync: 'registered' | 'failed' | 'disabled';
}

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

**Phase 34 extension (Plan 34-03):**

```typescript
export interface CronRegistrationStatus {
  proactive: 'registered' | 'failed';
  ritual: 'registered' | 'failed';
  ritualConfirmation: 'registered' | 'failed';
  episodic: 'registered' | 'failed';
  sync: 'registered' | 'failed' | 'disabled';
  profileUpdate: 'registered' | 'failed';   // ← NEW (D-26)
}

export interface RegisterCronsDeps {
  config: {
    proactiveSweepCron: string;
    ritualSweepCron: string;
    episodicCron: string;
    syncIntervalCron: string;
    proactiveTimezone: string;
    profileUpdaterCron: string;             // ← NEW (D-25)
  };
  runSweep: () => Promise<unknown>;
  runRitualSweep: () => Promise<unknown>;
  runConsolidateYesterday: () => Promise<void>;
  ritualConfirmationSweep: () => Promise<number | void>;
  runProfileUpdate: () => Promise<void>;    // ← NEW (D-26)
  runSync?: () => Promise<void>;
}
```

**New `cron.schedule` block (placed at the end of `registerCrons` body, after the episodic block at lines 142-158):**

```typescript
// M010 Phase 34 GEN-01 — Sunday 22:00 Paris profile updater cron.
// 2h gap after weekly_review at Sunday 20:00 (M010-04 timing-collision mitigation).
// CRON-01 try/catch belt-and-suspenders.
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

**Status initialization (line 57-63 extension):**

```typescript
const status: CronRegistrationStatus = {
  proactive: 'failed',
  ritual: 'failed',
  ritualConfirmation: 'failed',
  episodic: 'failed',
  sync: deps.runSync ? 'failed' : 'disabled',
  profileUpdate: 'failed',   // ← NEW
};
```

### Config field

**EXISTS — extension only.** Pattern (`src/config.ts:53-78`) for adding a new `validatedCron` field:

```typescript
// Existing precedent — verbatim line 73:
ritualSweepCron: validatedCron('RITUAL_SWEEP_CRON', '* * * * *'),

// Phase 34 addition:
profileUpdaterCron: validatedCron('PROFILE_UPDATER_CRON', '0 22 * * 0'),
```

`validatedCron` throws `Error: config: invalid PROFILE_UPDATER_CRON expression "..."` on a bad value at module load — this is the D-25 fail-fast contract.

### /health endpoint

**EXISTS at `src/index.ts:25-70`.** Current response shape (verbatim line 64-69):

```typescript
res.status(statusCode).json({
  status: overallStatus,
  checks,
  ritual_cron_registered: effectiveCronStatus?.ritual === 'registered',
  timestamp: new Date().toISOString(),
});
```

**Phase 34 addition (D-27, GEN-01 names this key verbatim):**

```typescript
res.status(statusCode).json({
  status: overallStatus,
  checks,
  ritual_cron_registered: effectiveCronStatus?.ritual === 'registered',
  profile_cron_registered: effectiveCronStatus?.profileUpdate === 'registered',   // ← NEW
  timestamp: new Date().toISOString(),
});
```

**Wiring site at `src/index.ts:89-95`:**

```typescript
cronStatus = registerCrons({
  config,
  runSweep,
  runRitualSweep,
  runConsolidateYesterday,
  ritualConfirmationSweep,
  runProfileUpdate: () => updateAllOperationalProfiles(),   // ← NEW (D-28)
});
```

The `updateAllOperationalProfiles` import is added to the top of `src/index.ts` alongside the other handler imports.

### CONSTITUTIONAL_PREAMBLE export

**EXISTS at `src/chris/personality.ts:30-40`.** First line is `'## Core Principles (Always Active)'` — this is the structural-test anchor (D-04 — `system.startsWith('## Core Principles (Always Active)')`).

The constant ends with a trailing `\n\n` (line 40). M009's `weekly-review-prompt.ts:154` calls `.trimEnd()` before pushing; Phase 34 should mirror this.

---

## OQ-1 Resolution: Pensieve domain-filter strategy

**Q:** How does `loadProfileSubstrate()` filter Pensieve entries for the 4 profile dimensions?

**Recommendation (D-12+D-13 locked):** Tag-only filter, no keyword/semantic filtering. Use `inArray(pensieveEntries.epistemicTag, ['FACT', 'RELATIONSHIP', 'INTENTION', 'EXPERIENCE'])` directly in `loadProfileSubstrate`. Pass the SAME substrate to all 4 generators; per-dimension filtering happens inside the prompt builder's `dimensionSpecificDirective` (Claude's Discretion in CONTEXT.md), where each dimension's directive tells Sonnet "focus on X-relevant entries; ignore the rest."

**Verification of API support:** `inArray` is the OR-semantics operator in Drizzle (`src/pensieve/retrieve.ts:212` shows the exact usage — `inArray(pensieveEntries.epistemicTag, options.tags)`). The tag-filter API surface is fully available WITHOUT a new wrapper. The pattern lives inline in `loadProfileSubstrate` (`src/memory/profiles/shared.ts`, created in Plan 34-02).

**No wrapper needed.** The Pensieve substrate read is one query per fire (not 4); the per-dimension narrowing is Sonnet's job via the directive.

**Upgrade path (deferred to v2.5.1):** If Phase 36 fixture tests show Sonnet output contaminated by irrelevant tags (e.g., the jurisdictional profile picks up family-related entries because they happen to be RELATIONSHIP-tagged), the planner adds a keyword filter on top of the tag filter. This is the v2.5.1 OQ-1 upgrade lane, NOT a Phase 34 task.

---

## OQ-2 Resolution: Confidence calibration prompt phrasing

**Q:** What exact text does Sonnet see for the host-computes-confidence-from-data_consistency hybrid model (D-06)?

**Recommended phrasing (drafted here; locked in Plan 34-01):**

```text
## Confidence Calibration

You will report ONE field that quantifies how internally consistent the substrate
is for this profile dimension:

  `data_consistency`: a number between 0.0 and 1.0 inclusive.

  - 0.0 = substrate entries contradict each other; no coherent picture emerges
  - 0.3 = substrate is sparse OR contains a few aligned facts surrounded by noise
  - 0.5 = substrate paints a moderately coherent picture; minor inconsistencies present
  - 0.7 = substrate is clear and aligned across multiple distinct entries
  - 1.0 = substrate is highly consistent across many distinct entries with no contradictions

CRITICAL — you DO NOT emit a `confidence` field. The host application computes
the final `confidence` value from a formula combining `data_consistency` (your
output) and the count of substrate entries (a SQL aggregate the host already
knows). Do NOT attempt to compute or guess the entry count. Do NOT output a
`confidence` field of any kind — your output schema does not include one.

HARD CONSTRAINT — volume-weight ceiling:
  - When the substrate has fewer than 20 entries, your `data_consistency` value
    MUST NOT exceed 0.5. Reporting 0.7 on a 15-entry substrate would be rejected
    by the host as confidence inflation.
  - When 20–49 entries, `data_consistency` MAY range freely in 0.0..1.0.
  - When 50+ entries, `data_consistency` MAY range freely in 0.0..1.0.
```

**Why this phrasing:**
- Names the EXACT field name (`data_consistency`) that appears in the v3/v4 schemas at `src/memory/profiles/schemas.ts:43-44, 92-93, 149-150, 209-210`
- Explicitly forbids `confidence` in the output (Sonnet would otherwise be tempted to emit it; the v4 Zod schema doesn't include `confidence` but Sonnet sometimes hallucinates extra fields)
- Names the volume-weight ceiling at 0.5 (matching D-32's `.refine()` rejection rule: `data_consistency > 0.5 && entryCount < 20`)
- Educates Sonnet about what `data_consistency` semantically means at each band — reduces hallucination from "high agreement" → "high data_consistency" without warrant
- Tells Sonnet the host computes the final confidence — removes Sonnet's incentive to inflate

**Structural test expected substrings (D-35):**
- `system.includes('data_consistency')` — true for all 4 dimensions
- `system.includes('DO NOT emit a `confidence` field')` — true (host-computes)
- `system.includes('fewer than 20 entries')` — true (volume-weight phrasing)
- `system.includes('MUST NOT exceed 0.5')` — true

---

## Implementation Risks

All M010 PITFALLS items relevant to Phase 34 are mitigated by locked CONTEXT.md decisions. Residual flags below.

### M010-02 (Hallucinated profile facts) — RESIDUAL RISK

**Mitigation:** DO_NOT_INFER_DIRECTIVE (D-05), Constitutional preamble first section (D-04), schema strictness (Phase 33 .strict() on v3 schemas).

**Deferred:** Per-field `sources: uuid[]` arrays (D-33 explicitly deferred). Phase 34 ships WITHOUT source citation — the directive is the only anti-hallucination control. Phase 36 PTEST-05 quantifies the residual hallucination rate against real Sonnet.

**Risk if wrong:** Sonnet emits plausible inferences as facts; Greg notices via `/profile` (Phase 35) or via REFLECT-mode injection (Phase 35). Phase 34 cannot detect this — only Phase 36's live 3-of-3 test can. **Acceptable tradeoff per D-33 frugality argument.**

### M010-04 (Cron timing collision) — FULLY MITIGATED

Sunday 22:00 Paris (D-24); 2h gap after weekly_review at 20:00. Worst-case weekly_review retry duration ~120s; profile updater starts 7200s later. No overlap. **Verified by precedent — same pattern at `src/cron-registration.ts:142-158` (episodic 23:00).**

### M010-06 (Four-prompt drift) — FULLY MITIGATED

Shared `assembleProfilePrompt()` (D-03). Structural test asserts all 4 dimensions produce output containing the same anchor substrings (D-35). HARD CO-LOC #M10-2 enforced at plan-checker level (Plan 34-02 refused if 34-01 incomplete).

### M010-09 (Double-update idempotency) — FULLY MITIGATED

Substrate-hash column already in Phase 33 schema. SHA-256 of canonical-JSON IDs+dates+schema_version (D-15). Skip path emits `'profile_skipped_no_change'` (D-22). Two-cycle test verifies (D-36).

### M010-10 (First-fire celebration blindness) — FULLY MITIGATED

The M009 lt→lte lesson is the direct cause of D-36's two-cycle test design. Cycle 2 with identical substrate asserts `mockAnthropicParse.toHaveBeenCalledTimes(4)` (not 8) — proving the second-fire path skips Sonnet, not re-fires it. HARD CO-LOC #M10-3 forces the test into the same plan as the generator.

### M010-11 (JSONB schema evolution) — PARTIALLY ADDRESSED

Phase 33 shipped `schema_version`. Phase 34 includes `schema_version` in the substrate hash (D-16) — bumping the schema invalidates ALL hashes → forces regen on next fire. **Risk:** if Phase 34 schemas drift from Phase 33 schemas (e.g., adding an enum value to `HealthProfileSchemaV3.open_hypotheses.status`), backward-compat is preserved by the reader's PROFILE_SCHEMAS dispatcher (`src/memory/profiles.ts:64-69`). Phase 34 does NOT introduce a v2 schema. **Acceptable; not a Phase 34 task.**

### NEW residual risk: Cycle-3 mutation test discriminant

The two-cycle test as drafted in D-36 includes a Cycle 3 with a mutated Pensieve entry. The hash is computed over `pensieveIds.sort()` + `episodicDates.sort()` + `decisionIds.sort()` (D-15). **A mutation that changes only a Pensieve entry's CONTENT (not its ID) leaves the hash unchanged.** The Cycle 3 test must INSERT a new Pensieve entry or DELETE an existing one (changing the ID set), not mutate an existing entry's text.

**Action for planner:** Clarify in Plan 34-02 task description that the Cycle 3 mutation is an INSERT of a new tagged entry, NOT a text-content mutation. Update the test assertion accordingly.

### NEW residual risk: Anthropic SDK type/runtime cast

The `format: zodOutputFormat(v4Schema as unknown as any)` cast is required because the SDK's `.d.ts` types accept zod v3 but the runtime requires zod v4 (`src/episodic/consolidate.ts:148-156` JSDoc documents this). The `.refine()` overlay on the v4 schema (D-32) interacts with this cast. **Verify during Plan 34-02 implementation** that `.refine()` on a zod/v4 schema preserves the JSON-schema emission shape — if it doesn't, the volume-weight ceiling is silently dropped from what Sonnet sees, and only host-side parse-failure catches violations.

**Recommended test:** add an assertion in `profile-prompt.test.ts` or `generators.test.ts` that the v4 refined schema's `safeParse({data_consistency: 0.7, entryCount: 15})` returns `success: false`. This catches a future zod/v4 version drift that breaks the refine semantics.

---

## Test Strategy Mapping (Nyquist Dimension 8 coverage)

| Behavior | Test Type | Plan | File | Notes |
|----------|-----------|------|------|-------|
| 1. `assembleProfilePrompt` output structural shape (CONSTITUTIONAL_PREAMBLE + DO_NOT_INFER + volume-weight for 4 dims) | structural unit (pure-function) | 34-01 | `src/memory/__tests__/profile-prompt.test.ts` | Parametrized over `'jurisdictional' | 'capital' | 'health' | 'family'`; mirrors `src/rituals/__tests__/weekly-review-prompt.test.ts` |
| 2. `updateAllOperationalProfiles` Promise.allSettled isolation (one generator throws, other three succeed) | integration (real DB, mocked SDK) | 34-03 | `src/memory/__tests__/profile-updater.test.ts` | Mock one generator to throw; assert other 3 outcomes are 'profile_updated' and orchestrator returns void without rethrow |
| 3. `entryCount < 10` short-circuits before Sonnet call | integration (real DB sparse fixture, mocked SDK) | 34-02 | `src/memory/profiles/__tests__/generators.sparse.test.ts` | 5-Pensieve-entry seed; `expect(mockAnthropicParse).not.toHaveBeenCalled()`; all 4 outcomes = 'profile_below_threshold'; log assertion on `'chris.profile.threshold.below_minimum'` |
| 4. SHA-256 substrate hash skip (Cycle 1 + Cycle 2 identical + Cycle 3 mutated) | integration (real DB, mocked SDK, `vi.setSystemTime`) | 34-02 (HARD CO-LOC #M10-3) | `src/memory/profiles/__tests__/generators.two-cycle.test.ts` | Cycle 1: 4 calls. Cycle 2 (same substrate): still 4. Cycle 3 (new Pensieve entry inserted): 5+. profile_history row count: 4 → 4 → 5 |
| 5. Cron registration with `'0 22 * * 0'` + Europe/Paris + status.profileUpdate + runProfileUpdate wiring + /health field | unit (vi.mock node-cron, spy) | 34-03 | `src/rituals/__tests__/cron-registration.test.ts` EXTENSION | New 'it' block; pattern at lines 48-65 of the existing file |
| 6. Config fail-fast on invalid `PROFILE_UPDATER_CRON` env | unit (env-var cache-bust pattern) | 34-03 | `src/__tests__/config.test.ts` EXTENSION | New describe block; pattern at lines 31-52 of the existing file |
| 7. Volume-weight ceiling Zod refine rejects inflated `data_consistency` | unit (Zod safeParse against synthetic Sonnet output) | 34-02 | inside `generators.two-cycle.test.ts` or new `schemas-refine.test.ts` | Verify `JurisdictionalSchemaV4.refine(...).safeParse({data_consistency: 0.7, ...}, entryCount=15)` returns `success: false`. NOTE: `entryCount` is closure-captured; test must construct the refined schema with the same closure shape the generator does |
| 8. profile_history write-before-upsert on success path; no row on hash-skip | integration row-count assertion | 34-02 | `generators.two-cycle.test.ts` | Cycle 1 → 4 rows; Cycle 2 (skip) → still 4 rows; Cycle 3 (one regen) → 5 rows |

---

## Pattern Catalog — Logging Conventions

Mirrors M008/M009 convention (`logger.info({ ...fields }, 'chris.<channel>.<event>')`):

| Event | Key | Fields |
|-------|-----|--------|
| Generator success | `chris.profile.profile_updated` | dimension, entryCount, confidence, durationMs |
| Hash-skip path | `chris.profile.profile_skipped_no_change` | dimension, substrateHashPrefix |
| Below-threshold | `chris.profile.threshold.below_minimum` (verbatim — GEN-06 names) | dimension, entryCount, threshold (=10) |
| Generator failure | `chris.profile.profile_generation_failed` | dimension, error, durationMs |
| Aggregate cron complete | `chris.profile.cron.complete` | counts: {updated, skipped, belowThreshold, failed} |
| Cron handler exception | `profile.cron.error` | err |

The `'profile.cron.error'` key (NOT prefixed with `chris.`) matches the existing `episodic.cron.error` / `rituals.cron.error` / `sync.cron.error` convention at `src/cron-registration.ts:73, 92, 110, 131, 149`. Lower-cased dotted; `chris.*` prefix is for application-domain events; bare lowercase is for infrastructure error logging.

---

## Standard Stack

### Core (no new deps, no version bumps)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | ^0.90.0 | `messages.parse` + `zodOutputFormat` SDK boundary | M008 + M009 precedent; v3/v4 dual schema pattern |
| `zod` | ^3.24.0 + `zod/v4` sub-path | v3 contract + v4 SDK-boundary schemas | Established dual-schema pattern; Phase 33 schemas already in place |
| `drizzle-orm` | 0.45.2 | Substrate reads + `onConflictDoUpdate` upsert | `jsonb().$type<T>()` already proven in Phase 33 |
| `node-cron` | ^4.2.1 | 4th cron `'0 22 * * 0'` | 4 existing crons; same `cron.schedule(...)` API |
| `node:crypto` | Node 22 built-in | SHA-256 for substrate hash | Zero deps; `createHash('sha256').update(json).digest('hex')` |

### Canonical-JSON helper (Claude's Discretion)

**Recommendation: hand-roll a sort-keys serializer (5–10 lines).** Reasoning:
- The substrate hash inputs are a closed-shape object: `{pensieveIds: string[], episodicDates: string[], decisionIds: string[], schemaVersion: number}`. The sort-keys requirement is trivially satisfied by JS object key insertion order if the object is constructed with keys in alphabetical order.
- `fast-json-stable-stringify` is NOT a transitive dep (verified via `npm ls fast-json-stable-stringify` — adding would mean a new direct dep).
- A 10-line helper in `src/memory/profiles/shared.ts` is cheaper than the dep footprint.

Sketch (planner refines in Plan 34-02):

```typescript
function canonicalSubstrateJson(input: {
  pensieveIds: string[];
  episodicDates: string[];
  decisionIds: string[];
  schemaVersion: number;
}): string {
  // Sort each array independently; ensure key order is alphabetical
  const canon = {
    decisionIds: [...input.decisionIds].sort(),
    episodicDates: [...input.episodicDates].sort(),
    pensieveIds: [...input.pensieveIds].sort(),
    schemaVersion: input.schemaVersion,
  };
  return JSON.stringify(canon);
}

export function computeSubstrateHash(
  substrate: ProfileSubstrate,
  schemaVersion: number,
): string {
  const json = canonicalSubstrateJson({
    pensieveIds: substrate.pensieveEntries.map((e) => e.id),
    episodicDates: substrate.episodicSummaries.map((s) => s.summaryDate),
    decisionIds: substrate.decisions.map((d) => d.id),
    schemaVersion,
  });
  return createHash('sha256').update(json).digest('hex');
}
```

### Version verification

```bash
$ npm view @anthropic-ai/sdk version    # check that 0.90.x still current as of plan-write date
$ npm view zod version                  # check 3.24.x line
$ npm view drizzle-orm version          # check 0.45.x line
$ npm view node-cron version            # check 4.2.x line
```

(Skipped for this research pass — no version bumps proposed; M008/M009 precedents anchor the versions. Planner does NOT need to re-verify unless changing a version.)

---

## Architecture Patterns

### System Architecture Diagram

```
Sunday 22:00 Paris cron tick (node-cron, src/cron-registration.ts)
    │
    ▼
runProfileUpdate() — deps wiring from src/index.ts
    │
    ▼
updateAllOperationalProfiles()                    src/memory/profile-updater.ts
    │
    │  loadProfileSubstrate(now)  [ONCE, shared across all 4 generators]
    │  └── Drizzle reads: pensieve_entries (tag-filtered 4-way OR + isNull(deletedAt) + last 60d)
    │  └──               + episodic_summaries (getEpisodicSummariesRange — last 60d)
    │  └──               + decisions (status='resolved' + last 60d)
    │  └── Returns: { pensieveEntries, episodicSummaries, decisions, entryCount }
    │
    ▼
Promise.allSettled([
    generateJurisdictionalProfile(deps, substrate),
    generateCapitalProfile(deps, substrate),
    generateHealthProfile(deps, substrate),
    generateFamilyProfile(deps, substrate),
])
    │
    │  Each generator (mechanical body — D-08; identical except for config object):
    │    1. entryCount < 10? → log 'chris.profile.threshold.below_minimum' → return 'profile_below_threshold'
    │    2. computeSubstrateHash(substrate, schemaVersion)
    │    3. Read current profile row (for substrate_hash comparison + prevState injection)
    │    4. hash matches profile.substrate_hash? → log 'profile_skipped_no_change' → return 'profile_skipped_no_change'
    │    5. assembleProfilePrompt(dimension, substrate, prevState, entryCount)  → {system, user}
    │    6. anthropic.messages.parse({ model: SONNET_MODEL, ... format: zodOutputFormat(v4WithRefine as unknown as any) })
    │    7. v3 re-validation: <dimension>ProfileSchemaV3.parse(response.parsed_output)
    │    8. computeProfileConfidence(entryCount, sonnetOut.data_consistency)
    │    9. INSERT profile_history (profile_table_name, profile_id, snapshot) — full-row snapshot of CURRENT row
    │   10. db.insert(<profileTable>).values(newRow).onConflictDoUpdate({target: <table>.name, set: newRow})
    │   11. log 'chris.profile.profile_updated' → return 'profile_updated'
    │
    ▼
Aggregate per-dimension outcomes → logger.info({ summary }, 'chris.profile.cron.complete')
    │
    ▼
Cron handler returns; node-cron waits for next Sunday 22:00 Paris.
```

### Recommended File Structure

```
src/
├── memory/
│   ├── confidence.ts                  # Phase 33 — UNCHANGED (Phase 34 imports)
│   ├── profiles.ts                    # Phase 33 — UNCHANGED (Phase 34 does NOT consume this reader)
│   ├── profile-prompt.ts              # Plan 34-01 NEW: assembleProfilePrompt, DO_NOT_INFER_DIRECTIVE
│   ├── profile-updater.ts             # Plan 34-03 NEW: updateAllOperationalProfiles orchestrator
│   ├── profiles/
│   │   ├── schemas.ts                 # Phase 33 — UNCHANGED (Phase 34 imports v3+v4 schemas)
│   │   ├── shared.ts                  # Plan 34-02 NEW: ProfileSubstrate, loadProfileSubstrate, computeSubstrateHash, runProfileGenerator helper (optional)
│   │   ├── jurisdictional.ts          # Plan 34-02 NEW
│   │   ├── capital.ts                 # Plan 34-02 NEW
│   │   ├── health.ts                  # Plan 34-02 NEW
│   │   └── family.ts                  # Plan 34-02 NEW
│   └── __tests__/
│       ├── profile-prompt.test.ts     # Plan 34-01 structural test
│       └── profile-updater.test.ts    # Plan 34-03 orchestrator test
├── memory/profiles/__tests__/
│   ├── generators.sparse.test.ts      # Plan 34-02 sparse-fixture test
│   └── generators.two-cycle.test.ts   # Plan 34-02 two-cycle test (HARD CO-LOC #M10-3)
├── cron-registration.ts               # Plan 34-03 EDIT: add profileUpdate to status + deps + cron.schedule block
├── config.ts                          # Plan 34-03 EDIT: add profileUpdaterCron field
├── index.ts                           # Plan 34-03 EDIT: add runProfileUpdate to registerCrons deps + /health field
├── rituals/__tests__/
│   └── cron-registration.test.ts      # Plan 34-03 EDIT: add new test cases for profile cron + /health
└── __tests__/
    └── config.test.ts                 # Plan 34-03 EDIT: add fail-fast test for PROFILE_UPDATER_CRON
```

### Anti-Patterns to Avoid

- **Routing through ritual subsystem.** Researched and rejected in ARCHITECTURE.md Q1 + already locked in CONTEXT.md. Use 4th cron, NOT `rituals` row.
- **Mega-prompt for all 4 profiles.** Each profile is a distinct domain; one Sonnet call per dimension is the locked decision.
- **Delta updates.** Full regeneration on every fire (locked in ARCHITECTURE.md Q3).
- **Consumer-side threshold check.** Threshold is enforced inside the generator before the Sonnet call (D-19), NOT inside `getOperationalProfiles()` (Phase 33 reader doesn't gate; it just returns null on schema mismatch).
- **In-loop retry.** D-22 explicitly forbids — weekly cadence IS the retry. No exponential backoff, no second attempt in the same fire.
- **Sequential `await` loop.** D-21 explicitly mandates `Promise.allSettled` for per-dimension error isolation.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SHA-256 hashing | Custom hash function | `node:crypto.createHash('sha256')` | Built into Node 22; well-tested; constant time on equal-length inputs |
| JSON canonicalization | Recursive object walker | Hand-rolled 10-line helper (Claude's Discretion) OR existing `fast-json-stable-stringify` if transitive | Tradeoff frame: dep footprint vs maintenance. Closed-shape inputs make hand-roll safe |
| Promise concurrency | `for (const p of promises) { await p }` | `Promise.allSettled([...])` | D-21 locked; per-dimension error isolation + 4x wall-clock improvement |
| Cron expression validation | `regex match` | `node-cron`'s `validate()` (already used by `validatedCron` helper) | `src/config.ts:20-26` pattern; same fail-fast contract |
| Sonnet structured output parsing | Custom JSON.parse + manual field checks | `anthropic.messages.parse` + `zodOutputFormat(v4)` | M008/M009 precedent; safer + version-agnostic |
| Substrate ordering for hash | Custom sort | `[...arr].sort()` over IDs/dates | UUIDs are string-sortable; ISO dates are string-sortable; deterministic |

---

## Common Pitfalls

### Pitfall 1: `vi.setSystemTime` interaction with Drizzle createdAt defaults

**What goes wrong:** Test sets `vi.setSystemTime(+7d)` to simulate Cycle 2, but the test's `seedProfileSubstrate` helper inserts Pensieve entries whose `createdAt` defaults to `now()` AT INSERT TIME. The first cycle's seeded entries get the cycle-1 timestamp; the second cycle re-uses the same entries (no new inserts) so the substrate IDs are identical. Hash matches → skip path. Correct.

**Why it happens:** The test design correctly uses NO new inserts in Cycle 2. Cycle 3 must INSERT a new entry (NOT mutate an existing one) to change the ID set — see "NEW residual risk" above.

**How to avoid:** Plan 34-02 Cycle 3 task says: "Insert ONE new Pensieve entry with `epistemicTag: 'FACT'`, `createdAt` within the 60-day window from Cycle 2's now-anchor. Re-run `updateAllOperationalProfiles()`. Assert: total Sonnet calls = 5 (not 4), profile_history rows = 5 (one new snapshot)."

### Pitfall 2: Closure-captured entryCount in v4 refine

**What goes wrong:** A naive implementation puts the v4 schema with refine at module top-level:

```typescript
// WRONG — entryCount is undefined at module load
const JurisdictionalSchemaV4WithRefine = JurisdictionalProfileSchemaV4.refine(
  (out) => !(out.data_consistency > 0.5 && entryCount < 20),  // entryCount is ReferenceError
);
```

**Why it happens:** `entryCount` is a per-fire value (substrate-dependent), not a module-level constant.

**How to avoid:** Construct the refined schema INSIDE the generator function:

```typescript
async function generateJurisdictionalProfile(deps, substrate) {
  const entryCount = substrate.entryCount;
  const v4WithRefine = JurisdictionalProfileSchemaV4.refine(
    (out) => !(out.data_consistency > 0.5 && entryCount < 20),
    { message: 'M010-01 volume-weight ceiling' },
  );
  // ... call Sonnet with v4WithRefine
}
```

**Warning sign:** A test passes an arbitrary `entryCount` to a module-level refined schema and the refine doesn't fire. Reject the implementation; refactor.

### Pitfall 3: schema_version in hash but not in upsert values

**What goes wrong:** D-15 specifies `schemaVersion` participates in the hash. D-16 specifies a schema bump invalidates all cached hashes. But if the generator's upsert sets `schemaVersion: 1` (a constant from Phase 33's seed) instead of reading the CURRENT row's `schemaVersion` and incrementing on actual schema migration, future schema bumps will silently not propagate.

**Why it happens:** Phase 34 only has schema_version=1; the lack of a migration-bump path means the bug is invisible until Phase 35+ adds v2.

**How to avoid:** Plan 34-02 task explicitly: the generator's upsert sets `schemaVersion: PROFILE_SCHEMA_VERSION` (a named constant exported from `src/memory/profiles/schemas.ts` — `export const PROFILE_SCHEMA_VERSION = 1`). A future schema bump changes this constant once. The hash includes it; upsert writes it.

⚠️ **Phase 33 has not yet exported this constant.** Plan 34-02 must add the export to `src/memory/profiles/schemas.ts` (one-line addition).

### Pitfall 4: Sonnet emitting `confidence` field despite schema not asking for it

**What goes wrong:** Sonnet ignores the prompt's "DO NOT emit a `confidence` field" instruction and emits one anyway. The v4 Zod schema doesn't include `confidence`, so the SDK's parse_output may silently drop it OR raise a parse failure (depending on SDK version's strict-mode default).

**Why it happens:** Sonnet has been trained on profile-data templates that include confidence; OQ-2's directive may be insufficient.

**How to avoid:** Verify in the structural test that the v4 schema (as emitted via `zodOutputFormat`) does NOT include `confidence` in its JSON-schema. If Sonnet emits an extra field anyway, the v3 strict-mode schema at re-validation throws a ZodError, the generator catches it and returns `'profile_generation_failed'`.

**Warning sign:** Generator outcomes show `'profile_generation_failed'` with error messages like "Unrecognized key(s) in object: 'confidence'" — confirms Sonnet ignored the directive. The retry IS next week's cron (D-22).

### Pitfall 5: Threshold check using episodic count instead of Pensieve count

**What goes wrong:** A generator implementation reads `substrate.episodicSummaries.length` or `substrate.episodicSummaries.length + substrate.pensieveEntries.length` as the threshold input. The 10-entry threshold then trips on episodic counts (derived data) rather than Pensieve facts.

**Why it happens:** Aggregating counts feels more inclusive.

**How to avoid:** D-20 locks: `entryCount = pensieveEntries.length`. The generator reads `substrate.entryCount` (which was set by `loadProfileSubstrate` to exactly this value — see Pattern 4 above). The structural test in Plan 34-01 should also verify that the prompt builder's volume-weight phrasing uses `entryCount` not `summaryCount`.

---

## Code Examples — Verified Patterns

### Pensieve substrate query (inlined in `loadProfileSubstrate`)

Source: `src/pensieve/retrieve.ts:208-228` adapted for substrate use:

```typescript
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { pensieveEntries } from '../../db/schema.js';

const tagFilter = inArray(
  pensieveEntries.epistemicTag,
  ['FACT', 'RELATIONSHIP', 'INTENTION', 'EXPERIENCE'] as const as unknown as string[],
);

const rows = await db
  .select()
  .from(pensieveEntries)
  .where(and(
    isNull(pensieveEntries.deletedAt),
    tagFilter,
    gte(pensieveEntries.createdAt, windowStart),
  ))
  .orderBy(asc(pensieveEntries.createdAt));
```

### Discriminated outcome type (mirrors M008 ConsolidateResult)

Source: `src/episodic/consolidate.ts:95-98`:

```typescript
export type ConsolidateResult =
  | { inserted: true; id: string }
  | { skipped: 'existing' | 'no-entries' }
  | { failed: true; error: unknown };
```

**Phase 34 application:**

```typescript
export type ProfileGenerationOutcome =
  | { dimension: ProfilePromptDimension; outcome: 'profile_updated'; entryCount: number; confidence: number; durationMs: number }
  | { dimension: ProfilePromptDimension; outcome: 'profile_skipped_no_change'; entryCount: number; durationMs: number }
  | { dimension: ProfilePromptDimension; outcome: 'profile_below_threshold'; entryCount: number; durationMs: number }
  | { dimension: ProfilePromptDimension; outcome: 'profile_generation_failed'; error: unknown; entryCount: number; durationMs: number };
```

### Orchestrator skeleton

```typescript
// src/memory/profile-updater.ts (Plan 34-03)
import { loadProfileSubstrate } from './profiles/shared.js';
import { generateJurisdictionalProfile } from './profiles/jurisdictional.js';
import { generateCapitalProfile } from './profiles/capital.js';
import { generateHealthProfile } from './profiles/health.js';
import { generateFamilyProfile } from './profiles/family.js';
import { logger } from '../utils/logger.js';

export async function updateAllOperationalProfiles(): Promise<void> {
  const startMs = Date.now();
  logger.info({}, 'chris.profile.cron.start');

  let substrate: Awaited<ReturnType<typeof loadProfileSubstrate>>;
  try {
    substrate = await loadProfileSubstrate();
  } catch (err) {
    logger.error({ err }, 'chris.profile.cron.substrate_load_failed');
    return;
  }

  const results = await Promise.allSettled([
    generateJurisdictionalProfile({ substrate }),
    generateCapitalProfile({ substrate }),
    generateHealthProfile({ substrate }),
    generateFamilyProfile({ substrate }),
  ]);

  const counts = { updated: 0, skipped: 0, belowThreshold: 0, failed: 0 };
  for (const result of results) {
    if (result.status === 'rejected') {
      counts.failed += 1;
      logger.error({ err: result.reason }, 'chris.profile.cron.generator_rejected');
      continue;
    }
    switch (result.value.outcome) {
      case 'profile_updated':         counts.updated += 1; break;
      case 'profile_skipped_no_change': counts.skipped += 1; break;
      case 'profile_below_threshold': counts.belowThreshold += 1; break;
      case 'profile_generation_failed': counts.failed += 1; break;
    }
  }

  logger.info(
    { counts, durationMs: Date.now() - startMs },
    'chris.profile.cron.complete',
  );
}
```

### profile_history write-before-upsert skeleton

```typescript
// Inside a generator's success path (Plan 34-02)
import { profileHistory, profileJurisdictional } from '../../db/schema.js';

// Step 1: read CURRENT row (before changes)
const [currentRow] = await db
  .select()
  .from(profileJurisdictional)
  .where(eq(profileJurisdictional.name, 'primary'))
  .limit(1);

// Step 2: insert profile_history snapshot
if (currentRow) {
  await db.insert(profileHistory).values({
    profileTableName: 'profile_jurisdictional',
    profileId: currentRow.id,
    snapshot: currentRow as unknown as Record<string, unknown>,   // full-row jsonb snapshot
  });
}

// Step 3: upsert via name='primary' sentinel
const newValues = {
  schemaVersion: PROFILE_SCHEMA_VERSION,
  substrateHash: computedHash,
  confidence: hostComputedConfidence,
  dataConsistency: sonnetOut.data_consistency,
  currentCountry: sonnetOut.current_country,
  physicalLocation: sonnetOut.physical_location,
  // ... rest of fields per dimension
  lastUpdated: new Date(),
};

await db
  .insert(profileJurisdictional)
  .values({ name: 'primary', ...newValues })
  .onConflictDoUpdate({
    target: profileJurisdictional.name,
    set: newValues,
  });
```

---

## State of the Art

| Old Approach (pre-M010) | Current Approach (M010 Phase 34) | When Changed | Impact |
|--------------------------|----------------------------------|--------------|--------|
| No profile layer; Chris treats Greg as a blank slate every conversation | 4 operational profiles updated weekly + injected into REFLECT/COACH/PSYCHOLOGY | Phase 33-36 | Mode handlers receive grounded context, NOT just memory dump |
| Confidence inferred ad-hoc per call | Host-computed via `computeProfileConfidence(entryCount, dataConsistency)` from Phase 33 helpers | Phase 33 | Deterministic, testable, tunable post-ship (SATURATION constant) |
| Substrate hash absent (no idempotency) | SHA-256 of canonical-JSON IDs+dates+schema_version | Phase 33 column + Phase 34 logic | Skip redundant Sonnet calls; M010-09/10 mitigation |
| `profile_history` absent | Table shipped in migration 0012 + write-before-upsert in every generator success path | Phase 33 table + Phase 34 logic | Recovery from drift; v2.5.1+ replay capability |

**No deprecated/outdated patterns in this phase** — all referenced APIs are at current versions in active production code.

---

## Assumptions Log

> All factual claims in this research were verified against the codebase or upstream specs (CONTEXT.md decisions, Phase 33 as-built artifacts, M009 weekly-review source). No items tagged `[ASSUMED]`.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | (empty — no unverified claims) | — | — |

**Note on training-data exposure:** The "Anthropic SDK 0.90.0 still uses `messages.parse + zodOutputFormat` with the v4-cast pattern" claim is verified by direct code inspection of `src/episodic/consolidate.ts:148-156` (M008 code) and `src/rituals/weekly-review.ts:389-393` (M009 code) — both shipped between 2026-04 and 2026-05. The pattern is stable as of the codebase HEAD `22793b4`. If a future SDK bump changes the call shape, M008 and M009 will break first; Phase 34 is not the canary.

---

## Open Questions

> All milestone-level open questions (OQ-1, OQ-2) are resolved in §§5 above. OQ-3 (call-site inventory) is Phase 35 pre-work. OQ-4 (synth-pipeline bias determinism) is Phase 36. OQ-5 (SATURATION tuning) is post-ship.

**No remaining Phase 34 blockers.** The 41 locked decisions in CONTEXT.md plus the two resolved OQs leave the planner with a fully-specified scope.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker Postgres 16 + pgvector | Real-DB integration tests (Plan 34-02 two-cycle test, sparse test; Plan 34-03 orchestrator test) | ✓ (existing test infra) | pg16 + pgvector latest | — |
| `node:crypto` (Node 22 built-in) | SHA-256 substrate hash | ✓ | Node 22.x stdlib | — |
| Anthropic API key (`ANTHROPIC_API_KEY` env) | NOT NEEDED for Phase 34 — all Sonnet calls mocked | n/a (mocked) | — | D-40 explicitly excludes live calls |
| Postgres 16 on Proxmox 192.168.1.50 (prod) | Eventual deploy after phase ships | ✓ (existing — verified Phase 33 deploy) | pg16 with migration 0012 applied 2026-05-11 | — |

**No missing dependencies. No fallback paths required.** All infrastructure already in place from Phase 33's deploy.

---

## Sources

### Primary (HIGH confidence — direct codebase inspection on `main` HEAD `22793b4`)

- `src/rituals/weekly-review.ts:1-705` — M009 precedent for `messages.parse + zodOutputFormat`, v3-after-v4 re-validation, `buildSonnetRequest` pure-function extraction, MAX_RETRIES retry loop (NOT mirrored in Phase 34), CRON-01 try/catch
- `src/rituals/weekly-review-prompt.ts:1-363` — M009 precedent for pure-function prompt builder, CONSTITUTIONAL_PREAMBLE section-1 placement, language directive pattern, `.trimEnd()` discipline
- `src/rituals/weekly-review-sources.ts:1-261` — M009 precedent for `Promise.all` substrate fetch composing `getEpisodicSummariesRange` + Drizzle decisions query
- `src/episodic/consolidate.ts:1-220` — M008 precedent for v3/v4 dual schema at SDK boundary, conservative retry policy
- `src/cron-registration.ts:1-162` — full surface area for the 4th-cron registration extension (CronRegistrationStatus, RegisterCronsDeps, cron.schedule block placement)
- `src/index.ts:1-143` — `/health` endpoint shape, registerCrons deps wiring site at line 89, createApp test-injectable cronStatus pattern
- `src/config.ts:1-78` — `validatedCron` helper pattern; `weeklyReviewCron` precedent for adding `profileUpdaterCron`
- `src/pensieve/retrieve.ts:1-433` — `getEpisodicSummariesRange`, `hybridSearch` tag-filter pattern (`inArray(pensieveEntries.epistemicTag, options.tags)`)
- `src/db/schema.ts:31-46, 520-660` — `epistemicTagEnum` values verbatim; 4 profile tables + profile_history shape from Phase 33
- `src/memory/profiles/schemas.ts:1-242` — Phase 33's v3+v4 dual schemas, `data_consistency` field present on all 4 dimensions
- `src/memory/profiles.ts:1-181` — Phase 33's reader (NOT consumed by Phase 34 generators; consumed by integration tests)
- `src/memory/confidence.ts:1-66` — Phase 33's `computeProfileConfidence`, `isAboveThreshold`, MIN_ENTRIES_THRESHOLD=10, SATURATION=50
- `src/chris/personality.ts:30-40` — CONSTITUTIONAL_PREAMBLE export verbatim
- `src/rituals/__tests__/weekly-review.test.ts:1-799` — `vi.setSystemTime` two-cycle pattern, `mockAnthropicParse` counting, real Docker Postgres integration shape
- `src/rituals/__tests__/cron-registration.test.ts:1-157` — vi.mock node-cron + scheduleSpy + validateSpy patterns to extend for Plan 34-03
- `src/__tests__/config.test.ts:1-52` — env-var cache-bust pattern to extend for `PROFILE_UPDATER_CRON` fail-fast test
- `.planning/phases/34-inference-engine/34-CONTEXT.md` — 41 locked decisions (D-01 through D-40); HARD CO-LOC #M10-2 + #M10-3
- `.planning/phases/33-profile-substrate/33-02-SUMMARY.md` — Phase 33 as-built (4 seed rows with substrate_hash=''; reader; helpers)
- `.planning/research/SUMMARY.md` — M010 milestone consolidated; STACK-vs-ARCH conflict resolutions
- `.planning/research/PITFALLS.md` — M010-01 through M010-11 with phase ownership; all Phase 34 items mitigated by locked CONTEXT.md decisions
- `.planning/research/STACK.md` — no new deps confirmed; version inventory verified
- `.planning/research/ARCHITECTURE.md` — execution-model conflict resolved (Promise.allSettled); cron timing (Sunday 22:00 Paris)
- `.planning/REQUIREMENTS.md` — GEN-01 through GEN-07 verbatim
- `.planning/ROADMAP.md` — Phase 34 success criteria 1-5 verbatim; HARD CO-LOC #M10-2, #M10-3
- `.planning/PROJECT.md` — D004, D005, D029, D030, D031, D034, D035, D041

### Secondary (MEDIUM confidence — production incidents + retrospectives)

- M009 second-fire bug fix commit `c76cb86` (2026-05-10) — lt→lte lesson that motivates D-36 two-cycle test design; named in CLAUDE.md memory
- v2.4 RETROSPECTIVE.md — first-fire celebration blindness; cron-context DB-backed language detection lesson (applied as D-13 substrate slice design)

### Tertiary (LOW confidence — none required for this phase)

- (empty — Phase 34 is purely an integration of established codebase patterns; no external research needed)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all patterns at-version-stable in M008/M009 production code
- Architecture: HIGH — all decisions locked in CONTEXT.md; conflict-resolutions documented in SUMMARY.md
- Pattern catalog: HIGH — verbatim code excerpts from current main; line numbers anchored to HEAD `22793b4`
- API surface: HIGH — every "exists" claim verified by direct file read; every "extension" claim shows exact insertion point
- OQ-1 + OQ-2 resolution: HIGH — Pensieve tag-filter verified via inArray + grep; OQ-2 phrasing drafted with exact structural-test-anchor substrings
- Pitfalls: HIGH — 11 M010 pitfalls all addressed; 2 NEW residual risks flagged (Cycle 3 mutation type; closure-captured entryCount)

**Research date:** 2026-05-12
**Valid until:** 2026-06-12 (30 days for stable; codebase is in active development but Phase 34's pattern set is anchored to M008/M009 which are post-deploy stable)
