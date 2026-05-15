# Phase 45 — Deferred Items

Items surfaced during Plan 45 execution that are **out of scope** for v2.6.1
Phase 45 (per plan-defined boundaries) and require explicit follow-up.

---

## Plan 45-04 — PTEST-03 three-cycle date-window fragility

**File:** `src/memory/profiles/__tests__/integration-m010-30days.test.ts:383`
**Test:** `PTEST-03 three-cycle: C1=4, C2=4 cumulative (skip), C3=8 cumulative (mutated)`
**Discovered:** 2026-05-15 during Plan 45-04 FIX-06 fixture regen
**Failure mode:** `expect(mockAnthropicParse).toHaveBeenCalledTimes(4)` got 8 calls

### Root cause

The test pins `NOW_C1 = 2026-05-20T22:00:00.000Z` and `NOW_C2 = NOW_C1 + 7d
= 2026-05-27T22:00:00.000Z`. `loadProfileSubstrate(now)` queries a 60-day
window backward from `now`, returning `pensieveEntries`, `episodicSummaries`,
and `decisions` ordered by date. The substrate hash is computed over
`{pensieveIds.sort(), episodicDates.sort(), decisionIds.sort(),
schemaVersion}` per `src/memory/profiles/shared.ts:265-278`.

The fresh regen (commit pending Plan 45-04) produces a `synthetic_date_range`
of `["2026-05-16", "2026-05-22"]` (relative to today 2026-05-15) — meaning
episodic_summaries dated 2026-05-16..2026-05-22 exist. The 60-day windows:

- NOW_C1 = 2026-05-20 → window `[2026-03-21, 2026-05-20]` captures
  episodic_summaries 2026-05-16..2026-05-20 = **5 summaries**
- NOW_C2 = 2026-05-27 → window `[2026-03-28, 2026-05-27]` captures
  episodic_summaries 2026-05-16..2026-05-22 = **7 summaries**

Cycle 1 computes hash over 5 summary dates; Cycle 2 computes hash over 7
summary dates → hashes diverge → hash-skip path doesn't fire → Sonnet
regenerates → 8 cumulative calls instead of 4.

### Why this is pre-existing fragility, NOT a Plan 45-04 regression

The test passed previously because the **pre-regen** fixture had
`synthetic_date_range: ["2026-05-07", "2026-05-19"]` — the entire synthetic
range was BEFORE NOW_C1 (2026-05-20), so NOW_C1's window and NOW_C2's
window captured **identical** episodic_summary sets. The hash was stable.

The fresh regen, run on 2026-05-15, produces synthetic data extending past
NOW_C1 (forward-looking from the regen date). Plan 45-04 changes nothing
about the test or substrate-hash logic; it only refreshes the underlying
fixture. The fragility is in the test's **assumption that all synthetic
data falls strictly before NOW_C1**, which the fixture pipeline does NOT
guarantee.

### Why this confirms Plan 45-04 succeeded

- PTEST-02 (populated, the canonical first-fire test) passes — 4 Sonnet
  calls, 64-hex substrate_hash written, confidence>0.
- PTEST-04 (sparse, m010-5days) passes — threshold gate logic correct.
- primed-sanity-m010 passes — fixture entry counts above floor.
- Phase 45-04 success criterion D-14 (PMT-06 zero schema_mismatch warns)
  is addressed via the seed-profile-rows.ts shape update — not via the
  3-cycle test.

PTEST-03 verifies hash-idempotency invariants, NOT schema_mismatch behavior.
Its failure does not block Plan 45-04's FIX-06 deliverable.

### Recommended fix (v2.7 backlog)

Two options:

1. **Pin NOW_C2 = NOW_C1** (zero-day-delta same-substrate test). The +7d
   delta was meant to express "later in time, same substrate" but the
   substrate-window math doesn't preserve invariance under arbitrary
   regen date ranges.
2. **Pin NOW_C1 + NOW_C2 to a date strictly after the regen's synthetic
   range max.** This requires either (a) the test reading the MANIFEST's
   `synthetic_date_range[1]` at runtime and pinning past it, or (b) the
   fixture pipeline being deterministic such that `synthetic_date_range`
   has a stable max relative to NOW_C1.

Option 1 is simpler and preserves the test's intent (hash-idempotency
on identical substrate). Option 2 preserves the "later in time" intent
but couples the test to the fixture's manifest contract.

### Status

Defer to v2.7 backlog. Track under M010 milestone-gate hardening category.
Plan 45-04 ships without addressing this — the schema-mismatch deliverable
(D-14) is independent of and unaffected by the date-window fragility.

---

## Plan 45-01 fallout — `psychological-profiles.test.ts` Layer 2 corruption injection

**File:** `src/memory/profiles/__tests__/psychological-profiles.test.ts:171`
**Test:** `hexaco honesty_humility score-as-string → null + warn parse_failed; siblings still parse`
**Discovered:** 2026-05-15 during Plan 45-04 full-suite regression check
**Failure mode:** `PostgresError: invalid input syntax for type numeric: "not-a-number"`

### Root cause

The test injects `score: "not-a-number"` (a string) into `profile_hexaco.honesty_humily`
to exercise the Layer 2 (`safeParse` failure) → `parse_failed` warn path in
`getPsychologicalProfiles`. The injection was authored in Phase 37
(commit d123d56) when no DB-level constraints existed on score values —
Layer 2 was the only enforcement boundary.

Plan 45-01 (migration 0015, commit 7b7118c / 4804d8b / c05d40f) added CHECK
constraints of the form
`CHECK ((value->>'score')::numeric BETWEEN 1.0 AND 5.0 ...)` on the HEXACO
per-dim jsonb columns. The CHECK constraint evaluates `(value->>'score')::numeric`
which fails with `22P02 invalid input syntax for type numeric` when the
underlying string is non-numeric — Postgres rejects the UPDATE before the
constraint expression even runs, so the test's `db.execute(sql\`UPDATE...\`)`
throws instead of the test reaching the Layer 2 assertion.

This is the **correct CHECK-constraint behavior** (defense-in-depth blocking
corrupt data at the DB boundary). The test's injection technique needs an
update — it should pick a corrupted shape that bypasses the CHECK constraint
but still fails Zod safeParse. Two options:

1. **Score numerically out-of-range (e.g., `score: 6.0`):** The CHECK is
   `BETWEEN 1.0 AND 5.0`, so `6.0` triggers a different Postgres error
   (`check constraint violation`) — still doesn't reach Zod.
2. **Missing-key shape (e.g., remove `confidence` field):** The CHECK
   only validates score + confidence numeric paths; an entirely-missing
   key would pass the CHECK (NULL on path `->>'score'`) but fail Zod's
   `.strict()` requirement.
3. **Wrong-type non-string-non-number (e.g., `score: true` or `score: null`):**
   The CHECK uses `->>` (text extraction); a `null` jsonb value extracts
   as SQL NULL; `(NULL)::numeric` is NULL; `NULL BETWEEN ...` is NULL
   (treated as failure by CHECK). Still rejected at DB level.

Option 2 (missing-key shape) is the cleanest update — the test's intent
is "exercise Layer 2 safeParse failure", and the v3 Zod `.strict()`
schemas reject missing keys without DB CHECK interference.

### Why this is NOT a Plan 45-04 regression

Plan 45-04 touches only `src/__tests__/fixtures/seed-profile-rows.ts`
(operational profile jsonb shapes) and `tests/fixtures/primed/m010-30days/*`
(gitignored regen output). It does NOT touch the psychological profile
tables, schemas, or the CHECK constraints from Plan 45-01.

The test failure exists on `main` post-Plan-45-01 (commit `c05d40f` /
`7b7118c`); Plan 45-04 inherits but does not cause it.

### Status

Defer to v2.7 backlog or a focused Plan-45-01-followup PR. Track under
"M010 milestone-gate hardening" alongside the PTEST-03 deferred item.
The CHECK constraints from Plan 45-01 are correct; the test needs an
updated injection vector.

---

## Plan 45-04 fixture-scope boundary — M011 HARN gates pre-existing failure

**File:** `src/__tests__/fixtures/primed-sanity-m011.test.ts:200, 216`
**Tests:**
- `has total telegram-source pensieve wordCount >= 5000`
- `has >= 1 OPENNESS_SIGNAL_PHRASES phrase present`

### Root cause

The M011 fixtures at `tests/fixtures/primed/m011-30days/` are stale relative
to the FIX-07 word-count gate (Plan 45-02 commit c9c9eb0) and require their
own regen via
`npx tsx scripts/regenerate-primed.ts --milestone m011 --target-days 30 --psych-profile-bias --force`
per Phase 40 RESEARCH.md line 472.

### Why out of scope for Plan 45-04

Plan 45-04 explicitly scopes to `--milestone m010`. M011 fixture refresh
is a separate operator step that should run independently (or be folded
into a follow-up plan for Phase 45-05 / v2.7).

### Status

Operator action required: run M011 regen as a separate step.
`npx tsx scripts/regenerate-primed.ts --milestone m011 --target-days 30 --psych-profile-bias --force`
This produces the fresh m011-30days fixture; HARN tests will then pass.
Not blocking Plan 45-04 closure.
