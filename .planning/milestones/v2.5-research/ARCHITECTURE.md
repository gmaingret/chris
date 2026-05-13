# Architecture Research — M010 Operational Profiles

**Domain:** Operational profile inference layer on top of existing append-only Pensieve + episodic consolidation + ritual substrate
**Researched:** 2026-05-11
**Confidence:** HIGH — all decisions anchored to direct codebase inspection of the named modules; no web sources required for this milestone (integrating with known code, not discovering new libraries)

---

## Question 1: Profile-Update Cron — New Cron vs New Ritual Type

**Recommendation: Option A — 4th cron in `registerCrons`.**

**Rationale:**

The ritual subsystem (`src/rituals/`) has a load-bearing semantic: rituals fire via the existing sweep, emit `ritual_fire_events`, participate in skip-tracking, trigger adjustment dialogues, and interact with `ritual_pending_responses`. Every one of those behaviors is wrong for operational profile updates:

- Profiles update silently with no Telegram round-trip. There is no "response window" to track, no skip-count to accumulate, no adjustment dialogue to trigger. Adding a `rituals` row would force the scheduler to run `ritualResponseWindowSweep` against a row that can never produce a `fired_no_response` event — permanently dead infrastructure.
- The `dispatchRitualHandler` switch in `src/rituals/scheduler.ts:452-468` keys on `ritual.name`. Adding `case 'operational_profile_update'` technically works, but the handler then returns `'fired'` with no response semantics — every skip-tracking invariant in `ritualResponseWindowSweep` becomes vacuously true for a row that has no pending response to scan.
- The `rituals.config` Zod schema (`RitualConfigSchema` with `fire_at`, `skip_threshold`, `mute_until`, etc.) is strict-mode (`.strict()` — rejects unknown fields). Profiles need none of these fields. Storing a valid row requires a `skip_threshold` that has no meaning and a `fire_at` that is never validated against Greg's response behavior.
- The catch-up ceiling in `runRitualSweep` (advance without firing if >1 cadence period stale) was built for interactive rituals where missing a fire is a user-visible skip. A profile update that was missed while the server was offline should simply run on restart — but the catch-up ceiling would swallow it silently, which is the wrong behavior for a data-pipeline step.

By contrast, a 4th cron in `registerCrons` is a 10-line addition that mirrors the exact shape of the episodic cron:

```typescript
// In RegisterCronsDeps interface:
profileUpdateCron?: string;
runProfileUpdate?: () => Promise<void>;

// In registerCrons():
if (deps.runProfileUpdate) {
  cron.schedule(
    deps.config.profileUpdateCron ?? '0 21 * * 0',  // Sunday 21:00
    async () => {
      try { await deps.runProfileUpdate!(); }
      catch (err) { logger.error({ err }, 'profiles.cron.error'); }
    },
    { timezone: deps.config.proactiveTimezone },
  );
  status.profileUpdate = 'registered';
}
```

`CronRegistrationStatus` gains one field (`profileUpdate`), the `/health` endpoint gains one status, and the wiring is testable via the same `vi.mock('node-cron')` pattern used by the existing cron unit tests.

**Timing:** Sunday 21:00 Paris (one hour after the Sunday 20:00 weekly review). The weekly review fires first, producing the most recent episodic summary for the week and any Sunday-resolved decisions before the profile update reads them. This is the correct dependency ordering.

**Tradeoff accepted:** The profile update cron has no skip-tracking, no adjustment dialogue, and no mute semantics. If the Sunday 21:00 update silently fails, it is logged but the next week's update will have a slightly larger input window. This is acceptable for a background data-pipeline step — unlike a skipped daily journal, a silently-failed profile update does not break the user experience because profiles are consumed as background context, not as interactive events.

---

## Question 2: Profile Generation Handler — One Orchestrator vs Four Separate Handlers

**Recommendation: One thin orchestrator (`src/memory/profile-updater.ts`) that fans out to four per-profile generators via `Promise.allSettled`, with each generator in its own file under `src/memory/profiles/`.**

**Structure:**

```
src/memory/profiles/
├── jurisdictional.ts    # updateJurisdictionalProfile()
├── capital.ts           # updateCapitalProfile()
├── health.ts            # updateHealthProfile()
├── family.ts            # updateFamilyProfile()
└── shared.ts            # loadProfileSubstrate(), ProfileSubstrate type, threshold check
```

```
src/memory/profile-updater.ts   # updateAllOperationalProfiles() — thin Promise.allSettled orchestrator
src/memory/profiles.ts          # getOperationalProfiles() — read-only API for mode handlers
```

**Rationale for parallel over serial:**

Each Sonnet call takes approximately 8–15 seconds. Serial execution of 4 calls takes 32–60 seconds. The Sunday 21:00 cron has no latency budget constraint (no user is waiting), but 60 seconds of blocking in a single Node.js async chain burns the event loop for no reason. `Promise.allSettled` gives 4 parallel Sonnet calls completing in ~15 seconds total — a 4x improvement with zero added complexity.

**Rationale for error isolation:**

If the health profile generator fails (e.g., Sonnet returns malformed output that survives retry), it must not prevent the capital or family profile from updating. `Promise.allSettled` (not `Promise.all`) is the right primitive here. Each generator returns a discriminated result (`{ updated: true } | { skipped: 'threshold' | 'existing' } | { failed: true; error: unknown }`), and the orchestrator logs each outcome independently:

```typescript
export async function updateAllOperationalProfiles(): Promise<ProfileUpdateResults> {
  const [jurisdictional, capital, health, family] = await Promise.allSettled([
    updateJurisdictionalProfile(),
    updateCapitalProfile(),
    updateHealthProfile(),
    updateFamilyProfile(),
  ]);
  // log each settled result; return summary
}
```

This mirrors the M008 `runConsolidate` error-isolation contract: `failed: true` is a valid return, not a thrown exception.

**Rationale for four separate files:**

Each profile has a distinct Zod schema, a distinct Sonnet prompt, and a distinct set of Pensieve tag filters. Colocating all four in one file creates a 500+ LOC module that is difficult to test in isolation. Per-file generators allow per-file test mocks without any shared-state contamination. The thin orchestrator stays under 50 LOC and becomes the only file that needs to import all four.

**Testability:** Each generator in `src/memory/profiles/{name}.ts` can be unit-tested with a mock Sonnet SDK and a stub `ProfileSubstrate` without touching the other generators. The orchestrator test only needs to assert that `Promise.allSettled` was called with the right 4 promises and that outcomes are correctly recorded.

---

## Question 3: Sonnet Prompt Strategy — Delta vs Full Regeneration

**Recommendation: Full regeneration every week.**

**Rationale:**

Delta updates (Sonnet reads the previous profile state and proposes field-level patches) introduce a class of error that compounds across weeks: if Sonnet generates a wrong value in week N, that value enters the "previous state" for week N+1 and gets laundered into the next prompt as authoritative fact. By week N+4, the error is deeply baked in. Full regeneration treats each weekly run as a fresh inference from the Pensieve substrate — wrong values are corrected on the next run without needing a repair path.

The practical concern about losing "manual edits" is not applicable here. The M010 spec does not include a manual-edit interface. Greg has no mechanism to manually patch individual profile fields in this milestone. The `/profile` command is read-only (display only). There are no human-in-the-loop edits to lose.

Full regeneration also simplifies the prompt. The per-profile system prompt structure is:

```
CONSTITUTIONAL_PREAMBLE
+ role framing ("You are reading Greg's operational profile domain...")
+ domain expertise framing (per-profile, locked in per-file constants)
+ data freshness window instruction ("focus on last 30 days; use older data only if referenced in recent entries")
+ threshold instruction ("if fewer than 10 distinct entries mention this domain, output confidence: 0 and null for all fields")
+ Pensieve substrate (FACT/RELATIONSHIP/INTENTION/EXPERIENCE-tagged entries filtered by per-profile domain keywords, last 30–60 days)
+ episodic summaries (last 4–8 weeks, pre-formatted as structured blocks)
+ resolved decisions (domain-tagged, last 60 days)
+ output schema instruction ("respond in JSON matching the schema below")
```

There is no "previous state" slot. The prompt is stateless. This makes it trivially testable with a fixed synthetic substrate.

**Structured output schema per profile:** Each generator uses a Zod v3 schema (for the business contract) + Zod v4 mirror (for the SDK boundary) following the established dual-schema pattern from `src/episodic/consolidate.ts:33-81` and `src/rituals/weekly-review.ts:132-161`. The v4 mirror is passed to `zodOutputFormat()` at the SDK boundary; Sonnet output is re-validated through the v3 schema.

**Example schema (jurisdictional):**

```typescript
// v3 business contract
export const JurisdictionalProfileSchema = z.object({
  current_location: z.string().min(1),
  residency_statuses: z.array(z.object({
    country: z.string(),
    status: z.string(),
    since: z.string().nullable(),
  })).max(10),
  tax_structures: z.array(z.object({
    jurisdiction: z.string(),
    type: z.string(),
    notes: z.string().nullable(),
  })).max(10),
  next_planned_move: z.string().nullable(),
  planned_move_date: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  inference_notes: z.string().max(500).nullable(),
});
```

The `confidence` field is emitted by Sonnet as part of the structured output — it is not calculated by the application layer. Sonnet is instructed to calibrate: 0.0 = below threshold or contradictory data, 0.3–0.6 = sparse but consistent data, 0.7–0.9 = clear consistent data over multiple entries. The application layer enforces the minimum-10-entries threshold regardless of Sonnet's confidence output (if below threshold, the generator skips the Sonnet call entirely and writes confidence: 0).

---

## Question 4: `getOperationalProfiles()` Reader API Shape

**Recommendation:** Reader API owns the confidence gating. Mode handlers receive pre-formatted strings and pass them as a new `extras` argument to `buildSystemPrompt`.

### Reader API shape

```typescript
// src/memory/profiles.ts
export interface OperationalProfiles {
  jurisdictional: ProfileRow<JurisdictionalData> | null;
  capital: ProfileRow<CapitalData> | null;
  health: ProfileRow<HealthData> | null;
  family: ProfileRow<FamilyData> | null;
}

export interface ProfileRow<T> {
  data: T;
  confidence: number;
  lastUpdated: Date;
}

export async function getOperationalProfiles(): Promise<OperationalProfiles>;
export function formatProfilesForPrompt(profiles: OperationalProfiles): string;
```

`getOperationalProfiles()` returns `null` for each profile whose row does not exist in the DB (first run before any cron has fired) or whose `confidence` is 0 (threshold not met). A confidence value of 0 is set by the generator for sparse data; the reader treats it identically to "no row" — both result in `null` for that profile slot.

**Gating in the reader, not the consumer:** The confidence threshold check (`confidence === 0 || row === null → null`) lives inside `getOperationalProfiles()`, not in REFLECT/COACH/PSYCHOLOGY mode handlers. The mode handlers do not need to know about the threshold — they receive `null` and render the absence as "insufficient data". This is the correct separation: the reader owns the data-quality contract; the consumer owns the rendering.

**"Insufficient data" rendering:** `formatProfilesForPrompt` converts `null` slots to a fixed string. When all four are null (first run), the entire profiles block is omitted from the system prompt rather than injected as four "insufficient data" lines. If all four are null, `formatProfilesForPrompt` returns an empty string and the mode handler does not add the profiles section at all.

### `buildSystemPrompt` extension

**Recommendation: Refactor the positional-argument list into a named `extras` object and add `operationalProfiles` there.**

The existing signature at `src/chris/personality.ts:89-95`:

```typescript
buildSystemPrompt(
  mode: ChrisMode,
  pensieveContext?: string,
  relationalContext?: string,
  language?: string,
  declinedTopics?: DeclinedTopic[],
): string
```

The ACCOUNTABILITY mode already overloads the `pensieveContext`/`relationalContext` slots (documented in the JSDoc at `personality.ts:79-87`). Adding a 4th positional context argument would deepen this confusion. The clean fix is a named `extras` object:

```typescript
export interface ChrisContextExtras {
  language?: string;
  declinedTopics?: DeclinedTopic[];
  operationalProfiles?: string;  // pre-formatted by formatProfilesForPrompt(); "" = omit section
}

buildSystemPrompt(
  mode: ChrisMode,
  pensieveContext?: string,
  relationalContext?: string,
  extras?: ChrisContextExtras,
): string
```

The `extras.operationalProfiles` string is appended inside the REFLECT, COACH, and PSYCHOLOGY branches only. The existing `language` and `declinedTopics` parameters are folded into `extras` in the same commit to avoid a growing positional-argument list. This is a breaking signature change that touches all call sites and must be one atomic plan.

The ACCOUNTABILITY overload is preserved exactly as documented — ACCOUNTABILITY still passes the decision context in the `pensieveContext` slot and the temporal-Pensieve block in the `relationalContext` slot. The `extras` object for ACCOUNTABILITY will have `operationalProfiles: undefined` (profiles are not injected into ACCOUNTABILITY mode).

**Modes that consume operational profiles:** REFLECT, COACH, PSYCHOLOGY only — as explicitly listed in the M010 spec. JOURNAL, INTERROGATE, and PRODUCE are retrieval-grounded (specific user queries); profiles would inject standing context that could contaminate verbatim retrieval responses. ACCOUNTABILITY is decision-resolution specific.

**Injection site:** Mode handlers call `getOperationalProfiles()` and `formatProfilesForPrompt()` before calling `buildSystemPrompt()`. The async profile fetch is a fast DB read (not a Sonnet call) so it adds negligible latency to the message-processing path. No new pre-processor (PP#) is needed.

---

## Question 5: `/profile` Telegram Command Formatting

**Recommendation: Plain text, one message per profile (4 separate Telegram messages), human-formatted narrative (not JSON dump).**

**Plain text over Markdown/HTML:** The `/summary` handler at `src/bot/handlers/summary.ts` uses `ctx.reply(text)` with no `parse_mode`. The rationale documented there (`summary.ts:25`) applies identically: Telegram's Markdown renderer is finicky with user-origin content. Profile field values contain special characters (`/`, `-`, `(`, `)`) that must be escaped in Markdown mode. Plain text is safe, requires no escaping, and is consistent with the established pattern.

**Four separate messages over one mega-message:** Each profile gets its own `ctx.reply()` call. Telegram has a 4096-character per-message limit; a single message with four verbose profiles would exceed this on a well-populated profile. Separate messages also let Greg quote-reply a specific profile for follow-up conversation. The `/decisions` handler follows the same multi-message pattern.

**Human-formatted narrative over JSON dump:** JSON dumps expose internal field names that are implementation details. Human-formatted output uses section headers and bullet points. Example:

```
Jurisdictional (confidence: 0.78, updated 2026-05-11)
Location: Paris, France
Residency: French resident, Georgian tax resident (since 2024)
Tax structures: French income tax; Georgian flat-rate territorial
Next move: None planned
```

The handler lives at `src/bot/handlers/profile.ts` and registers as `/profile` in `src/bot/bot.ts`. It follows the exact shape of `src/bot/handlers/summary.ts`: localized strings, error handling, single-user auth via Grammy middleware (no per-handler auth needed).

---

## Question 6: Synthetic-Fixture Integration

**Minimum dataset shape per profile:**

The primed-fixture pipeline (`scripts/synthesize-delta.ts`) generates entries by day. M010 needs 30+ days of data with entries biased toward each profile's domain keywords.

| Profile | Min Pensieve entries | Tags required | Episodic summaries | Decision signals |
|---------|---------------------|---------------|-------------------|-----------------|
| Jurisdictional | 10 with location/residency/tax keywords | FACT, INTENTION | 4+ mentioning location | 1+ resolved decision with domain_tag relating to legal/location |
| Capital | 10 with FI/investment/net-worth keywords | FACT, INTENTION, DECISION | 4+ mentioning financial state | 1+ resolved decision with domain_tag relating to financial |
| Health | 10 with health/medical/symptom keywords | FACT, EXPERIENCE | 4+ mentioning health | 0 minimum |
| Family | 10 with relationship/partner/family keywords | RELATIONSHIP, EXPERIENCE, INTENTION | 4+ mentioning family | 0 minimum |

**Sparse fixture for threshold enforcement:** A separate `m010-5days` fixture with exactly 5 entries per profile domain (below the 10-entry threshold) must produce all four profiles at `confidence: 0` with null fields. This tests the threshold gate independently from the populated-profile case.

**synthesize-delta.ts extension:** The existing synthesizer generates entries by calling Haiku with style-transfer prompts. M010 needs a per-profile "bias mode" where the synthesizer generates entries with explicit domain keywords embedded in the style-transfer prompt. This is a new `--profile-bias` flag on `synthesize-delta.ts`. The bias is additive — a day with `--profile-bias jurisdictional` still generates organic-style content but the Haiku instruction includes "include references to location, residency, or tax status in today's entries."

The synthetic pipeline does not need a separate extension for episodic summaries: `scripts/synthesize-episodic.ts` runs `runConsolidate()` against the Pensieve entries already in the fixture DB. If the Pensieve entries contain jurisdictional/capital/health/family keywords, the episodic summaries will naturally reflect them.

**Fixture names:** `m010-30days` for the populated case, `m010-5days` for the sparse case. Loaded via the existing `loadPrimedFixture('m010-30days')` pattern.

---

## Question 7: Migration Sequence

**Recommendation: Migration 0012, no seed rows — first cron fire creates rows via upsert.**

**Rationale for no seed rows:** The 4 profile tables are updated by the weekly cron, which upserts (INSERT ... ON CONFLICT DO UPDATE). The initial state is "no row exists". `getOperationalProfiles()` returns `null` for missing rows — identical behavior to a row with `confidence: 0`. There is no semantic difference between "no row" and "row with confidence 0 and null fields" from the consumer's perspective. Seeding row-0 placeholders adds migration complexity and creates phantom rows that could confuse the generator's threshold check.

**Migration 0012 content (4 tables, sentinel-name pattern):**

```sql
CREATE TABLE profile_jurisdictional (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE DEFAULT 'primary',  -- sentinel for ON CONFLICT upsert
  current_location text,
  residency_statuses jsonb NOT NULL DEFAULT '[]',
  tax_structures jsonb NOT NULL DEFAULT '[]',
  next_planned_move text,
  planned_move_date date,
  confidence real NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  inference_notes text,
  last_updated timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- similar for profile_capital, profile_health, profile_family
```

Each table holds exactly one row by application convention. The `name = 'primary'` sentinel is the ON CONFLICT target for the weekly upsert. This design allows future named snapshots (e.g., archiving quarterly state) without a schema change.

**drizzle meta snapshot:** Regeneration follows the existing `scripts/regen-snapshots.sh` pattern. Migration 0012 is hand-authored (Drizzle-kit generates the DDL from the schema; seed data cannot be auto-generated). The `scripts/test.sh` psql setup line must be updated with migration 0012, identical to how migrations 0009–0011 were added in M009.

---

## Question 8: Build Order

**Recommended phase split (Phases 33–36, continuing from M009's Phase 32):**

### Phase 33 — Substrate (migration + types + reader API stub)

**What ships:**
- Migration 0012: 4 profile tables in `src/db/schema.ts` + hand-authored SQL + drizzle meta snapshot + `scripts/test.sh` update
- `src/memory/profiles/shared.ts`: `ProfileSubstrate` type, `loadProfileSubstrate()`, threshold check constant
- `src/memory/profiles.ts`: `getOperationalProfiles()` returning all-null stubs (rows don't exist yet; compiles and returns correct type); `formatProfilesForPrompt()` stub
- `src/memory/profiles/jurisdictional.ts`, `capital.ts`, `health.ts`, `family.ts`: Zod v3+v4 schemas only (contract surface, no generator logic)
- Unit tests: migration applies cleanly; `getOperationalProfiles()` returns all-null when no rows exist; schemas reject invalid shapes

**Inter-phase coupling:** Zero dependency on Phase 34 generators. Mode handlers in Phase 35 can begin wiring against the stub API after Phase 33 ships.

### Phase 34 — Profile Generators + Orchestrator + Cron

**What ships:**
- `src/memory/profiles/jurisdictional.ts`: full `updateJurisdictionalProfile()` with Sonnet call + upsert
- `src/memory/profiles/capital.ts`, `health.ts`, `family.ts`: same
- `src/memory/profile-updater.ts`: `updateAllOperationalProfiles()` via `Promise.allSettled`
- Cron registration: `src/cron-registration.ts` 4th cron (Sunday 21:00) + `CronRegistrationStatus.profileUpdate` field
- `src/config.ts`: `profileUpdateCron` config field with default `'0 21 * * 0'`
- Integration tests using `m010-30days` fixture: weekly cron fires, all 4 profiles upsert with non-zero confidence; `m010-5days` fixture: all 4 profiles produce confidence 0 (threshold enforcement)

**Inter-phase coupling:** Depends on Phase 33 schemas and DB tables. Independent of Phase 35. Phase 34 can ship with no Telegram surface — generators run silently until Phase 35 wires the display layer.

### Phase 35 — Bot Command + Mode-Handler Wiring

**What ships:**
- `src/bot/handlers/profile.ts`: `/profile` command handler (4 plain-text messages, localized EN/FR/RU)
- `src/bot/bot.ts` edit: register `/profile` handler
- `src/chris/personality.ts` edit: `buildSystemPrompt` signature refactor (`language` + `declinedTopics` → `extras: ChrisContextExtras`, new `operationalProfiles?` field)
- `src/memory/profiles.ts`: complete `formatProfilesForPrompt()` implementation
- `src/chris/modes/reflect.ts`, `coach.ts`, `psychology.ts` (or wherever mode handlers live): call `getOperationalProfiles()` + `formatProfilesForPrompt()` and pass to `buildSystemPrompt`
- Regression tests: all existing mode-handler and engine tests pass with refactored signature; `/profile` handler test covers null path and populated path

**Inter-phase coupling:** Depends on Phase 33 (reader API) and Phase 34 (generators, because `/profile` needs at least one populated row to test the non-null rendering path). The `buildSystemPrompt` signature change must be one atomic plan — it touches all call sites in the engine.

### Phase 36 — Synthetic Fixture Test + Live Integration

**What ships:**
- `scripts/synthesize-delta.ts` extension: `--profile-bias <profile-name>` flag
- `m010-30days` and `m010-5days` primed fixtures generated and committed as VCR-cached artifacts
- Fixture test: `m010-30days` → all 4 profiles populated with calibrated confidence; `m010-5days` → all 4 profiles at confidence 0
- Live integration test (API-gated, 3-of-3): send REFLECT-mode message with `m010-30days` fixture loaded; assert system prompt contains profile data; verify Sonnet does not confuse profile context with invented facts

**Inter-phase coupling:** Depends on all prior phases. Cannot run until generators (Phase 34) and mode wiring (Phase 35) are complete.

**Why a dedicated phase:** Following the M009 HARD CO-LOCATION #4 precedent — fixture generation and fixture testing are separate concerns. Phase 36 is the end-to-end integration-test phase; bundling it with Phase 35 would either delay Phase 35 or ship Phase 35 without the tests.

---

## System Overview

```
Weekly Cron (Sunday 21:00 Paris)
    │
    ▼
updateAllOperationalProfiles()          src/memory/profile-updater.ts
    │
    ├─ Promise.allSettled([
    │    updateJurisdictionalProfile()  src/memory/profiles/jurisdictional.ts
    │    updateCapitalProfile()         src/memory/profiles/capital.ts
    │    updateHealthProfile()          src/memory/profiles/health.ts
    │    updateFamilyProfile()          src/memory/profiles/family.ts
    │  ])
    │
    │  Each generator:
    │    loadProfileSubstrate()         reads pensieve_entries (tag-filtered)
    │                                   + episodic_summaries (last 4-8 weeks)
    │                                   + decisions (resolved, domain-tagged, last 60 days)
    │    threshold check                < 10 entries → confidence: 0, skip Sonnet call
    │    Sonnet structured call         CONSTITUTIONAL_PREAMBLE + domain prompt + substrate
    │    Zod v4 parse (SDK boundary)    → Zod v3 re-validate (business contract)
    │    INSERT ... ON CONFLICT         upsert single row via name='primary' sentinel
    │
    ▼
profile_{jurisdictional,capital,health,family} (1 row each, last_updated weekly)


Read path (REFLECT / COACH / PSYCHOLOGY message or /profile command):

Greg sends message
    │
    ▼
Chris engine mode detection
    │
    ├─ getOperationalProfiles()         src/memory/profiles.ts — DB read, null for missing/low-confidence
    ├─ formatProfilesForPrompt()        human-formatted string or "" if all null
    ├─ buildSystemPrompt(mode, pensieveCtx, relationalCtx, { operationalProfiles })
    └─ Sonnet call with enriched prompt


/profile command path:

Greg sends /profile
    │
    ▼
handleProfileCommand()                  src/bot/handlers/profile.ts
    ├─ getOperationalProfiles()
    └─ 4x ctx.reply(formatProfileSection(profile, lang))   plain text, one per profile
```

---

## Integration Points (Named Module Edges)

| Edge | From | To | Contract |
|------|------|----|----------|
| Cron → orchestrator | `src/cron-registration.ts:registerCrons()` | `src/memory/profile-updater.ts:updateAllOperationalProfiles()` | CRON-01 try/catch, fire-and-forget |
| Orchestrator → 4 generators | `profile-updater.ts` | each `src/memory/profiles/{name}.ts:update{Name}Profile()` | `Promise.allSettled`, discriminated result |
| Generator → substrate reader | each generator | `src/memory/profiles/shared.ts:loadProfileSubstrate()` | async, typed `ProfileSubstrate` |
| Substrate → Pensieve | `shared.ts` | direct Drizzle on `pensieve_entries` WHERE epistemic_tag IN (...) | no new retrieve.ts function needed |
| Substrate → episodic | `shared.ts` | `src/pensieve/retrieve.ts:getEpisodicSummariesRange()` | already exported, zero M010 callers before Phase 34 |
| Substrate → decisions | `shared.ts` | direct Drizzle on `decisions` WHERE status IN ('resolved','reviewed') | domain_tag filter applied in query |
| Generator → Sonnet | each generator | `src/llm/client.ts:anthropic.messages.parse()` | `zodOutputFormat(v4Schema)` + v3 re-validate |
| Generator → DB upsert | each generator | Drizzle `db.insert(profile_{name}).onConflictDoUpdate({target: name})` | single-row sentinel, idempotent |
| Reader API → mode handler | `src/memory/profiles.ts:getOperationalProfiles()` | `src/chris/modes/{reflect,coach,psychology}.ts` | returns typed `OperationalProfiles` |
| Mode handler → buildSystemPrompt | mode handler | `src/chris/personality.ts:buildSystemPrompt()` | new `extras.operationalProfiles` field |
| Bot command → reader | `src/bot/handlers/profile.ts` | `src/memory/profiles.ts:getOperationalProfiles()` | same reader as mode handlers |

---

## Component Boundaries

| Component | File(s) | Responsibility | Communicates With |
|-----------|---------|---------------|-------------------|
| Cron registration | `src/cron-registration.ts` | Weekly Sunday 21:00 cron wiring | `profile-updater.ts` |
| Profile orchestrator | `src/memory/profile-updater.ts` | `Promise.allSettled` fan-out, outcome logging | all 4 generators |
| Shared substrate reader | `src/memory/profiles/shared.ts` | Read Pensieve + episodic + decisions, enforce 10-entry threshold | Pensieve entries (Drizzle), `getEpisodicSummariesRange`, decisions (Drizzle) |
| Jurisdictional generator | `src/memory/profiles/jurisdictional.ts` | Zod schemas + Sonnet prompt + upsert for jurisdictional | `shared.ts`, `llm/client.ts`, DB |
| Capital generator | `src/memory/profiles/capital.ts` | Same for capital | `shared.ts`, `llm/client.ts`, DB |
| Health generator | `src/memory/profiles/health.ts` | Same for health | `shared.ts`, `llm/client.ts`, DB |
| Family generator | `src/memory/profiles/family.ts` | Same for family | `shared.ts`, `llm/client.ts`, DB |
| Reader API | `src/memory/profiles.ts` | `getOperationalProfiles()`, `formatProfilesForPrompt()` | DB (read-only), mode handlers, /profile command |
| Bot command handler | `src/bot/handlers/profile.ts` | `/profile` display, EN/FR/RU localized formatting | reader API |
| buildSystemPrompt | `src/chris/personality.ts` | System prompt assembly with new `extras: ChrisContextExtras` | mode handlers |

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Routing operational profiles through the ritual subsystem

**What people do:** Add a `rituals` row with `name = 'operational_profile_update'` and implement a handler in `dispatchRitualHandler`.
**Why it's wrong:** The ritual subsystem's invariants (skip-tracking, adjustment dialogue, response windows, catch-up ceiling) all become dead code for a profile that fires silently with no user-facing event. The `RitualConfigSchema` `.strict()` mode requires fields that have no meaning for a data pipeline step.
**Do this instead:** 4th cron in `registerCrons` as documented in Question 1.

### Anti-Pattern 2: Mega-prompt for all 4 profiles in one Sonnet call

**What people do:** Pass all four profile schemas to a single Sonnet call and ask it to return a JSON object with four top-level keys.
**Why it's wrong:** A single prompt assembling 30+ days of Pensieve entries for all four domains simultaneously exceeds the context budget that produces high-quality Sonnet output. Errors in one domain contaminate the full response (one Zod parse failure = all four profiles fail). Error isolation requires separate calls.
**Do this instead:** 4 separate Sonnet calls via `Promise.allSettled` as documented in Question 2.

### Anti-Pattern 3: Delta (incremental) profile updates

**What people do:** Include the previous profile state in the Sonnet prompt and ask Sonnet to produce a JSON patch.
**Why it's wrong:** Wrong values from week N become authoritative "prior state" in week N+1's prompt, compounding over time. Delta also requires a merge/patch implementation that is significantly more complex to test.
**Do this instead:** Full regeneration from substrate on every weekly run as documented in Question 3.

### Anti-Pattern 4: Consumer-side confidence threshold check

**What people do:** Have REFLECT/COACH/PSYCHOLOGY mode handlers call `getOperationalProfiles()` and then check `if (profile.confidence < 0.3)` before injecting.
**Why it's wrong:** Duplicates the threshold logic at every consumer. A future change to the threshold requires updating multiple files. The reader API owns the data-quality contract.
**Do this instead:** Confidence gating inside `getOperationalProfiles()` as documented in Question 4.

### Anti-Pattern 5: Adding `operationalProfiles` as a 6th positional argument to `buildSystemPrompt`

**What people do:** Append `operationalProfiles?: string` after `declinedTopics` in the existing positional-argument signature.
**Why it's wrong:** The existing signature already has an ACCOUNTABILITY overload documented at `personality.ts:79-87` that repurposes positional slots with different semantics. Adding a 6th positional argument deepens this confusion and makes the ACCOUNTABILITY call site even harder to reason about.
**Do this instead:** Fold into `extras: ChrisContextExtras` named object as documented in Question 4.

---

## Open Architecture Questions Requiring Phase-Level Research

**OQ-1: Pensieve filtering strategy for "domain-relevant entries."**
How does `loadProfileSubstrate()` filter Pensieve entries for a specific profile domain? Options:
- (A) Keyword filter in SQL (`WHERE content ILIKE '%location%' OR content ILIKE '%residency%' ...`) — cheap but brittle for French/Russian content
- (B) Full semantic search via embedding similarity against a profile-domain query string — accurate, but requires an embedding call per profile per week
- (C) Epistemic tag filter only (FACT + RELATIONSHIP + INTENTION + EXPERIENCE), no domain filtering; let Sonnet ignore irrelevant entries

**Recommended starting point:** Option C, with a recency window (last 30 days). If synthetic fixture tests show Sonnet producing profile values contaminated by irrelevant entries, upgrade to Option A with EN/FR/RU keyword lists. Embedding search (B) is deferred — adds latency and complexity for marginal gain at M010 scale.

**OQ-2: Confidence calibration instruction phrasing.**
Instructing Sonnet to self-report a calibrated confidence score is a prompt-level behavior. Phase 36's live integration test must validate calibration on both sparse (5 entries) and rich (30+ entries) fixtures. The specific instruction text needs to be finalized during Phase 34 planning and locked as a HARD CO-LOC in the generator files.

**OQ-3: `buildSystemPrompt` signature change blast radius.**
The `extras: ChrisContextExtras` refactor touches every call site in the engine. The full list of callers must be inventoried during Phase 35 planning. The ACCOUNTABILITY overload (documented in `personality.ts:79-87`) must be preserved exactly — ACCOUNTABILITY passes decision context in `pensieveContext` slot and temporal-Pensieve block in `relationalContext` slot; it does not use `extras.operationalProfiles`.

**OQ-4: `synthesize-delta.ts` `--profile-bias` implementation boundary.**
The `--profile-bias` flag must ensure that biased entries still read as natural Greg-style journal content. The implementation must be validated during Phase 36 planning to confirm the 10-entry threshold can be crossed deterministically on the 30-day fixture.

---

## Sources

All findings are HIGH confidence — derived from direct codebase inspection.

- `/home/claude/chris/src/rituals/scheduler.ts` — `dispatchRitualHandler`, `runRitualSweep`, `ritualResponseWindowSweep`, catch-up ceiling
- `/home/claude/chris/src/rituals/types.ts` — `RitualConfigSchema` (`.strict()`, named fields), `RitualFireOutcome`
- `/home/claude/chris/src/cron-registration.ts` — `registerCrons`, `CronRegistrationStatus`, `RegisterCronsDeps` interface
- `/home/claude/chris/src/chris/personality.ts` — `buildSystemPrompt`, `CONSTITUTIONAL_PREAMBLE`, ACCOUNTABILITY overload documentation at lines 79-87
- `/home/claude/chris/src/memory/context-builder.ts` — `buildPensieveContext`, `buildRelationalContext` patterns
- `/home/claude/chris/src/episodic/consolidate.ts` — `runConsolidate` error-isolation contract, dual-schema pattern at lines 33-81
- `/home/claude/chris/src/rituals/weekly-review.ts` — `fireWeeklyReview`, `generateWeeklyObservation`, v3/v4 dual schema pattern
- `/home/claude/chris/src/bot/handlers/summary.ts` — canonical `/summary` bot command pattern for `/profile` design
- `/home/claude/chris/src/db/schema.ts` — existing table shapes, enum definitions, drizzle patterns
- `/home/claude/chris/.planning/PROJECT.md` — D028, D029, D031, D034, D035, D038, D040, D041; M010 current milestone section
- `/home/claude/chris/M010_Operational_Profiles.md` — spec

---
*Architecture research for: M010 Operational Profiles integration into Chris*
*Researched: 2026-05-11*
