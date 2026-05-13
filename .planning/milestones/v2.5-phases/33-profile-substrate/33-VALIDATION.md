---
phase: 33
slug: profile-substrate
status: compliant
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-11
audited: 2026-05-13
---

# Phase 33 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.1.2 (existing — package.json:46) |
| **Config file** | `vitest.config.ts` (existing — no Phase 33 changes) |
| **Quick run command** | `npx vitest run src/memory/__tests__/confidence.test.ts` (unit; subseconds) |
| **Full suite command** | `bash scripts/test.sh` (Docker Postgres + all migrations + all vitest + smoke gate) |
| **Estimated runtime** | ~1s quick (unit) · ~60s full (Docker PG + migration apply chain + smoke gate) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <relevant-test-file>` (subseconds for unit tests; ~15s for `profiles.test.ts` with Docker Postgres warm)
- **After every plan wave:** Run `bash scripts/test.sh` (full suite including migration apply chain + smoke gates)
- **Before `/gsd-verify-work`:** Full suite green AND `bash scripts/regen-snapshots.sh` passes (acceptance gate prints "No schema changes")
- **Max feedback latency:** ~1s unit · ~60s full gate

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 33-01-XX | 33-01 | 1 | PROF-01 | T-33-* / — | Migration 0012 applies cleanly + 5 tables exist with required columns | integration (SQL smoke gate) | `bash scripts/test.sh` | ✓ scripts/test.sh:218-262 (substrate smoke gate) | ✅ green |
| 33-01-XX | 33-01 | 1 | PROF-01 | — | `schema_version int NOT NULL DEFAULT 1` + `substrate_hash text` + `name='primary' UNIQUE DEFAULT` present on all 4 profile tables | integration | `bash scripts/test.sh` | ✓ scripts/test.sh:218-262 | ✅ green |
| 33-01-XX | 33-01 | 1 | PROF-02 | — | `profile_history` table exists with discriminator columns | integration | `bash scripts/test.sh` | ✓ scripts/test.sh smoke gate | ✅ green |
| 33-01-XX | 33-01 | 1 | PROF-03 | — | Initial profile rows seeded (4 rows, name='primary', correct confidence) | integration | `bash scripts/test.sh` | ✓ scripts/test.sh smoke gate | ✅ green |
| 33-02-XX | 33-02 | 2 | PROF-04 | — | `getOperationalProfiles()` returns all-null when DB has no rows | integration | `npx vitest run src/memory/__tests__/profiles.test.ts` | ✓ exists | ✅ green |
| 33-02-XX | 33-02 | 2 | PROF-04 | — | `getOperationalProfiles()` returns null per profile on DB error (does not throw) | integration | `npx vitest run src/memory/__tests__/profiles.test.ts` | ✓ exists | ✅ green |
| 33-02-XX | 33-02 | 2 | PROF-05 | — | v3 schemas parse valid shapes | unit | `npx vitest run src/memory/profiles/__tests__/schemas.test.ts` | ✓ exists | ✅ green |
| 33-02-XX | 33-02 | 2 | PROF-05 | — | v3 schemas reject invalid shapes (wrong confidence range, missing fields) | unit | `npx vitest run src/memory/profiles/__tests__/schemas.test.ts` | ✓ exists | ✅ green |
| 33-02-XX | 33-02 | 2 | PROF-05 | — | `schema_version: 999` returns null without throwing | integration | `npx vitest run src/memory/__tests__/profiles.test.ts` | ✓ profiles.test.ts | ✅ green |
| 33-02-XX | 33-02 | 2 | (substrate) | — | `computeProfileConfidence(0,0)`→0; `(10,1.0)`→0.3; `(50,1.0)`→1.0; `(9)` below threshold | unit | `npx vitest run src/memory/__tests__/confidence.test.ts` | ✓ exists | ✅ green |
| 33-02-XX | 33-02 | 2 | (substrate) | — | `isAboveThreshold(9)`→false; `(10)`→true | unit | `npx vitest run src/memory/__tests__/confidence.test.ts` | ✓ exists | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs marked `33-01-XX` / `33-02-XX` will be replaced with concrete IDs once PLAN.md task numbering is finalized in step 8.*

---

## Wave 0 Requirements

- [x] `src/memory/__tests__/confidence.test.ts` — covers PROF-05 substrate (`computeProfileConfidence`, `isAboveThreshold`) — 95 lines, 13 test cases (per 33-VERIFICATION.md)
- [x] `src/memory/__tests__/profiles.test.ts` — integration test against Docker Postgres covering PROF-04 + PROF-05 schema-mismatch — 238 lines
- [x] `src/memory/profiles/__tests__/schemas.test.ts` — covers PROF-05 v3 schema valid/invalid parse — 184 lines, 14 tests
- [x] `scripts/test.sh` smoke gate for migration 0012 — lines 218-262 assert 5 tables + 4 seed rows + correct confidence values
- [x] vitest ^4.1.2 + Docker Postgres on 5433 + `scripts/test.sh` orchestrator already installed — no framework install needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Production migration apply (Drizzle migrator on container restart) | PROF-01 | Touches Proxmox prod database; D-prod-discipline requires operator confirmation | After CI green, deploy container; observe `__drizzle_migrations` row for 0012; assert all 5 tables exist via `psql` on Proxmox |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (4 test files + scripts/test.sh smoke gate extension all shipped)
- [x] No watch-mode flags
- [x] Feedback latency < 60s (full gate)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ✓ compliant (audited 2026-05-13 retroactively during v2.5 milestone close; all referenced test files exist and pass per 33-VERIFICATION.md)

---

## Validation Audit 2026-05-13

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 11 per-task verification entries cross-referenced against shipped test files. Confidence test (13 cases), profiles integration test (238 lines), schemas test (184 lines), and scripts/test.sh substrate smoke gate (lines 218-262) all exist and pass per 33-VERIFICATION.md (status: passed, score 5/5 must-haves). One manual-only verification remains (Proxmox production migration apply, already executed 2026-05-11 — see 34-HUMAN-UAT.md deploy record).
