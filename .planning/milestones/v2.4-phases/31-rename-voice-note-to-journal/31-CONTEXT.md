# Phase 31: Rename `voice_note` → `journal` — Context

**Gathered:** 2026-05-04
**Status:** Ready for planning
**Mode:** locked decisions from conversation (no gray areas — pure mechanical rename)

<domain>
## Phase Boundary

Rename the misleadingly-named `voice_note` ritual (which is purely text-based — Chris sends a prompt, Greg replies in text) to `journal` everywhere in the codebase. Atomic — partial rename leaves the bot in an inconsistent state.

**Why:** The Phase 26 ritual was historically conceived for voice messages but shipped as text-only (audio voice messages get a polite decline per VOICE-05). The codebase name `voice_note` is misleading and grates in conversation — Greg has corrected this 3 times in chat. Naming must match feature reality before v2.5.

**In scope:**
- New migration `0011_rename_daily_voice_note_to_journal.sql` — `UPDATE rituals SET name='daily_journal' WHERE name='daily_voice_note'`
- File renames (5):
  - `src/rituals/voice-note.ts` → `src/rituals/journal.ts`
  - `src/rituals/__tests__/voice-note.test.ts` → `journal.test.ts`
  - `src/rituals/__tests__/voice-note-handler.test.ts` → `journal-handler.test.ts`
  - `src/rituals/__tests__/voice-note-suppression.test.ts` → `journal-suppression.test.ts`
- Function/symbol renames (~10): `fireVoiceNote` → `fireJournal`, `recordRitualVoiceResponse` → `recordJournalResponse`, `shouldSuppressVoiceNoteFire` → `shouldSuppressJournalFire`, `voiceNoteRitual` → `journalRitual` (any), etc.
- String constant renames (~5): `metadata.source_subtype = 'ritual_voice_note'` → `'ritual_journal'`, log keys like `'rituals.voice_note.fired'` → `'rituals.journal.fired'` (preserve hierarchy, change segment), etc.
- Comment + docstring updates throughout — wherever "voice note" appears as natural-language text
- Top-level docs: `M009_Ritual_Infrastructure.md`, `PRD_Project_Chris.md`, `PLAN.md` — rename references; do NOT delete the files
- Drizzle schema mirror update (`src/db/schema.ts`) — only if it references the literal name (it shouldn't; row name is data, not schema)
- Live deploy: apply migration 0011 + redeploy chris container with updated code

**Out of scope:**
- `.planning/` archives — historical record (Phase 26 was named "Daily Voice Note Ritual" at the time; that's just history)
- Migration filename `0007_daily_voice_note_seed.sql` — drizzle journal references it; renaming breaks migration replay. The file STAYS named that; its INSERT is superseded by 0011.
- Drizzle meta `_journal.json` for migration 0007 — same reason
- Database row IDs — only `name` field changes; UUIDs preserved
- Container/deployment names — `chris-chris-1` Docker container name unaffected
- Pensieve historical entries — entries with `metadata.source_subtype = 'ritual_voice_note'` from before this rename stay as-is (historical record); ONLY the constant in code that produces NEW entries changes. PP#5 detector must accept BOTH `'ritual_voice_note'` (legacy) and `'ritual_journal'` (new) for backward compatibility on existing rows.

</domain>

<decisions>
## Implementation Decisions

### Rename target (D-31-01)

**D-31-01:** Use **`journal`** as the new base name (option A from conversation). Matches `daily_wellbeing` parallel structure.

- DB row name: `daily_journal` (parallels `daily_wellbeing`)
- Source file: `src/rituals/journal.ts`
- Function names: `fireJournal()`, `recordJournalResponse()`, `shouldSuppressJournalFire()`
- String constant: `metadata.source_subtype = 'ritual_journal'`
- Log keys: `'rituals.journal.fired'`, `'rituals.journal.suppressed'`, etc.
- Test files: `journal.test.ts`, `journal-handler.test.ts`, `journal-suppression.test.ts`

**Rejected:**
- `daily_journal_prompt` (option B): too long for log keys + reads awkwardly in code
- `evening_journal`: emphasizes timing but loses parallel with `daily_wellbeing`

### Atomicity (D-31-02)

**D-31-02:** Rename is **single-plan atomic** (Plan 31-01). All file moves + symbol renames + migration file authoring happen in one plan. Deploy is a separate operational plan (Plan 31-02) so the code-only verification gate (TypeScript compile + full test suite) lands cleanly before touching prod.

- Plan 31-01: code rename (no DB touch yet, no live deploy)
- Plan 31-02: live deploy (apply migration 0011, redeploy container, verify rituals fire under new name)

### Backward compat for historical Pensieve entries (D-31-03)

**D-31-03:** PP#5 detector in `src/chris/engine.ts` must accept BOTH `'ritual_voice_note'` (historical) AND `'ritual_journal'` (new) when reading `metadata.source_subtype`. Existing Pensieve entries from 2026-05-04+ before the rename land with the old subtype; deleting them or migrating them is unnecessary churn. The dual-accept is permanent (cheap union check).

NEW Pensieve writes from journal handler use ONLY `'ritual_journal'`.

- Mechanism: change the equality check `entry.metadata?.source_subtype === 'ritual_voice_note'` to `['ritual_voice_note', 'ritual_journal'].includes(entry.metadata?.source_subtype)` (or equivalent set membership). Document the legacy-accept inline.
- Test: add a one-liner test asserting both legacy and new subtypes are detected (extends existing PP#5 test file).

### Migration 0011 shape (D-31-04)

**D-31-04:** Migration 0011 is purely a data update — no schema changes. Idempotent.

```sql
-- Migration 0011: Rename daily_voice_note ritual to daily_journal
-- Phase 31 — terminology cleanup (text-based ritual was misleadingly named)

UPDATE rituals SET name = 'daily_journal'
WHERE name = 'daily_voice_note';

-- Note: ritual UUID preserved; only `name` field changes. All
-- ritual_fire_events / ritual_responses / ritual_pending_responses /
-- ritual_config_events FK references point to the UUID, not the name,
-- so they remain valid post-rename.
```

Drizzle meta journal entry added per the standard pattern (mirror 0010_adjustment_dialogue's meta entry).

### scripts/test.sh seed-row gate (D-31-05)

**D-31-05:** `scripts/test.sh` currently has a smoke check that asserts the `daily_voice_note` seed row exists post-migration (added in Phase 26 plan). Update this check to assert `daily_journal` exists post-migration 0011. The check on `daily_voice_note` (post-0007 only) is removed because by the time tests run, 0011 has applied and the row has been renamed.

</decisions>

<canonical_refs>
## Canonical References

- `./CLAUDE.md` — project conventions
- `.planning/PROJECT.md`, `.planning/STATE.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`
- `src/rituals/voice-note.ts` — primary rename target (file move)
- `src/db/migrations/0007_daily_voice_note_seed.sql` — historical seed; SUPERSEDED by 0011 but file stays
- `src/db/schema.ts` — verify no literal `'daily_voice_note'` references (should be data not schema)
- `src/chris/engine.ts` — PP#5 detector site for D-31-03 backward-compat
- `~/.claude/projects/-home-claude-chris/memory/feedback_evening_journal_naming.md` — user feedback that drove this phase

</canonical_refs>

<deferred>
## Deferred Ideas

- **Container/service rename** (`chris-chris-1` → something less repetitive) — separate concern, not blocking M009 close
- **`.planning/phases/26-daily-voice-note-ritual/` directory rename** — historical archive; renaming would break commit hash references in earlier docs. Leave as-is.

</deferred>

---

*Phase: 31-rename-voice-note-to-journal*
*Context locked: 2026-05-04*
