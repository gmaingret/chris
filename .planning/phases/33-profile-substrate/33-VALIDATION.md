---
phase: 33
slug: profile-substrate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-11
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
| 33-01-XX | 33-01 | 1 | PROF-01 | T-33-* / — | Migration 0012 applies cleanly + 5 tables exist with required columns | integration (SQL smoke gate) | `bash scripts/test.sh` | ❌ Wave 0 (`scripts/test.sh` extend smoke gate) | ⬜ pending |
| 33-01-XX | 33-01 | 1 | PROF-01 | — | `schema_version int NOT NULL DEFAULT 1` + `substrate_hash text` + `name='primary' UNIQUE DEFAULT` present on all 4 profile tables | integration | `bash scripts/test.sh` | ❌ Wave 0 (smoke-gate SQL) | ⬜ pending |
| 33-01-XX | 33-01 | 1 | PROF-02 | — | `profile_history` table exists with discriminator columns | integration | `bash scripts/test.sh` | ❌ Wave 0 (smoke gate IN-list) | ⬜ pending |
| 33-01-XX | 33-01 | 1 | PROF-03 | — | Initial profile rows seeded (4 rows, name='primary', correct confidence) | integration | `bash scripts/test.sh` | ❌ Wave 0 (smoke gate SELECT assertion) | ⬜ pending |
| 33-02-XX | 33-02 | 2 | PROF-04 | — | `getOperationalProfiles()` returns all-null when DB has no rows | integration | `npx vitest run src/memory/__tests__/profiles.test.ts` | ❌ Wave 0 (new file) | ⬜ pending |
| 33-02-XX | 33-02 | 2 | PROF-04 | — | `getOperationalProfiles()` returns null per profile on DB error (does not throw) | integration | `npx vitest run src/memory/__tests__/profiles.test.ts` | ❌ Wave 0 (same file) | ⬜ pending |
| 33-02-XX | 33-02 | 2 | PROF-05 | — | v3 schemas parse valid shapes | unit | `npx vitest run src/memory/profiles/__tests__/schemas.test.ts` | ❌ Wave 0 (new file) | ⬜ pending |
| 33-02-XX | 33-02 | 2 | PROF-05 | — | v3 schemas reject invalid shapes (wrong confidence range, missing fields) | unit | `npx vitest run src/memory/profiles/__tests__/schemas.test.ts` | ❌ Wave 0 (same file) | ⬜ pending |
| 33-02-XX | 33-02 | 2 | PROF-05 | — | `schema_version: 999` returns null without throwing | integration | `npx vitest run src/memory/__tests__/profiles.test.ts` | ❌ Wave 0 (`profiles.test.ts`) | ⬜ pending |
| 33-02-XX | 33-02 | 2 | (substrate) | — | `computeProfileConfidence(0,0)`→0; `(10,1.0)`→0.3; `(50,1.0)`→1.0; `(9)` below threshold | unit | `npx vitest run src/memory/__tests__/confidence.test.ts` | ❌ Wave 0 (new file) | ⬜ pending |
| 33-02-XX | 33-02 | 2 | (substrate) | — | `isAboveThreshold(9)`→false; `(10)`→true | unit | `npx vitest run src/memory/__tests__/confidence.test.ts` | ❌ Wave 0 (same file) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs marked `33-01-XX` / `33-02-XX` will be replaced with concrete IDs once PLAN.md task numbering is finalized in step 8.*

---

## Wave 0 Requirements

- [ ] `src/memory/__tests__/confidence.test.ts` — covers PROF-05 substrate (`computeProfileConfidence`, `isAboveThreshold`) — new file
- [ ] `src/memory/__tests__/profiles.test.ts` — integration test against Docker Postgres covering PROF-04 + PROF-05 schema-mismatch — new file
- [ ] `src/memory/profiles/__tests__/schemas.test.ts` — covers PROF-05 v3 schema valid/invalid parse — new file
- [ ] `scripts/test.sh` smoke gate for migration 0012 — extend existing pattern (~30 lines of new bash inside the existing file)
- [x] vitest ^4.1.2 + Docker Postgres on 5433 + `scripts/test.sh` orchestrator already installed — no framework install needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Production migration apply (Drizzle migrator on container restart) | PROF-01 | Touches Proxmox prod database; D-prod-discipline requires operator confirmation | After CI green, deploy container; observe `__drizzle_migrations` row for 0012; assert all 5 tables exist via `psql` on Proxmox |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (4 new test files + scripts/test.sh smoke gate extension)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s (full gate)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
