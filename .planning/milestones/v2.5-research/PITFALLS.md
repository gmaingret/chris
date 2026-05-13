# Pitfalls Research

**Domain:** M010 Operational Profiles — adding profile inference + storage + read APIs to an existing single-user self-hosted Telegram bot (Project Chris)
**Researched:** 2026-05-11
**Confidence:** HIGH (all pitfalls grounded in M006-M009 production incidents, direct code inspection of the substrate being extended, and the M010 spec text)

---

## Critical Pitfalls

### Pitfall M010-01: Sparse-Data Confidence Inflation

**What goes wrong:**
The 10-entry threshold gate correctly prevents profile population below minimum signal. But the threshold is a binary gate, not a continuous calibration. A profile populated from exactly 10 entries can display `confidence: 0.8` if Sonnet finds the entries consistent — even though 10 entries of jurisdictional data is one month of Greg saying roughly the same thing. The confidence number misleads both the system prompt injection and Greg's `/profile` output. Chris injects "confidence: 0.82" profile data into REFLECT/COACH/PSYCHOLOGY mode handlers and speaks about Greg's jurisdictional situation as established fact when the actual substrate is thin.

**Why it happens:**
Sonnet is instructed to compute confidence from "data volume + consistency." It interprets "consistency" well but has no objective anchor for what volume means. With 10 entries all saying "I live in France," consistency is perfect, so Sonnet inflates confidence toward 0.8–0.9. The prompt has no floor below which high consistency cannot yield high confidence.

**How to avoid:**
Two-axis confidence formula enforced in the Sonnet structured-output prompt:

`confidence = consistency_score × volume_weight`

where `volume_weight` is a non-negotiable multiplier based on entry count:
- 10–19 entries → volume_weight ≤ 0.5 (regardless of consistency)
- 20–49 entries → volume_weight ≤ 0.75
- 50+ entries → volume_weight = 1.0

The formula must appear verbatim in the Sonnet system prompt, not left to Sonnet to infer. Enforce at parse time via Zod schema: if the substrate entry count is below 20 and Sonnet returns `confidence > 0.5`, the Zod parse fails and the retry loop applies (same pattern as Stage-1 refine in weekly-review.ts). This requires the entry count to be passed alongside the structured-output response for validation.

Per-dimension thresholds are also needed: the four profiles have different data densities. Health entries accumulate slowly because Greg deposits health hypotheses infrequently. Family milestones are rarer still. The global 10-entry threshold is a floor; each profile prompt must include dimension-specific guidance ("for health dimension: confidence above 0.4 requires at least 15 entries explicitly referencing symptoms or hypotheses").

**Warning signs:**
- A freshly-seeded 10-entry fixture returning confidence > 0.5 on the first weekly cron fire
- The sparse 5-entry fixture test passing threshold enforcement but the 10-entry fixture producing confidence >= 0.75
- Profile confidence does not increase week-over-week as new entries accumulate

**Phase to address:**
Schema + prompt design phase (whichever phase writes the four Sonnet prompts and the Zod output schema). Confidence ceiling enforcement must be in the same plan as the Zod output schema — HARD CO-LOCATION constraint analogous to M009 Pitfall 28's migration + meta snapshot + scripts/test.sh psql line constraint.

---

### Pitfall M010-02: Hallucinated Profile Facts

**What goes wrong:**
Sonnet bridges substrate gaps by plausible inference. Given "Greg mentions moving to France" and "Greg mentions a bank account in Estonia," Sonnet may infer "Greg is tax-resident in Estonia" and emit it as a profile field with confidence 0.7. Greg never told Chris this. The jurisdictional profile becomes a mix of facts and Sonnet inferences, then `getOperationalProfiles()` injects this into REFLECT/COACH/PSYCHOLOGY system prompts as "grounded context." Chris starts referencing Estonia tax residency as established fact in conversations. Greg notices and trust breaks.

The M006 constitutional preamble forbids hallucination, but it is written for conversational contexts. In structured-output mode (the profile update calls), Sonnet is filling schema fields, not conversing. The preamble's "never state as fact anything Greg has not told you" constraint applies but is less salient when Sonnet is filling a `tax_structure` JSON field versus composing a paragraph.

**Why it happens:**
The M010 spec says profiles update from "observable facts." But Sonnet's definition of observable includes logical inference from stated facts. "Has a bank account in Estonia → probably has Estonian tax obligations" is Sonnet-plausible even if Greg never said it. There is no runtime mechanism to distinguish fact from inference in the structured output.

**How to avoid:**
Per-field source-citation requirement in the Sonnet output schema. Each non-null profile field must include a `sources` array of Pensieve entry IDs. The Zod schema requires `sources: z.array(z.string().uuid()).min(2)` for any non-null field. Fields without two distinct sources must be null.

Add an explicit "DO NOT INFER" directive to each profile prompt (part of the shared prompt builder — see Pitfall M010-06): "Output only facts that appear verbatim or near-verbatim in the substrate entries below. If you are bridging from one fact to another by logical inference, mark the field null rather than filling it. An inferred fact is worse than a null field."

Optional post-check (higher quality, higher cost): after each Sonnet structured-output call, run a Haiku post-check that verifies each populated field can be plausibly traced to a substrate entry. This mirrors the M009 date-grounding post-check pattern from `runDateGroundingCheck` in weekly-review.ts. Cost: 4 additional Haiku calls per weekly profile update — ~$0.0012/week additional.

**Warning signs:**
- Profile fields reference specific entities (countries, banks, tax structures) not explicitly mentioned in the substrate entries passed to the prompt
- `sources` arrays in the structured output contain UUIDs not present in the substrate input
- Confidence scores on fields that should be "unknown" are non-zero

**Phase to address:**
Prompt + schema phase. The source-citation Zod schema is a HARD CO-LOCATION with the structured-output schema — cannot be added after the fact without a schema migration for the profile JSONB columns.

---

### Pitfall M010-03: Profile Drift / Regression Without Snapshot History

**What goes wrong:**
Week N: jurisdictional profile says `residency: France, confidence: 0.85`. Week N+1: Greg deposits several entries about a potential move to Portugal (speculative). Sonnet over-weights recent signal and updates `residency: France/Portugal (uncertain), confidence: 0.55`. Week N+2: Greg decides against Portugal. Sonnet re-analyzes and produces `residency: France, confidence: 0.85` again. The regression went undetected. No one knows the profile fluctuated.

A worse variant: the N+1 update introduces a factual error (Sonnet misreads a date as Portugal-planning context) and the error propagates until the next re-analysis catches it — two weeks of wrong profile data injected into mode handlers.

**Why it happens:**
The weekly cron does a full regeneration from scratch each time. Without a snapshot of the previous state, there is no baseline to diff against. Regression is invisible. The `profile_history` table mentioned in the M010 spec does not exist yet.

**How to avoid:**
Two mitigations, both required:

1. **Feed previous profile state into the weekly Sonnet prompt.** The prompt includes a "CURRENT PROFILE STATE" section with the prior week's fields and confidence. Instruct Sonnet: "If any field changes from the previous state, explain why in a `change_rationale` string field. A change in a high-confidence field requires at least 3 new substrate entries explicitly supporting the change." This turns each update from pure generation into a grounded diff. Without this, Sonnet over-weights whatever entries are most recent regardless of prior established state.

2. **`profile_history` table:** before each weekly upsert, INSERT the current profile row into `profile_history` with a `generated_at` timestamp. This costs ~4 rows per week (one per dimension). At 52 weeks/year = ~208 rows — trivially small. The history table enables the successive-fire regression test (Pitfall M010-10) and lets Greg query "what did my profile say three weeks ago."

The `profile_history` table must ship in the same migration as the four profile tables. Retrofitting it later means a migration that adds the table and has no historical rows to backfill.

**Warning signs:**
- Profile confidence oscillates more than 0.2 week-over-week without a corresponding burst of new substrate entries
- A field that was confidently populated (>= 0.7) becomes null then repopulates
- No `profile_history` table exists in the schema

**Phase to address:**
Schema phase (history table lands in the same migration as the profile tables). Prompt phase (previous-state injection requires the history table to exist first — the prompt reads the most recent `profile_history` row as its prior state input).

---

### Pitfall M010-04: Weekly Cron Timing Collision with weekly_review

**What goes wrong:**
weekly_review fires Sunday 20:00 Paris. If operational profile update fires Sunday 21:00 Paris, and weekly_review triggers its retry loop (MAX_RETRIES=2, each retry is ~30s Haiku call + ~18s Sonnet call = ~50s/retry), weekly_review could still be running when profile update starts. Both handlers share the Anthropic client. Five concurrent Sonnet calls (4 profile + 1 weekly_review) could hit Anthropic rate limits or degrade response quality. Even without rate limits, interleaved logs from two cron handlers executing simultaneously are harder to debug.

Production baseline for weekly_review: 18 seconds (2026-05-10 first fire). Under adversarial conditions (2 retries × ~50s each = 100s), weekly_review could run for ~118s. A 1-hour gap means profile update starts ~3,482s after weekly_review; fine. But a 10-minute gap (e.g., 20:10 Paris for profile) would overlap.

**Why it happens:**
The M010 spec says "weekly cron" without specifying the fire time or its relationship to weekly_review. The natural implementation choice of "one hour after weekly_review" is tight but usually fine. "Ten minutes after" creates a real collision risk.

**How to avoid:**
Set profile update to Sunday 22:00 Paris — two hours after weekly_review. This gives the weekly_review retry window ample buffer even under worst-case adversarial conditions. Document the timing relationship in the cron seed migration SQL:

```sql
-- Profile update fires at 22:00 Paris (2h after weekly_review at 20:00).
-- Gap ensures weekly_review's MAX_RETRIES=2 loop (worst case ~120s) completes
-- before profile Sonnet calls start. See M010 PITFALLS.md Pitfall M010-04.
```

**Warning signs:**
- Logs show `rituals.weekly.fire.start` and `profile.update.start` within 60 seconds of each other
- Anthropic rate-limit errors (`429`) appearing in Sunday evening logs
- Two SONNET_MODEL calls active simultaneously per log timestamps

**Phase to address:**
Cron registration phase for M010. The timing must be documented in the seed migration comment. The migration + drizzle meta snapshot + scripts/test.sh psql line must land in one atomic plan (same HARD CO-LOCATION constraint as M009's Phase 28).

---

### Pitfall M010-05: Synthetic Fixture Dimension Coverage Gap

**What goes wrong:**
The M010 synthetic fixture must produce 30+ days of data covering all four profile dimensions. But `scripts/synthesize-delta.ts` generates entries by mimicking Greg's Telegram voice via Haiku style-transfer from organic few-shot examples. The Haiku prompt (`buildHaikuSystemPrompt`) says "match topic distribution" — so synthetic entries inherit the organic data distribution, which skews heavily toward journal/introspective entries. Greg's organic data has sparse coverage of jurisdictional facts, capital decisions, and health hypotheses (these are deposited infrequently in real life).

Result: a 30-day synthetic fixture produces ~25 introspective entries, ~3 capital mentions, ~1 health mention, 0 jurisdictional entries. The threshold-enforcement test passes (entry counts below 10 for all dimensions). But the "populated case" test fails because no dimension reaches 10 relevant entries. The M010 synthetic fixture is permanently stuck in "sparse data" mode — it tests threshold enforcement but cannot test what happens when profiles populate.

Direct code inspection of `synthesize-delta.ts` confirms: there is no `--topic-bias` flag, no per-milestone topic configuration, and `buildHaikuSystemPrompt` has no parameter for steering content toward specific domains. Adding this requires modifying the script.

**Why it happens:**
The `synthesize-delta.ts` script was designed for M008/M009 where generic journal entries were sufficient. M010 requires domain-specific substrate. The script's design did not anticipate per-milestone topic biasing.

**How to avoid:**
Add a `--topic-hints` parameter to `synthesize-delta.ts` accepting a JSON file path. The JSON file specifies per-day-range topic directives:

```json
{
  "m010": [
    {"dayRange": [1, 8], "hint": "Include at least one entry about location, residency, or tax situation"},
    {"dayRange": [9, 16], "hint": "Include at least one entry about financial independence, net worth, or investment decisions"},
    {"dayRange": [17, 24], "hint": "Include at least one entry about health, symptoms, or medical hypotheses"},
    {"dayRange": [25, 32], "hint": "Include at least one entry about family planning, relationships, or life milestones"}
  ]
}
```

The hint is appended to the Haiku prompt: "Today's entries should include at least one mention of [hint]. Distribute naturally." The `--milestone m010` flag auto-loads the corresponding hints file.

Additionally: write a HARN-style sanity gate for the M010 fixture: `MIN_JURISDICTIONAL_ENTRIES >= 12`, `MIN_CAPITAL_ENTRIES >= 12`, `MIN_HEALTH_ENTRIES >= 12`, `MIN_FAMILY_ENTRIES >= 12`. The sanity gate runs after fixture generation and must pass before any profile update test runs. This is analogous to HARN-03's `>= 7 summaries / >= 200 entries` gate from M009 Phase 30.

The fixture sanity gate is part of the fixture acceptance criterion, not discovered at test-run time.

**Warning signs:**
- Running the M010 fixture through `getOperationalProfiles()` returns "insufficient data" for 3 or 4 dimensions after 30 days of synthetic data
- The populated-case profile test is permanently in `describe.skip` state waiting for fixture generation that never produces enough signal
- No HARN sanity gate exists for per-dimension entry counts

**Phase to address:**
Test infrastructure phase (must precede the profile update cron handler phase). The topic-bias mechanism must land before the cron handler is written — otherwise there is no fixture to validate against. This phase is analogous to M009's Phase 24 primed-fixture pipeline.

---

### Pitfall M010-06: Four-Prompt Prompt Drift

**What goes wrong:**
M010 requires four separate Sonnet prompts — one per profile dimension. Each prompt needs: CONSTITUTIONAL_PREAMBLE injection (M009 Pitfall 17), anti-hallucination "DO NOT INFER" directive (Pitfall M010-02), source-citation schema (Pitfall M010-02), previous-state injection (Pitfall M010-03), and volume-weight confidence ceiling (Pitfall M010-01). That is five structural requirements shared across four prompts.

In M009, there was one cron prompt (weekly_review) and one CONSTITUTIONAL_PREAMBLE grep guard. In M010, there are four cron prompts. When the "DO NOT INFER" directive is refined after observing a hallucination, the developer updates the jurisdictional prompt but forgets health and capital. Three weeks later, health produces an inferred fact. The grep guard catches drift in each file individually but does not catch when one file is updated and the others are not synchronized.

**Why it happens:**
Four separate prompt files are the natural structure but create four independent drift surfaces. The M009 weekly_review pattern (one prompt file, one grep guard) does not scale to four prompts without a shared abstraction layer.

**How to avoid:**
Shared prompt builder function: `assembleProfilePrompt(dimension, substrate, prevState, entryCount)` is a single pure function that:
1. Injects CONSTITUTIONAL_PREAMBLE (shared named constant)
2. Injects the DO_NOT_INFER_DIRECTIVE (shared named constant)
3. Injects the volume-weight confidence ceiling formula (shared named constant)
4. Injects the previous-state section (shared logic, per-dimension data)
5. Injects the dimension-specific substrate, field schema, and dimension-specific guidance

The dimension-specific parts are config objects (`JURISDICTIONAL_PROFILE_CONFIG`, `CAPITAL_PROFILE_CONFIG`, `HEALTH_PROFILE_CONFIG`, `FAMILY_PROFILE_CONFIG`) passed to the builder. When the "DO NOT INFER" directive is updated, it is updated in one place.

Structural test: `assembleProfilePrompt` called with each of the four dimension configs must produce output that includes CONSTITUTIONAL_PREAMBLE and DO_NOT_INFER_DIRECTIVE. The test calls all four variants and asserts each output starts with the preamble (mirrors the M009 weekly-review-prompt.test.ts CONSTITUTIONAL_PREAMBLE-first assertion at line 513).

**Warning signs:**
- One profile dimension produces hallucinated facts while others don't
- The DO_NOT_INFER_DIRECTIVE appears in 2 of 4 prompt outputs
- Code review finds divergent phrasing of the same constraint across dimension files

**Phase to address:**
Prompt architecture phase — the shared builder must be the first artifact written in the prompt phase, before any per-dimension prompts. Analogous to M009's Phase 29 Plan 01 writing `assembleWeeklyReviewPrompt` before Plan 02 wired the Sonnet call.

---

### Pitfall M010-07: /profile Command Leaking Internal Field Names

**What goes wrong:**
The `/profile` command calls `getOperationalProfiles()`, which returns structured Drizzle-typed objects with JSONB fields. The developer formats the Telegram response by serializing the objects directly. Greg sees:

```
{"residency": "France", "tax_structure": {"primary": "French income tax"}, "confidence": 0.72}
```

instead of a readable summary. This is the exact pattern that failed in M009's first-Sunday weekly_review fire: the 29-VERIFICATION.md documents "third-person framing reads as documentation rather than conversation." The `/profile` equivalent is a JSON dump reading as a database export rather than a personal profile summary.

The M009 retrospective is explicit: the weekly_review shipped with "ask Greg ONE Socratic question" wording that produced third-person framing ("Is there a cost Greg is not accounting for"). Fixed post-fire with a "second-person addressing as an explicit prompt directive" pattern. The `/profile` command has the same failure mode before the formatter layer is built.

**Why it happens:**
`getOperationalProfiles()` returns types designed for injection into mode handler system prompts (machine-readable structured data), not for direct user display. Without an explicit formatter layer, the temptation is to JSON.stringify the result and send it.

**How to avoid:**
Explicit formatter function: `formatProfileForDisplay(profiles: OperationalProfiles): string` is a pure function that converts structured profile objects into a user-readable Telegram message in second person ("You're currently in France..."), omitting null fields, and replacing zero-confidence fields with actionable messaging ("Building your jurisdictional profile — Chris needs ~8 more entries about your location and tax situation").

Golden-output snapshot test: the formatter test uses a fixed `MOCK_PROFILES` fixture (covering all four dimensions, including null fields, zero-confidence fields, and "insufficient data" markers) and asserts the output matches a stored golden string. Any change to the formatter output requires updating the golden string, making regressions visible at test time rather than at the next `/profile` invocation.

The formatter and its golden-output test ship in the same plan as the `/profile` command handler — HARD CO-LOCATION.

**Warning signs:**
- `/profile` output in development shows raw field names (`tax_structure`, `fi_phase`, `open_hypotheses`)
- The Telegram message contains `null` or `{}` literals
- The Telegram message addresses Greg in third person

**Phase to address:**
`/profile` command phase. The formatter ships in the same plan as the command handler.

---

### Pitfall M010-08: Mode Handler Context Injection Unintended Consequences

**What goes wrong:**
REFLECT, COACH, and PSYCHOLOGY mode handlers are extended to call `getOperationalProfiles()` and inject the result into their system prompts as "grounded context." Three distinct failure modes:

(a) **Stale profile in wrong direction:** Greg's jurisdictional profile says "considering a move to Portugal" (from 3 weeks ago when he was evaluating it). He has since decided against it. REFLECT mode references "your ongoing consideration of Portugal" as grounded context in a conversation about something unrelated. Factually wrong and confusing.

(b) **Inappropriate salience:** A health profile entry about "low cortisol hypothesis" is injected into COACH mode's system prompt. Greg asks a coaching question about his business strategy. Chris steers toward health topics without being asked because the health context is salient in the 2000-token system prompt addition.

(c) **Token cost creep:** Four profile summaries at ~500 tokens each = 2000 additional tokens per mode handler call. At 4 Telegram messages per day = ~8000 additional tokens/day. At $3/million tokens (Sonnet 4.6 input) = ~$0.024/day = ~$0.72/month. Marginal but compounds with profile growth over M011/M012.

**Why it happens:**
"Inject all profiles into all modes" is the simplest implementation but the least precise. Each mode has different reasoning objectives; not all profile dimensions are relevant to all modes at all times.

**How to avoid:**
Per-mode profile injection mapping, defined as a named constant in `src/memory/profiles.ts`, not inline logic in each mode handler:

```typescript
export const PROFILE_INJECTION_MAP = {
  REFLECT: ['jurisdictional', 'capital', 'health', 'family'], // full context
  COACH: ['capital', 'family'], // decisions + constraints only
  PSYCHOLOGY: ['health', 'jurisdictional'], // clinical + situational grounding
} as const;
```

Health profile injected into any mode only when `confidence >= 0.5` — avoid injecting speculative health hypotheses as grounded facts.

Staleness guard: if `profile.last_updated` is more than 21 days ago, inject the profile with an explicit staleness marker in the system prompt: "Note: profile data from [date] — may not reflect current state." Prevents Chris from treating a 6-week-old jurisdictional profile as current.

A unit test verifies the mapping: call `getProfileContextForMode('COACH')` and assert it returns only capital + family dimensions, not health or jurisdictional.

**Warning signs:**
- COACH mode conversations drift toward health topics without user initiation
- Greg corrects Chris about a profile fact that was updated 4 weeks ago
- System prompt token counts increase by > 2000 per message after M010 deploy

**Phase to address:**
Mode handler injection phase. The per-mode mapping must be designed and coded before any handler is modified. Modifying each handler independently without a shared mapping means each developer makes independent injection scope decisions.

---

### Pitfall M010-09: Cron Re-Run Idempotency / Double-Update

**What goes wrong:**
The weekly profile update cron fires twice in one week. This is the M009 class of bug: the `tryFireRitualAtomic` `lt` vs `lte` predicate failure caused rituals to not fire at all; the analog here is a predicate error that causes the profile update to fire twice (e.g., `next_run_at` is not advanced after the first fire due to a bug in the upsert).

Because Sonnet is non-deterministic, the two calls produce slightly different profiles. The second update silently overwrites the first with a subtly different result. No error fires. The profile oscillates invisibly. The M009 retrospective is explicit: "Test 'fires N times in a row' for every ritual-class behavior."

**Why it happens:**
Profile update uses `INSERT ... ON CONFLICT (id) DO UPDATE` semantics. Any fire that reaches the upsert will overwrite the previous profile. Without an idempotency guard, double-fire produces non-deterministic drift.

**How to avoid:**
Substrate fingerprint: compute a hash of the Pensieve entry IDs + episodic summary IDs used in this window. Store the hash in the profile row as `substrate_hash`. Before running the Sonnet update, check if `substrate_hash` matches the current substrate. If yes, skip the LLM call and emit `profile.update.skipped.same_substrate`. This makes the update idempotent for the same substrate, which is the dominant case in a double-fire scenario.

`substrate_hash` must be a column in all four profile tables, shipped in the initial migration.

The successive-fire regression test (Pitfall M010-10's two-cycle test) covers this: the second cycle in the test uses the same substrate hash and asserts the LLM calls are skipped (verified via `expect(mockAnthropicCreate).not.toHaveBeenCalled()` on the second cycle if substrate is unchanged). This mirrors the cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` afterAll invariant established in M009 as the Pitfall 6 mitigation.

**Warning signs:**
- Two `profile.update.start` log events within the same 7-day window
- `profile_history` shows two rows for the same week and dimension
- Profile confidence oscillates week-over-week without new substrate entries

**Phase to address:**
Cron handler implementation phase. `substrate_hash` column must be in the initial migration (schema phase). The skip guard must be in the same plan as the upsert logic.

---

### Pitfall M010-10: First-Fire Celebration Blindness (Profile Edition)

**What goes wrong:**
The M010 profile update cron fires Week 1. All four dimensions populate. The synthetic fixture test passes. The milestone closes.

Week 2: the profile update fires again. `getOperationalProfiles()` reads the previous profile state to inject into the Sonnet prompt (per Pitfall M010-03's previous-state injection). The Week 1 upsert stored the `profile_jurisdictional` row's `residency_statuses` JSONB column with a shape that slightly differs from what the Week 2 reader's Zod schema expects (e.g., a field name changed between the Week 1 implementation commit and a Week 2 schema-cleanup commit). The Zod parse fails on read. The previous-state injection is null. The Week 2 prompt runs without prior context. Output is degraded — the profile loses Week 1 detail — but no error alarm fires.

This is the M009 `lt` vs `lte` pattern (2026-05-05 production incident): "a bug that only manifested after the FIRST fire because the Week 1 write becomes Week 2's read input." The M009 retrospective added "second-fire+" regression tests to every cron handler as the direct lesson.

**Why it happens:**
The Week 1 fire is covered by the synthetic fixture test (single cycle). The Week 2 fire is not tested because the synthetic fixture only runs one weekly cycle. The second-fire regression pattern from M009 Phase 25 must be explicitly carried forward.

**How to avoid:**
The M010 synthetic fixture test must run two consecutive weekly profile update cycles:

- **Cycle 1:** Profile tables start empty. Run update. Assert all four dimensions populate with correct confidence. Assert `profile_history` has 1 row per dimension.
- **Cycle 2** (same fixture, one week later via `vi.setSystemTime`): Run update again. Assert: (a) all four profiles still populated, (b) `last_updated` advanced by exactly 7 days, (c) previous-state injection was non-null (verified via mock SDK boundary test: `expect(mockAnthropicCreate.mock.calls[N][0].system[0].text).toContain('CURRENT PROFILE STATE')`), (d) `profile_history` has exactly 2 rows per dimension.

Cycle 2 is the regression detector for the schema-mismatch failure mode. If the Zod parse of the Week 1 row fails in Week 2, the previous-state injection is null, and the mock SDK boundary assertion catches it.

This pattern is analogous to M009's idempotency.test.ts `tryFireRitualAtomic` successive-fire assertion (commit `c76cb86` post-fix). The two-cycle test must be written before the cron handler is implemented — the test design constrains the implementation (specifically: the previous-state read must be a typed DB query with versioned Zod parsing, not in-memory state).

**Warning signs:**
- The profile update synthetic fixture test only runs one weekly cycle
- Week 2 profile output lacks fields that Week 1 populated
- `profile_history` shows only one row per dimension after two weeks of production use
- No mock SDK boundary assertion verifies previous-state injection in the second cycle

**Phase to address:**
Test phase. The two-cycle test structure must be designed before the cron handler phase — analogous to how M009's Phase 30 synthetic fixture test was designed after the handler phases (25-29) but before milestone close.

---

### Pitfall M010-11: Drizzle JSONB Column Schema Evolution Failure

**What goes wrong:**
M010 ships four profile tables, each with JSONB columns for complex fields (`residency_statuses`, `open_hypotheses`, `fi_phase`, etc.). M011 adds a new field to `profile_health.open_hypotheses` (e.g., `severity` on each hypothesis). Old `profile_health` rows (from M010 era) pass the M010 Zod schema. The new M011+ code uses the updated schema, which has `severity` as required. Parsing an M010-era row against the M011 schema throws a Zod error. `getOperationalProfiles()` crashes. REFLECT/COACH/PSYCHOLOGY mode handlers fail to inject profile context, silently degrading to no-profile mode for one week until the next weekly cron fire regenerates the row.

**Why it happens:**
JSONB columns are schema-less at the DB level. Zod enforces schema at the application level. When the application schema evolves, old rows fail the new schema validation. Standard JSONB versioning problem — well-known but easy to neglect at design time when only M010 is in scope.

**How to avoid:**
`schema_version INTEGER NOT NULL DEFAULT 1` column on each profile table, shipped in the initial M010 migration. `getOperationalProfiles()` reads `schema_version` first, then selects the appropriate Zod schema from a registry:

```typescript
const PROFILE_SCHEMAS: Record<number, z.ZodType> = {
  1: ProfileJurisdictionalSchemaV1,
  // M011 adds: 2: ProfileJurisdictionalSchemaV2
};
```

If `schema_version` has no registered parser, return `{ profile: null, reason: 'schema_version_unsupported' }` rather than throwing. Mode handlers check for null and skip injection gracefully (log a warning, continue without profile context — do not crash).

The migration that bumps `schema_version` in M011 must also update any live rows' `schema_version` if the change is backward-compatible (ADD field with default), or flag rows for re-generation on the next weekly cron fire if not (set a `needs_regeneration` boolean).

Tolerable-degradation unit test: pass a row with `schema_version: 999` to `getOperationalProfiles()` and assert it returns null with the `schema_version_unsupported` reason rather than throwing.

**Warning signs:**
- `schema_version` column is absent from the profile table schema (M010 didn't include it)
- `getOperationalProfiles()` throws a Zod parse error after an M011 deploy
- REFLECT/COACH/PSYCHOLOGY mode handlers silently omit profile context after a schema-changing deploy

**Phase to address:**
Schema phase (M010). `schema_version` must be in the initial profile table schema. Adding it in M011 requires a migration to add the column and backfill existing rows — doable but adds migration complexity and risks a deployment window where the column does not exist yet.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Single global 10-entry threshold (no per-dimension thresholds) | Simpler prompt + schema | Health and family dimensions may never reach threshold because data is inherently sparse; profiles stay permanently "insufficient" for those dimensions | Never — per-dimension guidance in each profile prompt is required |
| No `profile_history` table | One fewer table + migration | Profile regression is invisible; successive-fire (Week 2) test is impossible; no recovery path when a field drifts wrong | Never — history table must ship in M010 initial migration |
| Injecting all four profiles into all three mode handlers unconditionally | Simpler injection code | Health profile in COACH mode causes topic drift; token cost 2× expected; stale jurisdictional data referenced inappropriately | Never — per-mode mapping must be a named constant |
| No `substrate_hash` idempotency guard | Simpler cron handler | Double-fire produces non-deterministic profile drift; no defense against the M009 `lt/lte` class of cron predicate bugs | Never — substrate hash must ship in initial profile row schema |
| Formatter-less `/profile` output (raw JSON or direct JSONB serialization) | Zero formatting code | Greg sees a database dump; trust breaks immediately; analogous to M009 weekly_review third-person framing incident | Never — formatter with golden-output test ships in same plan as `/profile` handler |
| Single-cycle (Week 1 only) synthetic fixture test | Faster to write | Second-fire regression is invisible; schema-mismatch bugs in Week 2's previous-state read go undetected until production | Never — two-cycle test is required for every cron handler per M009 lesson |
| No `schema_version` column on profile tables | One fewer column | M011 schema evolution causes Zod parse failures on M010-era rows; mode handlers crash silently | Never — `schema_version` must be in the M010 initial migration |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| DB-backed language detection in profile cron | Skipping `getLastUserLanguageFromDb()` and assuming in-memory `sessionLanguage` is populated | Profile cron fires weekly — in-memory cache is always empty after container restart (the lesson from M009's first-Sunday weekly_review fire: "Cron-context handlers need DB-backed inputs, not in-memory session state"). Use `getLastUserLanguageFromDb()` at cron fire time exactly as `fireWeeklyReview` does post-Phase-32 fix (weekly-review.ts lines 580-583). |
| Substrate fetch scope | Reusing weekly_review's substrate fetch (`loadWeeklyReviewContext`) for profile update | Profile update needs a different substrate slice: FACT + RELATIONSHIP + INTENTION + EXPERIENCE epistemic tags filtered from pensieve_entries, NOT pattern synthesis. Write a separate `loadProfileSubstrate(dimension, weekStart, weekEnd)` function. |
| Drizzle JSONB column reads | Using raw Drizzle query results without Zod parsing | All four profile JSONB columns must go through version-aware Zod parsing on read. Raw Drizzle types for jsonb columns are `unknown`. `getOperationalProfiles()` must parse each JSONB field through the appropriate schema version before returning. |
| Migration sequence + test harness | Adding profile table migrations without extending scripts/test.sh psql apply chain | The HARD CO-LOCATION constraint established in M009 Phase 28 applies: migration SQL file + drizzle meta snapshot + scripts/test.sh psql apply line must land in one atomic plan. Four profile tables = four migrations (or one combined migration) — all must appear in the psql chain. |
| Zod v3/v4 dual schema for structured output | Passing a v3 Zod schema to `zodOutputFormat()` | The Anthropic SDK requires v4 schemas at runtime. Follow the v3/v4 dual pattern established in `src/rituals/weekly-review.ts` (import both `zod` and `zod/v4`; v3 for `.refine()` validation, v4 for `zodOutputFormat()`). All four profile output schemas must follow this dual pattern. |
| CONSTITUTIONAL_PREAMBLE in profile prompts | Omitting CONSTITUTIONAL_PREAMBLE injection in `assembleProfilePrompt` | Profile updates are cron-context (the engine does not auto-inject the preamble). Same failure mode as M009 Pitfall 17. The shared prompt builder injects CONSTITUTIONAL_PREAMBLE as section 1. Grep guard: `grep -c "CONSTITUTIONAL_PREAMBLE" src/memory/profile-prompt.ts` must be >= 2. |
| Parallel vs serial Sonnet calls | Firing 4 profile Sonnet calls serially | Run the four calls via `Promise.all` — each profile dimension is independent. Serial execution is ~4× slower (72s vs ~18s). No data dependency between the four calls. |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| 4 serial Sonnet calls in profile update | Profile update takes 60-120s per weekly fire vs weekly_review's 18s production baseline | Run all 4 calls via `Promise.all`. Each is independent. Wall-clock time drops to ~1 call's latency. | N/A for single user at current scale — but serial calls could collide with the 22:00→22:02 Paris cron tick next week if execution takes >7 days (pathological, not real) |
| Injecting full profile text into all mode handler system prompts without size cap | System prompt grows unboundedly as profiles become more detailed over months | Cap profile injection at 500 tokens per dimension (enforce via character limit in the formatter called by mode handlers). Truncate with "..." marker if over cap. | Starts degrading when profile JSONB fields each exceed ~400 characters of content |
| Querying all four profile tables on every mode handler call | Every Telegram message triggers 4 DB queries for profile data that changes weekly | Cache `getOperationalProfiles()` result in memory for 1 hour (time-based TTL). Invalidate on profile update cron completion. First call per hour hits DB; subsequent calls return cached result. | N/A for single user — but adds ~4ms per message without caching |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Third-person framing in `/profile` output ("Greg's jurisdictional profile: France") | Greg reads a medical chart, not a personal profile | Format in second person: "You're currently in France. Residency status: French resident." — direct lesson from M009 weekly_review first-Sunday fire (29-VERIFICATION.md: "third-person framing reads as documentation rather than conversation") |
| Showing "insufficient data (confidence: 0.0)" for all four dimensions on first `/profile` call | Greg thinks the profile layer is broken | Show a progress indicator: "Building your operational profile — Chris has seen ~3 entries about your location; needs ~7 more before populating your jurisdictional profile." The formatter derives this from the `substrate_entry_count` field stored in the profile row. |
| Injecting `schema_version_unsupported` error text into mode handler system prompts | Chris references "profile unavailable" mid-conversation | Log the error; inject nothing; mode handlers check for null profile and skip injection silently. The error is operator-visible in logs, not user-visible in chat. |
| Profile injection making Chris reference outdated facts as current | Greg: "I decided against Portugal last month. Why is Chris still mentioning it?" | Staleness guard: if `last_updated > 21 days ago`, add a staleness qualifier in the injected context: "Note: profile data from [date] — may not reflect current situation." Mode handler applies this qualifier, not the profile reader. |

---

## "Looks Done But Isn't" Checklist

- [ ] **Two-cycle synthetic fixture test:** Does the test run two `vi.setSystemTime` weekly cycles? Verify: test file has Cycle 1 (populate from empty) and Cycle 2 (update from populated + previous-state injection).
- [ ] **Confidence ceiling Zod enforcement:** Is there a Zod `.refine()` or equivalent that rejects `confidence > 0.5` when substrate entry count < 20? Verify: grep for `volume_weight` or confidence ceiling logic in the Sonnet output schema definition.
- [ ] **Source citation in output schema:** Does the Sonnet structured-output Zod schema require `sources: uuid[]` for non-null fields? Verify: grep for `sources` in the profile output schema Zod definition.
- [ ] **`profile_history` table in migration:** Is `profile_history` present in the M010 migration SQL? Verify: `grep -r "profile_history" src/db/migrations/` returns results.
- [ ] **`schema_version` column in profile tables:** Is `schema_version` in the initial profile table schema? Verify: `grep -r "schema_version" src/db/schema.ts` returns results for profile tables.
- [ ] **`substrate_hash` column in profile tables:** Is `substrate_hash` in the initial profile table schema? Verify: `grep -r "substrate_hash" src/db/schema.ts` returns results.
- [ ] **Golden-output formatter test for `/profile`:** Does a formatter test file exist with a fixed `MOCK_PROFILES` fixture and a stored golden string? Verify: a test file imports `formatProfileForDisplay` and uses `toMatchInlineSnapshot` or equivalent.
- [ ] **DB-backed language detection in profile cron:** Does the profile cron handler call `getLastUserLanguageFromDb()`? Verify: `grep -r "getLastUserLanguageFromDb" src/memory/` returns results.
- [ ] **CONSTITUTIONAL_PREAMBLE grep guard:** Verify: `grep -c "CONSTITUTIONAL_PREAMBLE" src/memory/profile-prompt.ts` returns >= 2.
- [ ] **scripts/test.sh extended for profile migrations:** Verify: grep for each profile migration filename in the psql apply chain in `scripts/test.sh`.
- [ ] **Cron timing documented:** Is Sunday 22:00 Paris with 2h gap rationale documented in the seed migration SQL? Verify: the seed migration has a comment explaining the timing relative to weekly_review.
- [ ] **Per-mode injection mapping is a named constant:** Verify: `grep -r "PROFILE_INJECTION_MAP" src/memory/profiles.ts` returns results.
- [ ] **Fixture HARN sanity gate per dimension:** Does a sanity test assert >= 12 entries per profile dimension? Verify: the fixture sanity test file has four MIN_*_ENTRIES assertions.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| M010-01: Confidence inflation discovered after deploy | LOW | Add volume_weight ceiling to `assembleProfilePrompt` + deploy; next weekly cron fire regenerates with corrected confidence |
| M010-02: Hallucinated fact in production | MEDIUM | Identify hallucinated field via `profile_history`; `UPDATE profile_* SET <field> = null WHERE id = <id>`; add source-citation requirement to prompt; redeploy; next weekly fire corrects |
| M010-03: Profile regression discovered | LOW | Query `profile_history` for last-known-correct state; `UPDATE` to restore; the history table is the recovery mechanism |
| M010-04: Timing collision in production | LOW | Update cron seed migration fire time; apply migration with ON CONFLICT DO UPDATE changing the timing; no data loss |
| M010-05: Synthetic fixture always shows insufficient data | MEDIUM | Add topic-bias to `synthesize-delta.ts`; regenerate fixture; re-run fixture sanity gate; re-run tests |
| M010-06: Prompt drift causing hallucinations | MEDIUM | Add missing directive to drifted prompts via shared builder update; redeploy; next weekly fire corrects; structural test prevents recurrence |
| M010-07: `/profile` showing internal fields | LOW | Implement `formatProfileForDisplay`; redeploy; immediate fix |
| M010-08: Inappropriate topic salience in mode handlers | LOW | Restrict COACH injection to capital + family via PROFILE_INJECTION_MAP; redeploy |
| M010-09: Double-update / profile oscillation | LOW | Add substrate_hash column via migration; add skip guard in cron handler; redeploy |
| M010-10: Week 2 previous-state null injection | MEDIUM | Identify schema mismatch; fix Zod schema; add schema_version reader registry entry; next weekly fire regenerates; add two-cycle test |
| M010-11: Zod parse failure after M011 schema evolution | MEDIUM | Register old schema version in reader registry; deploy; mode handlers stop crashing; next weekly fire regenerates rows in new schema |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| M010-01: Confidence inflation | Schema + prompt design phase | Zod schema enforces confidence ceiling per entry count; sparse-fixture test asserts confidence = 0 below threshold |
| M010-02: Hallucinated facts | Prompt + schema phase (same plan as Zod output schema) | Source-citation schema present; DO_NOT_INFER_DIRECTIVE in shared builder; unit test verifies null field when sources < 2 |
| M010-03: Profile drift/regression | Schema phase (history table); prompt phase (previous-state injection) | `profile_history` in migration; mock SDK boundary test asserts previous-state injection non-null in Cycle 2 |
| M010-04: Timing collision | Cron registration phase | Seed migration fires profile update at 22:00 Paris; comment documents 2h gap rationale |
| M010-05: Fixture dimension coverage gap | Test infrastructure phase (before cron handler phase) | HARN sanity gate asserts >= 12 entries per profile dimension; populated-case test produces all four profiles |
| M010-06: Four-prompt drift | Prompt architecture phase (first artifact in prompt phase) | Structural test: `assembleProfilePrompt` output includes CONSTITUTIONAL_PREAMBLE + DO_NOT_INFER_DIRECTIVE for all four dimensions |
| M010-07: /profile internal field leak | `/profile` command phase | Golden-output snapshot test on `formatProfileForDisplay` with fixed `MOCK_PROFILES` fixture |
| M010-08: Mode handler context injection | Mode handler injection phase (after profile retrieval module) | PROFILE_INJECTION_MAP is a named constant; unit test verifies COACH injects only capital + family |
| M010-09: Double-update idempotency | Cron handler implementation phase | `substrate_hash` in profile schema; Cycle 2 successive-fire test asserts no-op when substrate unchanged |
| M010-10: First-fire celebration blindness | Test phase | Two-cycle synthetic fixture test; Cycle 2 previous-state injection verified via mock SDK boundary assertion |
| M010-11: JSONB schema evolution | Schema phase (schema_version in initial M010 migration) | `schema_version` column present; tolerable-degradation test verifies null return on unsupported version |

---

## Sources

- v2.4 RETROSPECTIVE.md — "What Was Inefficient" and "Key Lessons" sections: first-fire celebration blindness (direct source of M010-10), test workaround masking production bug, cron-context DB-backed language detection lesson (direct source of M010-08 DB-backed language requirement)
- v2.4 M009 Phase 29 VERIFICATION.md — UX failure on first-Sunday weekly_review fire (third-person framing incident at 2026-05-10 20:00 Paris; direct source of M010-07 formatter requirement)
- `src/rituals/weekly-review.ts` (direct code inspection) — v3/v4 dual Zod schema pattern, CONSTITUTIONAL_PREAMBLE injection, Stage-2 Haiku judge, date-grounding post-check, MAX_RETRIES, DB-backed language detection (`getLastUserLanguageFromDb` at lines 580-583), write-before-send pattern — all referenced as patterns M010 must mirror
- v2.4 MILESTONE-AUDIT.md — HARN-04/06 floor relaxation (direct precedent for M010-05 fixture dimension coverage gap); Phase 32 substrate hardening (successive-fire fix origin)
- PROJECT.md Risk Mitigations table — "Profile over-confidence" entry confirms M010-01 is architecturally anticipated but not yet mitigation-implemented in M010 schema
- PROJECT.md D028 — Attachment dimensions profile deferred until 2000 words of relational speech: validates M010-01's "sparse data produces stereotypes worse than no profile" principle
- `scripts/synthesize-delta.ts` (direct code inspection) — `buildHaikuSystemPrompt` has no `topicHint` parameter, no `--topic-bias` flag, no milestone-specific topic configuration: confirms M010-05 is a real gap, not a hypothesis
- PROJECT.md D041 — primed-fixture pipeline is the validation gate; no calendar-time accumulation: confirms M010-05's test infrastructure must produce dimension-biased fixtures on demand

---
*Pitfalls research for: M010 Operational Profiles added to Project Chris (single-user self-hosted Telegram bot)*
*Researched: 2026-05-11*
