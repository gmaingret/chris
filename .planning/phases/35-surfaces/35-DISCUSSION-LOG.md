# Phase 35: Surfaces - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 35-surfaces
**Mode:** `--auto` (single-pass, recommended options auto-selected from M010 research pass)
**Areas discussed:** Plan split, buildSystemPrompt refactor, mode-handler injection, /profile command, formatter + golden test, test strategy

---

## Plan split structure

| Option | Description | Selected |
|--------|-------------|----------|
| 3 plans matching REQUIREMENTS SURF-01..05 traceability | 35-01 refactor (SURF-01); 35-02 mode injection (SURF-02); 35-03 /profile + formatter + golden test (SURF-03/04/05) | ✓ |
| 2 plans (refactor + everything else) | Simpler split but bloats Plan 35-02 with both mode wiring AND /profile handler | |
| 4+ plans (one per SURF requirement) | Over-fragments the /profile + formatter + golden test (HARD CO-LOC #M10-5 demands single plan) | |

**User's choice (auto):** 3 plans matching REQUIREMENTS traceability — recommended per REQUIREMENTS.md:93-97 mapping.
**Notes:** Mirrors Phase 33/34 split discipline. HARD CO-LOC #M10-4 (35-01 atomic) and #M10-5 (35-03 atomic) explicitly named in ROADMAP.

---

## buildSystemPrompt refactor strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Keep overload, add extras as optional 4th positional arg | `(mode, pensieveContext?, relationalContext?, extras?: ChrisContextExtras)`; ACCOUNTABILITY overload preserved verbatim | ✓ |
| Promote ACCOUNTABILITY to typed overload (separate fn) | Cleaner but breaking change beyond what SURF-01 requires; bigger blast radius | |
| Pass entire context object including pensieveContext/relationalContext | Maximum cleanup but multiplies the diff size 3× | |

**User's choice (auto):** Keep overload, add extras as optional 4th positional arg — recommended per SUMMARY.md line 180.
**Notes:** Minimal-blast-radius refactor. 8 call sites migrate mechanically.

---

## Mode-handler injection scope (PROFILE_INJECTION_MAP)

| Option | Description | Selected |
|--------|-------------|----------|
| Per-mode subset via named constant | REFLECT=4 dimensions; COACH=`capital,family`; PSYCHOLOGY=`health,jurisdictional` | ✓ |
| All 4 profiles for all 3 modes | Simpler but PITFALLS M010-08 identifies COACH topic-drift risk if health injected during business-strategy conversations | |
| All 4 for REFLECT, COACH=`capital` only, PSYCHOLOGY=full | More conservative on COACH, less on PSYCHOLOGY; doesn't match research SUMMARY.md line 82-86 | |

**User's choice (auto):** Per-mode subset via named constant — recommended per PITFALLS M010-08 + SUMMARY.md lines 82-86.
**Notes:** M010-08 is a load-bearing pitfall mitigation. Health profile gated additionally by confidence ≥ 0.5 (any mode). Staleness qualifier at 21 days (any dimension).

---

## Caching strategy for getOperationalProfiles in mode handlers

| Option | Description | Selected |
|--------|-------------|----------|
| Per-call (no cache) | DB read on every REFLECT/COACH/PSYCHOLOGY invocation; ~4ms × 4 queries overhead | ✓ |
| In-memory cache with 1h TTL | Performance Trap mitigation; invalidate on profile-update cron completion | |
| Cache per session/conversation | Tied to chat lifecycle; complex invalidation | |

**User's choice (auto):** Per-call (no cache) — recommended for single-user v1 scale.
**Notes:** Deferred to v2.5.1 if profile-read overhead becomes measurable. Performance Trap explicitly acknowledges single-user scale doesn't justify cache-invalidation complexity in v1.

---

## /profile output structure

| Option | Description | Selected |
|--------|-------------|----------|
| 5 separate replies (4 dimensions + M011 placeholder) | One ctx.reply per dimension; isolates per-dimension rendering failures; well below 4096-char Telegram limit | ✓ |
| Single combined reply with section dividers | Matches summary.ts shape but risks exceeding 4096-char limit when profiles grow | |
| 4 replies (M011 placeholder inline with family) | Saves one reply but couples unrelated content | |

**User's choice (auto):** 5 separate replies — recommended per SUMMARY.md line 79 (verbatim "4 separate `ctx.reply()` calls" + M011 placeholder reply).
**Notes:** Per-dimension failure isolation is the key. SURF-05 "ASCII section dividers" refers to within-reply formatting (blank lines + section titles), not Markdown dividers (plain-text policy D-17).

---

## Zero-confidence UX in /profile

| Option | Description | Selected |
|--------|-------------|----------|
| Actionable progress indicator with entry-count gap | "Building your jurisdictional profile — Chris needs ~7 more entries about your location and tax situation" | ✓ |
| Literal "insufficient data (confidence: 0.0)" | Reads as broken state per UX Pitfall in PITFALLS.md line 413 | |
| Hide zero-confidence dimensions entirely | Less informative for Greg; counter to ROADMAP success #3 (all four profiles surfaced) | |

**User's choice (auto):** Actionable progress indicator — recommended per UX Pitfall PITFALLS.md line 413.
**Notes:** Tells Greg the system is working and ramping up, not broken.

---

## Golden snapshot granularity

| Option | Description | Selected |
|--------|-------------|----------|
| English only for full snapshots; FR/RU via language-coverage smoke test | 16 inline snapshots (4 dimensions × 4 cases) + 2 language-coverage cases | ✓ |
| All 3 languages × 4 cases per dimension | 48 inline snapshots; unmaintainable churn on any rendering change | |
| English only; no FR/RU coverage | Misses localization regressions | |

**User's choice (auto):** English snapshots + FR/RU language-coverage smoke test — recommended for snapshot maintainability.
**Notes:** English-only locks the rendering structure; smoke test guards label translation. Vitest `-u` regenerates snapshots after deliberate rendering changes.

---

## Localization source for /profile

| Option | Description | Selected |
|--------|-------------|----------|
| `getLastUserLanguage` (in-memory session cache) | User-initiated handler context; cache always populated by preceding message; matches summary.ts:162 pattern | ✓ |
| `getLastUserLanguageFromDb` (DB-backed lookup) | Cron-context lesson from M009 first-Sunday weekly_review; not needed for user-initiated commands | |
| English default with no localization | Out of compliance with codebase EN/FR/RU policy | |

**User's choice (auto):** `getLastUserLanguage` (in-memory) — recommended per user-initiated context + existing handler convention.
**Notes:** Cron-context DB-backed lookup is for the Sunday 22:00 profile cron itself (Phase 34) — irrelevant to user-initiated /profile.

---

## Call-site migration of tests in Plan 35-01

| Option | Description | Selected |
|--------|-------------|----------|
| Same plan, atomic | All 47 test-file call sites migrated in Plan 35-01 alongside source code; build stays green throughout | ✓ |
| Separate follow-up plan | Build red between Plan 35-01 source edits and Plan 35-01.5 test edits; partial-refactor anti-pattern | |
| Deprecation period with both signatures supported | Adds backward-compat code that has to be removed later; pollutes the diff | |

**User's choice (auto):** Same plan, atomic — recommended per HARD CO-LOC #M10-4 enforcement.
**Notes:** Build never goes red. gsd-plan-checker enforces.

---

## Health profile confidence gate threshold

| Option | Description | Selected |
|--------|-------------|----------|
| Health only — other dimensions inject from confidence > 0 | Health gated at ≥ 0.5; jurisdictional/capital/family inject from any non-zero confidence | ✓ |
| All dimensions gated at ≥ 0.5 | More conservative but suppresses early-stage profile signals across the board | |
| No confidence gate (inject whatever exists) | Risks injecting speculative health hypotheses as grounded facts per M010-08 | |

**User's choice (auto):** Health only — recommended per M010-08 (health is the topic-drift risk).
**Notes:** Jurisdictional/capital/family are factual enough (location, money, milestones) that low-confidence values are still useful grounding.

---

## Staleness qualifier threshold

| Option | Description | Selected |
|--------|-------------|----------|
| 21 days | 3 weekly cron cycles; allows for one missed cron + buffer | ✓ |
| 14 days | 2 weekly cycles; aggressive but covers single-week miss | |
| 30 days | 4+ weekly cycles; more lenient; risks treating month-old data as current | |

**User's choice (auto):** 21 days — recommended per M010-08 verbatim text.
**Notes:** Same threshold applied to both prompt-side staleness (mode handler injection) and user-facing /profile staleness note. Localized rendering in /profile, plain English directive in system prompt.

---

## Per-dimension prompt-side token cap

| Option | Description | Selected |
|--------|-------------|----------|
| Hard 500-token cap (~2000 chars) with truncation marker | Performance Trap mitigation; "..." marker tells Sonnet content was elided | ✓ |
| No cap; rely on Sonnet brevity | Risks system prompt token bloat as profiles grow over M011/M012 | |
| Cap at higher value (1000 tokens) | Doubles the budget; less protection against bloat | |

**User's choice (auto):** Hard 500-token / 2000-char cap — recommended per Performance Trap in PITFALLS.md line 403.
**Notes:** Applied only to prompt-side formatter (`formatProfilesForPrompt`); /profile user-facing display (`formatProfileForDisplay`) uses 4096-char Telegram message cap (per-reply).

---

## Claude's Discretion

- **Localized string consolidation in /profile** — Inline `MSG` map (matches summary.ts/decisions.ts pattern) vs. shared `src/bot/handlers/_strings.ts` extraction. Default: inline (consistent with existing handlers).
- **Section header phrasing in /profile output** — Exact wording, percentage formatting, French/Russian rendering of "Jurisdictional Profile (confidence 72%)" etc. left to planner.
- **Helper extraction `injectOperationalProfiles(mode)` for 3 in-scope mode handlers** — If 3-line × 3 handlers duplication feels DRY-worthy, planner MAY extract; default inline.
- **Per-dimension display config object** — Switch-case in v1; refactor to config only if M011/M012 add more dimensions.
- **`MOCK_PROFILES` fixture exact field values per case** — Planner finalizes during Plan 35-03 task expansion; "populated-fresh" case may borrow from Phase 33 ground-truth seed values.

## Deferred Ideas

- In-memory cache of `getOperationalProfiles()` with 1h TTL (Performance Trap mitigation) — v2.5.1 if profile-read overhead becomes measurable
- Helper extraction `injectOperationalProfiles(mode)` for 3 in-scope mode handlers — revisit if M011/M012 add similar wiring
- Per-dimension display config object — v2.5.1+ if more dimensions added
- DB-backed language detection in `/profile` — only needed if a future cron surface invokes /profile-equivalent rendering
- Sub-commands under `/profile` (e.g., `/profile jurisdictional`, `/profile history`) — M013 candidate if Greg's usage suggests friction with 5-reply default
- DIFF-3 user-facing time-series profile history — M013/M014 per REQUIREMENTS.md line 48
- DIFF-4 per-profile Sonnet-generated narrative summaries — v2.5.1
