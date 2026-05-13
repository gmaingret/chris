---
phase: 35
slug: surfaces
status: compliant
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-13
audited: 2026-05-13
---

# Phase 35 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `35-RESEARCH.md` §Validation Architecture (lines 932-977).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x (latest pinned in `package.json`) |
| **Config file** | `vitest.config.ts` (project root) — `fileParallelism: false` serial execution per Phase 33 D-02 |
| **Quick run command** | `npx vitest run src/chris/__tests__/personality.test.ts src/chris/__tests__/engine.test.ts` (Plan 35-01 regression gate) |
| **Full suite command** | `scripts/test.sh` (Docker compose + Postgres + vitest full run) |
| **Estimated runtime** | ~15s quick / ~3-5min full Docker suite |

---

## Sampling Rate

- **After every task commit (Plan 35-01):** `npx tsc --noEmit && npx vitest run src/chris/__tests__/personality.test.ts src/chris/__tests__/engine.test.ts` (~15s)
- **After every task commit (Plan 35-02):** `npx vitest run src/memory/__tests__/profiles.test.ts src/chris/__tests__/{reflect,coach,psychology,journal,interrogate,produce,photos}.test.ts` (~30s)
- **After every task commit (Plan 35-03):** `npx vitest run src/bot/handlers/__tests__/profile.test.ts src/bot/handlers/__tests__/profile.golden.test.ts` (~5s)
- **After every plan wave:** `scripts/test.sh` full Docker suite (Postgres + all vitest files)
- **Before `/gsd-verify-work`:** Full Docker suite must be green AND `npx tsc --noEmit` clean
- **Max feedback latency:** 30 seconds (quick path); 5 minutes (full Docker path)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 35-01-* | 01 | 1 | SURF-01 | T-35-V8 | buildSystemPrompt signature migrated atomically; ACCOUNTABILITY overload preserved | regression unit | `npx vitest run src/chris/__tests__/personality.test.ts src/chris/__tests__/engine.test.ts` | ✅ | ✅ green |
| 35-01-* | 01 | 1 | SURF-01 | — | resolution.ts ACCOUNTABILITY call site preserved | unit | `npx vitest run src/decisions/__tests__/resolution.test.ts` (verify exists in Wave 0) | ✅ verified | ✅ green |
| 35-02-* | 02 | 2 | SURF-02 | T-35-V11 | REFLECT/COACH/PSYCHOLOGY call getOperationalProfiles + inject profile block | positive unit | `npx vitest run src/chris/__tests__/{reflect,coach,psychology}.test.ts` | ✅ | ✅ green |
| 35-02-* | 02 | 2 | SURF-02 | T-35-V11 | JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY do NOT call getOperationalProfiles | negative invariant unit | `npx vitest run src/chris/__tests__/{journal,interrogate,produce,photos}.test.ts src/decisions/__tests__/resolution.test.ts` | ✅ | ✅ green |
| 35-02-* | 02 | 2 | SURF-02 | — | PROFILE_INJECTION_MAP shape (REFLECT=4, COACH=`capital,family`, PSYCHOLOGY=`health,jurisdictional`) | unit | `npx vitest run src/memory/__tests__/profiles.test.ts` | ✅ | ✅ green |
| 35-02-* | 02 | 2 | SURF-02 | T-35-V8 | formatProfilesForPrompt empty-string return; staleness qualifier appears at >21d; 2000-char truncation marker | unit | `npx vitest run src/memory/__tests__/profiles.test.ts` | ✅ | ✅ green |
| 35-03-* | 03 | 3 | SURF-03 | T-35-V7 | /profile emits 5 ctx.reply calls (4 dimensions + M011 placeholder) | handler integration | `npx vitest run src/bot/handlers/__tests__/profile.test.ts` | ✓ exists | ✅ green |
| 35-03-* | 03 | 3 | SURF-03 | T-35-V7 | /profile handles all-null gracefully (returns localized "insufficient data" actionable progress indicator) | handler integration | same file | ✓ exists | ✅ green |
| 35-03-* | 03 | 3 | SURF-04 | T-35-V8 | formatProfileForDisplay golden snapshot — 4 dimensions × 4 cases (null/zero-conf/populated-fresh/populated-stale) × EN | golden snapshot | `npx vitest run src/bot/handlers/__tests__/profile.golden.test.ts` | ✓ exists | ✅ green |
| 35-03-* | 03 | 3 | SURF-04 | — | FR/RU language coverage smoke (section labels appear in expected language for 1 dimension populated-fresh case) | golden snapshot smoke | same file | ✓ exists | ✅ green |
| 35-03-* | 03 | 3 | SURF-05 | T-35-V8 | Plain text output — ctx.reply called with single string arg (no `parse_mode` second arg) | handler integration | `profile.test.ts` | ✓ exists | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/bot/handlers/__tests__/profile.golden.test.ts` — covers SURF-04 (4 dim × 4 cases × EN snapshots + FR/RU smoke for 1 dim); 18 tests pass
- [x] `src/bot/handlers/__tests__/profile.test.ts` — covers SURF-03 + SURF-05 (handler integration; mock getOperationalProfiles + ctx.reply spy); 8 tests pass
- [x] `src/decisions/__tests__/resolution.test.ts` verified — ACCOUNTABILITY negative-injection invariant covered (0 references to getOperationalProfiles)
- [x] Extended `src/chris/__tests__/{reflect,coach,psychology}.test.ts` with positive-injection tests
- [x] Extended `src/chris/__tests__/{journal,interrogate,produce,photos}.test.ts` with negative-injection invariants (mockGetOperationalProfiles.not.toHaveBeenCalled())
- [x] Extended `src/memory/__tests__/profiles.test.ts` with PROFILE_INJECTION_MAP shape test + formatProfilesForPrompt unit tests (empty-string, staleness, char cap); 21 tests pass

**Framework install:** None needed — vitest already in devDependencies; `npx vitest run` already routine via `scripts/test.sh`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `/profile` smoke from Telegram against deployed container | SURF-03 / SURF-05 (informal UAT) | Real Telegram rendering depends on the Grammy → Telegram Bot API path; the golden snapshot test asserts string output, not on-device rendering | After Plan 35-03 deploys to Proxmox: send `/profile` from Greg's Telegram account; verify 5 messages arrive (4 dimensions + M011 placeholder); verify plain text rendering (no Markdown artifacts); verify second-person framing reads naturally |
| REFLECT mode prompt injection verified end-to-end in production conversation | SURF-02 (informal UAT) | Confirms cron-context populated rows from Phase 34's first Sunday 22:00 fire (2026-05-17) flow into Chris's REFLECT-mode responses | After 2026-05-17 cron fire: send a REFLECT-mode message ("Help me think about ..."); verify Chris references concrete profile facts (location, FI target) grounded in the operational profile block |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (3 new test files + 7 test extensions all shipped)
- [x] No watch-mode flags (all commands use `npx vitest run`, not `npx vitest`)
- [x] Feedback latency < 30s for unit gates / < 5min for full Docker
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ✓ compliant (audited 2026-05-13 retroactively during v2.5 milestone close; all referenced test files exist and pass per 35-VERIFICATION.md — status: passed, 47/47 phase-owned tests + 218/218 mode-handler tests, full Docker suite 1608/1/0).

---

## Validation Audit 2026-05-13

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 11 per-task verification entries cross-referenced against shipped test files. profile.golden (18 snapshot tests), profile.test (8 integration tests), resolution.test verified, plus injection-positive extensions to reflect/coach/psychology and injection-negative extensions to journal/interrogate/produce/photos. 2 manual-only Telegram UAT items remain (real-device /profile rendering + post-2026-05-17 REFLECT-mode injection observation), naturally requiring deployed container + future cron fire.
