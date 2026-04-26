# Phase 25: Ritual Scheduling Foundation + Process Gate - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-26
**Phase:** 25-Ritual Scheduling Foundation + Process Gate
**Mode:** `--auto` (Claude auto-selected recommended defaults; no interactive AskUserQuestion calls)
**Areas discussed:** PROC-01/02 disposition, Plan split structure, Cron validation behavior, Ritual channel daily counter, Test approach for cron registration, Cron-registration extraction, Manual-sweep script, Migration meta-snapshot regeneration

---

## PROC-01/PROC-02 disposition

| Option | Description | Selected |
|--------|-------------|----------|
| Drop from scope | Mark `[x] (upstream: GSD 1.38.4/1.38.5)` in REQUIREMENTS.md; Phase 25 scope shrinks to 12 reqs / 3 plans | ✓ |
| Keep as Chris-side regression test | Ship a thin test in Chris repo confirming the new GSD behavior | |
| Leave as planned | Implement PROC-01/02 ignoring the upstream verdict | |

**Auto-selected:** "Drop from scope" (recommended default).
**Rationale:** GSD 1.38.4/1.38.5 changelog + line-level evidence in `~/.claude/get-shit-done/workflows/execute-phase.md:1338-1376` and `~/.claude/get-shit-done/templates/summary.md:41` confirms full coverage. Chris-side regression duplicates upstream gsd-sdk test surface.
**Required follow-up:** Greg edits REQUIREMENTS.md + ROADMAP.md to reflect scope reduction (planner cannot do this per the original verification todo's instruction).

---

## Plan split structure

| Option | Description | Selected |
|--------|-------------|----------|
| 3 plans (substrate / helpers / process boundaries) | Migration+meta+test.sh / cadence+schema+idempotency / cron+sweep+health | ✓ |
| 4 plans (split idempotency from cadence) | Adds extra plan boundary for ~10 LoC helper | |
| 2 plans (collapse helpers into substrate) | Violates HARD CO-LOCATION #7 spirit; >10 file plan hard to review | |

**Auto-selected:** "3 plans".
**Rationale:** HARD CO-LOCATION #7 forces migration + meta-snapshot + scripts/test.sh into ONE plan. Pure-function helpers (cadence, schema, idempotency) cohere naturally. Process boundaries (cron + sweep + /health) cohere naturally.

---

## Cron validation behavior at config load

| Option | Description | Selected |
|--------|-------------|----------|
| Fail-fast (throw) | `cron.validate()` short-circuits at config load; container restart-loops until env fixed | ✓ |
| Warn and continue | Log warning, attempt to register cron anyway | |
| Validate at registration time only | Defer validation until cron.schedule() is called | |

**Auto-selected:** "Fail-fast (throw)".
**Rationale:** A silently-broken cron expression means rituals never fire — exactly the trust-breaking failure mode this milestone defends against. Existing M008 patterns already throw at config load.

---

## Ritual channel daily counter

| Option | Description | Selected |
|--------|-------------|----------|
| One counter for the channel as a whole | Shared across all rituals; independent of accountability/reflective | ✓ |
| Per-ritual-type counters | Separate counter per ritual (voiceNoteCount, wellbeingCount, etc.) | |
| No counter; rely on per-tick max-1 only | Rate-limit purely via max-1-ritual-per-tick | |

**Auto-selected:** "One counter for the channel as a whole".
**Rationale:** Per-tick max-1 cap (TS-11) handles per-ritual rate-limiting; channel-level counter is for the channel as a unit. Per-ritual-type fragments tracking with no consumer.

---

## Test approach for cron registration

| Option | Description | Selected |
|--------|-------------|----------|
| Both `/health` endpoint + unit-test spy | `/health` for runtime ops visibility, spy for build-time regression | ✓ |
| `/health` only | Operator-visible runtime check only | |
| Unit-test spy only | Deterministic build-time check only | |

**Auto-selected:** "Both".
**Rationale:** `/health` covers production runtime; unit test catches refactor regressions in CI before next 21:00 fire. HARD CO-LOCATION #4 (Pitfall 23 — fixture vs cron-registration tests as distinct plans) applies to Phase 30 live tests, not Phase 25 substrate.

---

## Cron registration extraction from src/index.ts

| Option | Description | Selected |
|--------|-------------|----------|
| Extract `registerCrons(deps)` helper | Centralized, testable; returns status map for /health | ✓ |
| Keep cron registrations inline + spy `cron.schedule` | Requires importing all of src/index.ts to test | |

**Auto-selected:** "Extract `registerCrons(deps)` helper".
**Rationale:** Testing in isolation avoids importing the full bot+Express+Drizzle init chain.

---

## `runRitualSweep()` invocability for manual operator testing

| Option | Description | Selected |
|--------|-------------|----------|
| `scripts/manual-sweep.ts` thin wrapper | Matches existing `scripts/*.ts` convention | ✓ |
| REPL-only via `node --experimental-repl-await` | Operators must remember import paths | |

**Auto-selected:** "`scripts/manual-sweep.ts` thin wrapper".
**Rationale:** Matches existing `scripts/regen-snapshots.sh`, `scripts/backfill-episodic.ts` convention; cleaner for CI parity.

---

## Migration meta-snapshot regeneration approach

| Option | Description | Selected |
|--------|-------------|----------|
| `scripts/regen-snapshots.sh` clean-slate iterative replay | TECH-DEBT-19-01 + Phase 19 v2.1 pattern; proven across v2.1/v2.2/v2.3 | ✓ |
| `npx drizzle-kit generate --custom` against unstable journal | Drizzle 0.45 doesn't auto-generate ALTER TYPE enum extensions | |

**Auto-selected:** "`scripts/regen-snapshots.sh` clean-slate iterative replay".
**Rationale:** Established escape hatch for the well-known Drizzle ALTER TYPE limitation; pattern proven across three milestones.

---

## Claude's Discretion

- Exact file names within `src/rituals/` (`types.ts` vs `schema.ts`, `idempotency.ts` co-located in `scheduler.ts` or split out)
- Exact env var name capitalization (`RITUAL_SWEEP_CRON` is the obvious choice but planner picks)
- Exact log-event names (`rituals.cron.scheduled` vs `ritual.cron.registered`)
- Exact test file locations (`src/rituals/__tests__/cadence.test.ts` is the obvious choice)
- `ritualCount` daily ceiling value (planner reads `src/proactive/sweep.ts` for existing channel cap precedent)
- `scripts/manual-sweep.ts` JSON output schema shape

## Deferred Ideas

- Per-ritual-type daily counters (revisit in v2.5 if real-use shows per-tick max-1 insufficient)
- Hourly cron sweep (Disagreement #1 alternative — defer until a third cron tick is genuinely needed)
- Cron expression parsing for Greg-friendly config UI (explicitly anti-feature OOS-9; deferred indefinitely)
- Wellbeing trajectory as 3rd weekly-observation source (DIFF-2 — defer to v2.5)
- Server-side Whisper transcription (OOS-3 — explicit anti-feature in PLAN.md `## Out of Scope`)
