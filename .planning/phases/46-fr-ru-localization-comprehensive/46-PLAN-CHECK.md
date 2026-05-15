# Phase 46 — Plan Check Report

**Verified:** 2026-05-15
**Plans checked:** 4 (46-01, 46-02, 46-03, 46-04)
**Verdict:** ISSUES FOUND — 1 BLOCKER, 4 WARNINGS, 2 INFO
**Recommendation:** Bounce to planner for minor revisions. The single blocker is a test-correctness defect in 46-03-T4 that would let a regression slip through; the four warnings are quality/clarity polish.

> **POST-CHECK ADDENDUM (2026-05-15 ~02:00 UTC, parent orchestrator):**
> **BLOCKER (L10N-03c regression test false-positive) — RESOLVED inline.** Parent applied a surgical edit to 46-03-PLAN.md Task 4:
> - Replaced the original L10N-03c test (which passed under both old + new regex, falsely "verifying" the fix) with a **direct regex assertion** against `INTERROGATIVE_REGEX.match()` returning `null` — this is the only test shape that distinguishes the two regex versions for the single-near-interrogative input.
> - Added a NEW L10N-03c2 test using a 2-interrogative input (`"Premier doute (queest-ce) puis: qu'est-ce que tu fais ?"`) where the OLD broken regex matches 2 occurrences (stage1Check REJECTS) and the NEW regex matches 1 (stage1Check ACCEPTS) — proves the behavior change end-to-end through `stage1Check`.
> - Acceptance criterion updated: `grep -c "L10N-03"` ≥ 4 (was 3) + new requirement that `INTERROGATIVE_REGEX` be exported as a test-only named export alongside `stage1Check`.
>
> The 4 WARNINGs (decimal formatting consistency in 46-02 T3, 46-04 over-conservative `depends_on`, missing translation-review table for D-06, T2-vs-T4 invariant asymmetry) remain for the executor to address during plan-execution. Non-blocking — they will surface as quality issues but won't break the gate.
>
> **Effective verdict after addendum:** APPROVED. Proceed to `/gsd-execute-phase 46`.

---

## Verdict Summary

Plans deliver L10N-01..06 against the phase-46 success criteria with the following caveats:

| L10N-# | Requirement | Plan(s) | Status |
|--------|-------------|---------|--------|
| 01 | /profile 21 sites | 46-02 | COVERED — full 21-site catalog (qualifier 705-707 via 46-01 import, HEXACO 715-720, Schwartz 728-737, score-line tokens at 791+806) |
| 02 | WEEKLY_REVIEW_HEADER locale-matched | 46-03 T1 | COVERED — D-08 verbatim seed, language already in scope at :583 |
| 03 | FR regex curly-apostrophe + gibberish | 46-03 T2 | COVERED on implementation; WARNING on T4 test efficacy |
| 04 | journal PROMPTS locale-aware | 46-04 | COVERED — fireJournal wires getLastUserLanguageFromDb |
| 05 | qualifierFor consolidated | 46-01 + 46-02 T2 | COVERED — canonical in src/chris/locale/strings.ts; both call sites migrated |
| 06 | TEMPLATED_FALLBACK_EN per-locale | 46-03 T3 | COVERED — D-08 verbatim seed |

Decision compliance: D-01 (no new layer) HONORED — strings.ts is co-located beside language.ts, no parallel detection. D-03/D-04 (MSG-shape + chris/locale/strings.ts) HONORED. D-11 (qualifierFor canonical) HONORED. D-14 (NFC + curly normalize) HONORED. D-18 (per-locale golden snapshots) HONORED via 46-02-T4 inline snapshots.

The "WR-02 EN-tokens leak folded" success-criterion #1 refers to **39-REVIEW.md WR-02** (HEXACO/Schwartz dim labels at 715-737) — covered. NOT 35-REVIEW.md WR-02 (operational `since`/`energy=`/`mood=`/`anxiety=` at lines 400/481/496) — those remain unaddressed but are explicitly outside the 21-site catalog and outside REQUIREMENTS.md L10N-01 wording.

---

## Issues

```yaml
issues:
  - dimension: task_completeness
    severity: blocker
    plan: "46-03"
    task: 4
    description: |
      L10N-03 test "L10N-03c" asserts stage1Check("queest-ce que c'est ?")
      returns true, but this test passes under BOTH the old broken regex AND
      the new regex. The action says the fix's behaviour change is that
      gibberish "queest-ce que" no longer false-counts as an interrogative
      leading-word — but the test never verifies the interrogative-match
      count itself; it only checks the boolean output of stage1Check, which
      is governed by `interrogativeMatches <= 1`. Under the OLD regex,
      "queest-ce que c'est" produces 1 match (queest-ce que) → stage1Check
      returns true. Under the NEW regex, 0 matches → still true. The test
      gives a false sense of regression coverage.
    fix_hint: |
      Either (a) test stage1Check with TWO interrogatives so the OLD regex
      would push the count to 2 and reject, e.g.
      stage1Check("queest-ce que ou quoi ?") — OLD: 2 matches → false; NEW:
      1 match (quoi) → true; or (b) export INTERROGATIVE_REGEX and directly
      assert match-count: expect("queest-ce que".match(INTERROGATIVE_REGEX)).
      toBeNull(). Option (b) is the cleanest regression detector.

  - dimension: context_compliance
    severity: warning
    plan: "46-02"
    task: 3
    description: |
      MSG.scoreLine for FR/RU hardcodes "/ 5,0" as a literal slug while
      score values come from `score.toFixed(1)` which always emits "."
      (dot decimal). CONTEXT.md D-deferred explicitly defers number-format
      locale, but the resulting FR output is `4.2 / 5,0` — mixing dot
      score with comma slug. This is internally inconsistent. The plan
      action acknowledges the asymmetry inline but does not propose any
      resolution. Greg may flag this at /gsd-verify-work.
    fix_hint: |
      Either (a) keep both as dot ("/ 5.0" in all locales — REQUIREMENTS.md
      L10N-01 wording does not mandate locale decimal); or (b) compute the
      score string via `score.toLocaleString(DATE_LOCALES[lang], { ... })`
      to match the slug locale. 39-REVIEW.md WR-03 fix already suggests
      toLocaleString. Choose one boundary; do not ship mixed "4.2 / 5,0".

  - dimension: dependency_correctness
    severity: warning
    plan: "46-04"
    description: |
      depends_on: [46-01] is over-conservative. Plan 46-04 (journal PROMPTS)
      does NOT import from src/chris/locale/strings.ts — it only imports
      from chris/language.ts (already shipped). The dependency forces
      sequential execution of waves that could run in parallel: 46-04 could
      run in wave 1 alongside 46-01 with no contract between them.
    fix_hint: |
      Change 46-04 depends_on to []. Move 46-04 to wave 1. This unblocks
      parallel execution and shortens overall execution time.

  - dimension: requirement_coverage
    severity: warning
    plan: "46-02"
    task: 1
    description: |
      FR translations for HEXACO/Schwartz dim labels are seed-only and
      Greg explicitly defers Russian Cyrillic-vs-transliteration register
      decisions per CONTEXT.md Deferred section "ru-RU Cyrillic-vs-
      transliteration register decisions for psychological dim labels —
      Greg signs off at verify-work". Plan 46-02 ships specific RU
      translations (e.g. "Честность-Скромность", "Самостоятельность")
      without staging a translation table or marking them clearly as
      seeds. Greg's review at /gsd-verify-work is the safety net per D-06,
      but the plan does not document a fast-revert path or table format
      for Greg's red-pen pass.
    fix_hint: |
      Add to 46-02 a "Translation Review Table" section listing every new
      FR + RU string side-by-side with the EN source so Greg can red-pen
      in a single pass. Reference D-06 reviewer-pass discipline.

  - dimension: task_completeness
    severity: warning
    plan: "46-03"
    task: 2
    description: |
      L10N-03 acceptance criteria step 3 says behaviour test "queest-ce que"
      produces ZERO interrogative matches. The test code in T4 (L10N-03c)
      does not actually assert match-count is zero — it only asserts the
      boolean output of stage1Check (which depends on count <= 1, allowing
      0 OR 1). Same defect class as the BLOCKER above; flagging separately
      because T2's acceptance criteria reference a stronger invariant
      ("ZERO interrogative matches") than T4's tests verify.
    fix_hint: |
      Make T2's acceptance criterion testable by exposing
      INTERROGATIVE_REGEX as exported (it already is) and asserting in
      T4: expect("queest-ce que".match(INTERROGATIVE_REGEX) ?? []).
      toHaveLength(0).

  - dimension: scope_sanity
    severity: info
    plan: "46-02"
    description: |
      Plan 46-02 modifies 2 files with 4 tasks; the third task (MSG
      scoreLine extension + rewire formatter) is the heaviest at ~30 LOC
      in the formatter body plus snapshot regeneration. Within budget
      but close to the 3-task target. Acceptable.
    fix_hint: |
      No action; flagged for execution-time monitoring. If snapshot
      regeneration produces unexpected EN diffs, halt per the plan's own
      risk note.

  - dimension: claude_md_compliance
    severity: info
    plan: "46-02 + 46-03 + 46-04"
    description: |
      All three plans correctly invoke `docker compose up -d postgres &&
      pnpm test` per user memory rule "Always run full Docker tests".
      No CLAUDE.md violations detected.
    fix_hint: |
      None.
```

---

## Coverage Verification

### Phase 46 Success Criteria → Plan Mapping

1. **/profile renders 21 sites in detected locale** → 46-02 T1 (12 HEXACO/Schwartz labels) + T2 (3 qualifier strings via 46-01 import) + T3 (6 score-line tokens × 2 sites = 12 token-occurrences, semantically 6 sites: 2× `/ 5.0`, 2× `confidence`, 2× separator). Catalogue from 39-REVIEW.md verified: lines 705-707 + 715-720 + 728-737 + 791 + 806 = 21 ROW IDs covered.
2. **WEEKLY_REVIEW_HEADER locale-matched** → 46-03 T1 ships D-08 verbatim seed at all three locales; consumption site at :621 rewired with `[language]` index + EN fallback.
3. **FR regex handles curly + rejects gibberish** → 46-03 T2 ships D-14 normalize helper (via 46-01 T2) + D-16 regex tightening. Plan correctly identifies regex lives in weekly-review.ts (NOT weekly-review-sources.ts as REQUIREMENTS.md L10N-03 says — REQUIREMENTS.md is misattributed; plan reflects reality).
4. **Daily journal PROMPTS locale-aware** → 46-04 T1 (PROMPTS shape) + T2 (fireJournal wires getLastUserLanguageFromDb).
5. **qualifierFor consolidated** → 46-01 T1+T3 (canonical at chris/locale/strings.ts) + 46-02 T2 (display-side migration). Both call sites covered.
6. **TEMPLATED_FALLBACK_EN per-locale** → 46-03 T3 ships D-08 verbatim seed; return-site at :472 narrows input.language inline.

### D-Decision Compliance

| Decision | Honored | Evidence |
|----------|---------|----------|
| D-01 (no new locale layer) | YES | strings.ts is REGISTER not detection; co-located beside language.ts |
| D-03 (MSG-shape + TS const) | YES | All registers use Record<Lang, T> as const |
| D-04 (cross-file only in chris/locale/strings.ts) | YES | qualifierFor + normalizeForInterrogativeCheck shared; WEEKLY_REVIEW_HEADER stays in weekly-review.ts (single consumer) |
| D-05 (Record<Lang, T> with Lang union) | YES | Every register typed against `Lang` import |
| D-06 (Sonnet seeds + Greg /gsd-verify-work pass) | PARTIAL | Plans note "seed" but lack consolidated translation review table — see WARNING |
| D-08 (verbatim seed text) | YES | WEEKLY_REVIEW_HEADER + TEMPLATED_FALLBACK use D-08 strings exactly |
| D-11 (qualifierFor canonical in chris/locale/strings.ts) | YES | 46-01 T1 |
| D-12 (signature with lang param) | YES | `qualifierFor(c: number, lang: Lang): string` |
| D-13 (thresholds locked verbatim) | YES | 0.6 / 0.3 / else |
| D-14 (NFC + curly→straight replace) | YES | normalizeForInterrogativeCheck uses `s.normalize('NFC').replace(/[‘’ʼ′]/g, "'")` |
| D-16 (drop `e` from regex class) | YES | `qu'?est-ce que` (no `[e]`) |
| D-17 (helper location chris/locale/strings.ts) | YES | 46-01 T2 |
| D-18 (golden snapshots per locale) | YES | 46-02 T4 extends profile-psychological.golden.test.ts |
| D-19 (Docker postgres for snapshots) | YES | Every plan's verification block runs `docker compose up -d postgres && pnpm test` |
| D-23 (4-plan recommended split) | YES | Plans follow recommended split exactly |

### Out-of-Scope Confirmations (Deferred Ideas honored)

- Prompt-side HEXACO_DIM_LABELS in profiles.ts stay EN — 46-01 T3 explicitly preserves; 46-02 boundary explicitly excludes.
- WeeklyReviewPromptInput.language type-narrowing (WR-04) NOT touched — 46-03 T3 defensive inline narrow only.
- BL-02 short-message getLastUserLanguageFromDb bug NOT touched — 46-03 + 46-04 risk sections flag separately.
- refusal.ts FR_PATTERNS retrofit NOT touched — 46-03 boundary excludes.
- 35-REVIEW.md WR-02 (operational `since`/`energy=`/etc.) NOT touched — outside the 21-site catalog; REQUIREMENTS.md L10N-01 scope is the 21 psychological sites.

### Cross-Plan Data Contracts

- 46-01 exports `qualifierFor` + `normalizeForInterrogativeCheck` + `LANG_QUALIFIER_BANDS`. Consumers: 46-02 imports qualifierFor; 46-03 imports normalizeForInterrogativeCheck. No conflicting transforms.
- 46-04's `PROMPTS[lang][promptIdx]` indexing relies on CAP-01 cardinality lock (all 3 locales = 6 prompts). Module-load assertion guards it. No bag-rotation invariant violation.
- WEEKLY_REVIEW_HEADER export shape changes from `string` → `Record<Lang, string>` — BREAKING export change. 46-03 T1 step 4 explicitly searches for cross-codebase consumers; verified above only test file + weekly-review.ts itself consume it.

### Architectural Tier Compliance

Skipped — no Architectural Responsibility Map in 46-RESEARCH.md (no RESEARCH.md exists for this phase).

### Nyquist Compliance

Skipped — no VALIDATION.md in phase directory.

### Pattern Compliance (#1861)

46-PATTERNS.md provides analog mappings:
- chris/locale/strings.ts → chris/refusal.ts:180-184 (register shape) ✓ referenced in 46-01 T1 read_first
- profile.ts MSG extension → self (MSG at :120-443) ✓ referenced in 46-02 T1+T3 read_first
- journal.ts cron-context fetch → weekly-review.ts:580-583 ✓ referenced in 46-04 T2 read_first

All shared patterns covered.

---

## Top 3 Issues (bounce summary)

1. **BLOCKER — 46-03 T4 "L10N-03c" test does not detect the regression it claims to detect.** Both old and new regex produce stage1Check==true on the test input. Fix: assert directly against INTERROGATIVE_REGEX match-count, OR craft input where old regex would produce 2 matches and new produces 1.

2. **WARNING — 46-02 T3 ships mixed decimal formatting:** literal slug `/ 5,0` in FR/RU strings while `score.toFixed(1)` always emits dot. Output reads `4.2 / 5,0` — internally inconsistent. Choose one boundary (all-dot OR `toLocaleString`).

3. **WARNING — 46-04 depends_on: [46-01] is over-conservative.** Plan 46-04 does not import from strings.ts; the dependency forces unnecessary sequential execution. Move 46-04 to wave 1.

---

*Plan check completed: 2026-05-15*
