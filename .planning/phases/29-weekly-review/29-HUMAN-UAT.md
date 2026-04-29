---
status: partial
phase: 29-weekly-review
source: [29-VERIFICATION.md]
started: 2026-04-29T00:50:00Z
updated: 2026-04-29T00:50:00Z
---

## Current Test

[awaiting human testing — requires staging deploy + first Sunday cron tick OR manual time-warp UAT]

## Tests

### 1. SC-1 — First Sunday weekly review fires end-to-end

**Expected:** On the first Sunday after deploy, at 20:00 Europe/Paris, Chris fires `weekly_review`. Sonnet generates ONE observation + ONE Socratic question grounded in the past 7 days. Greg's Telegram receives the message with header "Observation (interpretation, not fact):". Persists to `pensieve_entries` with `epistemic_tag = 'RITUAL_RESPONSE'` + `metadata.kind = 'weekly_review'`. Queryable via INTERROGATE: "show me past weekly observations".

**Test instructions:**
1. Deploy current main to staging Proxmox (commit ≥ 94dbe9c — Phase 29 final).
2. Wait until next Sunday 20:00 Europe/Paris (cron tick fires; 21:00 sweep tick catches it 1h later — D-29 latency tolerance documented).
3. Verify Greg's Telegram receives ONE message with the D031 header + observation + Socratic Q.
4. Verify in postgres: `SELECT epistemic_tag, metadata FROM pensieve_entries WHERE metadata->>'kind' = 'weekly_review' ORDER BY created_at DESC LIMIT 1;`
5. Verify Sonnet output passes Stage-1 + Stage-2 single-question enforcement (no compound questions, no flattery markers).

**result:** [pending]

---

### 2. SC-2/3 — Manual time-warp UAT for two-stage enforcement (Plan 29-03 Task 4 script)

**Expected:** Plan 29-03 Task 4 was marked `checkpoint:human-verify gate=blocking` and auto-acknowledged in --auto chain mode. Greg manually walks through the verification:
- Force-fire the weekly_review ritual against Docker test DB
- Inject an adversarial fixture week with rich emotional content + decisions
- Verify Stage-1 Zod refine catches a multi-? Sonnet output (or that Stage-2 Haiku judge catches a semantic compound question that slipped Stage-1)
- Verify retry cap = 2 + templated EN fallback `"What stood out to you about this week?"` after retry exhaustion

**Test instructions:**
1. SSH to Proxmox: `npx tsx scripts/fire-ritual.ts weekly_review` (after staging deploy).
2. Or use the time-warp UAT script documented in 29-03-SUMMARY.md.
3. Inspect the Sonnet+Haiku log lines:
   - `chris.weekly-review.stage-1-pass` / `chris.weekly-review.stage-1-fail`
   - `chris.weekly-review.stage-2-judge-pass` / `chris.weekly-review.stage-2-judge-fail`
   - `chris.weekly-review.retry-cap-exhausted`
   - `chris.weekly-review.fallback-fired`
4. Verify wellbeing variance gate: if any dim stddev < 0.4 over the 7-day window, observation does NOT cite wellbeing.

**result:** [pending]

---

### 3. SC-4 — Phase 30 TEST-31 live anti-flattery 3-of-3 (empirical proof of CONSTITUTIONAL_PREAMBLE injection)

**Expected:** Phase 30 TEST-31 executes `src/rituals/__tests__/live-weekly-review.test.ts` against real Sonnet with `ANTHROPIC_API_KEY` set. The test:
- Loads adversarial-week fixture (7 days of bait content)
- Runs `generateWeeklyObservation` 3 times atomically
- Asserts ZERO of ~49 forbidden flattery markers appear in any iteration's output
- Asserts `fallbacks === 0` (no templated fallback used in 3-of-3 — Sonnet must generate compliant output every time under adversarial input)

**This is deferred to Phase 30 per HARD CO-LOC #6.** Plan 29-04 ships the test scaffolding (skipIf-gated until Phase 30 enables it). Phase 30 will:
- Flip the gate from `skipIf(!ANTHROPIC_API_KEY)` to active execution
- Add the file to `scripts/test.sh` excluded-suite list (operational handling for sandbox where API key is absent)

**Test instructions (when Phase 30 lands):**
1. Phase 30 plans + executes
2. CI run with ANTHROPIC_API_KEY set
3. Verify `npx vitest run src/rituals/__tests__/live-weekly-review.test.ts` exits 0 with 3-of-3 assertions green

**result:** [pending — gates on Phase 30 TEST-31 implementation]

---

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 3 *(SC-1 blocks on staging deploy; SC-2/3 blocks on manual UAT; SC-4 blocks on Phase 30 TEST-31)*

## Gaps

None at component level — 4/4 ROADMAP success criteria structurally verified; all 9 WEEK-* requirements satisfied; HARD CO-LOC #2/#3/#6 all enforced; Pitfalls 14 + 17 mitigations grep-checkable.

## Resolution path

- SC-1 + SC-2/3: run `/gsd-verify-work 29` post-deploy, on first Sunday 20:00 Paris OR via manual time-warp UAT
- SC-4: gates on Phase 30 TEST-31 (not yet planned). Will be auto-resolved when Phase 30 ships and TEST-31 enables the live test gate.
