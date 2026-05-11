# Phase 30: Test Infrastructure + HARN-03 Refresh — Discussion Log

**Date:** 2026-04-30
**Mode:** interactive (default — single-question turns per area)
**Phase number:** 30
**Phase name:** Test Infrastructure + HARN-03 Refresh

> Audit/retrospective record of the discuss-phase session. Not consumed by downstream agents — they read CONTEXT.md.

---

## Gray areas identified

Phase 30 is heavily prescribed (13 requirements with locked file paths, assertion semantics, and 2 HARD CO-LOCATION markers). Gray areas concern HOW to organize the work, not WHAT to build.

1. **Plan split structure** — How many plans + how to partition.
2. **HARN-04 fixture freshness gate** — When/how to regenerate `m009-21days` against fresh prod.
3. **TEST-31 cost discipline** — How aggressively to gate the live anti-flattery test (3 real Sonnet calls = ~$0.45 per run).
4. **Wave structure / parallelization** — Sequential vs parallel for 30-02/03/04.

User selected: **all 4 areas**.

---

## Area 1 — Plan split structure (D-30-01)

**Question:** Plan split — given HARD CO-LOC #4 forces TEST-32 into its own file and HARD CO-LOC #6 forces TEST-31 into its own plan, the natural cleavage is 4 plans. Which structure?

**Options presented:**
- 4 plans (Recommended) — 30-01 HARN, 30-02 TEST-23..30, 30-03 TEST-32, 30-04 TEST-31
- 5 plans — split TEST-23..30 across 30-02a + 30-02b
- 3 plans — collapse 30-04 into 30-02 (violates HARD CO-LOC #6)

**User selection:** 4 plans (Recommended).

**Decision captured in CONTEXT.md as D-30-01.**

---

## Area 2 — HARN-04 fixture freshness gate (D-30-02)

**Question:** HARN-04 needs `regenerate-primed.ts --milestone m009 --target-days 21 --force` against fresh prod. TEST-29 (weekly review) requires at least one Sunday in the 21-day window. When to regenerate the m009-21days fixture?

**Options presented:**
- Plan 30-01 first task (Recommended) — regenerate as Plan 30-01 Task 1; fail-fast if no Sunday in window
- Manual gate — user runs regenerate-primed.ts before /gsd-execute-phase 30
- Plan 30-01 conditional regeneration — check mtime + Sunday presence; regenerate only if needed

**User selection:** Plan 30-01 first task (Recommended).

**Decision captured in CONTEXT.md as D-30-02.**

---

## Area 3 — TEST-31 cost discipline (D-30-03)

**Question:** TEST-31 fires 3 real Sonnet calls per run (~$0.15 each = ~$0.45/run). Phase 29-04 already gates with `skipIf(!process.env.ANTHROPIC_API_KEY)`. How aggressive should the gating stay in Phase 30?

**Options presented:**
- skipIf + RUN_LIVE_TESTS env (Recommended) — require BOTH env vars; default test runs skip
- skipIf on ANTHROPIC_API_KEY only — keep Phase 29-04's gate; risk silent CI spend
- Weekly cron + manual gate — `.github/workflows/anti-flattery-weekly.yml`; predictable spend ~$1.80/month

**User selection:** skipIf + RUN_LIVE_TESTS env (Recommended).

**Decision captured in CONTEXT.md as D-30-03.**

---

## Area 4 — Wave structure / parallelization (D-30-04)

**Question:** Wave structure — 30-01 (HARN fixture) blocks 30-02 (synthetic-fixture tests need the fixture). 30-03 (cron registration regression — static check, no fixture) and 30-04 (live anti-flattery — separate file) are independent of fixture freshness. How to wave them?

**Options presented:**
- 3 waves, 30-03/04 parallel-eligible (Recommended) — Wave 1: 30-01; Wave 2: 30-02 + 30-03 + 30-04 parallel
- 3 waves sequential — Wave 1: 30-01; Wave 2: 30-02; Wave 3: 30-03 + 30-04 parallel
- 4 waves fully sequential — mirrors Phase 28 pattern; slowest

**User selection:** 3 waves, 30-03 parallel-eligible (Recommended).

**Decision captured in CONTEXT.md as D-30-04.**

---

## Open questions surfaced during discussion (resolved during write_context)

- **D-30-05 (simulateCallbackQuery helper):** Plan 30-02 owns the helper at `src/rituals/__tests__/fixtures/simulate-callback-query.ts`. Open during planning: confirm whether Phase 27 has an existing forge helper to reuse vs author fresh.
- **D-30-06 (TEST-29 templated fallback exercise):** Plan 30-02 mocks the Sonnet response to return a compound question, forcing Stage-1 Zod refine to throw → retry cap=2 → templated fallback fires. Open during planning: confirm `vi.mock('@anthropic-ai/sdk', ...)` injection pattern exists.

---

## Deferred ideas captured

- Multi-week (>14 day) synthetic coverage — v2.5+
- VCR cache rebuild automation in CI — v2.5+
- DIFF-2/DIFF-3/DIFF-5 weekly review enhancement coverage — v2.5+
- Cross-cutting M009 UAT walkthrough document — defer to milestone-completion
- Performance / regression latency benchmarks — defer unless surfaced
- Weekly anti-flattery cron — D-30-03 rejected; reconsider for v2.5

No scope creep attempted by user.

---

## Outcome

`30-CONTEXT.md` written with 6 decisions (D-30-01..06). Ready for `/gsd-plan-phase 30`.
