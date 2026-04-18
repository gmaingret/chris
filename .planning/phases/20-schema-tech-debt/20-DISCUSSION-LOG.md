# Phase 20: Schema + Tech Debt — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `20-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 20-schema-tech-debt
**Areas discussed:** TECH-DEBT-19-01 resolution, Zod schema shape, DB-level CHECK constraints, Test gate expectations

---

## TECH-DEBT-19-01 Resolution Technique

### Q1: Regeneration technique

| Option | Description | Selected |
|--------|-------------|----------|
| Clean slate + replay | Delete 0002/0004 snapshots + `_journal.json`. Run `drizzle-kit generate` iteratively against cumulative migration applied state; rename outputs to fill 0001/0003. High-confidence; expensive. | ✓ |
| Hand-author 0001 + 0003 snapshots | Author the two missing JSON files by hand using 0000_snapshot + the SQL delta. Faster, but drift risk vs drizzle-kit canonical. | |
| Introspect + reconstruct | Apply all 5 migrations → `drizzle-kit introspect` → reverse-engineer per-migration snapshots. Scripting risk, drizzle-kit version inconsistency. | |
| Accept gap, never regen | Keep the missing snapshots as permanent tech debt; hand-craft migration 0005. Violates Phase 20 Success Criterion #1. | |

**User's choice:** Clean slate + replay
**Notes:** Selected the recommended option. Locked in D-01.

### Q2: Isolation

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated throwaway DB + branch | Fresh Docker volume + throwaway git branch. Zero contamination risk; reproducible. | ✓ |
| Scratch temp dir, no git | Copy migrations to `/tmp`, regenerate, copy back only the two missing files. Fewer moving parts; temp state not version-controlled. | |
| In-place on current branch | Regenerate directly with commits at each step. Fastest iteration; scary rollback. | |

**User's choice:** Dedicated throwaway DB + branch
**Notes:** Locked in D-02.

### Q3: Acceptance proof

| Option | Description | Selected |
|--------|-------------|----------|
| `drizzle-kit generate = no-op` | After regen, `drizzle-kit generate` must print "No schema changes, nothing to migrate". This is Phase 20 Success Criterion #1 verbatim. | ✓ |
| Snapshot byte-diff vs expected | Compute expected snapshot shape from schema.ts + SQL, byte-compare. No canonical oracle. | |
| Full test suite green + generate no-op | Both verifications. Belt-and-suspenders. | |

**User's choice:** `drizzle-kit generate = no-op`
**Notes:** Locked in D-03.

### Q4: Commit split

| Option | Description | Selected |
|--------|-------------|----------|
| Separate commits, TD-01 first | Commit 1: regenerated snapshots (no schema change). Commit 2+: migration 0005 + types + config. Independently revertable; clean bisection. | ✓ |
| Single atomic commit | Bundle everything into one "Phase 20 schema" commit. Simpler history; harder to isolate regressions. | |
| Snapshot regen as pre-work (not in phase plan) | Do regen as ungated prep commit before Phase 20; Phase 20 proceeds against fixed foundation. | |

**User's choice:** Separate commits, TD-01 first
**Notes:** Locked in D-04.

### Q5: Rollback plan

| Option | Description | Selected |
|--------|-------------|----------|
| Revert commit + redo approach | Thanks to commit-split, TD-01 commit is isolated → `git revert` it if broken, leaving migration 0005 intact. If both fail, revert both and escalate to different strategy. | ✓ |
| Keep STATE.md tech-debt entry | Best-effort regen; if gate passes ship, if not restore STATE.md entry with "retry in M009". Migration 0005 via hand-crafted SQL. | |
| Don't merge until fully verified | Regen + migration 0005 merge to main only when both `drizzle-kit generate` is no-op AND `scripts/test.sh` is green. | |

**User's choice:** Revert commit + redo approach
**Notes:** Locked in D-05.

---

## Zod Schema Shape

### Q1: Schema layering

| Option | Description | Selected |
|--------|-------------|----------|
| Three-layer: Sonnet / Insert / Row | `EpisodicSummarySonnetOutput` → `EpisodicSummaryInsert` → `EpisodicSummary` (DB row). Explicit about what each consumer needs. | ✓ |
| Two-layer: Schema + Row | One `EpisodicSummarySchema` (Sonnet + insert) + `EpisodicSummary` (row). Simpler but conflates LLM-output and insert. | |
| Single schema with optional id/created_at | One `EpisodicSummary` with `.optional()`. Minimal code; leaky. | |
| Deferred — decide in Phase 21 | Phase 20 ships only Row schema; Phase 21 plans Sonnet-output schema. Avoids speculative design. | |

**User's choice:** Three-layer: Sonnet / Insert / Row
**Notes:** Locked in D-11.

### Q2: Strictness

| Option | Description | Selected |
|--------|-------------|----------|
| Max strict, fail loud | importance `int().min(1).max(10)`; topics `min(1).max(10)`; summary `min(50)`; key_quotes each non-empty; emotional_arc `min(1)`. Sonnet drift caught by Zod. | ✓ |
| Permissive on arrays, strict on scalars | Scalars strict; allow empty topics/key_quotes. Covers sparse-entry without branching. | |
| Everything nullable/optional | All `.optional()`. Violates "NOT NULL everywhere" requirement. | |

**User's choice:** Max strict, fail loud
**Notes:** Locked in D-12.

### Q3: Export shape

| Option | Description | Selected |
|--------|-------------|----------|
| Types + parser helpers | Export schemas, inferred types, and `parseEpisodicSummary` helper wrapping `.parse()` with clear error. Downstream callers don't learn Zod internals. | ✓ |
| Only schemas, callers use `.parse()` | Export schemas + `z.infer` types; callers invoke `.parse()`. Less abstraction. | |
| Co-locate with schema.ts | Zod schema in `src/db/schema.ts` or sibling. Tight coupling; breaks module boundary. | |

**User's choice:** Types + parser helpers
**Notes:** Locked in D-13.

### Q4: Stub files

| Option | Description | Selected |
|--------|-------------|----------|
| Types-only, Phase 21 creates rest | Phase 20 creates `src/episodic/types.ts` only. No stubs. Matches Phase 13 pattern. | ✓ |
| Add `src/episodic/index.ts` barrel | Empty `index.ts` that re-exports from types.ts. Conventional import point; no-op file until Phase 21. | |
| Stub all planned files | Create empty `consolidate.ts`, `prompts.ts` stubs with TODOs. Signals module shape; dead files. | |

**User's choice:** Types-only, Phase 21 creates rest
**Notes:** Locked in D-14.

---

## DB-level CHECK Constraints

### Q1: Importance CHECK

| Option | Description | Selected |
|--------|-------------|----------|
| Ship CHECK now, belt-and-suspenders | `CHECK (importance BETWEEN 1 AND 10)` in migration 0005. Zod + DB CHECK together cover all write paths. | ✓ |
| Defer CHECK to Phase 21 | Follow Phase 13's "defer to write-phase" rule literally. Phase 21 adds CHECK in migration 0006. | |
| CHECK in separate follow-up migration 0005a | Migration 0005 ships without CHECK; 0005a adds it. Two migrations for one unit. | |
| Zod only, no DB CHECK ever | Trust the type layer. Matches existing table style (no CHECKs anywhere in schema.ts currently). | |

**User's choice:** Ship CHECK now, belt-and-suspenders
**Notes:** Locked in D-07. Deviation from Phase 13's rule is deliberate — operator paths (backfill, debugging) also write importance, not just Phase 21 engine. Rationale captured in <specifics>.

### Q2: Other DB-level constraints

| Option | Description | Selected |
|--------|-------------|----------|
| None beyond indexes + UNIQUE + NOT NULLs | Stick to EPI-01/02 + D-07 importance CHECK. | ✓ |
| Add `CHECK (array_length(source_entry_ids, 1) > 0)` | Guards zero-entry insert at DB level. Redundant with CONS-02 skip. | |
| Add `CHECK (length(summary) >= 50)` | Mirrors Zod min-50. Redundant; cheap insurance. | |

**User's choice:** None beyond indexes + UNIQUE + NOT NULLs
**Notes:** Locked in D-08. Alternatives moved to <deferred> section.

### Q3: Migration SQL authoring

| Option | Description | Selected |
|--------|-------------|----------|
| drizzle-kit generate | Add pgTable to schema.ts, run `drizzle-kit generate`. Matches D016. | ✓ |
| Hand-write migration SQL + drizzle-kit snapshot later | Author 0005.sql manually; drizzle-kit only for snapshot. Drift risk. | |
| Hand-write both SQL and snapshot | Maximum control; maximum maintenance. | |

**User's choice:** drizzle-kit generate
**Notes:** Locked in D-06.

---

## Test Gate Expectations

### Q1: Test coverage scope

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal: table + types smoke tests | 3-5 Zod unit tests + 3-4 Docker integration tests (insert valid, reject duplicate/bad-CHECK, pg_indexes assertion). Raises floor by ~5-8. | ✓ |
| Net-zero: just don't regress | No new tests. Gate stays at 152. Leaves EPI-02/03 untested. | |
| Maximum: migration round-trip + Zod exhaustive | ~15 new tests. Overkill for schema phase. | |

**User's choice:** Minimal: table + types smoke tests
**Notes:** Locked in D-18. Target: Docker gate ≥ 157 passing.

### Q2: Index assertion

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — one test queries pg_indexes | `SELECT indexname FROM pg_indexes WHERE tablename='episodic_summaries'` returns the three expected names. Only way to prove EPI-02 at runtime. | ✓ |
| No — trust drizzle-kit + SQL inspection | Code review of 0005 SQL is sufficient. | |
| Visual-only — manually verify in Docker psql | Executor runs `\d` once, pastes to SUMMARY. No automation. | |

**User's choice:** Yes — one test queries pg_indexes
**Notes:** Locked in D-18 test list.

### Q3: Test location

| Option | Description | Selected |
|--------|-------------|----------|
| src/episodic/__tests__/ | New dir mirroring `src/decisions/__tests__/`. Inherited by Phase 21+. | ✓ |
| src/db/__tests__/ | Treat as DB-concern. No existing convention. | |
| Inline in src/__tests__/ | Alongside fixtures dir. Scattered ownership. | |

**User's choice:** src/episodic/__tests__/
**Notes:** Locked in D-19.

### Q4: Config test for EPI-04

| Option | Description | Selected |
|--------|-------------|----------|
| TS compile-only — no runtime test | `tsc --noEmit` = the test. Matches how `proactiveSweepCron` was added. | ✓ |
| Add one unit test validating default + env override | 2 test cases verifying default and env override. Cheap; catches env-parsing typos. | |
| No test at all | Static object; if compiles, works. | |

**User's choice:** TS compile-only — no runtime test
**Notes:** Locked in D-16.

---

## Claude's Discretion

Planner/executor may decide:
- Exact throwaway branch name for TD-01 regen work.
- Whether the snapshot regen script lives in `scripts/regen-snapshots.sh` (resumable) or runs ad-hoc.
- Drizzle `pgTable` column ordering in `schema.ts` (follow existing convention: id → domain fields → audit timestamps).
- Exact file/test names beyond what's specified.
- Whether to wrap `parseEpisodicSummary` error in a custom `EpisodicSummaryValidationError` class or surface `ZodError` via `notifyError()`.

## Deferred Ideas

- Custom migration 0005 filename.
- Additional DB-level CHECKs (`array_length`, `length(summary)`).
- Phase 21 stub files.
- Migration rollback (down.sql) — codebase doesn't use this pattern.
- `EpisodicSummaryValidationError` custom error class (Claude's discretion).
- `episodic_embeddings` table — EPI-FUTURE-02, M010+.
- Versioned summaries / `/resummary` — EPI-FUTURE-01.
