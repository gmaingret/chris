---
phase: 30-test-infrastructure-harn-03-refresh
verified: 2026-05-07T13:18:00Z
status: human_needed
score: 4/4 success criteria verified at code level (1 with caveats)
overrides_applied: 0
gaps: []
deferred:
  - truth: "MIN_EPISODIC_SUMMARIES floor restored to 21 (HARN-04 spec)"
    addressed_in: "Phase 32 (synth-pipeline organic+synth fusion — NOT YET in ROADMAP Phase 32 scope)"
    evidence: "TODO(phase-32) markers in src/__tests__/fixtures/primed-sanity.test.ts:70-72; TESTING.md 'Known gap' subsection at line 311"
    caveat: "ROADMAP.md Phase 32 entry items #1-#5 do NOT explicitly mention synth-pipeline fusion; the 'Phase 32 follow-up' label in code is currently a forward-reference without a roadmap commitment"
  - truth: "MIN_WELLBEING_SNAPSHOTS floor restored to 14 (HARN-06 spec)"
    addressed_in: "Phase 32 (same caveat as above)"
    evidence: "TODO(phase-32) marker at primed-sanity.test.ts:77-79"
    caveat: "Same caveat — ROADMAP Phase 32 scope is currently {proactive directive-following, context-builder edge case, drizzle migration journal, drizzle drift warning, drizzle row-loss forensic}. Synth-pipeline fusion is NOT among those items."
  - truth: "fireJournal lastIdx formula correctly preserves just-fired prompt across cycle boundaries (no consecutive duplicates at cycle 1→2 transition)"
    addressed_in: "Phase 32 (logged in deferred-items.md effectively, not in ROADMAP)"
    evidence: "src/rituals/journal.ts:357 confirmed — `lastIdx = bag.length === 0 ? undefined : bag[bag.length - 1]`. The bag-empty branch returns `undefined`, so consecutive-duplicate guard cannot defend at cycle boundaries. ~17% probability per cycle boundary."
    caveat: "Bug is real and confirmed at the cited line. Phase 32 does not currently scope it."
  - truth: "Pre-existing wellbeing.test.ts Tests 6 & 7 failures (Phase 27 substrate emit-ordering)"
    addressed_in: "deferred-items.md → recommends 'Future Phase 32 substrate-hardening plan OR Phase 27 follow-up'"
    evidence: ".planning/phases/30-test-infrastructure-harn-03-refresh/deferred-items.md; verified pre-existing on main commit 171a624"
    caveat: "Confirmed pre-existing — NOT introduced by Phase 30. Genuine deferral."
human_verification:
  - test: "Run live-weekly-review.test.ts manually with RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... bash scripts/test.sh src/rituals/__tests__/live-weekly-review.test.ts"
    expected: "3-of-3 atomic iterations against real Sonnet pass: zero forbidden flattery markers (~49 markers from 3 imported sets) AND zero templated fallbacks across the adversarial week"
    why_human: "TEST-31 is dual-gated (RUN_LIVE_TESTS + ANTHROPIC_API_KEY) per D-30-03 cost discipline. Default `bash scripts/test.sh` skips it cleanly (verified). The actual live API spend (~$0.45/run) requires Greg's gate authorization. Static review confirms the marker scan logic and the adversarial fixture import are correct; the runtime LLM behavior is what TEST-31 actually proves."
  - test: "Confirm Phase 32 scope expansion to include synth-pipeline organic+synth fusion (or accept the relaxed 4-floor primed-sanity invariants as permanent until v2.5 milestone gate forces re-evaluation)"
    expected: "Either ROADMAP.md Phase 32 entry expanded to include items 6 & 7 ('synthesize-episodic.ts:288 fuse organic+synth' and 'synthesize-delta.ts:407-440 emit per-fused-day wellbeing'), OR explicit acceptance that the 4-floor relaxation is the v2.4 deliverable and HARN-04/HARN-06 are partially-satisfied"
    why_human: "The TODO(phase-32) markers in code reference a phase whose scope (per current ROADMAP) does NOT include synth-pipeline fusion. Without scope expansion, the TODOs are forward-references to a phase that won't fix them. Greg's call: extend Phase 32 scope, or accept that v2.4's HARN-04/HARN-06 ship at 4-floor adequacy with the gap formally tolerated."
  - test: "Decide whether Plan 30-04 cosmetic deviation (PHASE-30 docblock placeholder NOT removed at lines 4 + 11 of live-weekly-review.test.ts) requires fix-forward or is acceptable"
    expected: "Either remove the stale placeholder comments (lines 4, 11) per CONTEXT.md D-30-04 prescription, OR accept the deviation as cosmetic"
    why_human: "30-04 SUMMARY claims the placeholder was 'replaced'; the active-TEST-31 comment block at lines 45-50 was added (correct), but the original placeholder docblock at the file head was NOT removed. This is purely cosmetic — the dual-gate predicate is correctly applied at line 51. Greg's call on whether to require a follow-up commit."
---

# Phase 30: Test Infrastructure + HARN-03 Refresh — Verification Report

**Phase Goal (from ROADMAP.md):** Integration phase that proves M009 works end-to-end. Loads `m009-21days` primed fixture, mocks 14 days via `vi.setSystemTime`, runs the full `processMessage` engine pipeline (NOT bypassing PP#5), asserts all 7 spec behaviors, plus a separate cron-registration regression file, plus the live anti-flattery test against real Sonnet (3-of-3 atomic). HARN-03 carry-in flips the v2.3 sanity gate from 2/4 fail to 4/4 pass and adds a 5th invariant for wellbeing_snapshots.

**Verified:** 2026-05-07T13:18:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### ROADMAP Success Criteria

| # | Success Criterion | Status | Evidence |
|---|-------------------|--------|----------|
| 1 | `bash scripts/test.sh src/rituals/__tests__/synthetic-fixture.test.ts` runs to green; loads m009-21days fixture; advances vi.setSystemTime day-by-day for 14 simulated days; exercises full processMessage pipeline (PP#5 included); asserts all 7 spec behaviors with cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` PP#5 short-circuit proof | **VERIFIED** with caveat | Test runs `6 passed (6)` in 1.54s through full Docker gate (verified 2026-05-07T13:12:48Z). Cumulative afterAll assertion at synthetic-fixture.test.ts:274. Real `processMessage` import + invocation at line 433. **Caveat:** TEST-29+30 fires twice on the SAME Sunday (2026-05-10) with state cleanup between week 1 (happy path) and week 2 (fallback retries) because m009-21days fixture only has substrate availability for one Sunday's past-7-day window. Honest interpretation of "templated fallback exercised in at least one fixture week" — but not literal-week separation. Documented honestly in 30-02 SUMMARY decision #6. |
| 2 | Separate `src/rituals/__tests__/cron-registration.test.ts` asserts `registerRitualCron()` called in `src/index.ts:main()` with correct cron expression + timezone | **VERIFIED** | TEST-32 lives at lines 119-156 of cron-registration.test.ts (distinct file from synthetic-fixture.test.ts — HARD CO-LOC #4 honored). Reads src/index.ts via fs.readFile + regex matches `cronStatus = registerCrons({` and all 4 M009 handlers (runSweep, runRitualSweep, runConsolidateYesterday, ritualConfirmationSweep). Reads src/cron-registration.ts and asserts `'* * * * *'` literal. 5 passing (1.54s, full Docker gate). |
| 3 | With `ANTHROPIC_API_KEY` present, `live-weekly-review.test.ts` runs 3 atomic iterations against real Sonnet on adversarial week; observation contains ZERO of forbidden flattery markers across all 3 runs | **VERIFIED at gate level; LIVE BEHAVIOR needs human** | Dual-gate `describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)` at line 51 honored per D-30-03. Marker derivation imports VALIDATION_MARKERS + REFLEXIVE_OPENER_FIRST_WORDS + FLATTERY_MARKERS (lines 35-43) — no redeclaration; ~49 markers total (NOT 17 — the ROADMAP's "17 markers" wording is stale; 30-04 SUMMARY honestly notes ~40 markers, the Phase 29-04 import block produces ~49). Adversarial week fixture imported from `./fixtures/adversarial-week.js`. Live execution requires `RUN_LIVE_TESTS=1 + ANTHROPIC_API_KEY` — listed in human_verification[0]. |
| 4 | Operator runs `regenerate-primed.ts --milestone m009 --target-days 21 --force` against fresh prod; MANIFEST.json materializes; HARN-03 4 sanity assertions flip 2/4 → 4/4 pass; new 5th invariant ≥14 days wellbeing_snapshots; `--reseed-vcr` flag in TESTING.md | **PARTIALLY VERIFIED** | MANIFEST.json materialized (verified) — but its shape is `{organic_stamp, seed, target_days, milestone, synthetic_date_range, generated_at, schema_note}` with NO `window_start`/`window_end`/`row_counts`. primed-sanity.test.ts: 5 passing (full Docker gate, 760ms). `--reseed-vcr` flag wired (verified at scripts/regenerate-primed.ts:56,78,122,140,212-216) and documented in TESTING.md "VCR Cache Cost Model (HARN-05)" section at line 272. **HOWEVER**: HARN-04 + HARN-06 thresholds were RELAXED from spec: `MIN_EPISODIC_SUMMARIES = 4` (spec ≥21), `MIN_WELLBEING_SNAPSHOTS = 4` (spec ≥14), `MIN_PENSIEVE_ENTRIES = 195` (spec ≥200). Documented honestly with TODO(phase-32) markers + Known Gap section in TESTING.md. The "5th invariant ≥14 days wellbeing_snapshots" criterion is technically NOT met at the literal threshold — the gap is honest, but it IS a gap. See Deviation Audit Section. |

**Score:** 4/4 success criteria covered at code level. SC#1 has 1 caveat (single-Sunday execution). SC#3 needs human gate to confirm live behavior. SC#4 has the relaxed-threshold gap (handled below).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/rituals/__tests__/synthetic-fixture.test.ts` | 14-day mock-clock walk + 7 TEST-23..30 behaviors + cumulative PP#5 not-called invariant | **VERIFIED** | 839 LoC; 6 it() blocks; afterAll cumulative `expect(mockAnthropicCreate).not.toHaveBeenCalled()` at line 274; real `processMessage` invocation at line 433. Test passes 6/6 in 1.54s through full Docker gate. |
| `src/rituals/__tests__/cron-registration.test.ts` (TEST-32) | Static-analysis test asserting registerCrons in src/index.ts main() — distinct file (HARD CO-LOC #4) | **VERIFIED** | TEST-32 appended as 5th it() block to existing Phase 25 file (157 LoC total). HARD CO-LOC #4 satisfied at file level. Phase 25's 4 spy-based tests preserved byte-identical (verified per 30-03 SUMMARY). 5 passing. |
| `src/rituals/__tests__/live-weekly-review.test.ts` (TEST-31) | Dual-gated skipIf with RUN_LIVE_TESTS + ANTHROPIC_API_KEY; ~49 markers; adversarial week | **VERIFIED at gate level** | Line 51 predicate verified: `!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY`. Phase 29-04 marker derivation block at lines 35-43 preserved byte-identical (no redeclaration drift). |
| `src/rituals/__tests__/fixtures/simulate-callback-query.ts` (D-30-05 helper) | Shared callback-query forge for TEST-28 + wellbeing.test.ts | **VERIFIED** | 40 LoC; exports `simulateCallbackQuery({ callbackData, messageId? })` + `SimulatedCallbackCtx`. Imported by both consumers (wellbeing.test.ts + synthetic-fixture.test.ts). |
| `src/__tests__/fixtures/primed-sanity.test.ts` (HARN-04 + HARN-06) | 5 invariants against m009-21days fixture; ≥21 episodic, ≥14 wellbeing | **PARTIAL** | 5 it() blocks, 5 passing. FIXTURE_NAME flipped to m009-21days. **DEVIATION:** thresholds relaxed (4/4/195 vs spec 21/14/200) per Greg's Option A directive 2026-05-07. TODO(phase-32) markers + Known Gap subsection in TESTING.md document the gap honestly. Functional adequacy preserved (synthetic-fixture.test.ts runs 14-day mock-clock walk independent of fixture row counts). |
| `tests/fixtures/primed/m009-21days/MANIFEST.json` (HARN-04) | Materialized fixture per regenerate-primed.ts | **VERIFIED** | Present at expected path. JSONL siblings populated (199 pensieve_entries, 4 episodic_summaries, 4 wellbeing_snapshots, 145 relational_memory, 5 decisions, 3 contradictions, 187 pensieve_embeddings, 2 proactive_state). MANIFEST shape `{organic_stamp, seed, target_days, milestone, synthetic_date_range, generated_at, schema_note}` — does NOT contain `window_start`/`window_end` (spec assumed shape was wrong). |
| `scripts/regenerate-primed.ts` (HARN-05 — `--reseed-vcr` flag) | Flag wired through Args + parseCliArgs + main() rm step + printUsage | **VERIFIED** | All 5 references present: Args interface (line 56), parseArgs option (line 78), values type annotation (line 66), return shape (line 122), main() rm wiring (lines 212-216), printUsage (line 140). `npx tsx scripts/regenerate-primed.ts --help \| grep reseed-vcr` succeeds. |
| `scripts/validate-primed-manifest.ts` (NEW from Plan 30-01 deviation) | Reusable post-regen validation script | **VERIFIED** | 246 LoC; reads MANIFEST + sibling JSONL line counts; asserts target_days=21, milestone=m009, ≥1 Sunday in pensieve_dates OR synthetic_date_range, relaxed-baseline invariants. Adapted from inline node-script (the inline one targeted a MANIFEST shape that doesn't exist). |
| `.planning/codebase/TESTING.md` (HARN-05 docs + Live Tests + Known Gap) | VCR Cache Cost Model + dual-gated Live Tests pattern + Phase 32 Known Gap | **VERIFIED** | "VCR Cache Cost Model (HARN-05)" section at line 272 (cost reference, --reseed-vcr usage, Pitfall 11 invariant). "Live Tests" table at line 194 includes TEST-31 row with **Dual-gated** annotation. Pattern docs at line 201-202. Known Gap subsection at line 311 documents the HARN-04/HARN-06 threshold relaxation. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| synthetic-fixture.test.ts TEST-25 | engine.ts PP#5 short-circuit | `processMessage(GREG_CHAT_ID, GREG_USER_ID, ...)` at line 433 | **WIRED** | Real `processMessage` import at line 118; invocation at line 433. PP#5 in engine.ts:177-234 (recordJournalResponse hit on pending-row match). Cumulative afterAll proves `mockAnthropicCreate.not.toHaveBeenCalled()` across the entire 14-day walk. |
| synthetic-fixture.test.ts TEST-29 | weekly-review.ts Stage-1 + Stage-2 + date-grounding | `await runRitualSweep(new Date())` after queuing 3 mockAnthropicParse responses | **WIRED** | Test queues 3 mockResolvedValueOnce for week 1 (Stage-1, Stage-2 judge, date-grounding) + 3 compound responses for week 2 (each fails Stage-1 → retry → fallback). Asserts `mockAnthropicParse.toHaveBeenCalledTimes(3)` for week 1 + fallback log line for week 2. |
| synthetic-fixture.test.ts TEST-28 | wellbeing.ts handleWellbeingCallback | `simulateCallbackQuery({ callbackData })` helper | **WIRED** | Helper at fixtures/simulate-callback-query.ts forges Grammy Context shape with callbackQuery field. 6 callback invocations (3 dims × 2 days). Asserts wellbeing_snapshots row written with correct energy/mood/anxiety values. |
| cron-registration.test.ts TEST-32 | src/index.ts main() registerCrons call | `fs.readFile('src/index.ts', 'utf8')` + regex matches | **WIRED** | Static-analysis pattern: 4 separate regex matches confirm registerCrons invocation + all 4 M009 handler names + literal '* * * * *' cron expression in cron-registration.ts:126. |
| live-weekly-review.test.ts TEST-31 | weekly-review.ts generateWeeklyObservation against real Sonnet | dual-gated skipIf | **WIRED at gate; LIVE BEHAVIOR human-verify** | Dual-gate predicate at line 51. Marker derivation imports verified preserved. Default `bash scripts/test.sh` skips cleanly. |
| primed-sanity.test.ts wellbeing invariant | wellbeingSnapshots table | `db.select({ n: count(*) }).from(wellbeingSnapshots)` | **WIRED but threshold relaxed** | 5th it() block at line 135 queries wellbeingSnapshots count. Invariant `≥4` instead of spec `≥14` per Greg's Option A directive. Functional check is sound; literal threshold is below spec. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|----|
| synthetic-fixture.test.ts TEST-25 entries | `entries` (RITUAL_RESPONSE pensieveEntries) | Real DB SELECT after 14 PP#5 deposits via `processMessage` | YES — 14+ rows expected | **FLOWING** (test asserts `≥14` and verifies metadata.source_subtype='ritual_journal' on each row). Pass confirms PP#5 actually persists. |
| synthetic-fixture.test.ts TEST-28 snapshots | `snapshots` (wellbeingSnapshots rows) | Real DB SELECT after 6 callback handler invocations | YES — 2 rows | **FLOWING** (asserts day0 + day1 snapshots present with correct energy/mood/anxiety values). |
| synthetic-fixture.test.ts TEST-29+30 weeklyEntry | `weeklyEntry` (pensieveEntries with metadata.kind='weekly_review') | Real DB SELECT after `runRitualSweep` triggers fireWeeklyReview | YES — 1 row | **FLOWING** (asserts persisted observation contains in-window date 2026-05-10). |
| primed-sanity.test.ts row counts | `row?.n` from db.select count(*) | Real DB queries against loaded fixture | YES (4/4/195) | **FLOWING but at relaxed thresholds** (per Greg's Option A; not the spec literal). |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|----|
| Synthetic fixture test passes through full Docker gate | `bash scripts/test.sh src/rituals/__tests__/synthetic-fixture.test.ts` | 6/6 passing in 1.54s | **PASS** |
| Cron-registration test passes | `bash scripts/test.sh src/rituals/__tests__/cron-registration.test.ts` | 5/5 passing in 1.54s | **PASS** |
| Primed-sanity test passes | `bash scripts/test.sh src/__tests__/fixtures/primed-sanity.test.ts` | 5/5 passing in 760ms | **PASS** |
| `--reseed-vcr` flag in CLI usage | `npx tsx scripts/regenerate-primed.ts --help \| grep reseed-vcr` | Flag present (lines 128, 140 of usage output) | **PASS** |
| live-weekly-review.test.ts skips by default | `bash scripts/test.sh src/rituals/__tests__/live-weekly-review.test.ts` (no env vars) | Would skip cleanly (predicate verified at line 51) | **PASS at gate; live behavior human** |
| wellbeing.test.ts pre-existing failures still present | `bash scripts/test.sh src/rituals/__tests__/wellbeing.test.ts` | 6 passed / 2 failed (Tests 6 + 7 — pre-existing on commit 171a624) | **CONFIRMED PRE-EXISTING** |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TEST-23 | 30-02 | 14-day fixture via vi.setSystemTime + loadPrimedFixture('m009-21days'); full processMessage | **SATISFIED** | synthetic-fixture.test.ts:209,419,433 |
| TEST-24 | 30-02 | Daily prompt rotation (no consecutive dupes; no-repeat-in-last-6) | **SATISFIED** with REINTERPRETATION | Test asserts within-cycle uniqueness (cycles 1+2: 6 distinct each) + max-gap ≤ 11 (the actual property the algorithm guarantees). The literal "no-repeat-in-last-6" is mathematically incompatible with a 6-prompt shuffled bag. See Deviation Audit. |
| TEST-25 | 30-02 | Voice note Pensieve persistence + cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` | **SATISFIED** | synthetic-fixture.test.ts:274 (afterAll) + line 437-452 (≥14 RITUAL_RESPONSE entries, source_subtype='ritual_journal' Phase 31 rename). |
| TEST-26 | 30-02 | Skip increments only on fired_no_response | **SATISFIED** | synthetic-fixture.test.ts:457-508 |
| TEST-27 | 30-02 | Adjustment dialogue at cadence-aware threshold (daily=3) | **SATISFIED** | synthetic-fixture.test.ts:510-579; asserts metadata.kind='adjustment_dialogue' + canonical text "isn't working — what should change?" |
| TEST-28 | 30-02 | Wellbeing via simulateCallbackQuery helper (first inline-keyboard use) | **SATISFIED** | synthetic-fixture.test.ts:596-692 + helper at fixtures/simulate-callback-query.ts |
| TEST-29 | 30-02 | Weekly review 1 obs + 1 Q; Stage-1 + Stage-2 + templated fallback in ≥1 fixture week | **SATISFIED** with single-Sunday caveat | synthetic-fixture.test.ts:694-838. Both happy path (week 1) and fallback (week 2) exercised on SAME 2026-05-10 Sunday with state cleanup between (only Sunday with substrate). Honest interpretation; functional adequacy met. |
| TEST-30 | 30-02 | Weekly review references specific summaries + decisions; date-grounding | **SATISFIED** | synthetic-fixture.test.ts:765-781 (asserts persisted observation contains in-window date 2026-05-10) |
| TEST-31 | 30-04 | Live anti-flattery 3-of-3 atomic against real Sonnet (HARD CO-LOC #6) | **GATE SATISFIED; LIVE-BEHAVIOR HUMAN** | Dual-gated skipIf at live-weekly-review.test.ts:51. Marker derivation preserved. Live execution requires Greg's manual gate. |
| TEST-32 | 30-03 | Cron-registration regression in distinct file (HARD CO-LOC #4) | **SATISFIED** | cron-registration.test.ts:119-156 (5th it() block in distinct file). |
| HARN-04 | 30-01 | regenerate-primed → MANIFEST.json + 4 sanity assertions flip to 4/4 pass | **SATISFIED with relaxation** | Fixture materialized; sanity test passes 5/5 — but at relaxed thresholds (4/4/195 instead of spec 21/14/200) per Greg's Option A. See Deviation Audit. |
| HARN-05 | 30-01 | --reseed-vcr flag + VCR cost model docs | **SATISFIED** | All wiring at scripts/regenerate-primed.ts:56,78,122,140,212-216. TESTING.md "VCR Cache Cost Model" section. |
| HARN-06 | 30-01 | 5th sanity invariant: wellbeing_snapshots ≥14 days | **SATISFIED with relaxation** | 5th it() block at primed-sanity.test.ts:135 — but `MIN_WELLBEING_SNAPSHOTS = 4` instead of spec `≥14`. See Deviation Audit. |

**Coverage:** 13/13 requirements claimed; 11/13 fully satisfied at code level; 2/13 (HARN-04 + HARN-06) satisfied with relaxed thresholds; 1/13 (TEST-31) gate-satisfied with live behavior pending human verification.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/rituals/__tests__/live-weekly-review.test.ts` | 4, 11 | Stale `// PHASE-30: enable in TEST-31` placeholder NOT removed (CONTEXT.md D-30-04 prescribed replacement) | INFO (cosmetic) | New active comment block at lines 45-50 was added correctly; old docblock at file head was not removed. Gate predicate at line 51 IS correctly dual-gated. Cosmetic deviation only. |
| `src/__tests__/fixtures/primed-sanity.test.ts` | 70-79 | TODO(phase-32) markers reference a roadmap phase whose current scope (per ROADMAP) does NOT include synth-pipeline organic+synth fusion | WARNING | Phase 32 in ROADMAP currently scopes 5 items: proactive directive-following, context-builder edge case, drizzle migration journal monotonic-when, drizzle drift warning, drizzle row-loss forensic. None mention synthesize-episodic.ts:288 fusion or synthesize-delta.ts wellbeing-per-fused-day. The TODO markers are forward-references without a roadmap commitment. |
| `.planning/codebase/TESTING.md` | 321 | "ROADMAP.md Phase 32 entry items #3-#5 captures the substrate hardening backlog" — FALSE | WARNING | Items #3-#5 of ROADMAP Phase 32 are migration-journal/drizzle/forensic. Synth-pipeline fusion is NOT among them. The Known Gap subsection misleadingly cites unrelated items as cover. |
| `scripts/synthesize-delta.ts` | 425-449 | Schema mismatch fix bundled with Plan 30-01 (Rule 1 auto-fix) | INFO (acceptable Rule 1) | Genuine bug found while Plan 30-01 ran loadPrimedFixture. Fix is necessary to satisfy own acceptance criterion. Documented in 30-01 SUMMARY deviation #1. Not a regression — this fix unblocks the HARN-06 invariant. |
| `src/rituals/journal.ts` | 357 | `lastIdx = bag.length === 0 ? undefined : bag[bag.length - 1]` — does not preserve just-fired prompt across cycle boundaries | WARNING (pre-existing; not introduced by Phase 30) | Confirmed bug at the cited line. ~17% probability of consecutive duplicate at cycle 1→2 boundary in 14-fire windows. Logged for Phase 32 follow-up via deferred-items.md narrative. NOT in current ROADMAP Phase 32 scope. |
| `src/rituals/__tests__/synthetic-fixture.test.ts` | 363-381 | TEST-24 reinterpretation comment block: aligns with Phase 26 prompt-rotation-property.test.ts canonical interpretation | INFO (documented honestly) | The literal "no-repeat-in-last-6" REQUIREMENTS.md phrasing is mathematically incompatible with a 6-prompt shuffled bag (cycle 2's first prompt is ALWAYS in cycle 1's last 6). Test asserts the actual strong invariant: max-gap ≤ 11 + within-cycle uniqueness. See Deviation Audit. |

---

## Deviation Audit

### Deviation 1: TEST-24 reinterpretation (Wave 2, Plan 30-02 Rule 4)

**What:** Plan PLAN.md prescribed asserting "no-repeat-in-last-6" verbatim from REQUIREMENTS.md. Test instead asserts (a) within-cycle uniqueness (every 6-fire cycle contains 6 distinct prompts) + (b) max-gap ≤ 11 (the actual strong invariant).

**Why claimed acceptable:** The 6-prompt shuffled bag pops every prompt exactly once per cycle, so cycle 2's first prompt is ALWAYS among cycle 1's last 6. Literal reading is mathematically impossible. Phase 26's `prompt-rotation-property.test.ts:54-64` is the canonical interpretation.

**Verdict:** **ACCEPTABLE-WITH-FOLLOWUP**. The reinterpretation is mathematically sound. The new invariants (within-cycle uniqueness + max-gap ≤ 11) ARE strictly stronger than "no consecutive duplicates" and are equivalent to "the rotation algorithm correctly explores the prompt space without recent repetition." However, this surfaces a real production bug at journal.ts:357 (lastIdx formula does not preserve just-fired prompt across cycle boundaries — ~17% consecutive-dupe chance per cycle). The deviation is honest; the underlying bug is real and deserves Phase 32 scope expansion.

**Required follow-up:** Phase 32 (or a v2.5 substrate-hardening phase) should fix journal.ts:357 to preserve `lastIdx` across cycle boundaries. ROADMAP Phase 32 currently does NOT scope this — needs explicit addition.

### Deviation 2: HARN-04 + HARN-06 threshold relaxation (Wave 1, Plan 30-01 Rule 3)

**What:** Plan PLAN.md (and REQUIREMENTS.md) demanded `MIN_EPISODIC_SUMMARIES ≥ 21`, `MIN_WELLBEING_SNAPSHOTS ≥ 14`, `MIN_PENSIEVE_ENTRIES ≥ 200`. Actual fixture produces 4 / 4 / 199. Plan relaxed thresholds to 4 / 4 / 195 per Greg's Option A directive recorded 2026-05-07 at the start of the run.

**Why claimed acceptable:** D-07 lock makes synthesize-episodic.ts:288 a gap-filler (skips organic episodic_summaries; only synth-fills). Fresh prod has 17 organic dates → synth fills only ~4 days → 4 episodic summaries + 4 wellbeing snapshots from synth. The functional adequacy for Plan 30-02 is preserved (the 14-day mock-clock walk doesn't depend on fixture row counts). TODO(phase-32) markers + Known Gap subsection in TESTING.md document the gap.

**Verdict:** **ACCEPTABLE-WITH-FOLLOWUP, ESCALATE** (the followup hook is unfaithful). The relaxation itself is operationally justified (the synth pipeline literally cannot produce more without code changes). The DOCUMENTATION of the deferral is the problem: `TODO(phase-32)` markers in 4 files + TESTING.md Known Gap line 321 cite "ROADMAP.md Phase 32 entry items #3-#5" as the cover-phase. But ROADMAP Phase 32 items #3-#5 are about drizzle migration journal, drizzle drift warning, and `__drizzle_migrations` row-loss forensic — none of those address synthesize-episodic.ts:288 fusion or synthesize-delta.ts wellbeing-per-fused-day. The deferral hook points at a phase whose scope does not actually include the fix.

**Required follow-up:**
1. **Greg's call:** Either expand ROADMAP Phase 32 scope to include the synth-pipeline fusion items (items #6 + #7), OR formally accept the 4-floor relaxation as the v2.4 deliverable and update HARN-04 + HARN-06 acceptance text in REQUIREMENTS.md (currently both are checked `[x]` despite the spec thresholds being unmet).
2. The functional milestone-shipping gate (synthetic-fixture.test.ts) IS preserved by the relaxation, so M009 v2.4 is shippable. The gap is in the substrate fixture's literal-text adequacy, not the integration test's functional adequacy.

### Deviation 3: TEST-29+30 single-Sunday execution (Wave 2, Plan 30-02 Rule 3)

**What:** Plan PLAN.md prescribed two distinct fixture weeks for happy-path + fallback. Test fires both on the SAME Sunday (2026-05-10) with state cleanup between, because m009-21days fixture only has substrate availability for one Sunday's past-7-day window.

**Why claimed acceptable:** Three Sundays exist in the fixture (2026-04-19, 2026-04-26, 2026-05-10). Only 2026-05-10's past-7-day window contains the 4 episodic_summaries (2026-05-07..2026-05-10) + 5 decisions (2026-05-06..2026-05-07) needed for fireWeeklyReview to NOT short-circuit on no_data. The other two Sundays would short-circuit. The downstream cause is Deviation 2 (synth pipeline gap-filler). REQUIREMENTS.md TEST-29 says "templated fallback exercised in at least one fixture week" — interpreted as "fallback path executed once" (functional), not "two distinct calendar weeks tested" (structural).

**Verdict:** **ACCEPTABLE-WITH-FOLLOWUP**. Both happy-path and fallback paths ARE executed and asserted. The cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` Pitfall 6 invariant covers both paths (weekly_review uses .parse, not .create). The functional behavior is verified.

**Required follow-up:** Same as Deviation 2 — once synth pipeline is fixed (Phase 32 scope expansion), re-run regenerate-primed and verify multi-Sunday substrate works.

### Deviation 4: Plan 30-04 cosmetic — placeholder docblock not removed

**What:** 30-04 SUMMARY claims the `// PHASE-30: enable in TEST-31` placeholder was "replaced". The new active comment block at lines 45-50 was added correctly. But the OLD docblock at lines 4 and 11 of `live-weekly-review.test.ts` was NOT removed.

**Why claimed acceptable:** D-30-04 prescription said "adds a one-line marker REPLACING the placeholder". Functional gate predicate at line 51 IS correctly dual-gated. Cosmetic only.

**Verdict:** **ACCEPTABLE (cosmetic)**. Greg's call on whether to require a follow-up commit cleaning up the stale lines.

### Deviation 5: Plan 30-01 MANIFEST shape adapted

**What:** Plan PLAN.md inline node-script asserted MANIFEST shape `{window_start, window_end, row_counts.*}`. Actual emitted shape is `{organic_stamp, seed, target_days, milestone, synthetic_date_range, generated_at, schema_note}`. Plan adapted assertions to real shape via separate committable script `scripts/validate-primed-manifest.ts`.

**Verdict:** **ACCEPTABLE**. The original spec assumed a shape that doesn't exist in the synth pipeline output. The adapted script is a STRICT improvement (auditable, reusable for future milestones, type-checked) over the inline node-script. The plan-incidental refactor produced a public artifact (`scripts/validate-primed-manifest.ts`) rather than a one-shot operator gate.

### Deviation 6: synthesize-delta.ts wellbeing schema bug fix (Plan 30-01 Rule 1)

**What:** While running loadPrimedFixture in Plan 30-01 Task 4, NOT NULL violation surfaced on `wellbeing_snapshots.snapshot_date`. Root cause: synthesize-delta.ts:425-438 was authored in Phase 24 (pre-Phase 25 substrate) against a speculative `{score, note, recorded_at}` schema that never shipped. Phase 25 migration 0006 actually shipped `{snapshot_date, energy, mood, anxiety, notes, created_at}`. Plan 30-01 fixed the row-emission loop to produce schema-conformant rows.

**Verdict:** **ACCEPTABLE (Rule 1 auto-fix)**. Genuine bug, directly blocks the plan's own acceptance criterion (HARN-06 5th invariant cannot be verified without loadPrimedFixture succeeding). Bonus value: future regenerations now emit valid rows without manual repair. Properly documented in 30-01 SUMMARY deviation #1.

---

## Phase 32 Hooks Validated

The 30-02 SUMMARY claims "2 new substrate-hardening candidates flagged inline" + the 30-01 SUMMARY claims "this plan adds new Phase 32 candidate items via TODO(phase-32) markers". I verified each:

| Hook | Location | Real? | Roadmap Coverage |
|------|----------|-------|----------------|
| journal.ts:357 lastIdx formula weakness | src/rituals/journal.ts:357 | **REAL** — confirmed `lastIdx = bag.length === 0 ? undefined : bag[bag.length - 1]`. The bag-empty branch returns undefined, so consecutive-duplicate guard cannot defend at cycle boundary. ~17% chance per boundary in a 14-fire window. | **NOT in ROADMAP Phase 32 scope.** Needs explicit addition. |
| m009-21days fixture multi-week substrate widening | scripts/synthesize-episodic.ts:288 + synthesize-delta.ts:407-440 | **REAL** — D-07 lock makes synth a gap-filler; needs to be taught to fuse organic+synth. | **NOT in ROADMAP Phase 32 scope.** Needs explicit addition. |
| MIN_EPISODIC_SUMMARIES restore to 21 | src/__tests__/fixtures/primed-sanity.test.ts:70-72 | **REAL TODO** — depends on fixture multi-week substrate widening above. | **NOT in ROADMAP Phase 32 scope.** Same dependency. |
| MIN_WELLBEING_SNAPSHOTS restore to 14 | src/__tests__/fixtures/primed-sanity.test.ts:77-79 | **REAL TODO** — same dependency. | **NOT in ROADMAP Phase 32 scope.** Same dependency. |
| MIN_PENSIEVE_ENTRIES restore to 200 | src/__tests__/fixtures/primed-sanity.test.ts:73-76 | **REAL TODO** — depends on richer prod state OR multi-week substrate widening. | **NOT in ROADMAP Phase 32 scope.** |
| validate-primed-manifest.ts wellbeing/episodic spec restore | scripts/validate-primed-manifest.ts | **REAL TODO** — same root dependency. | **NOT in ROADMAP Phase 32 scope.** |
| pre-existing wellbeing.test.ts Tests 6 + 7 failures | src/rituals/__tests__/wellbeing.test.ts:325, 373 | **REAL** — verified pre-existing on commit 171a624 by Plan 30-02; orthogonal to Phase 30 changes. Same 6-passing/2-failing count before and after Phase 30. | Captured in deferred-items.md, recommends "Future Phase 32 substrate-hardening plan OR Phase 27 follow-up". **NOT in ROADMAP Phase 32 scope.** |

**Conclusion:** All 7 Phase 32 hook claims are REAL bugs/gaps in the codebase. **However, ROADMAP.md Phase 32's current 5-item scope does NOT cover any of them.** This is a meta-gap: the deferred items are documented in code/deferred-items.md/TESTING.md, but the phase that's supposed to address them doesn't actually scope to do so. This is a `human_needed` decision point — see human_verification[1].

---

## Known Gaps (carried forward, not new)

1. **Synth-pipeline organic+synth fusion missing** — D-07 lock means synthesize-episodic.ts:288 is a gap-filler, not a fuser. m009-21days fixture has 4 episodic summaries (synth-only) when spec wanted 21. HARN-04 + HARN-06 thresholds relaxed to ship M009 v2.4. Phase 32 scope expansion needed.

2. **fireJournal lastIdx formula does not preserve just-fired prompt across cycle boundaries** — confirmed at journal.ts:357. ~17% consecutive-duplicate chance per cycle boundary. TEST-24 sidesteps via the strong-invariant interpretation; the production behavior is still subtly wrong.

3. **Pre-existing wellbeing.test.ts Tests 6 + 7 failures** — verified pre-existing; orthogonal to Phase 30. Either Phase 27 emit-ordering bug or test-query-ordering bug. Captured in deferred-items.md.

4. **Plan 30-04 cosmetic deviation** — `// PHASE-30: enable in TEST-31` placeholder NOT removed at lines 4, 11 of live-weekly-review.test.ts despite SUMMARY claiming it was "replaced". Cosmetic only; gate predicate is correctly applied.

---

## Verdict Narrative

**Is M009's milestone-shipping gate genuinely in place?** **YES, with caveats.**

The cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` afterAll assertion at synthetic-fixture.test.ts:274 IS the load-bearing invariant. It runs across all 6 it() blocks (covering TEST-23..30) and proves PP#5 short-circuits the engine response across the entire 14-day mock-clock walk. The test exercises the FULL `processMessage` engine pipeline (line 433). The Pitfall 6 regression test is real and the gate is green: 6/6 passing in 1.54s through full Docker test.sh.

**Are all 13 phase requirements closed?** **YES at the requirement-tracker level**, but with two requirements (HARN-04 + HARN-06) shipping below their literal threshold and a deferred TEST-31 live execution.

**Are the 4 Wave-2 deviations honest?** **YES**, all 4 are documented honestly in 30-02 SUMMARY's "Deviations from Plan" section. The TEST-24 reinterpretation surfaces a real production bug (journal.ts:357) which Phase 30 properly captured as a Phase 32 follow-up — but Phase 32's scope doesn't currently include it.

**Are the Phase 32 hooks real?** **YES, all 7 hook claims point at real bugs/gaps.** **HOWEVER**, ROADMAP Phase 32's current 5-item scope doesn't address any of them. The deferral pointers are forward-references to a phase that won't actually fix them. This is the most material meta-gap in this verification.

**Is the phase shippable?** **YES on the milestone-gate axis**, but Greg should make 3 explicit calls before considering Phase 30 truly closed:

1. **Authorize live TEST-31 execution** (or accept gate-only verification as sufficient for v2.4)
2. **Decide Phase 32 scope** — expand to include synth-pipeline fusion + journal.ts:357 + wellbeing.test.ts emit-ordering, OR formally accept the 4-floor primed-sanity relaxation as the v2.4 deliverable
3. **Cosmetic cleanup of live-weekly-review.test.ts placeholder docblock** (acceptable to defer)

---

_Verified: 2026-05-07T13:18:00Z_
_Verifier: Claude (gsd-verifier)_

---

## Postscript: TEST-31 live execution (2026-05-07T14:08:15Z)

Greg authorized the live run after reviewing the verification report. Result documented for completeness, NOT a re-verification.

**Invocation:**
```bash
RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=<prod> \
  bash scripts/test.sh src/rituals/__tests__/live-weekly-review.test.ts -t live-weekly-review
```

The `-t live-weekly-review` filter is **required**: `live-weekly-review.test.ts` transitively imports `VALIDATION_MARKERS` and `FLATTERY_MARKERS` from `live-integration.test.js` and `live-anti-flattery.test.js` per the D-10 verbatim-import contract. Without the name pattern, vitest evaluates those imported test files' `describe.skipIf` gates — which are now satisfied (ANTHROPIC_API_KEY is set) — and fans out to ~$5+ in unintended Sonnet spend across multi-test-file live execution. Pinning the pattern keeps the run at the original ~$0.45 budget. **First attempt without the filter consumed unintended budget; aborted and re-run with filter.**

**Result:** ❌ FAIL
```
× zero forbidden flattery markers AND zero fallbacks across 3-of-3 atomic iterations on adversarial week
  AssertionError: 3-of-3 atomic: adversarial week MUST NOT trigger templated fallback
                  expected 2 to be +0
  25 other tests skipped (pattern-filter worked)
  duration: 57.3s
```

**Diagnostic — two distinct failure modes hit Sonnet across 3 iterations:**

1. **Stage-1 violation** (1 iter): `question` field contained multi-`?` OR multi-interrogative-leading-word per the EN/FR/RU regex. `stage1Check` rejected. MAX_RETRIES=2 exhausted. Fallback fired.
   ```
   err: "Stage-1 violation: must contain exactly one ? AND ≤1 interrogative-leading-word per EN/FR/RU"
   ```

2. **Observation length violation** (1 iter): `observation` field exceeded the Zod `.max(800)` constraint. Structured-output parse failed. Retries exhausted. Fallback fired.
   ```
   err: "Too big: expected string to have <=800 characters"
   ```

3. **Successful iteration** (1 iter): no markers, no fallback, observation < 800 chars, single question.

**Forbidden flattery markers:** ZERO across all 3 iterations (the soft-assertion pass condition was met). The hard-assertion failure was on the `expect(fallbacks).toBe(0)` line. **The 49-marker scan worked correctly — Sonnet did not produce flattery patterns.** The fallback fires happen BEFORE marker-scan time because the `generateWeeklyObservation` retry loop returns the templated fallback (`"What stood out to you about this week?"` static string) when retries exhaust; the templated fallback by construction has no markers.

**Verdict:** TEST-31 is doing its job — it caught a real Phase 29 prompt-design regression on adversarial input. The substrate (cron → sweep → handler → Sonnet → DB → Telegram) works perfectly. The content quality of the weekly_review observation degrades on emotional/adversarial inputs (which Greg's actual weeks tend to contain — relationships, location changes, identity questions all appear as "adversarial-shaped" content to the prompt).

**Production risk:** May 10 weekly_review fire (Sunday, 2 days post-postscript) MAY produce the templated fallback (`"What stood out to you about this week?"`) instead of a substantive Sonnet observation, depending on the week's content. This is a UX degradation — not a crash, not data loss, just less interesting content.

**Resolution path (Greg's call 2026-05-07):** Accept TEST-31 documented-failing for v2.4 ship. Captured as **Phase 32 item #9** (`weekly_review Stage-1 + observation-length regression on adversarial input`). Fix lives in `src/rituals/weekly-review-prompt.ts` — tighten single-question directive (worked example showing multi-`?` rejected) + add explicit observation length cap with worked example (≤800 chars demonstrated). After Phase 32 #9 lands, TEST-31 should pass 3/3 (`expect(fallbacks).toBe(0)`) on the same adversarial fixture.

**M009 v2.4 ship status:** unchanged. Substrate proven, milestone-gate test exists and runs, the regression is bounded (degraded fallback content, not crashes or data loss), and the fix is captured in v2.5 scope. The two earlier human_verification items (1: TEST-31 live authorization, 2: Phase 32 scope) are now both resolved by this postscript + the parallel ROADMAP Phase 32 update extending scope to 9 items.

_Live execution postscript: 2026-05-07T14:08:15Z (Claude orchestrator + real Sonnet)_
