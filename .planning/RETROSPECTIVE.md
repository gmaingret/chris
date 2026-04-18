# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v2.1 — M007 Decision Archive

**Shipped:** 2026-04-18
**Phases:** 7 (13–19) | **Plans:** 27 | **Tasks:** 36 | **Commits:** 252 | **LOC:** +9,322 / -379 over 49 files
**Timeline:** 3 days active work (2026-04-15 → 2026-04-18)

### What Was Built

- **Append-only decision lifecycle** — `decision_events` log + `decisions` projection + `decision_capture_state`, with `transitionDecision()` as the sole chokepoint enforcing optimistic concurrency (`UPDATE … WHERE id=$id AND status=$expected`) and 3 distinguishable error classes. `regenerateDecisionFromEvents()` proves the projection is replayable. (Phase 13)
- **Conversational 5-slot capture** — EN/FR/RU two-phase trigger (regex + Haiku stakes classifier fail-closed to trivial); greedy multi-answer Haiku extraction with 3-turn cap + abort phrases; `parseResolveBy` natural-language parser with 7/30/90/365-day fallback ladder; `/decisions suppress` persistence; engine PP#0/PP#1 pre-processors. (Phase 14)
- **Dual-channel proactive sweep** — Fifth `decision-deadline` SQL-first trigger at priority 2; `reflective_outreach`/`accountability_outreach` channels with independent daily caps; dated stale-context prompts ≥48h; write-before-send via `upsertAwaitingResolution`. (Phases 15 + 19)
- **ACCOUNTABILITY mode + resolution + post-mortem** — New mode bypasses praise quarantine at prompt level (D025 pattern) and forbids The Hard Rule (D027); `handleResolution` → `classifyOutcome` (Haiku 4-class) → `handlePostmortem` → `resolved → reviewed`; ±48h `getTemporalPensieve` context; auto-escalation after 48h silence (stale after 2 non-replies). (Phases 16 + 19)
- **`/decisions` command with honest stats** — 8 sub-commands pull-only; 2-axis Haiku reasoning classifier cached with model version; N≥10 floor + Wilson 95% CI; SQL `FILTER` rolling 30/90/365-day windows; domain-tag breakdown; `/decisions reclassify` preserving originals. (Phase 17)
- **Synthetic fixture + live suite** — `vi.setSystemTime` 14-day lifecycle (TEST-10); concurrency race (TEST-11); channel-separation collision (TEST-12); live Sonnet ACCOUNTABILITY 3-of-3 (TEST-13, API-gated); Haiku vague-prediction resistance (TEST-14, API-gated). (Phase 18)

### What Worked

- **Append-only + optimistic concurrency from day 1.** Extending the Pensieve's append-only invariant (D004) into the decision lifecycle meant the concurrency race test was straightforward to write and pass — there's no "mutable row" to race on, only which writer lands first in the event log. The chokepoint pattern caught every illegal transition at the type boundary.
- **Two-phase trigger execution reused.** The cheap-gate-before-expensive-call pattern (D010) scaled cleanly from M004's proactive sweep into the capture trigger (regex → Haiku stakes) and the deadline trigger (SQL gate → surface). Each two-phase reuse reinforced the architecture.
- **Byte-exact byte-exact canonical-commit restore.** Phase 19 used `git show 4c156c3:path` diffs to restore `state.ts`, `prompts.ts`, `sweep.ts` after the destructive worktree merge — not re-authoring from summary text. Zero regressions, 49 new proactive tests green on first run. The canonical-commit-as-source-of-truth pattern deserves to persist.
- **Docker Postgres as integration floor.** All 152 proactive + synthetic-fixture tests run against real Postgres migrations via `scripts/test.sh` (5-migration harness with `ON_ERROR_STOP=1`). No mock-DB lies. When Cat A baseline mock-chain failures surfaced, rollback+rerun against the real DB *appeared to* prove they were pre-existing, not v2.1 regressions — **see post-closure reframing below: this conclusion was wrong.**
- **Phase 18 gap closure made explicit.** Plans 18-03 and 18-04 were added mid-phase to restore lost exports and fix test assertion mismatches — admitted as gap-closure work rather than hidden as "test tweaks." Audit trail stayed honest.

### What Was Inefficient

- **Worktree merge `5582442` silently reverted Phase 15/16 source.** Six days of work (dual-channel sweep, channel-aware state helpers, ACCOUNTABILITY prompts, escalation block) landed in a feature branch, merged, then got lost when a subsequent worktree merge cherry-picked only a subset. Phases 15/16 `VERIFICATION.md` reported "SATISFIED" against canonical code that the runtime no longer had. The audit caught it (26/31 → 5 unsatisfied) but at the cost of a full gap-closure phase (Phase 19: 4 plans, 36+ minutes per plan). **Next time:** structural diffs, not just test results, before trusting "verified" claims across merges.
- **SUMMARY frontmatter drift.** 12 plan-level SUMMARY.md files omit `one_liner:` / `requirements-completed:` frontmatter. The CLI's `summary-extract` tool fell back to mangled `head -8` output in `milestone complete`, producing a noisy auto-generated MILESTONES.md entry that had to be rewritten by hand. The frontmatter hygiene tech debt is non-blocking but expensive to fix retroactively.
- **`audit-open` CLI tool broken.** `gsd-tools.cjs audit-open` threw `ReferenceError: output is not defined` — pre-close artifact audit couldn't run. Workflow had to fall back to the passed milestone audit report. The pre-close step should not depend on a second tool that can silently fail.
- **Code-review pipeline delivered 68 findings across 7 phases** — 4 Critical, 30 Warning, 34 Info/Medium/Low — all during post-audit Iteration 4 pass. The ~25 post-21:40Z Info commits were defensive hardening (static imports, schema reflection via `getTableColumns`, idempotency guards, UUID replacement) but arrived after "passed" — ideal flow would push Info-level fixes inline during plan execution, not after milestone audit.

### Patterns Established

- **Chokepoint + optimistic concurrency for any mutable state.** Applied to decisions; should apply to episodic summaries (M008), profiles (M010+), and life chapters (M014). Single code path + `UPDATE … WHERE …=$expected` + append-only event log = race-resistant by construction.
- **Channel separation in the proactive sweep.** `reflective_outreach` vs `accountability_outreach` with independent daily caps and serial collision handling. Future triggers (ritual reminders, weekly review nudges) should pick a channel rather than share a global cap. (D-07 legacy fallback preserves the single-channel default for existing silent/commitment triggers.)
- **Haiku classifier with fail-closed default.** Every Haiku call in v2.1 (stakes, vague, outcome, accuracy) fails closed on timeout/parse-error — never fails open to accidentally accept a bad prediction or award a flattering `hit`. Should be the default pattern across future Haiku gates.
- **Live-suite = absence-of-behavior assertion.** TEST-13 asserts absence-of-flattery + absence-of-condemnation, not presence-of-specific-text. The D023/D032 precedent (keyword-based rather than exact-match) is now extended to M007 and should remain the pattern for any mode-prompt regression test.
- **Byte-exact restore from canonical commit.** When production code diverges from verified-correct state due to merge artifacts, `git show` + `Write` byte-exact (not re-authored) is faster and safer than re-deriving from a SUMMARY.

### Key Lessons

1. **"Verified" requires structural diff, not just test pass.** Phase 15/16 claimed SATISFIED but the worktree merge silently reverted the code. Test suites passed against whatever was on disk; nobody diffed the delivered source against the claimed source. Future phases should include `git diff` summary in VERIFICATION.md.
2. **Gap-closure is legitimate; ship it in the audit trail.** Phase 19 as an explicit restoration phase was cleaner than silently recovering under another phase's rubric. Plans 18-03 and 18-04 likewise — admitted as gap-closure, documented, and ship-blocking until green.
3. **SUMMARY frontmatter is infrastructure, not ceremony.** The auto-extraction pipeline only works if `one_liner:` / `requirements-completed:` fields are populated. Treat frontmatter as a first-class artifact during plan execution, not a post-hoc chore.
4. **Architectural invariants (append-only, chokepoint, fail-closed) compound.** Each new subsystem that inherited M001's append-only Pensieve + M004's two-phase triggers got harder to build insecurely. Future milestones should identify which M-N invariants they're inheriting and reinforcing.
5. **Live-API tests deserve their own audit column.** TEST-13 and TEST-14 are written, Docker-verified for non-API paths, but execution requires `ANTHROPIC_API_KEY`. Calling these "satisfied (pending live API)" in the audit is honest; hiding them under "satisfied" would be the lie M006 was built to prevent.

### Cost Observations

- **Model mix:** Not instrumented in v2.1. Approximate distribution based on plan-level model usage: ~60% Opus (planning, code review, milestone restoration, auditing), ~35% Sonnet (execution of individual plan tasks), ~5% Haiku (pattern matching in tools).
- **Sessions:** One continuous execution window, 2026-04-15 → 2026-04-18. Heavy compaction — state recovered via `.planning/` markdown, not SQLite (per GSD v1 design, D-016 rationale reinforced).
- **Notable:** Phase 19 gap closure — 4 plans totaling ~100 minutes of execution — cost less than re-deriving Phase 15/16 from SUMMARY would have. Canonical-commit restore is strictly cheaper than re-authoring after a merge accident.

### Post-closure addendum (2026-04-18, after ship)

After the milestone was archived and tagged, a fresh code-review pass on the v2.0 M006 phases (commit `16eca6b`) — specifically the Phase 07 review — reframed one of the tech-debt items this retrospective originally categorized as "pre-existing Cat A baseline."

- **What the audit claimed:** 45 `engine.test.ts`-family test failures (29 in `engine.test.ts`, 3 in `engine-refusal.test.ts`, 13 more in sibling files) were a pre-existing bug introduced by commit `e4cb9da`'s partial PP#0 restore. "Proven pre-existing via rollback+rerun" (Plan 19-01 D19-01 evidence).
- **What the code review showed:** The real root cause was v2.1 Phase 14's new `getActiveDecisionCapture` call at `engine.ts:168` using a `.where().limit()` chain without `.orderBy()`. The unit-test select mock only supported `.where().orderBy().limit()`. The chain mismatch made 32 tests red. The rollback+rerun "proof" was misleading: it reverted the PP#0 block but not the capture-state imports; the remaining failures were then attributed to unrelated pre-existing state.
- **Why the v2.1 ship-gate missed it:** The 152-test gate was a deliberately scoped subset — `src/proactive/__tests__/` + `src/decisions/__tests__/synthetic-fixture.test.ts` — that excluded `src/chris/__tests__/engine*.test.ts`. No explicit red flag on that exclusion; no "is this gate actually representative?" question was asked before shipping.
- **Fix:** Commit `7791241` (`fix(07): CR-02`) — extended the mock chain to cover both shapes and added `vi.mock()` blocks for the five new decision-capture modules. 32 tests green. Same mock-chain gap remains in `engine-mute.test.ts` + `photos-memory.test.ts` — out of Phase 07 scope, flagged for M008 cleanup.

**Lesson added to Key Lessons:**

6. **"Proven pre-existing" needs harder evidence than a rollback.** Rollback+rerun can produce a false negative when the rollback is partial or touches different code than the real cause. A structural audit — "list every new call site added in this phase; confirm every mock still covers them" — would have caught this in Phase 19's gate. For M008, require gap closure PRs to include a "new call sites vs mock coverage" checklist before shipping.

**Lesson added to cross-milestone trends: structural verification beats outcome verification** (already #4 in Top Lessons) is now double-validated — the Phase 15/16 worktree-merge silent-revert was the v2.1-internal instance; the Phase 14 mock-chain regression is the v2.0/v2.1 cross-cutting instance. Both pass "verification report says SATISFIED" but fail "diff the code against the claim."

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 5 | — | Initial build; reqs tracked but no audit discipline |
| v2.0 | 7 | 19 | Introduced live-Sonnet integration suite + PITFALLS guards; live-suite precedent (D023/D032) |
| v2.1 | 7 | 27 | First milestone with full code-review pipeline (68 findings, 65 fixed); first milestone with gap-closure phase (Phase 19); first milestone caught by structural audit (26→31 reqs) |

### Cumulative Quality

| Milestone | Tests (unit + integ) | Requirements satisfied | Tech debt carried |
|-----------|----------------------|------------------------|-------------------|
| v1.0 | ~150 | 28 / 28 | Validation layer only |
| v2.0 | ~200 (+ 24 live + 20 FP audit) | 26 / 26 | Zero |
| v2.1 | 152 proactive + synthetic-fixture (+ TEST-13/14 API-gated) | 31 / 31 | TECH-DEBT-19-01 (drizzle snapshots) + 12 human-UAT items |

### Top Lessons (Verified Across Milestones)

1. **Live-Sonnet integration tests catch what mocks can't.** v2.0 introduced them (24-case + FP audit); v2.1 extended them (TEST-13 3-of-3 hit/miss/unverifiable, TEST-14 adversarial vagueness). Every mode-prompt change should ship with a live-suite case or explicit "no behavioral change" justification.
2. **Append-only + chokepoint is the cheapest concurrency story.** v1.0 Pensieve + v2.1 `decision_events` both pass race tests with minimal locking logic. M008 episodic summaries should inherit the same invariant.
3. **Between-milestones pause is real engineering discipline, not caution.** v2.0 → v2.1 happened in <72h; v2.1 surfaced trust-breaking edge cases (worktree merge silent-revert) that only became visible under usage pressure. M007 → M008 is mandated ≥2 weeks of real Telegram use before M008 starts, per PLAN.md discipline.
4. **Structural verification beats outcome verification.** Phase 15/16 had SATISFIED verification reports while the actual sweep code was missing; Phase 14 added a new DB call site (`getActiveDecisionCapture` with `.where().limit()`) without updating the unit-test mocks, which the v2.1 ship-gate's scoped 152-test subset then failed to catch. Structural checks (exports exist, imports resolve, canonical-commit diff is empty, every new call site has corresponding mock coverage) must sit alongside outcome checks (test pass, behavior observed). Double-validated across v2.1 — internal (worktree merge silent-revert) and cross-cutting (mock-chain regression flagged as "Cat A pre-existing" then later reframed as real).
5. **"Proven pre-existing" needs harder evidence than rollback+rerun.** A partial rollback can produce a false negative if it doesn't touch the real cause. Require gap-closure PRs to produce a structural audit — "here are the new call sites this phase adds; here is the mock coverage for each" — rather than relying on "we rolled back and the failures persisted."
