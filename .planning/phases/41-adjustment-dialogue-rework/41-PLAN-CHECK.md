# Phase 41 Plan Check — Goal-Backward Verification

**Reviewed:** 2026-05-15
**Reviewer:** gsd-plan-checker (adversarial stance)
**Plans checked:** 41-01-PLAN.md (3 tasks), 41-02-PLAN.md (3 tasks)
**Phase goal:** Stop every-tick re-fire, eliminate "isn't working" + slug-leak copy, close Haiku-whitelist privilege escalation, ship FR/RU + per-field validation + regression test
**Verdict:** **APPROVED with minor warnings** (no blockers — execution may proceed; warnings should be acknowledged in 41-01-SUMMARY.md)

---

## Coverage matrix — requirement → task

| Req | Source Citation | Covering Plan/Task | Status |
|-----|-----------------|--------------------|--------|
| ADJ-01 | adjustment-dialogue.ts:285 wrongful copy | 41-01 Task 2 Cluster B | COVERED |
| ADJ-02 | Slug leak L285, L308, L471, L733 | 41-01 Task 1 (map) + Task 2 Clusters B, C, D, E (4 substitutions) | COVERED |
| ADJ-03 | 8 sendMessage + Haiku prompt | 41-02 Task 2 Clusters A (wiring), B (8 maps), C (prompt) | COVERED |
| ADJ-04 | skip_count reset on 4 completion paths | 41-01 Task 2 Clusters C, D, E (3 sites) + Task 3 (4th site) | COVERED |
| ADJ-05 | Remove mute_until from Haiku whitelist | 41-02 Task 1 Cluster A | COVERED |
| ADJ-06 | Per-field validation in confirmConfigPatch | 41-02 Task 1 Cluster B | COVERED |
| ADJ-07 | Integration test asserts no re-fire | 41-02 Task 3 (5 cases) | COVERED |

All 7 ADJ requirements have explicit covering tasks. ROADMAP Phase 41 success criteria 1-6 all map to at least one task.

---

## Plan partitioning (D-41-01 compliance)

- Plan 41-01 ships ADJ-01/02/04 atomically as P0 live-fix — CORRECT per D-41-01
- Plan 41-02 ships ADJ-03/05/06/07 — CORRECT per D-41-01
- depends_on: [41-01] on 41-02 — wave ordering correct
- No scope creep observed; deferred items (BL-09/11/12, WR-02/03/04/05/07/10/12) correctly listed in CONTEXT.md `<deferred>` and absent from plans

---

## Verification dimensions

### Dimension 1 — Requirement Coverage: PASS
- All 7 ADJ requirements appear in plan `requirements:` frontmatter (41-01: ADJ-01,02,04; 41-02: ADJ-03,05,06,07)
- No orphans; no ambiguous mappings

### Dimension 2 — Task Completeness: PASS
- All 6 tasks have `<files>`, `<action>`, `<verify>`, `<done>`/`<acceptance_criteria>` blocks
- All tasks have specific file paths and line citations (no vague "implement auth"-style tasks)

### Dimension 3 — Dependency Correctness: PASS
- 41-01 wave 1, depends_on: [] — CORRECT (no upstream needed)
- 41-02 wave 2, depends_on: [41-01] — CORRECT (consumes display-names.ts created in 41-01)
- No cycles, no forward references

### Dimension 4 — Key Links Planned: PASS
- 41-01 frontmatter `key_links` covers: adjustment-dialogue.ts → display-names.ts (import), 4 reset+fire-event pairs, skip-tracking.ts wiring
- 41-02 frontmatter `key_links` covers: sendMessage → display-names, zod enum tightening, parseRitualConfig candidate-parse, test → runRitualSweep
- All wiring explicit in task actions

### Dimension 5 — Scope Sanity: PASS (with one note)
- 41-01: 3 tasks, 3 files modified — within target
- 41-02: 3 tasks, 2 files modified — within target
- Note: 41-01 Task 2 has 5 edit clusters in one file; this is dense but tractable because each cluster has explicit line ranges and the analog patterns are catalogued in 41-PATTERNS.md

### Dimension 6 — Verification Derivation: PASS
- `must_haves.truths` are user-observable ("Greg never sees 'isn't working'", "next sweep does NOT re-fire") — not implementation-focused
- Artifacts map to truths; key_links explicit

### Dimension 7 — Context Compliance: PASS
- All 8 decisions D-41-01..D-41-08 traceably implemented:
  - D-41-01 plan partition: PASS (two plans as decided)
  - D-41-02 BL-01 EN observational copy: PASS (41-01 Task 2 Cluster B uses exact string)
  - D-41-03 TS constant map + drop cadence prefix: PASS (41-01 Task 1 creates module; Task 2 Cluster B removes cadence ternary)
  - D-41-04 reuse existing language helpers: PASS (41-02 Task 2 Cluster A imports from language.ts)
  - D-41-05 four reset sites: PASS (41-01 Tasks 2+3 cover all 4)
  - D-41-06 remove mute_until, no replacement: PASS (41-02 Task 1 Cluster A)
  - D-41-07 candidate-parse via RitualConfigSchema: PASS (41-02 Task 1 Cluster B)
  - D-41-08 5-case test: PASS (41-02 Task 3)
- No deferred items leak into plans

### Dimension 7b — Scope Reduction Detection: PASS
- 41-01 ships EN-only deliberately — this is NOT scope reduction because Plan 41-02 (committed dependency) layers FR/RU. The decision D-41-01 explicitly partitions on user-visibility vs. internal-correctness. No "v1/v2" pseudo-versioning detected outside the locked decision.

### Dimension 10 — CLAUDE.md Compliance: PASS
- "evening journal" naming honored (41-01 Task 1 acceptance criteria explicit)
- Docker integration tests required (41-02 Task 3 verify includes `bash scripts/test.sh`)
- Live-server context not contradicted

---

## Warnings (non-blocking, should be addressed)

### WARNING-1: Acceptance criterion count miscount in 41-01 Task 2
- **Plan:** 41-01
- **Task:** 2
- **Issue:** Acceptance criterion states "`skipCount: 0` appears at exactly 4 distinct call sites inside adjustment-dialogue.ts... Total count: 5." but the existing file already contains 2 pre-existing reset sites (line 400-403 in the `no_change` Haiku branch, and line 700 in `ritualConfirmationSweep`). After adding 4 new sites, the grep should show 6 occurrences, not 5. The criterion will fail as written even on a correct implementation.
- **Severity:** WARNING (acceptance gate will produce a false negative)
- **Fix:** Update Task 2 acceptance criterion to "Total count: 6 (2 pre-existing at L400/L700 + 4 new)" or remove the count assertion entirely and rely on the named-site enumeration.

### WARNING-2: Existing integration test will fail before copy-update lines are touched
- **Plan:** 41-01
- **Task:** 2
- **Issue:** Existing `adjustment-dialogue.integration.test.ts:113` asserts `expect(sentText).toContain('daily')` — this WILL fail after Plan 41-01 removes the cadence prefix per D-41-03. Line 178 asserts `toContain('fire_at')` — fails after configFieldLabel substitution. Task 2 acceptance criterion says "update minimally as part of this task IF tests broke" — the word "if" is incorrect; the tests WILL break deterministically, so the test edit is a required part of Task 2, not an optional contingency.
- **Severity:** WARNING (executor may interpret "IF" as optional and skip the test update, leading to false test-suite failure)
- **Fix:** Reframe acceptance criterion as: "Update the three assertions at adjustment-dialogue.integration.test.ts:113, :114, :178 to reflect: (a) no 'daily' cadence prefix; (b) display name string `evening journal` (or slug fallback for the test fixture); (c) `fire time` instead of `fire_at`."

### WARNING-3: confirmConfigPatch signature change introduces a new user-facing sendMessage at cron context
- **Plan:** 41-02
- **Task:** 1 (Cluster B reject path)
- **Issue:** When `confirmConfigPatch` is called from `ritualConfirmationSweep` (auto_apply_on_timeout path, line 687) and the candidate-parse fails, the new code sends Greg an error message. Currently the auto_apply_on_timeout path is silent. This is a behavior change: Greg may now receive notification messages outside the original adjustment-dialogue conversation when Haiku's 60s-deferred patch fails type-check. The plan does not flag this as a deferred-conversation reactivation surface.
- **Severity:** WARNING (acceptable per the security framing but should be noted in 41-02-SUMMARY)
- **Fix:** Either (a) acknowledge in plan that the cron-context reject path produces a deferred Telegram notification — acceptable trade-off for security visibility — or (b) silence the reject sendMessage when actor === 'auto_apply_on_timeout'.

### WARNING-4: routeRefusal signature change unspecified in 41-02 Task 2
- **Plan:** 41-02
- **Task:** 2 Cluster A
- **Issue:** Plan says "Pass `locale` down to `routeRefusal` (extend its signature)" — but `routeRefusal` is a closed local function at line 125-185 with 3 params (ritualId, refusal, text). Adding `locale` to the signature is fine, BUT confirmConfigPatch is exported and may be called from outside; signature changes to confirmConfigPatch may have call-site callers Plan 41-02 doesn't enumerate. The plan asserts `ritualConfirmationSweep` calls it (cron context, needs DB-locale lookup as Task 1 Cluster B specifies) — but plan 41-02 Task 2 mixes "extend signature" and "use DB lookup inside" without resolving which strategy applies.
- **Severity:** WARNING (the executor will need to make a small disambiguating choice; both strategies in the plan would work but conflict if naively combined)
- **Fix:** Specify: confirmConfigPatch resolves locale internally via `getLastUserLanguageFromDb` (matches Task 1 Cluster B) — the caller does NOT pass locale. Remove "extend its signature" wording for confirmConfigPatch.

### WARNING-5: 41-02 Task 3 Case 1 mock orchestration may not exercise the full yes-path skip_count reset
- **Plan:** 41-02
- **Task:** 3
- **Issue:** Test Case 1 ("yes-reply path") drives through `handleAdjustmentReply` with mocked Haiku `change_requested` to insert the confirmation pending row, then calls `handleConfirmationReply(..., 'yes')`. The plan asserts `metadata->>'source'='user_yes'` in ritual_fire_events. But Plan 41-01 Task 2 Cluster C puts that source label on the COMPLETION event (handleConfirmationReply yes branch), not on the fire event from `fireAdjustmentDialogue`. Mock orchestration needs to seed/skip the initial fire event correctly so that the test sees only the new RESPONDED row.
- **Severity:** WARNING (test author will figure this out but the plan could specify the seed strategy more explicitly)
- **Fix:** Add to Task 3 action: "Filter `ritual_fire_events` query by `outcome='responded' AND metadata->>'source'='user_yes'` (not just by ritualId) to isolate the completion event from the prior 'in_dialogue' fire event."

---

## Issues YAML

```yaml
verdict: approved
blocker_count: 0
warning_count: 5
issues:
  - dimension: task_completeness
    severity: warning
    plan: "41-01"
    task: 2
    description: "Acceptance criterion 'Total count: 5' miscounts pre-existing skipCount: 0 occurrences (no_change branch at L400 + ritualConfirmationSweep at L700 → 2 pre-existing + 4 new = 6)"
    fix_hint: "Update count to 6 or remove count assertion; keep named-site enumeration"
  - dimension: task_completeness
    severity: warning
    plan: "41-01"
    task: 2
    description: "Existing integration test assertions at L113/L114/L178 will deterministically break (toContain('daily'), toContain('fire_at')) — plan frames test update as conditional 'IF tests broke' but failure is certain"
    fix_hint: "Make the three test assertion updates explicit required edits in the acceptance criteria"
  - dimension: key_links_planned
    severity: warning
    plan: "41-02"
    task: 1
    description: "New REJECT_ERROR_MSG sendMessage on auto_apply_on_timeout reject path introduces a new deferred user-notification surface not previously documented"
    fix_hint: "Either acknowledge in plan summary as accepted trade-off OR suppress sendMessage when actor === 'auto_apply_on_timeout'"
  - dimension: task_completeness
    severity: warning
    plan: "41-02"
    task: 2
    description: "Plan mixes 'extend confirmConfigPatch signature' (Cluster A) with 'resolve locale via getLastUserLanguageFromDb inside confirmConfigPatch' (Task 1 Cluster B) — conflicting strategies"
    fix_hint: "Specify confirmConfigPatch resolves locale internally; do NOT add locale parameter to its signature"
  - dimension: task_completeness
    severity: warning
    plan: "41-02"
    task: 3
    description: "Test Case 1 (and 2) ritual_fire_events query must filter by metadata->>'source' to isolate completion event from initial in_dialogue fire event"
    fix_hint: "Add filter detail to Task 3 action / acceptance criteria"
```

---

## Recommendation

**APPROVED for execution.** Five warnings are non-blocking — they affect implementation precision and test-suite hygiene but do not threaten the phase goal. All 7 ADJ requirements + 6 ROADMAP success criteria have explicit covering tasks with concrete file paths, line citations, and observable acceptance gates.

Plan 41-01 (P0 live-fix) is ready to ship after warnings 1 and 2 are addressed inline during execution (or accepted as known-during-execution caveats). Plan 41-02 (security + locale + test) follows correctly via depends_on:[41-01].

Operator-driven smoke on Proxmox (per CLAUDE.md live-server access) is mandatory after 41-01 ships.

---

*Reviewed: 2026-05-15*
*Reviewer: gsd-plan-checker*
*Methodology: Goal-backward verification against ROADMAP Phase 41 success criteria + 7 ADJ requirements + 8 D-41-XX decisions + CLAUDE.md constraints*
