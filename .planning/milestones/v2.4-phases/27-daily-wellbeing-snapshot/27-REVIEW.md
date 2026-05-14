---
phase: 27-daily-wellbeing-snapshot
reviewed_at: 2026-05-14
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/rituals/wellbeing.ts
  - src/bot/handlers/ritual-callback.ts
  - src/db/migrations/0008_wellbeing_seed.sql
  - scripts/fire-wellbeing.ts
  - src/rituals/__tests__/wellbeing.test.ts
  - src/bot/__tests__/ritual-callback.test.ts
blocker_count: 3
warning_count: 6
status: issues_found
---

# Phase 27: Code Review Report

**Depth:** standard
**Scope:** wellbeing-snapshot ritual handler + callback router infrastructure as it lives in CURRENT (post-v2.6) source tree. Tests touched (TEST-28 simulate-callback-query refactor visible), but Phase 27 behavior contract was not altered by downstream phases.

## Summary

Three correctness blockers in `src/rituals/wellbeing.ts`'s completion + skip paths. All relate to **M010 GEN-07 idempotency contract** and **race-window leaks** that the phase explicitly chose to validate against real Postgres — but the validation only covered the *jsonb_set merge* path, not the *post-merge completion side effects*. The same merge invariant (read-modify-write through Postgres) breaks down once you cross from `metadata.partial` mutation into the side-effect cluster (`wellbeing_snapshots` insert + `ritual_fire_events` emit + `rituals.skip_count` reset + `editMessageText`).

The phase's own Test 5 (rapid-tap concurrency, lines 281–312 of `wellbeing.test.ts`) demonstrates the exact race surface but its assertions are tolerant enough to pass even when the completion path runs 1, 2, or 3 times.

The wellbeing-trend writer/consumer drift flagged in the v2.6 audit is NOT in this phase's surface — `wellbeing_snapshots` writes are clean and bounded by schema CHECKs; the trend disagreement lives in Phase 12 (operational-profiles), not here.

## BLOCKERs

### BL-01: completeSnapshot duplicate-fires under concurrent third-tap (GEN-07 idempotency leak)

- **File:** `src/rituals/wellbeing.ts:227-258` (handleTap re-read), `:263-324` (completeSnapshot)
- **Issue:** The flow is `UPDATE jsonb_set` → separate `SELECT` re-read → if `isComplete(meta.partial)` then run `completeSnapshot`. When three callbacks race (Test 5 actually exercises this), Postgres serializes the three jsonb_set UPDATEs by row lock, but EACH handler's subsequent SELECT can observe all three dims populated (the second and third writers both see e/m/a present after their own UPDATE returns). All N handlers that observe `isComplete=true` then independently execute the entire completion side-effect cluster: a wellbeing_snapshots upsert (idempotent via ON CONFLICT), a `ritualFireEvents` INSERT (NOT idempotent — duplicate `wellbeing_completed` rows), a `rituals.skip_count = 0` UPDATE (idempotent but generates churn), an `editMessageText` (network call), and an `answerCallbackQuery` (Telegram contract requires ≤1 per query, but here each handler answers its own query so that part is fine).
- **Impact:** Phase 28 SKIP-01 reads `ritual_fire_events.outcome = 'wellbeing_completed'` to RESET skip_count and to track engagement. Duplicate rows distort engagement counts and any downstream weekly-review variance gates. Phase 29 TS-5c reads `wellbeing_snapshots` (idempotent, safe) but also reads fire_events. This is the canonical GEN-07 idempotency-leak shape: a fire/response side effect appears N times where N≥1 depending on concurrency.
- **Fix:** Gate completion on an atomic "I'm the one finishing it" winner. Either (a) add an `UPDATE ritual_responses SET responded_at = now() WHERE id = $1 AND responded_at IS NULL RETURNING id` and only run completeSnapshot if that UPDATE returned a row, or (b) move the entire side-effect cluster into a transaction that first SELECTs the row `FOR UPDATE` and bails if responded_at is already set. Option (a) is consistent with Phase 25's `tryFireRitualAtomic` pattern.

### BL-02: handleSkip clobbers concurrent partial-tap state via full-jsonb overwrite

- **File:** `src/rituals/wellbeing.ts:328-346` (handleSkip body)
- **Issue:** Skip reads `openRow.metadata` from the row fetched by `findOpenWellbeingRow` (executed BEFORE any concurrent tap could finish), spreads it into `skippedMeta = { ...meta, skipped: true, adjustment_eligible: false }`, then writes that whole object via `.set({ metadata: skippedMeta })`. If a tap callback's `jsonb_set` lands BETWEEN findOpenWellbeingRow and the skip's UPDATE, the skip wipes out the tap's partial value (last-write-wins on the full jsonb column). The handleTap path correctly uses `jsonb_set` to merge atomically; handleSkip does not.
- **Impact:** Silent loss of user-tapped data. A user tap that registered (handler returned success, Postgres ACKed) can be erased by a near-simultaneous skip press. Data-fidelity-mandate violation: the user perceives "I tapped energy=4" then sees "Skipped" — the energy value should remain in the audit metadata for forensic recovery, but is gone. Also breaks any future analytics that mine `metadata.partial` from skipped rows.
- **Fix:** Use `jsonb_set` (or jsonb concatenation) in skip too:
  ```ts
  .set({
    respondedAt: new Date(),
    metadata: sql`jsonb_set(jsonb_set(coalesce(${ritualResponses.metadata}, '{}'::jsonb),
                            '{skipped}', 'true'::jsonb, true),
                            '{adjustment_eligible}', 'false'::jsonb, true)`,
  })
  ```
  This preserves any `partial.*` that landed concurrently.

### BL-03: findOpenWellbeingRow matches stale prior-day NULL rows under DST/edge timing — cross-day stale tap bug

- **File:** `src/rituals/wellbeing.ts:422-450`
- **Issue:** Returns the most-recent ritual_responses row where `respondedAt IS NULL AND date_trunc('day', firedAt AT TIME ZONE tz) = today::date`. The semantics are right *if there are no orphaned NULL rows from prior days*. But the codebase has no mechanism that closes unresponded rows: `ritualResponseWindowSweep` (Phase 28) marks them `fired_no_response` in `ritual_fire_events` but DOES NOT set `responded_at`. Confirmed via grep of types.ts:115-149 — `'fired_no_response'` is an event-log outcome, not a ritual_responses mutation.

  Today's `fireWellbeing` inserts a new responses row at 10:00 Paris. Greg taps a button at, say, 11:30. `findOpenWellbeingRow` returns the latest matching row — today's is fine. But because nothing actually pollutes the search space TODAY, this is benign right now.

  The real concern is the **clock-skew + DST window**: on the spring-forward day (last Sunday in March), `date_trunc('day', firedAt AT TIME ZONE 'Europe/Paris')` for a row fired at 09:30 UTC on the boundary day computes against a shifted local-day boundary. If a fire happens just before the transition, and a tap arrives just after, the row's local-day truncation may or may not equal `today::date` depending on which side of the DST jump now() lands. The order-by + limit 1 hides the false-negative case (returns nothing → "Snapshot already closed") but cannot guard against a false-positive (yesterday's unresponded row matching today's date because the local-day arithmetic shifted).
- **Impact:** WELL-04 contract — skip-button distinct from `fired_no_response` — relies on findOpenWellbeingRow returning ONLY today's row. A DST-edge match against yesterday's row routes a skip/tap to update yesterday's response, corrupting that day's metadata and (via handleTap completion path) potentially writing a NEW wellbeing_snapshots row keyed by `todayLocalDate()` while the ritual_responses row says `firedAt = yesterday`. The data fidelity mandate calls this out explicitly.
- **Fix:** Filter by `fired_at >= now() - interval '24 hours'` AS WELL AS the local-day match, OR (better) join against `ritual_fire_events` to exclude rows that already have any terminal outcome (`fired_no_response`, `wellbeing_completed`, `wellbeing_skipped`) on the fire_events side. Both are belt-and-suspenders against the cross-day stale row.

## WARNINGs

### WR-01: completeSnapshot uses `sql.raw('EXCLUDED.energy')` — unnecessary raw-SQL use given parameterized alternatives

- **File:** `src/rituals/wellbeing.ts:282-284`
- **Issue:** `set: { energy: sql.raw('EXCLUDED.energy'), mood: sql.raw('EXCLUDED.mood'), anxiety: sql.raw('EXCLUDED.anxiety') }`. The strings are static constants and pose zero injection risk today, but `sql.raw` is the codebase's escape hatch for unsafe SQL fragments. Drizzle exposes `sql` template literals that work without `raw`. Establishes a pattern where future readers/refactorers might extend `sql.raw` with untrusted input.
- **Fix:** Use `sql\`EXCLUDED.energy\`` — no parameter, but typed as `SQL`, not `raw`. Aligns with the codebase's "no raw SQL with user data" guard rail.

### WR-02: ritualFireEvents write race in fireWellbeing — duplicate 'fired' events possible

- **File:** `src/rituals/wellbeing.ts:157-162`
- **Issue:** fireWellbeing emits `RITUAL_OUTCOME.FIRED` to `ritual_fire_events` after the message send. Phase 25's `tryFireRitualAtomic` guarantees the fire-side is called exactly once per next_run_at advance, so this is OK in steady-state. But: the migration's `next_run_at` (line 23 of 0008_wellbeing_seed.sql) sets the FIRST next_run_at to the next 09:00 Paris instant — which the 10:00 sweep tick catches. If the migration runs at exactly 09:00:00.000 local (the boundary), the CASE evaluates `now() AT TIME ZONE 'Europe/Paris' >= … + interval '9 hours'` as TRUE and skips today entirely (sets next_run_at to tomorrow 09:00). Not a fire-side correctness issue per se, but means the first fire is delayed by 24h under exact-boundary apply.
- **Impact:** Cosmetic in practice (operator deploys outside 09:00 boundary). Documented for completeness.
- **Fix:** Change `>=` to `>` in the migration CASE, OR document that migration apply at exactly 09:00 local time skips the first fire.

### WR-03: handleSkip writes metadata with snake_case `adjustment_eligible` but ritual_responses.metadata typing nowhere enforces it

- **File:** `src/rituals/wellbeing.ts:71-77, 335-339`
- **Issue:** The `WellbeingMetadata` interface uses `adjustment_eligible` (snake_case) inside TypeScript, which is the on-wire jsonb shape. The codebase's CONVENTIONS.md does not specify a metadata-jsonb naming policy. Phase 28's consumer (skip-tracking) reads this field via the same string key — confirmed identical in PATTERNS notes — but no schema-level enforcement exists. If a future refactor renames the TS field to `adjustmentEligible`, Drizzle would serialize it that way and Phase 28's reader would silently see `undefined`. This is the same shape of bug as the v2.6 `health.wellbeing_trend` schema-mismatch — writer and consumer agree by convention only.
- **Impact:** Silent contract drift between writer (Phase 27) and consumer (Phase 28+). Not a regression today but is the canonical pattern that produced the v2.6 audit warning.
- **Fix:** Either (a) declare a shared Zod schema for the metadata jsonb in `src/rituals/types.ts` and consume it in both Phase 27 and Phase 28, OR (b) add explicit casts at write sites: `metadata: { ...meta, skipped: true, adjustment_eligible: false } satisfies WellbeingMetadata`.

### WR-04: parseCallbackData accepts trailing-segment garbage silently

- **File:** `src/rituals/wellbeing.ts:392-402`
- **Issue:** `const [dimStr, valStr] = rest.split(':')` keeps only the first two segments. A payload `r:w:e:3:malicious:extra` parses as `dimStr='e'`, `valStr='3'`, and the rest is discarded. parseCallbackData returns `kind:'tap'` without complaint.
- **Impact:** No injection (validated downstream) but violates the "untrusted Telegram input" guard rail principle of strict validation. Future code that splits the data differently could be fed unexpected structure.
- **Fix:** `const parts = rest.split(':'); if (parts.length !== 2) return { kind: 'invalid' };` before destructuring.

### WR-05: 'fired' event written even if message send failed (insert-failed branch returns 'fired')

- **File:** `src/rituals/wellbeing.ts:118-121`
- **Issue:** If `db.insert(ritualResponses)…returning()` returns an empty array (`!fireRow`), the function logs `fire.insert_failed` and returns `'fired'` — and the dispatcher records the fire as successful. But: the sendMessage call happens AFTER this branch, and the ritualFireEvents emit (line 157) is GATED only by the function reaching the end. Reading again: actually, the early-return on `!fireRow` prevents the sendMessage AND the fire event from running. OK — but the function still returns `'fired'` outcome to the dispatcher, which then advances next_run_at thinking it succeeded. Greg gets no message and no event log.
- **Impact:** Silent data loss of the FIRE EVENT itself. A failed insert (which shouldn't happen given the schema, but could under DB stress) is invisible to operator monitoring beyond a log line.
- **Fix:** Return a non-fired outcome (e.g., throw or return `'failed'` if the dispatcher supports it) so next_run_at does NOT advance — Phase 25's RIT-10 idempotency contract means the next tick retries. Otherwise this is a fire-then-lose-it data-fidelity hole.

### WR-06: Skip-with-no-open-row swallows error silently — no telemetry that user pressed a stale button

- **File:** `src/rituals/wellbeing.ts:192-197`
- **Issue:** When `findOpenWellbeingRow` returns null, the handler logs `rituals.wellbeing.no_open_row` at WARN level and acks with "Snapshot already closed". This conflates three semantically distinct cases: (a) user pressed yesterday's button after window closure (DST edge — see BL-03), (b) user pressed a button after they themselves skipped, (c) user pressed a button after they themselves completed (keyboard should already be cleared by editMessageText, so this should not happen unless the editMessageText call failed silently in the prior completeSnapshot). All three log the same warn line.
- **Impact:** Operator cannot triage which scenario fired. Phase 28's skip-tracking has no visibility into whether stale-button traffic is a real-world signal of bugs.
- **Fix:** Add a discriminator probe — check the most-recent same-day ritual_responses row regardless of responded_at and log the prior state (`completed` / `skipped` / `none`) for forensic value.

## Notes (no-finding observations)

- **Cron timezone:** Migration's `next_run_at` arithmetic is correct (uses `AT TIME ZONE 'Europe/Paris'` round-trip). No DST-naive `new Date()` shortcuts in the writer. `todayLocalDate()` uses Luxon `setZone(config.proactiveTimezone)` correctly — confirmed against `src/episodic/sources.ts:dayBoundaryUtc` precedent.
- **Schema mismatch (v2.6 audit, wellbeing_trend):** Reviewed — this phase does NOT write `wellbeing_trend`. The trend column is written by Phase 12 (operational-profiles, `src/memory/profiles/health.ts:33`). Phase 27 writes only `wellbeing_snapshots.{snapshot_date,energy,mood,anxiety}`, all schema-bounded. Not a Phase 27 surface.
- **FR/RU localization:** Per D-27-08, English-only is an explicit phase decision. Skip-label `'Skip'` and prompts not localized — out of scope (deferred, documented).
- **Raw SQL:** Outside of WR-01 (`sql.raw('EXCLUDED.energy')`), all writes use Drizzle parameterized templates. No SQL injection surface from the validated dim/value path.
- **Telegram callback_data size:** `r:w:e:3` = 7 bytes; `r:w:skip` = 8 bytes. Well under 64-byte Telegram cap. Validated.

---

_Reviewed: 2026-05-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
