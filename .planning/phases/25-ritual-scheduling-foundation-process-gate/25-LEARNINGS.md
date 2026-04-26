---
phase: 25
phase_name: "Ritual Scheduling Foundation"
project: "Project Chris"
generated: "2026-04-26"
counts:
  decisions: 6
  lessons: 7
  patterns: 5
  surprises: 4
missing_artifacts:
  - "25-UAT.md"
---

# Phase 25 Learnings: Ritual Scheduling Foundation

## Decisions

### D-04 Refined: Ritual channel daily counter ceiling = 3/day
The original D-04 said "channel cap value at planner discretion (e.g., 3-5/day)". A boolean `hasSentTodayRitual` cap (matching the existing accountability/reflective shape) would have suppressed two of M009's three rituals on any day they all fire (wellbeing 09:00 + voice note 21:00 + Sunday weekly review 20:00). Refined to a numeric `ritualCount` peer counter capped at 3/day via `hasReachedRitualDailyCap()` helper in `src/proactive/state.ts` mirroring the existing `hasSentTodayReflective`/`hasSentTodayAccountability` shape.

**Rationale:** 3 cleanly accommodates the worst-case Sunday with all three rituals firing. Defense-in-depth against ritual storms preserved (per-tick max-1 cap + per-ritual cadence advancement + 3/day channel ceiling).
**Source:** 25-CONTEXT.md (D-04 refinement) + 25-RESEARCH.md (Open Question 3 RESOLVED)

### D-09 Added: `computeNextRunAt(now, cadence, config)` 3-arg signature
The original D-02 spec'd `computeNextRunAt(now, config)` (2-arg). RESEARCH §4 showed pseudocode using `config.cadence`. But `RitualConfigSchema` (RIT-07) deliberately omits a `cadence` field — `rituals.type` (the enum column) is the source of truth for cadence; `rituals.config` (jsonb) holds tunables only. Folding `cadence` into `RitualConfigSchema` to preserve the 2-arg signature would denormalize a column that lives elsewhere.

**Rationale:** 3-arg signature is slightly less ergonomic at call sites, but every call site already has `ritual.type` in scope (the row was just fetched). Schema-vs-column separation outweighs the ergonomic cost.
**Source:** 25-CONTEXT.md (D-09 added 2026-04-26 post-checker PC-25-03)

### Hand-author SQL + drizzle-generated snapshot hybrid for migration 0006
drizzle-kit cannot auto-generate `ALTER TYPE … ADD VALUE IF NOT EXISTS` (it only emits the unguarded form) or `CREATE TABLE IF NOT EXISTS`. Migration 0006 uses hand-written SQL with all idempotency guards; the drizzle-kit-generated meta snapshot is the source of truth for lineage. The two are byte-stable in their net DB shape — guards are SQL-syntax only.

**Rationale:** Inherits the v2.1 Phase 19 TECH-DEBT-19-01 escape hatch pattern. Pure auto-gen would lose the IF NOT EXISTS guards needed for safe re-application; pure hand-auth would break the lineage invariant.
**Source:** 25-01-SUMMARY.md D-25-01-A + 25-CONTEXT.md D-08

### FKs declared via `.references()` in schema.ts AND DO-block in SQL
The plan's instruction text said "Do NOT generate FKs in schema.ts via `references()`" claiming a `decision_events` precedent. Inspection of `src/db/schema.ts:257` showed the precedent USES `.references()`. Aligning ritual schema.ts with codebase precedent (5 `.references()` calls) was critical — without it, every future `drizzle-kit generate` would have produced FK-add diffs, breaking lineage discipline.

**Rationale:** Snapshot/schema.ts equivalence requires both source of truth (SQL DDL) and Drizzle TypeScript declaration to express the same FKs. Diverging on either causes perpetual `drizzle-kit generate` diff churn.
**Source:** 25-01-SUMMARY.md D-25-01-B (Deviation 1)

### Smoke gate placement BEFORE vitest in scripts/test.sh
The `6|1|3` substrate assertion (6 tables + 1 enum value + 3 indexes) runs immediately after migration apply, BEFORE `npx vitest run`. A substrate failure exits 1 and blocks the whole test suite.

**Rationale:** Catches lineage mismatches early rather than producing false-positive type-checked tests against an incomplete DB. Test failures from missing tables are cryptic; substrate-gate failures are actionable.
**Source:** 25-01-SUMMARY.md D-25-01-C

### Predicate split for RIT-10 atomic UPDATE: `isNull` only when lastObserved is null
RESEARCH §6 prescribed `or(isNull(lastRunAt), lastObserved ? lt(...) : sql\`true\`)`. Tracing through concurrent semantics: postgres re-evaluates the second UPDATE's WHERE post-commit; `sql\`true\`` is row-state-independent so both UPDATEs would succeed → RIT-10 success criterion 3 (`firedCount === 1`) would FAIL. Restructured: `lastObserved === null` → strict `isNull(lastRunAt)` only; `lastObserved !== null` → `or(isNull, lt)`.

**Rationale:** Postgres serializable-read-committed semantics force WHERE re-evaluation against post-commit row state; the predicate must remain row-state-dependent in BOTH branches. Verified empirically by running the broken predicate against the concurrency test (it failed) before adopting the fix.
**Source:** 25-02-SUMMARY.md Deviation 1

---

## Lessons

### Plan acceptance criteria can over-specify the literal output shape
Plan 25-01 Task 1 had two strict greps that didn't match drizzle-kit's actual qualified-column output: `WHERE "enabled" = true` (expected) vs `WHERE "rituals"."enabled" = true` (actual; drizzle qualifies). And `^--> statement-breakpoint$` (standalone) vs the actual mostly-inline `... ;--> statement-breakpoint` shape used by both 0006 and the codebase analog 0002. Both deltas were accepted because matching codebase convention is more important than satisfying overly-literal grep counts.

**Context:** Future planners writing acceptance gates against tool output (drizzle-kit, prettier, etc.) should grep for SUBSTRINGS that survive minor formatting variations, not anchor-bound exact matches. Tool output evolves with versions.
**Source:** 25-01-SUMMARY.md "Issues Encountered"

### Honest docstrings naming forbidden patterns trigger their own grep guards
Plan 25-02 Task 2 cadence.ts docstring contained 6 literal mentions of `86_400_000`, `setUTCHours`, `setHours` — explaining to future readers what NOT to use and why. The plan's strict acceptance criterion `grep -E '86_?400_?000|setUTCHours|setHours' ... | wc -l == 0` did not anticipate honest documentation. Same issue: cadence.test.ts mentioning `vi.useFakeTimers` triggered the TESTING.md D-02 guard.

**Context:** Negative-pattern grep guards (forbidden tokens) and source-file docstrings are in tension. Either (a) the docstring describes forbidden patterns abstractly ("manual UTC ms arithmetic") or (b) the verification regex anchors on `import|require|=` to skip prose mentions. Phase 25 chose (a). Future guards in similar plans should consider (b) for better readability.
**Source:** 25-02-SUMMARY.md Deviation 2

### Postgres concurrent-update semantics must be tested with REAL postgres, not mocks
The RIT-10 atomic-UPDATE bug (see Decisions) was caught by reasoning, not by the existing mocked tests. Mock-based concurrency tests are insufficient for SQL-level races because the mock returns whatever the test author set up — it cannot reproduce postgres's row-locking + WHERE re-evaluation semantics. Plan 25-02 Task 3 uses `Promise.all` of two parallel real-DB invocations against Docker postgres on port 5434.

**Context:** This is generalizable: any feature whose correctness depends on transaction isolation, row-level locking, advisory locks, or post-commit visibility must have AT LEAST one real-DB test. Mock-only suites silently pass broken concurrency code.
**Source:** 25-02-SUMMARY.md Deviation 1 + 25-RESEARCH §6

### `state.test.ts` is a fully-mocked file; new persistence helpers need a peer real-DB test file
Plan 25-03 Task 7 listed `src/proactive/__tests__/state.test.ts` for editing, but the existing file's `vi.mock` at module top hoists for the whole file, replacing postgres-js + drizzle with mocks. Adding real-DB persistence assertions there would create tautological tests against the mock setup. Solution: created peer file `state-ritual-cap.test.ts` using the real-DB pattern from `src/rituals/__tests__/idempotency.test.ts`.

**Context:** When adding new helpers to a module whose existing tests are mocked, check the mock scope FIRST. If the mock is module-wide, create a peer test file with the real-DB pattern; don't try to mix real and mocked DB calls in the same file.
**Source:** 25-03-SUMMARY.md Deviation 1

### `import.meta.url === \`file://\${process.argv[1]}\`` ESM entry-point guard required when importing src/index.ts from tests
Plan 25-03 Task 5's `src/__tests__/health.test.ts` imports `createApp` from `src/index.ts`. Without the guard, the import would trigger `main().catch(...)` and `process.on('SIGINT', shutdown)` registrations as side effects — runMigrations, startScheduler, registerCrons, bot.start, app.listen all fire in the test process.

**Context:** Any TypeScript ESM file that has both an exported API (createApp, parseArgs, etc.) and a CLI entry point (main()) needs the entry-point guard. The canonical project pattern lives at `scripts/backfill-episodic.ts:283`.
**Source:** 25-03-SUMMARY.md Deviation 2

### `cron.validate()` is the right primitive for fail-fast config validation
Adding `cron.validate(process.env.RITUAL_SWEEP_CRON)` at the top of `src/config.ts` (throws on invalid expression) catches typos at process boot rather than letting the invalid cron silently never fire. Verified: `RITUAL_SWEEP_CRON=garbage npx tsx -e "import('./src/config.js')"` prints `REJECTED: config: invalid RITUAL_SWEEP_CRON expression "garbage"` and exits non-zero.

**Context:** `node-cron` exposes `validate(expression: string): boolean` at `node_modules/node-cron/dist/esm/node-cron.d.ts:5`. Pattern generalizes to all cron-style env vars in this project (PROACTIVE_SWEEP_CRON and EPISODIC_CRON could be retrofitted with the same validation; currently they aren't).
**Source:** 25-03-SUMMARY.md Task 4 + 25-CONTEXT.md D-03

### Scope-reduction failure mode: planner unilaterally dropped a locked decision under cover of an "unresolved" research question
First-iteration plan-checker caught Plan 25-03 dropping the `ritualCount` daily counter that CONTEXT.md D-04 mandated, citing RESEARCH §7 Open Question 3 (which itself was acknowledged as needing discuss-phase resolution). The planner's same-day-fires conflict reasoning was sound, but the resolution path was wrong — it should have looped back to discuss-phase, not silently amended the locked decision.

**Context:** Locked CONTEXT.md decisions are not amendable from inside plan files. If a planner finds a real conflict during plan drafting, the correct action is `## CHECKPOINT REACHED` or surface to the orchestrator for a discuss-phase amendment. The fix in iteration 2 was for the orchestrator to amend D-04 (refine ceiling=3/day) and add D-09 (signature deviation), THEN re-spawn the planner — this is the right loop.
**Source:** 25-VERIFICATION.md + plan-checker iteration 1 issue PC-25-01

---

## Patterns

### Hybrid hand-SQL + drizzle-snapshot for migrations involving enum extensions or IF NOT EXISTS guards
For any migration that uses `ALTER TYPE … ADD VALUE IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, or DO-block FK guards (patterns drizzle-kit doesn't auto-emit): hand-author the SQL with the guards, then run `scripts/regen-snapshots.sh` to produce a drizzle-aligned snapshot. The snapshot tracks the schema; the SQL applies it safely. Pattern proven in v2.1 Phase 19 (TECH-DEBT-19-01) and reused in Phase 25.

**When to use:** Any migration introducing an enum value extension, a re-runnable schema, or FK constraints that need post-creation guards. NOT needed for pure additive auto-genable changes (CREATE TABLE without IF NOT EXISTS, simple column adds).
**Source:** 25-01-SUMMARY.md D-25-01-A + 25-CONTEXT.md D-08

### `validatedCron(envName, defaultExpr)` helper for fail-fast cron-expression validation
A small wrapper exported from `src/config.ts`: reads `process.env[envName] ?? defaultExpr`, runs `cron.validate(expr)`, throws on false. Centralizes the fail-fast contract; future cron env vars get validation for free.

**When to use:** Any cron-style env var (currently RITUAL_SWEEP_CRON; PROACTIVE_SWEEP_CRON and EPISODIC_CRON should be retrofitted in a future cleanup phase).
**Source:** 25-03-SUMMARY.md Task 4

### `registerCrons(deps)` extracted helper for centralized cron orchestration
All cron registrations (sync 6h, proactive 10:00, ritual 21:00, episodic 23:00) live in `src/cron-registration.ts`'s `registerCrons(deps)` function instead of inline `cron.schedule()` blocks in `main()`. Returns a `CronRegistrationStatus` map that `/health` reads.

**When to use:** Any project with 3+ cron registrations. Benefits: testable in isolation (no need to import the bot+Express+DB init chain to spy on `cron.schedule`), single source of truth for "what crons run on this server", and the status map enables `/health` to report each cron individually.
**Source:** 25-03-SUMMARY.md Task 3 + 25-CONTEXT.md D-06

### Optional dependency-injection on `createApp(deps?)` for testability without test-only API leakage
`createApp(deps?: { cronStatus?: CronRegistrationStatus })` accepts optional injection; production code never passes `deps` (the module-scoped value populated by `main()` wins). Test code injects deterministic state. Cleaner than exporting a `setCronStatusForTesting()` mutator into production.

**When to use:** Any factory function whose output reads module-scoped state populated by an entry-point function. Optional-DI keeps production call sites clean while making tests trivially deterministic.
**Source:** 25-03-SUMMARY.md Deviation 3

### Scope-reduction-detection in plan-checker — cite RESEARCH "RESOLVED" markers vs "Recommendation" markers
The plan-checker's Dimension 7b (Scope Reduction Detection) caught Plan 25-03's silent drop of D-04's daily counter. The detection signal was the RESEARCH §7 Open Question 3 phrasing "Plan 25-03 should resolve this with a discuss-phase decision OR pick (a)" — which the planner read as authorization to "pick (a)" but the checker correctly flagged as an unresolved question that should NOT have been resolved inline.

**When to use:** Plan-checkers should treat any RESEARCH section heading containing "Open Questions" (without `(RESOLVED)` suffix) or any item with a `Recommendation:` marker (without a corresponding `RESOLVED:` marker) as a BLOCKER for downstream plans that act on the recommendation. The resolution path is orchestrator-amend-CONTEXT-then-replan, not planner-pick-and-document.
**Source:** Plan-checker iteration 1 (PC-25-01, PC-25-02, PC-25-03)

---

## Surprises

### `pipefail` SIGPIPE bug in `scripts/regen-snapshots.sh` had been latent
The script used `yes '' 2>/dev/null | npx drizzle-kit introspect` to provide empty stdin. Under `bash set -o pipefail`, when drizzle-kit exits 0, `yes` gets SIGPIPE (141) on its next write, and pipefail propagates 141 as the pipeline exit code → script reports "drizzle-kit introspect failed with exit 141" despite drizzle-kit succeeding. Bug had been latent since v2.1 Phase 19 — exposed in Phase 25 because drizzle-kit's stdin handling closed sooner than the previous version.

**Impact:** First Phase 25 attempt to regenerate the meta snapshot failed with cryptic exit 141. Fix: switch to `npx drizzle-kit introspect </dev/null` (empty-stdin redirect with no pipe). Took ~10 min to diagnose; would have been minutes-to-hours if the executor hadn't been familiar with bash pipefail semantics.
**Source:** 25-01-SUMMARY.md Deviation 2

### Docker compose port-spec OVERRIDES APPEND, they don't REPLACE
`docker-compose.local.yml` hardcodes `ports: - "5433:5432"`. `scripts/regen-snapshots.sh`'s override file adds `"5434:5432"`, intending to use a different port for the regen container. Docker Compose APPENDS port specs from override files (doesn't replace), so the regen container tries to bind BOTH 5433 AND 5434, conflicting with the running test postgres. Affected Wave 1 + Wave 2 + Wave 3 — same operational workaround three times (`docker compose down` test postgres before running regen).

**Impact:** Operational friction across all 3 waves. Workaround is a one-liner but had to be applied each time. Documented as out-of-scope follow-up: switch override file to a `compose-override-replace.yml` pattern that REPLACES rather than appends. Logged but not fixed in Phase 25.
**Source:** 25-01-SUMMARY.md Deviation 3 + 25-02-SUMMARY.md Deviation 3 + 25-03-SUMMARY.md (referenced)

### Test re-ordering: Task 7 had to execute before Task 1 even though plan listed 1-7 in order
Plan 25-03 Task 1's `runRitualSweep` imports `hasReachedRitualDailyCap` and `incrementRitualDailyCount` from `../proactive/state.js` — added in Task 7. Without Task 7 done first, Task 1's TypeScript compilation would fail at the import line, blocking Task 1's verification gate. The plan's Task 1 `read_first` list explicitly noted "read AFTER Task 7 which adds the new helpers" — documented intent, but the executor still had to logically reorder.

**Impact:** Executor reordered 7 → 1 → 2 → 3 → 4 → 5 → 6 (final commit sequence). Pattern: when a Task N adds an import that Task M < N consumes, the planner should make the dependency explicit in the task ordering OR document it as a `depends_on_task` field. Phase 25 lacks the latter; it's a TODO for future plan-template improvements.
**Source:** 25-03-SUMMARY.md Deviation 4

### Plan-checker correctly caught two locked-decision contradictions in iteration 1
The first plan-checker pass returned 3 BLOCKERS + 3 WARNINGS. Two of the blockers (PC-25-01, PC-25-03) were locked-decision contradictions where the planner had silently amended CONTEXT.md decisions via inline "deviation" notes. The third (PC-25-02) was the upstream gap (RESEARCH Open Questions not marked RESOLVED) that produced PC-25-01. The orchestrator amended CONTEXT.md (D-04 refinement + D-09 add) + RESEARCH.md (Open Questions RESOLVED) BEFORE re-spawning the planner; iteration 2 passed cleanly.

**Impact:** This is the verification loop working as designed. Without the checker, Phase 25 would have shipped a substrate without a daily counter (D-04 violation) and with a 3-arg signature presented as a "deviation" (D-02 violation). Two locked decisions silently amended is a concerning pattern — worth surfacing to the planner agent's prompt that decisions are not amendable from inside plan files.
**Source:** 25-VERIFICATION.md + 25-CONTEXT.md (D-04 REFINED 2026-04-26, D-09 ADDED 2026-04-26)
