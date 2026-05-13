# Architecture Research

**Domain:** M011 Psychological Profiles — HEXACO + Schwartz + Attachment integration with M010 operational profile layer
**Researched:** 2026-05-13
**Confidence:** HIGH (all integration points verified from source)

---

## 1. Table Strategy — Locked Answer

**Decision: Single `profile_hexaco` + single `profile_schwartz` + single `profile_attachment`. Each table holds all dimensions as jsonb columns. Mirror the M010 four-table shape exactly.**

Rationale grounded in observed M010 patterns:

- M010 uses one table per profile "domain" (jurisdictional, capital, health, family), not one row per dimension. Each table holds multiple named jsonb columns representing that domain's dimensions.
- The Drizzle schema pattern at `src/db/schema.ts:536-636` declares per-dimension columns with `.$type<T>()` compile-time inference. This gives typed column reads for free, avoids JOIN complexity, and matches the `readOneProfile` reader pattern in `src/memory/profiles.ts:100-152` which does a single `SELECT * FROM table WHERE name='primary'`.
- The "per-dimension rows" alternative (like a 6-row EAV table for HEXACO) would break the `ProfileRow<T>` contract (`src/memory/profiles.ts:41-46`), require a JOIN or six selects in the reader, and cannot use `.$type<T>()` inference without a separate Drizzle table per row shape.
- HEXACO has 6 stable, named dimensions (honesty_humility, emotionality, extraversion, agreeableness, conscientiousness, openness). Schwartz has 10 stable, named values. These are fixed academic constructs — they will not gain new dimensions. The schema-churn risk of wide tables does not apply.

**Resulting table shape for both:**

```
profile_hexaco
  id uuid PK
  name text NOT NULL UNIQUE DEFAULT 'primary'        -- sentinel row pattern
  schema_version int NOT NULL DEFAULT 1              -- never-retrofittable
  substrate_hash text NOT NULL DEFAULT ''            -- idempotency seed
  overall_confidence real NOT NULL DEFAULT 0         -- host-computed aggregate
  word_count_at_last_run int NOT NULL DEFAULT 0      -- 5k-word gate audit trail
  honesty_humility jsonb NOT NULL DEFAULT 'null'     -- {score, confidence, evidence_count}
  emotionality jsonb NOT NULL DEFAULT 'null'
  extraversion jsonb NOT NULL DEFAULT 'null'
  agreeableness jsonb NOT NULL DEFAULT 'null'
  conscientiousness jsonb NOT NULL DEFAULT 'null'
  openness jsonb NOT NULL DEFAULT 'null'
  last_updated timestamptz NOT NULL DEFAULT now()
  created_at timestamptz NOT NULL DEFAULT now()
  CHECK (overall_confidence >= 0 AND overall_confidence <= 1)

profile_schwartz
  id uuid PK
  name text NOT NULL UNIQUE DEFAULT 'primary'
  schema_version int NOT NULL DEFAULT 1
  substrate_hash text NOT NULL DEFAULT ''
  overall_confidence real NOT NULL DEFAULT 0
  word_count_at_last_run int NOT NULL DEFAULT 0
  self_direction jsonb NOT NULL DEFAULT 'null'
  stimulation jsonb NOT NULL DEFAULT 'null'
  hedonism jsonb NOT NULL DEFAULT 'null'
  achievement jsonb NOT NULL DEFAULT 'null'
  power jsonb NOT NULL DEFAULT 'null'
  security jsonb NOT NULL DEFAULT 'null'
  conformity jsonb NOT NULL DEFAULT 'null'
  tradition jsonb NOT NULL DEFAULT 'null'
  benevolence jsonb NOT NULL DEFAULT 'null'
  universalism jsonb NOT NULL DEFAULT 'null'
  last_updated timestamptz NOT NULL DEFAULT now()
  created_at timestamptz NOT NULL DEFAULT now()
  CHECK (overall_confidence >= 0 AND overall_confidence <= 1)

profile_attachment
  id uuid PK
  name text NOT NULL UNIQUE DEFAULT 'primary'
  schema_version int NOT NULL DEFAULT 1
  substrate_hash text NOT NULL DEFAULT ''
  overall_confidence real NOT NULL DEFAULT 0
  word_count_at_last_run int NOT NULL DEFAULT 0
  relational_word_count int NOT NULL DEFAULT 0       -- 2000-word activation gate
  activated boolean NOT NULL DEFAULT false            -- threshold-gate flag
  secure jsonb NOT NULL DEFAULT 'null'               -- {score, confidence, evidence_count}
  anxious jsonb NOT NULL DEFAULT 'null'
  avoidant jsonb NOT NULL DEFAULT 'null'
  last_updated timestamptz NOT NULL DEFAULT now()
  created_at timestamptz NOT NULL DEFAULT now()
  CHECK (overall_confidence >= 0 AND overall_confidence <= 1)
```

Each per-dimension jsonb value shape: `{ score: number (1.0-5.0 for HEXACO, 0.0-1.0 normalized for Schwartz), confidence: number (0.0-1.0), evidence_count: number }`. `evidence_count` enables inter-period consistency tracking without storing raw history.

**Integration point:** `src/db/schema.ts` — add three table exports after `profileFamily` (line 636), before `profileHistory` (line 646). The Drizzle type imports from `src/memory/profiles/schemas.ts` will need matching `HexacoProfileData`, `SchwartzProfileData`, `AttachmentProfileData` types added to that file.

---

## 2. Migration Shape — Locked Answer

**Decision: ONE atomic migration (0013) containing all three tables + Never-Retrofit columns + seed-row INSERTs + profile_history no-op comment.**

Rationale from M010 HARD CO-LOC #M10-1 precedent (observed at `src/db/migrations/0012_operational_profiles.sql:1-10`):

- The M010 migration shipped all 4 operational profile tables atomically in 0012. The schema.ts table defs, migrations/meta/0012_snapshot.json, _journal.json entry, scripts/test.sh psql apply line, and scripts/regen-snapshots.sh cleanup-flag bump all moved together.
- Splitting into 0013/0014/0015 creates three separate test.sh psql apply lines, three journal entries, and three snapshot regeneration cycles — none of which correspond to a meaningful incremental functional boundary. The tables are inert until the generator code fires; schema and generator code must co-deploy anyway.
- profile_history requires NO ALTER TABLE. The table's `profile_table_name text NOT NULL` column at `src/db/schema.ts:651` is freeform text — it already accommodates new table names by design (no FK, per the schema comment at lines 643-645: "No FK on profile_id (polymorphic across 4 profile tables)"). New M011 generators simply write `profile_table_name = 'profile_hexaco'` etc.

**HARD CO-LOCATION candidate for M011 (call it #M11-1):**

Migration 0013 SQL + schema.ts table defs (three new exports) + migrations/meta/0013_snapshot.json + _journal.json entry + scripts/test.sh psql apply line for 0013 + scripts/regen-snapshots.sh cleanup-flag bump + `src/memory/profiles/schemas.ts` new type exports. All ship in the same plan atomically. Any split produces an incoherent intermediate state where the Drizzle ORM cannot see the tables.

**Never-Retrofit columns that must ship in 0013 (not addable later without a new migration cycle):**

- `schema_version int NOT NULL DEFAULT 1` — same as M010 PITFALL M010-11; participates in substrate hash; cache-bust knob
- `substrate_hash text NOT NULL DEFAULT ''` — same as M010 PITFALL M010-09; D-18 pattern (empty string never matches a real SHA-256)
- `name text NOT NULL UNIQUE DEFAULT 'primary'` — same as M010 PITFALL M010-03; upsert target
- `word_count_at_last_run int NOT NULL DEFAULT 0` — the 5,000-word gate's audit trail; cannot be added later without a DEFAULT that silently hides pre-existing zero counts
- `activated boolean NOT NULL DEFAULT false` on profile_attachment — the automatic activation gate; must exist from day 1 or the activation sweep has no column to flip

---

## 3. assembleProfilePrompt Reuse vs Fork — Locked Answer

**Decision: Fork into `assemblePsychologicalProfilePrompt` in `src/memory/psychological-profile-prompt.ts`. Do NOT extend `assembleProfilePrompt`'s `ProfilePromptDimension` union.**

Rationale grounded in `src/memory/profile-prompt.ts`:

- `assembleProfilePrompt` is tightly coupled to the operational-profile contract: section 4 (`buildVolumeWeightCeilingDirective`) references entry counts of 10/20/50; section 2 (`buildRolePreamble`) says "extracting an operational profile… fact-extraction task, not an interpretation task"; `DO_NOT_INFER_DIRECTIVE` references "operational profile" framing. Psychological profiling is an inference/interpretation task by nature — the epistemological framing is fundamentally different.
- `ProfilePromptDimension` at `src/memory/profile-prompt.ts:51` is `'jurisdictional' | 'capital' | 'health' | 'family'`. Extending it with `'honesty_humility' | 'extraversion' | ...` would break every exhaustive switch that consumes it (including the `DIMENSION_DIRECTIVES` record at line 124, the `buildStructuredOutputDirective` schema-name map at line 363, and `src/memory/profiles/shared.ts` `ProfileGeneratorConfig.dimension` type).
- The substrate loader also differs: M011 needs a word-count computation over Greg's own speech, not just entry-count. The 5,000-word gate operates on word volume of user-authored content, not on the number of Pensieve rows. This is a different substrate query.
- The psychological prompt needs a section explaining the empirical limits of personality inference (r ≈ .31–.41) and the confidence-calibration framing for inter-period consistency — content that has no place in the operational-profile prompt.

**What CAN be reused directly:**
- `CONSTITUTIONAL_PREAMBLE` from `src/chris/personality.ts:50` — import verbatim
- `DO_NOT_INFER_DIRECTIVE` from `src/memory/profile-prompt.ts:107` — import verbatim; the anti-hallucination floor applies equally
- The 8-section structure (preamble → role → anti-hallucination → confidence calibration → previous state → dimension directive → substrate → output format) — mirror the structure, replace the content
- `ProfileSubstrateView` structural type — extend it with `wordCount: number` or create a parallel `PsychologicalSubstrateView` that adds the word-count field

**New file:** `src/memory/psychological-profile-prompt.ts`
**New type:** `PsychologicalProfileDimension = 'hexaco' | 'schwartz' | 'attachment'` — one value per TABLE, not per individual trait. The per-dimension-within-table prompt logic lives inside the dimension directive section, not in the type union.
**New function:** `assemblePsychologicalProfilePrompt(dimension: PsychologicalProfileDimension, substrate: PsychologicalSubstrateView, prevState: unknown | null, wordCount: number): AssembledProfilePrompt`

**D047 psychological-vs-operational boundary statement (see section 11 below).**

---

## 4. Orchestrator Strategy — Locked Answer

**Decision: Separate `updateAllPsychologicalProfiles()` in `src/memory/psychological-profile-updater.ts`. A separate monthly cron entry. The existing `updateAllOperationalProfiles` in `src/memory/profile-updater.ts` is NOT modified.**

Rationale:

- `updateAllOperationalProfiles` at `src/memory/profile-updater.ts:64` has a specific loading contract (D-14: one substrate load per fire, passed to all 4 generators). The psychological substrate loader is different — it must compute word count of Greg's own speech, not just pull rows by tag.
- Cadence differs: operational profiles run weekly (Sunday 22:00); psychological profiles run monthly. Merging them into one orchestrator creates a function that sometimes runs 2 generators and sometimes runs 6 depending on which cadence fired, which complicates the aggregate cron-complete log and makes the 5,000-word gate logic bleed into the operational-profile code path.
- `Promise.allSettled` isolation still applies within `updateAllPsychologicalProfiles`: hexaco, schwartz, attachment generators run in parallel with per-generator isolation. Attachment uses the same isolation even though it has an activation gate — the gate lives inside the attachment generator, not in the orchestrator.
- The new orchestrator exports `updateAllPsychologicalProfiles(): Promise<void>` with the same D-23 fire-and-forget contract.

**CronRegistrationStatus** at `src/cron-registration.ts:22` adds one new field:

```typescript
psychologicalProfileUpdate: 'registered' | 'failed';
```

**RegisterCronsDeps** at `src/cron-registration.ts:32` adds:
```typescript
config.psychologicalProfileUpdaterCron: string;
runPsychologicalProfileUpdate: () => Promise<void>;
```

The `/health` endpoint's `profile_cron_registered` field will need a sibling `psychological_profile_cron_registered`.

---

## 5. 5,000-Word Threshold Gate — Locked Answer

**Decision: Gate lives in the psychological substrate loader, checked BEFORE calling `updateAllPsychologicalProfiles` and again as step 1 inside each generator. Two-layer check.**

Rationale mapped to M010 patterns:

- In M010, `isAboveThreshold(substrate.entryCount)` at `src/memory/profiles/shared.ts:371` is checked as step 1 inside `runProfileGenerator` — after substrate load but before Sonnet call. The threshold check is cheap compared to the Sonnet call; it short-circuits at the per-generator level.
- For M011, the word count is expensive to compute (requires iterating pensieve_entries.content for user-authored text), so it must be computed ONCE in the substrate loader and stored on the substrate object (same D-14 pattern: substrate loaded once, passed to all generators).
- The psychological substrate loader (`loadPsychologicalSubstrate`) computes `userWordCount` (words from Greg's own Pensieve entries, excluding Chris's responses from conversations table). This value is stored on `PsychologicalSubstrate.userWordCount`.
- Each generator calls `isBelowWordThreshold(substrate.userWordCount)` as step 1. Below threshold: write a row with `overall_confidence = 0` and all dimension jsonb fields set to `{score: null, confidence: 0, evidence_count: 0}`, log `'chris.psych_profile.threshold.below_minimum'`, return `'profile_below_threshold'`. No Sonnet call.
- Attachment uses a separate relational-word threshold (2,000 words of relational speech, tracked in `profile_attachment.relational_word_count`). The attachment generator computes relational word count separately from the 5,000-word gate.

**Word count computation:** Count words in `content` of `pensieve_entries` WHERE `source = 'telegram'` (Greg's own voice) AND `epistemic_tag IN ('FACT', 'EMOTION', 'BELIEF', 'INTENTION', 'EXPERIENCE', 'VALUE', 'PREFERENCE', 'FEAR', 'RELATIONSHIP')`. Exclude `RITUAL_RESPONSE` tagged responses that might be prompted by Chris. Simple whitespace split word count is sufficient; no need for NLP tokenization.

**UX contract for below-threshold:** The seed row for `profile_hexaco` / `profile_schwartz` / `profile_attachment` is inserted in migration 0013 with `overall_confidence = 0` and all dimension jsonb columns as `'null'::jsonb`. The `/profile` handler reads `overall_confidence = 0` and renders the "insufficient data — need X more words" message per the M011 spec. No special "word count deficit" field is needed — the handler can compute needed words by calling `getPsychologicalProfiles()` which exposes `wordCountAtLastRun`.

---

## 6. PROFILE_INJECTION_MAP Extension — Locked Answer

**Decision: Separate `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` in `src/memory/profiles.ts`. Do NOT extend the existing `PROFILE_INJECTION_MAP`.**

Rationale grounded in `src/memory/profiles.ts:70-74`:

- `PROFILE_INJECTION_MAP` is a `Readonly<Record<'REFLECT' | 'COACH' | 'PSYCHOLOGY', readonly Dimension[]>>` where `Dimension = 'jurisdictional' | 'capital' | 'health' | 'family'`. Extending `Dimension` to include psychological dimensions breaks the `for (const dim of scope)` loop in `formatProfilesForPrompt` (line 237) — the loop calls `profiles[dim]` which is `OperationalProfiles[dim]`, and `OperationalProfiles` has no `hexaco` or `schwartz` field.
- The token budget concern is real: injecting 6 HEXACO + 10 Schwartz scores with per-dimension confidence framing into EVERY REFLECT conversation is 300-500 tokens of psychological context that is only meaningful in PSYCHOLOGY mode and occasionally in REFLECT. For COACH it is likely noise (coaching is about decisions and actions, not personality scores).
- Proposed injection scope for psychological profiles:
  - PSYCHOLOGY: hexaco + schwartz (both)
  - REFLECT: schwartz only (values inform reflection; HEXACO traits are less actionable in a reflective context)
  - COACH: neither (per M010-08 token-drift reasoning — psychological inference has even higher topic-drift risk than health data)

```typescript
export const PSYCHOLOGICAL_PROFILE_INJECTION_MAP: Readonly<Record<'REFLECT' | 'PSYCHOLOGY', readonly PsychologicalDimension[]>> = {
  REFLECT: ['schwartz'],
  PSYCHOLOGY: ['hexaco', 'schwartz'],
} as const;
```

Attachment is excluded from injection map pending activation — it will be added to PSYCHOLOGY mode only once the activation gate fires.

**New function:** `formatPsychologicalProfilesForPrompt(profiles: PsychologicalProfiles, mode: string): string` — returns `''` for modes not in the map or when no profiles have confidence > 0. Parallel to `formatProfilesForPrompt`.

**buildSystemPrompt integration** at `src/chris/personality.ts:120`: `ChrisContextExtras` gains an optional `psychologicalProfiles?: string` field. The REFLECT/PSYCHOLOGY mode cases prepend it after `operationalProfiles` and before `contextValue`:

```typescript
const pensieveWithProfile = [operationalProfiles, psychologicalProfiles, contextValue]
  .filter(Boolean).join('\n\n');
```

The PSYCHOLOGY case gets both; REFLECT gets only Schwartz (as filtered by the new injection map).

---

## 7. profile_history Extension — Locked Answer

**Decision: No migration delta needed. profile_history accommodates M011 rows as-is.**

Evidence from `src/db/schema.ts:646-658` and `src/db/migrations/0012_operational_profiles.sql:115-126`:

- `profile_table_name text NOT NULL` is freeform — it stores `'profile_hexaco'`, `'profile_schwartz'`, `'profile_attachment'` without schema change.
- `profile_id uuid NOT NULL` — the new tables have uuid PKs matching this type.
- `snapshot jsonb NOT NULL` typed as `ProfileSnapshot = Record<string, unknown>` — accommodates any row shape.
- The existing index `profile_history_table_recorded_idx ON (profile_table_name, recorded_at DESC)` at line 655 already partitions by table name, so history queries for psychological profiles are indexed from day 1.

The only consideration is `ProfileSnapshot` type in `src/memory/profiles/schemas.ts:241`. It is already `Record<string, unknown>` — no change needed.

**Write-before-upsert pattern (D-29)** from M010 `src/memory/profiles/shared.ts:495-501` applies identically to M011 generators. The psychological generators will call `db.insert(profileHistory)` before their upsert with the same pattern.

---

## 8. Monthly Cron Registration — Locked Answer

**Decision: `0 9 1 * *` — 1st of month at 09:00 Paris time.**

Rationale and collision analysis:

- Existing Sunday 22:00 Paris operational cron: `0 22 * * 0`. Monthly cron on 1st at 09:00 has zero overlap — different weekday anchor, different time.
- The 1st-of-month anchor is preferable over "last Sunday" because: (a) it is deterministic in cron syntax without complex expressions; (b) it aligns with the spec's "pulls the previous month's data" framing — firing on the 1st means the previous calendar month is cleanly complete; (c) "last Sunday" in cron requires `L` syntax which node-cron does not support (only minute/hour/day/month/weekday standard fields).
- 09:00 Paris: morning fire avoids late-night race with other crons. The weekly_review fires Sunday 20:00, the operational profile Sunday 22:00. Monthly psychological profile fires 1st at 09:00 — no timing proximity to either.
- Expression: `0 9 1 * *` with `timezone: 'Europe/Paris'` (matching existing cron timezone config at `src/cron-registration.ts:104`).
- `cron.validate('0 9 1 * *')` from node-cron passes (standard 5-field expression) — the fail-fast validation pattern from M010 Phase 34 applies identically.

**CronRegistrationStatus addition:**

```typescript
psychologicalProfileUpdate: 'registered' | 'failed';
```

**Config key addition:**

```typescript
config.psychologicalProfileUpdaterCron: string  // default: '0 9 1 * *'
```

**Health endpoint addition:** `psychological_profile_cron_registered: boolean` alongside existing `profile_cron_registered`.

---

## 9. Reader API Split — Locked Answer

**Decision: Separate `getPsychologicalProfiles(): Promise<PsychologicalProfiles>` function in `src/memory/profiles.ts`. Do NOT extend `getOperationalProfiles` return type.**

Rationale from `src/memory/profiles.ts:191-199`:

- `getOperationalProfiles` returns a strictly typed `OperationalProfiles` interface. Adding `hexaco`, `schwartz`, `attachment` fields would force all existing callers (`src/bot/handlers/profile.ts:614`, mode handlers in `src/chris/modes/`) to handle the new fields or use type-narrowing guards. There are 8+ `buildSystemPrompt` call sites already refactored atomically for M010 — a return type change on `getOperationalProfiles` is a wide blast radius.
- `PsychologicalProfiles` is a new interface:
  ```typescript
  export interface PsychologicalProfiles {
    hexaco: PsychologicalProfileRow<HexacoProfileData> | null;
    schwartz: PsychologicalProfileRow<SchwartzProfileData> | null;
    attachment: PsychologicalProfileRow<AttachmentProfileData> | null;
  }
  ```
- `PsychologicalProfileRow<T>` extends `ProfileRow<T>` (or mirrors its shape) with an additional `wordCountAtLastRun: number` field for threshold UX.
- `getPsychologicalProfiles()` follows the exact `Promise.all` + per-reader try/catch pattern from `getOperationalProfiles` — same never-throw contract, same null-per-failure semantics.

**PROFILE_SCHEMAS extension** at `src/memory/profiles.ts:83-88`: a new `PSYCHOLOGICAL_PROFILE_SCHEMAS` record maps `PsychologicalDimension` values to their versioned Zod schemas. The existing operational `PROFILE_SCHEMAS` is untouched.

---

## 10. Suggested Build Order

**M011 mirrors the M010 Substrate → InferenceEngine → Surfaces → Tests structure with one addition: the word-count gate infrastructure ships with the substrate, not with the engine.**

### Phase 1: Schema + Substrate

Deliverables:
- Migration 0013 (HARD CO-LOC #M11-1): three tables + Drizzle schema.ts additions + meta snapshots + test.sh psql line
- `src/memory/profiles/schemas.ts` additions: `HexacoProfileData`, `SchwartzProfileData`, `AttachmentProfileData` types (v3 + v4 Zod schemas, dual-schema pattern per M010 discipline)
- `src/memory/confidence.ts` additions: `WORD_COUNT_THRESHOLD = 5000`, `RELATIONAL_WORD_COUNT_THRESHOLD = 2000`, `isAboveWordThreshold(wordCount: number): boolean`
- `loadPsychologicalSubstrate()` in `src/memory/psychological-profiles/shared.ts`: loads rolling-window substrate + computes `userWordCount` over Greg's speech, `relationalWordCount` for attachment gate
- Substrate hash for psychological profiles: same SHA-256 over canonical JSON of `{pensieveIds, episodicDates, decisionIds, schemaVersion, wordCountBucket}` where `wordCountBucket = Math.floor(wordCount / 1000)` — this ensures the hash changes when word volume crosses a 1000-word boundary even if the entry-set is identical

### Phase 2: Inference Engine

Deliverables:
- `src/memory/psychological-profile-prompt.ts`: `assemblePsychologicalProfilePrompt` with the 8-section structure; `PsychologicalProfileDimension` type; `HEXACO_DIMENSION_DIRECTIVES` and `SCHWARTZ_DIMENSION_DIRECTIVES` records
- `src/memory/psychological-profiles/hexaco.ts`: generator config + `generateHexacoProfile()`
- `src/memory/psychological-profiles/schwartz.ts`: generator config + `generateSchwartzProfile()`
- `src/memory/psychological-profiles/attachment.ts`: generator with activation gate; writes row but leaves all dims null when `activated = false`
- `src/memory/psychological-profile-updater.ts`: `updateAllPsychologicalProfiles()` orchestrator
- `src/cron-registration.ts`: `psychologicalProfileUpdate` status field + `runPsychologicalProfileUpdate` dep + `0 9 1 * *` registration
- Two-cycle regression test (HARD CO-LOC #M11-2, mirrors M010's `generators.two-cycle.test.ts`) — ships atomically with the shared.ts substrate hash logic

### Phase 3: Surfaces

Deliverables:
- `getPsychologicalProfiles()` reader + `PsychologicalProfiles` type in `src/memory/profiles.ts`
- `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` + `formatPsychologicalProfilesForPrompt()` in `src/memory/profiles.ts`
- `ChrisContextExtras.psychologicalProfiles?: string` field in `src/chris/personality.ts`
- REFLECT/PSYCHOLOGY mode handlers extended to call `getPsychologicalProfiles()` + `formatPsychologicalProfilesForPrompt()` and pass result in extras
- `/profile` command extended: `handleProfileCommand` adds hexaco + schwartz + attachment sections after the existing 4; replaces the `MSG.m011Placeholder` with real formatters
- New `formatPsychologicalProfileForDisplay()` pure function in `src/bot/handlers/profile.ts` (or sibling file)
- Golden-output snapshot test for the new psychological display formatter (HARD CO-LOC #M11-3, mirrors M010's profile.golden.test.ts pattern)

### Phase 4: Tests

Deliverables:
- Synthetic fixture test (per M011 spec): 30+ days of synthetic episodic summaries + 6,000+ words of simulated dialogue with designed personality signature
- Three assertion checkpoints: (1) 1,000-word fixture → no profile generated; (2) 6,000-word fixture → populated profile with `overall_confidence > 0`; (3) detected HEXACO signature roughly matches designed signature within ±1 scale point on high-signal dimensions
- `src/memory/psychological-profiles/__tests__/substrate.test.ts`: word-count computation, relational-word-count computation
- `src/memory/__tests__/psychological-profile-prompt.test.ts`: structural tests mirroring `profile-prompt.test.ts` (CONSTITUTIONAL_PREAMBLE first, DO_NOT_INFER_DIRECTIVE present, etc.)

**Phase ordering rationale:** Schema before engine because Drizzle type inference requires the table definitions. Engine before surfaces because the reader needs the table + generator to have been run at least once (seed row). Surfaces before full tests because the golden-snapshot test requires the formatter to exist. Two-cycle regression test co-locates with the substrate hash logic (Phase 2) per M010 HARD CO-LOC #M10-3 precedent.

---

## 11. D047 — Psychological-vs-Operational Boundary Statement

**D047: Operational profiles extract Greg's current facts-of-record (where he lives, what he owns, what his health status is, who is in his family). Psychological profiles infer stable trait-level dispositions (who he is as a person across situations). Operational profiles are grounded in explicit statements Greg has made; psychological profiles are probabilistic inferences over a corpus of speech. Any piece of data that can be stated as a current fact ("I moved to Tbilisi", "my FI target is $1.5M") belongs in an operational profile. Any piece of data that requires pattern-aggregation over many entries to infer ("your Openness score is 4.2") belongs in a psychological profile. The two systems must never co-locate in the same prompt assembler, the same generator, or the same injection map. Cross-reading is permitted (PSYCHOLOGY mode may consume operational context via PROFILE_INJECTION_MAP) but cross-writing is forbidden (operational profile generators must never emit psychological trait scores, and psychological profile generators must never emit operational facts).**

This boundary statement answers the classification question for every ambiguous future feature: "Is relational memory a psychological or operational dimension?" → It is operational (it captures Greg's family facts-of-record). "Is attachment style a psychological or operational dimension?" → It is psychological (it is a pattern inference over relational speech, not a fact Greg stated). "Can the HEXACO generator also update profile_family?" → No: cross-writing violation.

---

## Architectural Overview

```
                        M011 Integration Map
┌─────────────────────────────────────────────────────────────────┐
│                    src/memory/                                   │
│                                                                  │
│  profile-prompt.ts        psychological-profile-prompt.ts        │
│  (operational, unchanged) (NEW — forked, different framing)     │
│         │                          │                             │
│  profiles/shared.ts        psychological-profiles/shared.ts      │
│  (unchanged)               (NEW — word-count substrate loader)   │
│         │                          │                             │
│  profiles/{juris,cap,      psychological-profiles/{hexaco,       │
│    health,family}.ts         schwartz,attachment}.ts             │
│  (unchanged)               (NEW — 3 generators)                  │
│         │                          │                             │
│  profile-updater.ts        psychological-profile-updater.ts      │
│  (unchanged)               (NEW — monthly orchestrator)          │
│         │                          │                             │
│  profiles.ts               profiles.ts (MODIFIED)                │
│  getOperationalProfiles()  + getPsychologicalProfiles()          │
│  formatProfilesForPrompt() + formatPsychologicalProfilesForPrompt│
│  PROFILE_INJECTION_MAP     + PSYCHOLOGICAL_PROFILE_INJECTION_MAP │
└──────────────┬───────────────────────┬──────────────────────────┘
               │                       │
       src/chris/personality.ts (MODIFIED: ChrisContextExtras += psychologicalProfiles?)
               │
       buildSystemPrompt() — PSYCHOLOGY gets both maps; REFLECT gets Schwartz only
               │
       src/bot/handlers/profile.ts (MODIFIED: adds psych sections, drops M011 placeholder)
```

```
                     Cron Timeline (Paris time)
Mon–Sat     no profile crons
Sunday      20:00 weekly_review fires
            22:00 updateAllOperationalProfiles (4 generators, weekly)
1st of month 09:00 updateAllPsychologicalProfiles (3 generators, monthly)
```

---

## HARD CO-LOCATION Constraints

| ID | Constraint | Load-Bearing Reason |
|----|-----------|---------------------|
| **M11-1** | Migration 0013 SQL + schema.ts table exports + meta/0013_snapshot.json + _journal.json entry + scripts/test.sh psql apply line + regen-snapshots cleanup bump + schemas.ts type exports | Drizzle ORM requires table def + migration + meta snapshots to be consistent; incoherent intermediate state causes drizzle-kit to generate spurious ALTER TABLE statements |
| **M11-2** | `psychological-profiles/shared.ts` substrate hash logic + two-cycle regression test | Same class as M010 HARD CO-LOC #M10-3; substrate hash correctness is untestable without a test that detects second-fire blindness at the same time the hash is introduced |
| **M11-3** | `/profile` psychological display formatter + golden-output snapshot test | Same class as M010 HARD CO-LOC #M10-5; prevents M010-07 framing regression (third-person, JSON-dump aesthetic) from reaching M011 surfaces |
| **M11-4** | `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` + `formatPsychologicalProfilesForPrompt` + `ChrisContextExtras.psychologicalProfiles` + PSYCHOLOGY mode handler wiring | These four pieces form a single logical circuit; any one shipped without the others leaves an unexercised code path that silently fails to inject profiles |

---

## Component Boundaries

| Component | File | Responsibility | Communicates With |
|-----------|------|---------------|-------------------|
| Schema | `src/db/schema.ts` (modified) | Table definitions for profile_hexaco, profile_schwartz, profile_attachment | Drizzle ORM, migration SQL |
| Schemas | `src/memory/profiles/schemas.ts` (modified) | Zod v3+v4 dual schemas for 3 new profile data types | Generators (v4 at SDK boundary), readers (v3 at read boundary) |
| Substrate Loader | `src/memory/psychological-profiles/shared.ts` (new) | Load rolling-window substrate + compute word counts | DB (pensieve_entries, episodic_summaries, decisions) |
| Prompt Builder | `src/memory/psychological-profile-prompt.ts` (new) | Assemble Sonnet prompt for HEXACO/Schwartz/Attachment | Generators (pure function, no I/O) |
| Generators | `src/memory/psychological-profiles/{hexaco,schwartz,attachment}.ts` (new) | Per-profile Sonnet call + threshold gate + upsert | Substrate loader, prompt builder, Anthropic SDK, DB |
| Orchestrator | `src/memory/psychological-profile-updater.ts` (new) | Fan out 3 generators via Promise.allSettled | Generators, substrate loader, cron |
| Reader | `src/memory/profiles.ts` (modified) | `getPsychologicalProfiles()` never-throw reader | DB (3 new tables) |
| Formatter | `src/memory/profiles.ts` (modified) | `formatPsychologicalProfilesForPrompt()` | Mode handlers via buildSystemPrompt extras |
| Display | `src/bot/handlers/profile.ts` (modified) | `/profile` command extended with psych sections | Reader, language helpers |
| Cron | `src/cron-registration.ts` (modified) | Monthly 1st-of-month 09:00 Paris registration | Orchestrator |

---

## Key Integration Points at File:Line

| Integration | File:Line | What M011 Touches |
|-------------|-----------|-------------------|
| Add 3 table exports | `src/db/schema.ts:636` | Insert after `profileFamily` export, before `profileHistory` |
| Import new types | `src/db/schema.ts:27` | Add imports for `HexacoProfileData`, `SchwartzProfileData`, `AttachmentProfileData` from schemas.ts |
| New Zod schemas | `src/memory/profiles/schemas.ts:241` | Append after `ProfileSnapshot` typedef |
| Word-count threshold constants | `src/memory/confidence.ts:31` | Add `WORD_COUNT_THRESHOLD`, `RELATIONAL_WORD_COUNT_THRESHOLD`, `isAboveWordThreshold` |
| New profile reader | `src/memory/profiles.ts:199` | Add `getPsychologicalProfiles()` after `getOperationalProfiles` |
| New injection map | `src/memory/profiles.ts:74` | Add `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` after `PROFILE_INJECTION_MAP` |
| New formatter | `src/memory/profiles.ts:259` | Add `formatPsychologicalProfilesForPrompt` after `formatProfilesForPrompt` |
| ChrisContextExtras | `src/chris/personality.ts:39-43` | Add `psychologicalProfiles?: string` to interface |
| buildSystemPrompt REFLECT case | `src/chris/personality.ts:146-151` | Prepend Schwartz block to pensieveWithProfile |
| buildSystemPrompt PSYCHOLOGY case | `src/chris/personality.ts:163-169` | Prepend both HEXACO + Schwartz blocks |
| CronRegistrationStatus | `src/cron-registration.ts:22` | Add `psychologicalProfileUpdate` field |
| RegisterCronsDeps | `src/cron-registration.ts:32` | Add `psychologicalProfileUpdaterCron` config + `runPsychologicalProfileUpdate` handler |
| registerCrons function | `src/cron-registration.ts:66` | Add monthly cron block after existing profile cron (line ~189) |
| handleProfileCommand | `src/bot/handlers/profile.ts:623` | Replace `MSG.m011Placeholder` reply with actual psych profile displays |

---

*Architecture research for: M011 Psychological Profiles (HEXACO + Schwartz + Attachment)*
*Researched: 2026-05-13*
