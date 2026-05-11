# Phase 26: Daily Voice Note Ritual - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-26
**Phase:** 26-Daily Voice Note Ritual
**Mode:** `--auto` (Claude auto-selected recommended defaults; no interactive AskUserQuestion calls)
**Areas discussed:** Migration 0007 ownership + shape, PP#5 implementation (position + query + return path), Direct-tag write path for RITUAL_RESPONSE, Plan split structure, Pre-fire suppression query mechanism, Outcome shape for system_suppressed, Mock-chain test family update scope, Dispatch keying (name vs type), Voice-decline language source

---

## Migration 0007 ownership + shape

| Option | Description | Selected |
|--------|-------------|----------|
| New `0007_daily_voice_note_seed.sql` migration with `INSERT ... ON CONFLICT DO NOTHING` seed | Hand-authored hybrid SQL + drizzle snapshot regen (Plan 25-01 D-25-01-A pattern); idempotent | ✓ |
| Fold seed into 0006_rituals_wellbeing.sql | Modify shipped migration; breaks lineage invariant (TECH-DEBT-19-01 class) | |
| Runtime seed via app boot (`src/index.ts:main()`) | Per-environment hidden side effect; complicates manual-sweep.ts testability | |

**Auto-selected:** "New `0007_daily_voice_note_seed.sql`".
**Rationale:** Phase 25 Open Q1 RESOLVED — Phases 26/27/29 own their respective seed inserts. Hand-SQL pattern + idempotent ON CONFLICT matches Plan 25-01 D-25-01-A; new migration slot preserves lineage discipline.

---

## PP#5 implementation: position + query + return path

| Option | Description | Selected |
|--------|-------------|----------|
| PP#5 at body top of `processMessage` (BEFORE PP#0); state-table lookup; return empty string on hit | Per spec interpretation #4 + Pitfall 6 mitigation; state-table mechanism is load-bearing | ✓ |
| PP#5 between PP#0 and PP#1 | Stale capture state could hijack ritual response; rejected per ARCHITECTURE.md §3 | |
| Text-heuristic detection (no DB lookup) | Conflates organic JOURNAL deposits with ritual responses; rejected per Pitfall 6 | |
| Separate `bot.on('message:text')` handler bypassing `processMessage` | Pitfall 24 explicitly forbids — must flow through same `processMessage` pipeline that fixture tests | |

**Auto-selected:** "PP#5 at body top".
**Rationale:** HARD CO-LOC #1 demands PP#5 + handler in same plan; spec interpretation #4 demands position 0 (BEFORE PP#0). State-table lookup against `ritual_pending_responses` is the load-bearing invariant; text heuristics break.

---

## Direct-tag write path for RITUAL_RESPONSE

| Option | Description | Selected |
|--------|-------------|----------|
| Add explicit `epistemicTag` parameter to `storePensieveEntry` | Backward-compat (additive); type-checked at call site | ✓ |
| Metadata flag (`metadata.preTagged: true`) | Implicit; not type-checked; tagger has to know about the flag | |
| Write entry with NULL tag, then update via tagEntry | Window where entry exists with NULL tag and might be misclassified | |

**Auto-selected:** "Add explicit `epistemicTag` parameter".
**Rationale:** Explicit > implicit; matches CONVENTIONS.md preference for type-safe contracts. Backward-compat — existing 4 call sites omit `opts`.

---

## Plan split structure

| Option | Description | Selected |
|--------|-------------|----------|
| 4 plans (substrate / handler+PP#5+mock-chain / suppression / voice-decline) | HARD CO-LOC #1 + #5 in Plan 26-02; clean blast radius per concern | ✓ |
| 3 plans (collapse PP#5 + suppression + handler) | >8-file plan harder to review; suppression test depends on PP#5 mock chain | |
| 5 plans (extract prompt-rotation primitive) | Adds boundary cost for ~30 LoC pure logic with no risk reduction | |
| Bundle voice-decline with PP#5 plan | Expands Plan 26-02 surface unnecessarily; risks timeout | |

**Auto-selected:** "4 plans".
**Rationale:** HARD CO-LOC #1 (PP#5 + voice handler) and #5 (mock-chain coverage with PP#5) both land in Plan 26-02. Substrate, suppression, voice-decline naturally cleave into separate plans by surface area.

---

## Pre-fire suppression query mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Query `pensieve_entries` with `dayBoundaryUtc` + `metadata->>'mode' = 'JOURNAL'` filter | Pensieve is authoritative (D035); reuses existing Luxon helper | ✓ |
| Count `conversations.role = 'USER' AND mode = 'JOURNAL'` | Conversations is a transient store; less canonical | |
| Count `ritual_responses` rows fired today | Counts ritual fires, not user deposits — wrong target per Pitfall 9 | |

**Auto-selected:** "Query `pensieve_entries` with `dayBoundaryUtc`".
**Rationale:** D035 makes Pensieve authoritative; Pitfall 9 phrasing explicitly says "≥5 deposits today" which maps to Pensieve entries. Reuses `dayBoundaryUtc` from `src/episodic/sources.ts`.

---

## Outcome shape for VOICE-04 suppression

| Option | Description | Selected |
|--------|-------------|----------|
| Append `'system_suppressed'` literal to existing `RitualFireOutcome` union now (Phase 26) | Forward-compat; Phase 28 enriches with discriminator fields if needed | ✓ |
| Wait for Phase 28 to formalize discriminated union | Phase 26 has no clean outcome string for VOICE-04 success criterion | |
| Phase 26 ships ad-hoc string (not in union) | Type drift; harder for Phase 28 to reconcile | |

**Auto-selected:** "Append literal now".
**Rationale:** VOICE-04 success criterion 3 in ROADMAP demands `system_suppressed` semantics in Phase 26. Appending literal to union is forward-compatible — Phase 28 enriches; Phase 26 gets the contract it needs.

---

## Mock-chain test family update scope

| Option | Description | Selected |
|--------|-------------|----------|
| Update `engine.test.ts` + `engine-mute.test.ts` + `engine-refusal.test.ts` (and check boundary-audit) | Phase 14 v2.1 regression class precedent — sibling files must update mocks too | ✓ |
| Update only `engine.test.ts` | v2.1 Phase 14 specifically failed by leaving sibling files with stale mocks | |

**Auto-selected:** "Full family update".
**Rationale:** HARD CO-LOC #5 + Pitfall 24 demand full coverage. v2.1 Phase 14 left mock chains stale and the regression class re-emerged.

---

## Dispatch keying

| Option | Description | Selected |
|--------|-------------|----------|
| Dispatch on `ritual.name` (e.g. `'daily_voice_note'`) | Name is UNIQUE; cadence is behavioral not routing | ✓ |
| Dispatch on `ritual.type` (cadence enum) | Multiple rituals share cadences; daily wellbeing + daily voice note both `'daily'` | |
| Add new `kind` column to `rituals` table | Denormalize without value (RIT-01 column set already locked) | |

**Auto-selected:** "Dispatch on `ritual.name`".
**Rationale:** `name` is UNIQUE constraint in Phase 25 schema; aligns with seed-migration design (each phase seeds its own named ritual row).

---

## Voice-decline handler language source

| Option | Description | Selected |
|--------|-------------|----------|
| `getLastUserLanguage(chatId)` from existing language tracker | Reads M006 stickiness contract; honors spec language without Whisper | ✓ |
| Whisper transcribe + franc on transcript | OOS-3 explicit anti-feature | |
| Always reply in English | Regression vs M006 multilingual support | |

**Auto-selected:** "`getLastUserLanguage`".
**Rationale:** Spec language ("`franc` detection on user's last text message") is honored by reading from PRIOR text messages — exactly what `getLastUserLanguage` returns (populated by PP#4). No Whisper, no `franc` invocation on the empty-text voice message.

---

## Claude's Discretion

- Exact file names within `src/rituals/` (single `voice-note.ts` module owning constants + handler + 3 helpers, vs splitting into `prompt-rotation.ts`)
- Exact log-event names (`rituals.voice_note.fired`, `rituals.voice_note.suppressed`, `chris.engine.pp5.hit`, `chris.engine.pp5.miss`, `bot.voice.declined`)
- Exact test file locations (`src/chris/__tests__/engine-pp5.test.ts`, `src/rituals/__tests__/voice-note.test.ts`, `src/bot/handlers/__tests__/voice-decline.test.ts`)
- Whether to ship `scripts/fire-ritual.ts` operator wrapper in Plan 26-02 (recommended) or defer to Phase 30
- `recordRitualVoiceResponse` exact return type and error handling shape
- Whether to declare the new partial index in `src/db/schema.ts` (cleaner) or only in migration SQL (acceptable, drizzle-kit `.where()` works either way)

## Deferred Ideas

- Server-side Whisper transcription (OOS-3 — explicit anti-feature; revisit only if review/confirm-before-storage flow ships first)
- `config.suppress_if_deposits_above` per-ritual override (Phase 28 adjustment dialogue territory)
- `RESPONSE_WINDOW_HOURS` retuning (revisit after 30 days of real use; OPEN-1)
- Cleaned-projection `pensieve_entries.cleaned_for_quote_retrieval` for STT filler removal (Pitfall 8; future M010+ phase)
- Skip-tracking on missed voice notes (`fired_no_response` outcome) — Phase 28
- AI follow-up question after voice deposit (OOS-1 — kills the habit; D026 forbids)
- Free-text custom prompts via Haiku (OOS-10 — major test surface)
- 14-day primed-fixture integration test asserting full Pitfall 6 regression contract (Phase 30 TEST-25)
