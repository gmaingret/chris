---
phase: 26
slug: daily-voice-note-ritual
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-04-26
updated: 2026-04-26
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> Source: `26-RESEARCH.md` §1 (PP#5) + §2 (rotation) + §3 (handler) + §4 (suppression) + §5 (voice-decline) + §6 (migration).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (existing) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run src/rituals/__tests__ src/chris/__tests__/engine-pp5.test.ts src/bot/handlers/__tests__/voice-decline.test.ts` |
| **Full suite command** | `bash scripts/test.sh` (Docker postgres + full vitest) |
| **Estimated runtime** | quick ~10s; full ~100s (Docker spin-up dominated) |

> **Env-level constraint:** vitest-4 fork-IPC hang under HuggingFace EACCES — `scripts/test.sh` already excludes 5 specific files. Phase 26's new test files MUST NOT be added to that exclude list, AND they MUST NOT import `@huggingface/transformers` (none should — Phase 26 has zero LLM surface).
>
> **Real-DB test discipline:** `engine-pp5.test.ts` and `voice-note-suppression.test.ts` use the real Docker postgres pattern (port 5434 — Plan 25-02 idempotency.test.ts precedent). Mock-only suites silently pass broken concurrency code (Plan 25-02 D-25-02-A lesson). PP#5 atomic consume + suppression count are concurrency-sensitive.

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/rituals/__tests__ src/chris/__tests__/engine-pp5.test.ts src/bot/handlers/__tests__/voice-decline.test.ts` (quick)
- **After every plan wave:** Run `bash scripts/test.sh` (full)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~10s for quick; ~100s for full

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 26-01-* | 01 | 1 | VOICE-02 | — | `PROMPTS` array contains 6 spec-order prompts; `PROMPT_SET_VERSION = 'v1'` constant exported | unit | `npx vitest run src/rituals/__tests__/voice-note.test.ts` | ❌ W0 | ⬜ pending |
| 26-01-* | 01 | 1 | VOICE-03 (rotation primitive) | Pitfall 7 | Shuffled-bag: 600 fires → distribution within ±20%, no consecutive dupes, max gap ≤ 11 | property test | `npx vitest run src/rituals/__tests__/prompt-rotation-property.test.ts` | ❌ W0 | ⬜ pending |
| 26-01-* | 01 | 1 | VOICE-02..03 (substrate) | Pitfall 28 | Migration 0007 applies cleanly; seed row + partial index present | integration (Docker postgres) | `bash scripts/test.sh` (psql line confirms `daily_voice_note` row + `ritual_pending_responses_chat_id_active_idx`) | ❌ W0 | ⬜ pending |
| 26-02-* | 02 | 2 | VOICE-01 (PP#5 deposit-only) | **Pitfall 6 CRITICAL** | PP#5 fires at engine position 0 on pending-row hit; returns empty string; `expect(mockAnthropicCreate).not.toHaveBeenCalled()` cumulative | integration (Docker postgres + LLM mock) | `npx vitest run src/chris/__tests__/engine-pp5.test.ts` | ❌ W0 | ⬜ pending |
| 26-02-* | 02 | 2 | VOICE-01 (atomic consume) | — | `UPDATE ritual_pending_responses SET consumed_at WHERE consumed_at IS NULL RETURNING id` mutual exclusion: 2 concurrent invocations → exactly 1 winner | concurrency test (Docker postgres) | `npx vitest run src/rituals/__tests__/voice-note.test.ts -t "atomic consume"` | ❌ W0 | ⬜ pending |
| 26-02-* | 02 | 2 | VOICE-06 (source_subtype tag) | Pitfall 8 | Pensieve entry from PP#5 has `epistemic_tag = 'RITUAL_RESPONSE'` AND `metadata->>'source_subtype' = 'ritual_voice_note'` | integration (Docker postgres) | `npx vitest run src/chris/__tests__/engine-pp5.test.ts -t "Pensieve persistence"` | ❌ W0 | ⬜ pending |
| 26-02-* | 02 | 2 | VOICE-02 + VOICE-03 (handler) | — | `fireVoiceNote` pops next prompt from bag, sends Telegram message, inserts pending row, updates `rituals.config.prompt_bag` | integration (Docker postgres + bot.api mock) | `npx vitest run src/rituals/__tests__/voice-note.test.ts -t "fireVoiceNote"` | ❌ W0 | ⬜ pending |
| 26-02-* | 02 | 2 | VOICE-01 (mock-chain coverage) | **Pitfall 24 CRITICAL** | Existing `engine.test.ts`/`engine-mute.test.ts`/`engine-refusal.test.ts` pass after PP#5 added with stubbed `findActivePendingResponse → null` | unit (existing tests) | `npx vitest run src/chris/__tests__/engine.test.ts src/chris/__tests__/engine-mute.test.ts src/chris/__tests__/engine-refusal.test.ts` | ⚠ existing files | ⬜ pending |
| 26-03-* | 03 | 3 | VOICE-04 (suppression) | Pitfall 9 | `shouldSuppressVoiceNoteFire(now)` returns true when ≥5 telegram JOURNAL Pensieve entries exist with `created_at >= dayStart` (local Paris) | integration (Docker postgres) | `npx vitest run src/rituals/__tests__/voice-note-suppression.test.ts` | ❌ W0 | ⬜ pending |
| 26-03-* | 03 | 3 | VOICE-04 (outcome) | — | `fireVoiceNote` returns `'system_suppressed'` outcome; advances `next_run_at` to tomorrow's 21:00 Paris; does NOT increment `skip_count`; does NOT insert `ritual_pending_responses` | integration (Docker postgres + bot.api spy) | `npx vitest run src/rituals/__tests__/voice-note-suppression.test.ts -t "outcome"` | ❌ W0 | ⬜ pending |
| 26-04-* | 04 | 4 | VOICE-05 (polite-decline) | — | `bot.on('message:voice', handleVoiceMessageDecline)` registered; reply in EN/FR/RU per `getLastUserLanguage`; defaults to EN; no Pensieve write, no `processMessage` call | unit (mock ctx + getLastUserLanguage) | `npx vitest run src/bot/handlers/__tests__/voice-decline.test.ts` | ❌ W0 | ⬜ pending |
| 26-04-* | 04 | 4 | VOICE-05 (registration) | — | `src/bot/bot.ts` has `bot.on('message:voice', ...)` registration | static grep | `grep -nE "bot\.on\(['\"]message:voice['\"]" src/bot/bot.ts` | ⚠ existing file | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 = test stubs that compile but fail (red); Wave N replaces stubs with passing implementation. New test files Phase 26 introduces:

- [ ] `src/rituals/__tests__/voice-note.test.ts` — PROMPTS constants, fireVoiceNote handler integration, atomic-consume race test
- [ ] `src/rituals/__tests__/prompt-rotation-property.test.ts` — VOICE-03 600-fire property invariants
- [ ] `src/rituals/__tests__/voice-note-suppression.test.ts` — VOICE-04 suppression behavior + outcome
- [ ] `src/chris/__tests__/engine-pp5.test.ts` — VOICE-01 + VOICE-06 integration with cumulative `mockAnthropicCreate.not.toHaveBeenCalled()`
- [ ] `src/bot/handlers/__tests__/voice-decline.test.ts` — VOICE-05 polite-decline handler

Existing test files Phase 26 extends:

- [ ] `src/chris/__tests__/engine.test.ts` — add `vi.mock('../../rituals/voice-note.js')` chain stub (HARD CO-LOC #5)
- [ ] `src/chris/__tests__/engine-mute.test.ts` — same mock
- [ ] `src/chris/__tests__/engine-refusal.test.ts` — same mock
- [ ] `src/chris/__tests__/boundary-audit.test.ts` — verify it doesn't transitively import engine; if it does, add the mock too

> Plan 26-01's migration test reuses existing `scripts/test.sh` Docker harness with new psql line additions — no new test infra required for that plan.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator can `npx tsx scripts/fire-ritual.ts daily_voice_note` (or `scripts/manual-sweep.ts` after manually setting `next_run_at <= now()`) and observe Telegram message arriving with one of 6 spec prompts | VOICE-01..03 (success criterion 1 in ROADMAP) | Requires real Telegram bot token + real chat | After Wave 2 completes against staging Telegram bot: set `next_run_at = now() - interval '1 minute'` for `daily_voice_note` row; run `scripts/manual-sweep.ts`; observe Telegram message; reply with free-text; confirm Pensieve entry created with `RITUAL_RESPONSE` tag + `source_subtype='ritual_voice_note'`; confirm Chris DOES NOT respond |
| Sending an actual Telegram voice message gets EN/FR/RU polite-decline | VOICE-05 (success criterion 4 in ROADMAP) | Requires real Telegram client to send voice message | After Wave 4 completes against staging Telegram bot: send a voice message; observe polite-decline reply matches the language of prior text messages |
| Day with ≥5 telegram JOURNAL entries causes 21:00 fire to suppress | VOICE-04 (success criterion 3 in ROADMAP) | Wallclock-dependent; stub via integration test in Plan 26-03; manual confirms staging behavior | Seed 5 telegram-source JOURNAL Pensieve entries on staging; wait for 21:00 cron; confirm no Telegram message; confirm `next_run_at` advanced to tomorrow; confirm `skip_count` unchanged |

---

## HARD CO-LOCATION enforcement gate

| Constraint | Plan | Verification |
|-----------|------|--------------|
| **HARD CO-LOC #1 (Pitfall 6)** — PP#5 detector + voice note handler in same plan | 26-02 | grep `findActivePendingResponse\|fireVoiceNote` in plan task file list — both must appear |
| **HARD CO-LOC #5 (Pitfall 24)** — mock-chain coverage update + PP#5 in same plan | 26-02 | grep `engine.test.ts\|engine-mute.test.ts\|engine-refusal.test.ts` in plan task file list — all three must appear with `vi.mock('../../rituals/voice-note.js')` edits |

If checker finds either constraint violated → **CHECKPOINT REACHED** (orchestrator amends CONTEXT.md + replans, mirrors Plan 25-03 iteration-1 pattern).

---

## Pitfall Mitigation Coverage Map

| Pitfall | Severity | Phase 26 Plan | Mitigation Test |
|---------|----------|---------------|-----------------|
| Pitfall 6 (engine responds to ritual voice note) | **CRITICAL** | 26-02 | `engine-pp5.test.ts` cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` |
| Pitfall 7 (prompt rotation stuck) | HIGH | 26-01 | `prompt-rotation-property.test.ts` 600-fire invariants |
| Pitfall 8 (STT filler tagging) | MEDIUM | 26-02 | `engine-pp5.test.ts` asserts `metadata->>'source_subtype' = 'ritual_voice_note'` |
| Pitfall 9 (pre-fire suppression) | MEDIUM | 26-03 | `voice-note-suppression.test.ts` integration test with 5-entry seed |
| Pitfall 24 (mock-chain coverage) | **CRITICAL** | 26-02 | `engine.test.ts` + siblings pass after PP#5 added |
| Pitfall 28 (migration lineage) | HIGH | 26-01 | `scripts/test.sh` smoke gate confirms seed row + partial index post-migration |

---

*Validation strategy locked: 2026-04-26 (per CONTEXT.md D-26-01..09)*
