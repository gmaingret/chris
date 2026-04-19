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

## Milestone: v2.2 — M008 Episodic Consolidation

**Shipped:** 2026-04-19
**Phases:** 5 (20, 21, 22, 22.1, 23) | **Plans:** 17 | **Commits:** 94 | **LOC:** +15,815 / -145 over 82 files
**Timeline:** 2 days active work (2026-04-18 → 2026-04-19)

### What Was Built

- **`episodic_summaries` schema foundation (Phase 20)** — Migration 0005 ships the 8-column table with `UNIQUE(summary_date)` + `GIN(topics)` + `btree(importance)` all in the initial migration, not retrofitted. TECH-DEBT-19-01 drizzle-kit snapshot lineage cleaned via `scripts/regen-snapshots.sh` clean-slate iterative replay. Zod 3-layer type chain (`SonnetOutput → Insert → DB-read`). `config.episodicCron` default `"0 23 * * *"`.
- **`runConsolidate` end-to-end with M006 preamble continuity (Phase 21)** — `src/episodic/consolidate.ts` pulls day's Pensieve entries + M002 contradictions + M007 decisions; `assembleConsolidationPrompt` pure module injects `CONSTITUTIONAL_PREAMBLE` explicitly (cron runs outside engine, preamble does not auto-apply); 4-band rubric + runtime importance floors (≥6 for real decisions, ≥7 for contradictions); verbatim-quote enforcement + sparse-entry guard; `notifyConsolidationError` surfaces Telegram on failure; pre-flight SELECT + ON CONFLICT belt-and-suspenders idempotency.
- **DST-safe cron + two-dimensional retrieval routing (Phase 22)** — Independent `cron.schedule` in `src/index.ts` as peer to proactive sweep. `retrieveContext` orchestrator with 5 named `RoutingReason` literals (recency ≤7d/>7d + verbatim-keyword EN/FR/RU fast-path + high-importance raw descent at importance≥8). INTERROGATE gets its own ad-hoc date routing (three-tier regex + Haiku fallback gated on 49-keyword heuristic); labeled `## Recent Episode Context (interpretation, not fact)` D031 boundary marker. Boundary audit enforces summary text NEVER enters Known Facts or `pensieve_embeddings`.
- **Decimal Phase 22.1 — wire `retrieveContext` into 5 chat-mode handlers** — Gap closure inserted after initial audit identified `retrieveContext` as orphaned (shipped in Phase 22 Plan 02 but chat modes still called `hybridSearch` directly). `hybridOptions?: SearchOptions` passthrough + `summaryToSearchResult(summary)` adapter synthesizing `SearchResult` with `score=1.0` sentinel. 15 new regression tests (3 per mode × 5 modes) prove routing decision fires. INTERROGATE + `/summary` bypass byte-identical. Audit flipped `status: tech_debt → passed`.
- **Test suite + operator backfill + `/summary` (Phase 23)** — 1136-line 14-day `vi.setSystemTime` synthetic fixture with `GROUND_TRUTH_LABELS=[1,2,3,4,4,5,5,6,6,7,7,8,9,10]` covering all 4 CONS-05 bands + both tails; Pearson r > 0.7; routing branches a/b/c/d; DST 2026-03-08 PST→PDT. `scripts/backfill-episodic.ts` 272-line operator script with `--from YYYY-MM-DD --to YYYY-MM-DD`, 2s inter-day delay, `runConsolidate` per-day, continue-on-error, ESM `main()` guard. `/summary [YYYY-MM-DD]` Telegram handler with EN/FR/RU localization. TEST-22 live anti-flattery 3-of-3 atomic against real Sonnet with 17 M006-sourced flattery markers — zero markers across all 3 iterations.

### What Worked

- **Wave-based parallel plan execution via gsd-executor.** Phases 22 and 23 each had 4-5 independent plans that executed in parallel waves, cutting calendar time dramatically. Plan dependencies were declared up front (Phase 22 wave 1: Plans 22-01, 22-02, 22-04 parallel; wave 2: Plan 22-03 depends on 22-02; wave 3: Plan 22-05 depends on others). This lifted ~12 hours of serial work into ~3 hours of parallel + review. The pattern should persist.
- **Code-review + fix cycle catching real bugs post-audit.** A dedicated code-review pass after each phase completion found 14 Warning-level real bugs that unit tests didn't catch: Phase 21 WR-01 (HH:MM rendered in UTC not `config.proactiveTimezone`), Phase 22 WR-02 (negative-offset tz drift in `extractQueryDate` midnight-UTC anchor), Phase 22 WR-03 (FR/RU month-day regex missing `\b` leading anchor — "item 121 décembre" would extract "21 décembre"), Phase 22 WR-04 (silent Feb 30 → March 2 rollover via `Date.UTC`), Phase 23 WR-01 (`/summary 2026-02-30` reaching DB because regex-only gate accepted it), Phase 20 WR-02 (EXIT trap in `regen-snapshots.sh` destroyed committed 0005 snapshot on re-run). All 14 fixed in 20 commits post-audit. Docker gate climbed 981 → 1014 passing, zero regressions.
- **Excluded-suite Docker mitigation for env fork-IPC hang.** Instead of blocking on an env-level vitest-4 fork mode IPC hang under HuggingFace EACCES (root-owned node_modules cache + live-integration 401-retry loop triggering unhandled rejections), shipped a 5-file exclusion list that reaches exit 0 in ~28s with the 15 documented environmental failures unchanged. Documented as operational mitigation in each plan's SUMMARY. Worth a future fix-up phase but did not block M008 shipping.
- **Live-Sonnet anti-flattery test as empirical proof, not theatrical gate.** TEST-22 surveyed 17 flattery markers from existing M006 conventions (live-integration.test.ts VALIDATION_MARKERS + praise-quarantine.ts REFLEXIVE_OPENER_FIRST_WORDS + CONSTITUTIONAL_PREAMBLE Three Forbidden Behaviors) — NOT invented ad-hoc. 3-of-3 atomic run against real Sonnet on adversarial 2026-02-14 fixture. Passed with zero markers. The value isn't the pass/fail bit, it's having empirical ground truth that the preamble threads from engine into cron-invoked consolidation. D038 locked.
- **Boundary audit via structural grep test, not runtime assertion.** `src/chris/__tests__/boundary-audit.test.ts` asserts zero matches for `\bepisodic_summaries\b|\bepisodicSummaries\b` in `src/chris/personality.ts` / `src/pensieve/ground-truth.ts` / `src/pensieve/embeddings.ts`. Impossible-to-forget guardrail — any future accidental boundary violation (e.g., a well-intentioned JOIN into Known Facts) gets caught at test time with an exact line number. Pattern should persist for RETR-07+ in future milestones.

### What Was Inefficient

- **Initial integration check missed `retrieveContext` orphaned export.** Phase 22 Plan 02 shipped `retrieveContext` with 22 passing unit tests and full excluded-suite Docker gate. Five chat-mode handlers still called `hybridSearch` directly — the orchestrator had zero production callers. Unit tests pass because they call the export directly; no test asserted "at least one chat-mode handler imports retrieveContext." Phase 22.1 gap-closure was ~2h 10m of work that could have been integrated into Phase 22 if the integration check had flagged it before Plan 22-02 closed. **Next time:** include an "orphaned-export sentinel" check — for every new exported function, assert at least one non-test import resolves.
- **Env-level vitest-4 fork-IPC hang.** Full `bash scripts/test.sh` does not complete on this environment (root-owned `node_modules/@huggingface/transformers` cache + `live-integration.test.ts` 401-retry loop triggers unhandled rejections under vitest-4 fork mode). Worked around with the 5-file excluded-suite list, but that adds execution-time friction (every plan SUMMARY has to explain the mitigation). Pre-existing M006/M007 issue that flared again. A fix-up phase fixing the root cause (non-root cache ownership + 401-retry backoff + vitest config) would unblock future milestones' Docker gates.
- **Rework on WR-02 tz drift.** Phase 22's original `extractQueryDate` anchored at midnight-UTC, which is correct under positive offsets (Europe/Paris, Moscow) but drifts a calendar day in America/*. Caught in code review, not unit tests. The fix (anchor all 4 date paths at T12:00:00Z noon-UTC) was 15 minutes of work but required hunting down 4 separate code paths (iso, relative-ago, month-day, Haiku fallback). Cheaper if the original test suite had included `America/Los_Angeles` as a fixture tz alongside Europe/Paris. Added to code review checklist going forward.
- **SUMMARY frontmatter hygiene still partial.** Some plan-level SUMMARY.md files in Phases 20-23 omit `one_liner:` / `requirements-completed:` frontmatter fields. Same tech-debt carried from v2.1. REQUIREMENTS.md remains source of truth for requirement closure, so nothing blocked shipping — but the automated MILESTONES.md extraction still can't lift plan-level evidence without manual review. The hygiene floor isn't rising phase-over-phase.

### Patterns Established

- **Decimal phases (22.1) for mid-milestone gap closure.** Pattern borrowed from v2.1 Phase 15.1/16.1 precedent. When a milestone audit reveals a wiring gap that is NOT a re-open of the originating phase's scope, insert a decimal phase with explicit `(INSERTED)` marker in the progress table and plan numbering `22.1-01` (not 22-06). Keeps the audit trail clean: each phase's plans stay bounded; decimal phases are always gap-closure. Candidate for formalization in GSD itself (D040).
- **Excluded-suite Docker mitigation as documented operational pattern.** When an env-level issue prevents the full gate from running, maintain a rolling exclusion list + document it in every plan SUMMARY + cross-check deltas against the previous plan's baseline (e.g., "981 → 996 = +15, zero regressions"). The pattern kept every v2.2 plan's SUMMARY honest about which tests actually ran.
- **Tarball + lockfile surgical patch for root-owned `node_modules`.** The HuggingFace cache is root-owned from a prior Docker run; standard `npm install` fails with EACCES. Surgical workaround: install from `@anthropic-ai/sdk@0.90.0.tgz` tarball + commit the package-lock.json delta, then rebuild inside the Docker container with writable cache. Documented in Phase 21 Plan 01 SUMMARY.
- **Boundary audit via grep test.** For every new subsystem that must NOT cross into an existing subsystem, ship a dedicated test file that asserts zero matches for the forbidden identifier in the protected files. Takes ~30 lines, catches accidental boundary violations at test time. Done for RETR-05/06 (episodic_summaries); candidate for M009 ritual-boundary and M010+ profile-boundary.
- **Live-Sonnet tests survey markers from existing code, not invent them.** TEST-22's 17 forbidden flattery markers came from 3 existing M006 files. Reusing conventions keeps the test honest (marker list matches what the rest of the codebase considers flattery) and prevents ad-hoc expansion. Pattern for future live tests: `grep` existing convention files before adding new markers.

### Key Lessons

1. **Post-verify integration checks catch orphan exports that unit tests don't.** Phase 22's `retrieveContext` passed all 22 unit tests but had zero production callers. A unit test validates the function; an integration check validates the wiring. They are different audits. The v2.2 audit's "orphaned exports" check (found 1: `retrieveContext`) was the load-bearing finding — without it, M008 would have shipped with RETR-02/03 unreachable at runtime. **Rule for M009+:** for every new exported function, integration check asserts at least one non-test caller.
2. **Code review after phase completion found 14 real bugs including tz drift in negative-offset zones.** The 14 Warning-level findings were not style nits — they included Feb 30 accepted via `Date.UTC` silent rollover, `/summary 2026-02-30` reaching DB because a regex passed, tz drift in `America/*` because noon-UTC vs midnight-UTC wasn't tested, and a shell-script EXIT trap that destroyed committed snapshots. Unit tests passed against each. Code review is a structurally different audit that catches different classes of bugs. **Rule for M009+:** Phases ship into review, not into "done"; review batches into a fix cycle; fix cycle ships before audit.
3. **INTERROGATE's ad-hoc routing is intentional, not a smell.** D037 documents why: different UX contract (citation-anchored Q&A) and different header form (`## Recent Episode Context (interpretation, not fact)` D031 boundary marker). Trying to unify `retrieveContext` with INTERROGATE would have lost one or the other UX property. Not all orchestrators should be consolidated. **Rule for M009+:** when two subsystems look like they should share an orchestrator, document why they don't before forcing a merge.
4. **Empirical proof > theatrical gates.** TEST-22 isn't a checkmark — it's 3-of-3 against real Sonnet on an adversarial fixture with 17 forbidden markers, with inter-run cleanup preventing CONS-03 false-pass. The value isn't "did it pass" but "is the preamble actually threading from engine into cron-invoked consolidation". Answer: yes, empirically, with model output in the test log. Pattern for any cross-subsystem behavioral guarantee.
5. **Pensieve stays authoritative.** D035 locked: episodic tier is a projection, not a replacement. The boundary audit enforces structurally (grep test). Every future memory tier (M009 weekly, M013 monthly, M014 narrative identity) should inherit this invariant — projections up the tier; never mutate the raw.

### Cost Observations

- **Model mix (approximate, not instrumented):** Executor agents were primarily Sonnet for heavy implementation work (Phases 20-23); verifier agents Sonnet; code-reviewer Sonnet (found 14 real bugs); planning and audit Opus (CONTEXT.md authoring, VERIFICATION.md audits, milestone re-audit). No actual token-count instrumentation in this environment — rough distribution: ~70% Sonnet (execution + verification + review), ~25% Opus (planning + audit), ~5% Haiku (classifier calls in consolidation pipeline at runtime, near zero during development).
- **Sessions:** Highly compressed — 2026-04-18 kickoff to 2026-04-19 ship. Heavy parallel-wave execution. State recovered via `.planning/` markdown across any compaction (GSD v1 design; D-016 rationale reinforced again).
- **Notable:** The code-review-fix cycle added ~2h of work AFTER the initial audit's "passed" verdict — but caught 14 real bugs that would have shipped to production. The cycle is strictly cheaper than hot-fixing production.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 5 | — | Initial build; reqs tracked but no audit discipline |
| v2.0 | 7 | 19 | Introduced live-Sonnet integration suite + PITFALLS guards; live-suite precedent (D023/D032) |
| v2.1 | 7 | 27 | First milestone with full code-review pipeline (68 findings, 65 fixed); first milestone with gap-closure phase (Phase 19); first milestone caught by structural audit (26→31 reqs) |
| v2.2 | 5 (incl. decimal 22.1) | 17 | First milestone with wave-based parallel plan execution (halved calendar time); first milestone where post-completion code-review-fix cycle caught 14 real Warning bugs (tz drift, Feb 30 rollover, EXIT-trap destruction); first decimal phase used as mid-milestone gap-closure pattern (22.1); orphan-export integration check formalized as audit gate |

### Cumulative Quality

| Milestone | Tests (unit + integ) | Requirements satisfied | Tech debt carried |
|-----------|----------------------|------------------------|-------------------|
| v1.0 | ~150 | 28 / 28 | Validation layer only |
| v2.0 | ~200 (+ 24 live + 20 FP audit) | 26 / 26 | Zero |
| v2.1 | 152 proactive + synthetic-fixture (+ TEST-13/14 API-gated) | 31 / 31 | TECH-DEBT-19-01 (drizzle snapshots) + 12 human-UAT items |
| v2.2 | 1014 excluded-suite (+ TEST-22 live API-gated) | 35 / 35 | env-level vitest-fork-IPC hang (pre-existing) + `getEpisodicSummariesRange` unconsumed (forward M009) + Phase 21 WR-02 retry-on-all-errors (design choice) |

### Top Lessons (Verified Across Milestones)

1. **Live-Sonnet integration tests catch what mocks can't.** v2.0 introduced them (24-case + FP audit); v2.1 extended them (TEST-13 3-of-3 hit/miss/unverifiable, TEST-14 adversarial vagueness). Every mode-prompt change should ship with a live-suite case or explicit "no behavioral change" justification.
2. **Append-only + chokepoint is the cheapest concurrency story.** v1.0 Pensieve + v2.1 `decision_events` both pass race tests with minimal locking logic. M008 episodic summaries should inherit the same invariant.
3. **Between-milestones pause is real engineering discipline, not caution.** v2.0 → v2.1 happened in <72h; v2.1 surfaced trust-breaking edge cases (worktree merge silent-revert) that only became visible under usage pressure. M007 → M008 is mandated ≥2 weeks of real Telegram use before M008 starts, per PLAN.md discipline.
4. **Structural verification beats outcome verification.** Phase 15/16 had SATISFIED verification reports while the actual sweep code was missing; Phase 14 added a new DB call site (`getActiveDecisionCapture` with `.where().limit()`) without updating the unit-test mocks, which the v2.1 ship-gate's scoped 152-test subset then failed to catch. Structural checks (exports exist, imports resolve, canonical-commit diff is empty, every new call site has corresponding mock coverage) must sit alongside outcome checks (test pass, behavior observed). Double-validated across v2.1 — internal (worktree merge silent-revert) and cross-cutting (mock-chain regression flagged as "Cat A pre-existing" then later reframed as real).
5. **"Proven pre-existing" needs harder evidence than rollback+rerun.** A partial rollback can produce a false negative if it doesn't touch the real cause. Require gap-closure PRs to produce a structural audit — "here are the new call sites this phase adds; here is the mock coverage for each" — rather than relying on "we rolled back and the failures persisted."
