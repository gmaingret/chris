---
phase: 31-rename-voice-note-to-journal
reviewed_at: 2026-05-14
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/db/migrations/0011_rename_daily_voice_note_to_journal.sql
  - src/db/migrations/meta/_journal.json
  - src/db/migrations/meta/0011_snapshot.json
  - src/rituals/journal.ts
  - src/rituals/scheduler.ts
  - src/rituals/skip-tracking.ts
  - src/rituals/__tests__/journal.test.ts
  - src/rituals/__tests__/journal-handler.test.ts
  - src/rituals/__tests__/journal-suppression.test.ts
  - src/rituals/__tests__/skip-tracking.test.ts
  - src/rituals/__tests__/synthetic-fixture.test.ts
  - src/chris/engine.ts
  - src/chris/__tests__/engine-pp5.test.ts
  - scripts/test.sh
blocker_count: 0
warning_count: 4
status: issues_found
---

# Phase 31: Code Review Report

**Reviewed:** 2026-05-14
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found (no blockers; 4 warnings)

## Summary

Phase 31 is a mechanical rename (`voice_note` → `journal`) with one DML migration (0011), four `git mv` file moves, and ~10 symbol renames. The rename is **comprehensive and correct**:

- Scheduler dispatch keyed correctly on `'daily_journal'` (scheduler.ts:457)
- Log keys updated to `rituals.journal.fired` / `rituals.journal.suppressed`
- Pensieve `source_subtype` writes use `'ritual_journal'`
- All renamed symbols (`fireJournal`, `recordJournalResponse`, `shouldSuppressJournalFire`, `findActivePendingResponse`) wired consistently
- Migration 0011 is idempotent, UUID-preserving, and parameterless (no SQLi surface)
- Drizzle meta journal monotonic; 0011_snapshot.json present
- scripts/test.sh seed gate updated to `daily_journal`
- Live deploy verified UUID preservation post-migration (Plan 31-02 SUMMARY)

User-facing impact: NONE — the user-facing prompt strings (PROMPTS array) were never the issue; the rename was operator-facing (log keys, code symbols, DB row name). No user-facing "voice" strings remain in the journal ritual path.

The legitimate "voice"-prefixed feature `src/bot/handlers/voice-decline.ts` (VOICE-05 — polite-decline for INBOUND Telegram audio voice messages) is a separate, correctly-named feature — NOT in scope for this rename. The memory feedback "never call the Phase 26 ritual 'voice note'" applies to the journal ritual, not the literal-audio-decline handler, which IS audio-related.

## Findings by Severity

- **BLOCKERS:** 0
- **WARNINGS:** 4
- **INFO:** (omitted per task spec)

---

## Warnings

### WR-01: `RITUAL_JOURNAL_SUBTYPES` constant is dead code — D-31-03 backward-compat is never invoked

- **File:** `src/chris/engine.ts:87-88`
- **Issue:** D-31-03 promised a "dual-accept" backward-compat path so historical Pensieve entries with `metadata.source_subtype = 'ritual_voice_note'` would still be detected by PP#5. The constant `RITUAL_JOURNAL_SUBTYPES = ['ritual_voice_note', 'ritual_journal']` is exported, but a full grep of `src/` shows **zero consumers** read `source_subtype` to dispatch behavior — PP#5 dispatch is via `ritual_pending_responses.metadata.kind`, not Pensieve subtype. Plan 31-01 SUMMARY explicitly admits this ("no such check exists in engine.ts"). The constant is documentation pretending to be code.
- **Impact:** If anyone in the future relies on the export name to safely filter ritual-derived Pensieve entries, they'll get the right answer by accident. But the D-31-03 acceptance criterion ("PP#5 detector accepts both") is not actually implemented — it's an unused export. If a future PP#5 enhancement (e.g., "skip ritual-derived entries when computing context") naively writes `entry.metadata.source_subtype === 'ritual_journal'`, the legacy `'ritual_voice_note'` rows will silently fall through. The dead constant gives false confidence.
- **Fix:** Either (a) delete `RITUAL_JOURNAL_SUBTYPES` + delete D-31-03 from CONTEXT/SUMMARY (acknowledge the decision was a no-op), or (b) wrap actual filter sites with a helper:
  ```ts
  export function isRitualJournalEntry(entry: { metadata?: Record<string, unknown> | null }): boolean {
    const s = entry.metadata?.source_subtype;
    return s === 'ritual_voice_note' || s === 'ritual_journal';
  }
  ```
  and use it whenever code touches Pensieve subtype downstream. Option (a) is honest — the constant is currently a lie about coverage.

### WR-02: `synthetic-fixture.test.ts` asserts STRICTLY `'ritual_journal'` — contradicts D-31-03 dual-accept invariant

- **File:** `src/rituals/__tests__/synthetic-fixture.test.ts:463-464`
- **Issue:** Loop asserts `meta.source_subtype === 'ritual_journal'` on every RITUAL_RESPONSE entry. If the synthetic fixture were ever regenerated against a database that retained legacy `'ritual_voice_note'` rows (the "historical Pensieve entries before 2026-05-04" scenario explicitly preserved per CONTEXT.md "out of scope" + D-31-03), this assertion would fail — undermining the explicit decision to leave those rows untouched.
- **Impact:** Today the test passes because the fixture is generated from post-rename code. But the assertion encodes "all entries must be new-style" as an invariant, which **directly conflicts** with D-31-03's "permanent dual-accept" rationale. Either D-31-03 is wrong or this test is wrong; they cannot both be correct.
- **Fix:** Either accept both subtypes (consistent with WR-01's helper):
  ```ts
  expect(['ritual_voice_note', 'ritual_journal']).toContain(meta.source_subtype);
  ```
  or drop the dual-accept rationale from the SUMMARY and admit Phase 31 broke backward-read of pre-rename entries (which is also fine — the data still exists, no code reads it).

### WR-03: `journal-suppression.test.ts` cleanup unconditionally wipes ALL rituals

- **File:** `src/rituals/__tests__/journal-suppression.test.ts:71`
- **Issue:** `await db.delete(rituals);` has no WHERE clause — it deletes every row in the rituals table. The sibling test `journal-handler.test.ts:61` is surgical (`.where(eq(rituals.name, FIXTURE_RITUAL_NAME))`). When this test runs against a database that already has the live-seeded rituals from migrations 0007/0008/0009/0011 (e.g., shared Docker harness), it nukes those seed rows, leaving the DB in a state where other concurrently-running or subsequently-running tests can hit "rituals not found" failures. The summary already lists pre-existing failures in `weekly-review.test.ts`, `wellbeing.test.ts`, `scheduler.test.ts` — suspicious correlation with global-rituals-delete in this fixture.
- **Impact:** Test isolation failure. Phase 31 didn't introduce this (the pattern came from `voice-note-suppression.test.ts`), but the rename was the right moment to surface and fix it. As-is, the fixture is a footgun for any future parallel test runner or cross-suite ordering change.
- **Fix:** Scope deletes by ritual name:
  ```ts
  await db.delete(rituals).where(eq(rituals.name, RITUAL_NAME));
  ```
  Also seed `pensieveEntries` deletes by source/metadata key to avoid clobbering unrelated rows in a shared DB.

### WR-04: 0007 migration filename retains historical `voice_note` name — user-correctness vs. drizzle-replay tension is documented but not bulletproof

- **File:** `src/db/migrations/0007_daily_voice_note_seed.sql` + `src/db/migrations/meta/_journal.json:58`
- **Issue:** Per CONTEXT.md "out of scope" decision, migration filename 0007 stays `0007_daily_voice_note_seed.sql` because drizzle journal references it. This is correct as far as it goes, but the SQL **body** of 0007 (line 27) still INSERTs a row named `'daily_voice_note'`, which then 0011 renames. On a fresh database, the rename happens in two migration steps. Anyone reading the migration history without context will see the "voice_note" string twice (in 0007 body + 0007 filename + drizzle journal tag), which conflicts with the user-feedback guard rail "never call the Phase 26 ritual 'voice note' anywhere."
- **Impact:** Operator/developer-facing only — the live DB ends up correct after 0011. But every fresh DB rebuild (test.sh, CI) creates and then renames the row, leaving migration archaeology that contradicts the project-wide naming directive. CONTEXT.md acknowledges this tension; no remediation was attempted.
- **Fix:** Two options:
  - (a) Squash 0007 + 0011 by editing 0007 in-place to insert as `daily_journal` and deleting 0011 — only safe if no production DB has applied either yet (live deploy already happened per Plan 31-02 SUMMARY, so this is now infeasible).
  - (b) Accept as-is and add a one-line top-of-file comment to 0007:
    ```sql
    -- HISTORICAL: this file seeds the row under its original misleading
    -- name 'daily_voice_note'. Migration 0011 renames it to 'daily_journal'
    -- (Phase 31). The filename is preserved because drizzle journal indexes
    -- it; do not rename this file or the migration replay breaks.
    ```
  Option (b) is the pragmatic fix — surfaces the historical context without breaking drizzle.

---

## Leftover "voice" references (audit trail)

Comprehensive `grep -ri 'voice' src/` sweep results, classified:

**LEGITIMATE — `voice-decline` audio handler (Phase 26 VOICE-05; separate feature):**
- `src/bot/bot.ts:54` — `bot.on('message:voice', handleVoiceMessageDecline ...)`
- `src/bot/handlers/voice-decline.ts` (entire file — declines INBOUND audio voice messages)
- `src/bot/handlers/__tests__/voice-decline.test.ts`

**LEGITIMATE — Historical migration (preserved per CONTEXT.md "out of scope"):**
- `src/db/migrations/0007_daily_voice_note_seed.sql` (filename + body)
- `src/db/migrations/meta/_journal.json:58` (`"tag": "0007_daily_voice_note_seed"`)
- `src/db/migrations/0011_rename_daily_voice_note_to_journal.sql` (the rename itself)
- `src/db/migrations/0009_weekly_review_seed.sql:1` (comment reference)
- `src/db/migrations/0010_adjustment_dialogue.sql` (3 comment references to "voice-note rows")

**LEGITIMATE — D-31-03 backward-compat constant (but see WR-01):**
- `src/chris/engine.ts:81-87`

**LEGITIMATE — VOICE-NN spec-ID references (Phase 26 plan ID anchors, not user-facing terminology):**
- `src/rituals/journal.ts` (VOICE-01..06 spec references in docstrings)
- `src/rituals/__tests__/journal*.test.ts` (test describe strings)
- `src/rituals/__tests__/prompt-rotation-property.test.ts`
- `src/rituals/__tests__/types.test.ts`
- `src/rituals/types.ts:115,132` ("Phase 26 VOICE-04" outcome enum documentation)

**LEGITIMATE — historical context comments:**
- `src/rituals/scheduler.ts:438` ("renamed from daily_voice_note in Phase 31")
- `src/rituals/skip-tracking.ts:23` (same)
- `src/rituals/__tests__/skip-tracking.test.ts:83,147` (same)
- `src/rituals/__tests__/synthetic-fixture.test.ts:55-57` (rename note)
- `src/chris/__tests__/engine-pp5.test.ts:74` ("recordRitualVoiceResponse" in comment — stale function name in a comment, see note below)

**LEGITIMATE — unrelated `voice` semantic ("Greg's writing voice"):**
- `src/proactive/mute.ts` ("Chris's natural voice")
- `src/llm/prompts.ts` (multiple "voice and framing" comments)
- `src/episodic/sources.ts` (literal "voice, etc.")
- `src/__tests__/fixtures/primed-sanity-m010.test.ts` ("Greg's primary voice")
- `scripts/synthesize-delta.ts` ("Greg's Telegram voice" for tone-matching)

**MINOR STALE comment (not promoted to a finding — comment-only, no behavior):**
- `src/chris/__tests__/engine-pp5.test.ts:74` — "Phase 28 Plan 28-01 extended `recordRitualVoiceResponse` to write ritual_fire_events". Function is now `recordJournalResponse`. Pure documentation drift; harmless.

---

_Reviewed: 2026-05-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
