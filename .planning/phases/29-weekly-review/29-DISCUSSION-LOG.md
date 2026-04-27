# Phase 29: Weekly Review - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-26
**Phase:** 29-Weekly Review
**Mode:** `--auto` (Claude auto-selected recommended defaults; no interactive AskUserQuestion calls)
**Areas discussed:** Plan split structure, CONSTITUTIONAL_PREAMBLE injection mechanism, Stage-1 single-question enforcement details, Stage-2 Haiku judge details, Date-grounding post-check, Wellbeing variance gate, Pensieve persistence shape, Dispatcher mechanism, Migration ordering, Live anti-flattery test scaffolding split

---

## Plan split structure

| Option | Description | Selected |
|--------|-------------|----------|
| 4 plans (substrate / generator / wire-up / live-test scaffold) | HARD CO-LOC #2 + #3 atomic in plan 02; HARD CO-LOC #6 prep in plan 04 | ✓ |
| 3 plans (collapse wire-up into generator) | Bundles seed migration + Drizzle snapshot regen with LLM logic; >12-file plan | |
| 5 plans (split Stage-1 from Stage-2) | VIOLATES HARD CO-LOC #2 — first weekly review = compound questions in production | |
| Plan 29-04 as separate Phase 30.5 | Live test FILE belongs with implementation per HARD CO-LOC #6; only execution gate moves to Phase 30 | |

**Auto-selected:** "4 plans".
**Rationale:** HARD CO-LOC #2 (single-question enforcement) + #3 (CONSTITUTIONAL_PREAMBLE) force the observation generator + both enforcement stages + preamble injection into ONE plan (Plan 29-02). HARD CO-LOC #6 forces the live-test execution into Phase 30 — but the test FILE belongs with the implementation it tests (Plan 29-04 ships scaffolding with `skipIf(!process.env.ANTHROPIC_API_KEY)`; Phase 30 flips the gate).

---

## CONSTITUTIONAL_PREAMBLE injection mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror M008 CONS-04 pattern (pure prompt assembler imports + injects) | `assembleWeeklyReviewPrompt()` composes `CONSTITUTIONAL_PREAMBLE` as section 1 of returned string | ✓ |
| Reuse `buildSystemPrompt('REFLECT')` chat-mode handler | REFLECT is a chat mode, not Sonnet cron generator; couples Phase 29 to chat-mode prompt evolution | |
| No explicit injection (rely on default Sonnet behavior) | Pitfall 17 explicit anti-pattern; M006 sycophancy failure mode in cron context | |

**Auto-selected:** "Mirror M008 CONS-04 pattern".
**Rationale:** M008 D038 (CONS-04) explicitly documents the cron-context preamble exception; Pitfall 17 mitigation list cites this exact pattern. Same shape as `src/episodic/prompts.ts:115-163`.

---

## Stage-1 single-question enforcement details

| Option | Description | Selected |
|--------|-------------|----------|
| Zod refine: `?` count + interrogative-leading-word per EN/FR/RU | Both checks must pass; rejects compound `?` and period-terminated FR/RU questions | ✓ |
| `?` count alone | Pitfall 14 explicit anti-pattern — French/Russian period-questions slip through | |
| Token-count check | Spec interpretation #6 explicitly supersedes this in favor of two-stage Zod + Haiku | |
| Interrogative-leading-word alone | Misses single-language compound `?` questions | |

**Auto-selected:** "Zod refine with both checks".
**Rationale:** Pitfall 14 enumerates all three failure modes Stage-1 catches; both checks combined are O(string-length) regex with zero LLM cost.

**Locked regex per language (per D-03 in CONTEXT.md):**
- EN: `\b(what|why|how|when|where|which|who)\b`
- FR: `\b(qu['e]?est-ce que|qu['e]?est-ce qui|comment|pourquoi|quoi|quand|où|quel|quelle|quels|quelles|qui)\b`
- RU: `\b(почему|что|как|когда|где|кто|какой|какая|какое|какие|зачем)\b`

---

## Stage-2 Haiku judge details

| Option | Description | Selected |
|--------|-------------|----------|
| Haiku judge with `{ question_count, questions[] }` structured output | Catches semantic compound questions Stage-1 missed; ~$0.001/week cost | ✓ |
| Stage-1 only (no Stage-2) | Pitfall 14 documented failure mode "What surprised you — and what felt familiar?" passes Stage-1 | |
| Sonnet judge instead of Haiku | Overkill for question-counting task | |
| Embedding-based similarity check | Major test surface; Haiku judge is simpler + matches research SUMMARY recommendation | |

**Auto-selected:** "Haiku judge".
**Rationale:** Pitfall 14 explicit Stage-2 prescription; mirrors M008's Haiku-for-classification + Sonnet-for-generation tier discipline.

---

## Retry cap

| Option | Description | Selected |
|--------|-------------|----------|
| Cap = 2 (initial + 2 = 3 attempts max), templated fallback after | Pitfall 15 explicit; mirrors M008 CONS error policy | ✓ |
| Cap = 1 retry only | Adversarial weeks (rich content) can require 2 retries to converge per Pitfall 15 | |
| Cap = unlimited | Pitfall 15 documented failure: "Sonnet API spend ratchets up; weekly review never delivers" | |
| Templated fallback only (no LLM retry) | Loses pattern observations entirely; spec wants Sonnet observation when possible | |

**Auto-selected:** "Cap = 2".
**Rationale:** Pitfall 15 explicit + M008 precedent. Templated fallback ships SOMETHING on Sunday (cadence is the contract).

---

## Date-grounding post-check

| Option | Description | Selected |
|--------|-------------|----------|
| Haiku post-check after single-question enforcement passes | Pitfall 16 explicit; runtime safety net + Sonnet drift in cron contexts is documented (M008 precedent) | ✓ |
| Prompt-level constraint only (no post-check) | Pitfall 16 documented failure mode: Sonnet still references stale dates with explicit window in prompt | |
| Strict-regex post-check (regex date strings, validate each in window) | Date references aren't always ISO-formatted ("Wednesday" / "two weeks ago") — regex misses semantic mentions | |

**Auto-selected:** "Haiku post-check".
**Rationale:** Pitfall 16 explicit + M008 date-extraction Haiku JSON-fences bug (fixed 2026-04-25) is a precedent that Sonnet's date discipline drifts in cron contexts.
**Shared retry budget:** Counts against same `retry_count <= 2` cap as single-question rejection.

---

## Wellbeing variance gate

| Option | Description | Selected |
|--------|-------------|----------|
| Per-dim stddev in JS; ANY dim < 0.4 → omit wellbeing block at PROMPT-ASSEMBLY time | Sonnet never sees the data → cannot cite it. Asymmetric coverage avoided. | ✓ |
| ALL-dims-flat rule (only omit if all 3 dims < 0.4) | Asymmetric coverage ("mood was variable but anxiety constant 4") is a worse observation than no wellbeing mention | |
| SQL window functions for variance | Portability + simplicity argues for JS computation on fetched rows | |
| Defer WEEK-09 to v2.5 | Explicit WEEK-09 requirement in M009 scope; cannot defer | |

**Auto-selected:** "Per-dim stddev in JS; ANY dim < 0.4 → omit".
**Rationale:** WEEK-09 explicit threshold 0.4; ANY-dim-flat is more conservative + avoids unfocused observations.

**Insufficient-data threshold:** `<4` snapshots in 7-day window → omit wellbeing block (statistically meaningless stddev with fewer points).

---

## Pensieve persistence shape

| Option | Description | Selected |
|--------|-------------|----------|
| `epistemic_tag = 'RITUAL_RESPONSE'` + `metadata.kind = 'weekly_review'` + tag override | WEEK-08 explicit; D035 boundary holds (commentary, not summary text) | ✓ |
| Persist into `episodic_summaries` directly | D035 boundary violation (Pensieve authoritative) | |
| `ritual_responses.metadata.observationText` ONLY (no Pensieve) | WEEK-08 explicit "persists to Pensieve as RITUAL_RESPONSE" | |
| Skip embedding | Longitudinal INTERROGATE recall ("show me past weekly observations") is the documented use case | |

**Auto-selected:** "RITUAL_RESPONSE + metadata.kind = 'weekly_review' + tag override".
**Rationale:** WEEK-08 explicit; D035 boundary holds; longitudinal recall is the documented use case.

**Cross-phase coordination:** `storePensieveEntry` extension to accept explicit `epistemic_tag` parameter coordinates with Phase 26's voice-note needs (HARD CO-LOC #1). Whichever ships first defines the API; the other reuses.

---

## Dispatcher mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| `dispatchRitualHandler` switches on `ritual.name` | name is UNIQUE per RIT-01; natural key for handler dispatch; Phase 26 + 27 each own one branch | ✓ |
| Switch on `ritual.type` (cadence enum) | Cadence is shared across many possible rituals (M013 may add multiple weeklies) | |
| Subclass-based dispatch | Over-engineering for 3 handlers | |
| Map-based dispatch | Switch is conventional for static enumeration | |

**Auto-selected:** "Switch on `ritual.name`".
**Rationale:** name is the natural unique key; type is shared across rituals at the same cadence.

---

## Migration ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Per-phase migration files: 0007 (Ph26), 0008 (Ph27), 0009 (Ph29) | Per-phase ownership boundary preserved; INSERT-only so no schema conflict | ✓ |
| Single combined seed migration | Bundles 3 independent phase responsibilities into one migration file | |
| Application-startup seed (vs migration) | RIT-01: rituals table is source of truth from migration time, not app boot | |
| Hardcoded next_run_at | Stale after migration sits unmerged for days | |

**Auto-selected:** "Per-phase migration files; Phase 29 = 0009".
**Rationale:** Per-phase ownership preserved. Merge-coordination cost accepted.

**`next_run_at` SQL expression:** `date_trunc('week', now() AT TIME ZONE 'Europe/Paris') + interval '6 days 20 hours'` (Monday→Sunday 20:00). Same-day-after-fire CASE handled by planner.

---

## Live anti-flattery test scaffolding split (HARD CO-LOC #6)

| Option | Description | Selected |
|--------|-------------|----------|
| Plan 29-04 ships test FILE with `skipIf(!ANTHROPIC_API_KEY)` + `// PHASE-30: enable in TEST-31` | HARD CO-LOC #6 honored: file with implementation, gate flipped in Phase 30 | ✓ |
| Phase 30 owns entire test file | Pitfall 26 documented failure mode "ships without the test" | |
| Phase 29 enables live gate (no skipIf) | Phase 29 should not depend on a live Anthropic call to land | |

**Auto-selected:** "Plan 29-04 ships scaffolding; Phase 30 flips gate".
**Rationale:** HARD CO-LOC #6 explicitly: live execution = Phase 30 plan, but the test FILE must EXIST in Phase 29's commit so Phase 30 only flips a gate (otherwise impl ships without test).

**17 forbidden-marker list:** Combined `live-integration.test.ts VALIDATION_MARKERS` + `praise-quarantine.ts REFLEXIVE_OPENER_FIRST_WORDS` + `CONSTITUTIONAL_PREAMBLE` Three Forbidden Behaviors. Plan 29-04 imports or copies. v2.5 cleanup folds into shared module.

---

## Claude's Discretion

- Exact file names within `src/rituals/`: `weekly-review.ts` vs split `weekly-review-prompt.ts`
- Exact log-event names: `chris.weekly-review.fallback-fired`, `chris.weekly-review.date-grounding.rejected`, etc. — planner aligns with prevailing prefix in `src/rituals/` (`rituals.weekly.*` vs `chris.weekly-review.*`)
- FR + RU templated fallback exact text (planner provides per `franc` localization pattern; English baseline is `"What stood out to you about this week?"`)
- Exact Zod schema bounds for `WeeklyReviewSchema` (planner picks min/max per spec intent + M008 precedent)
- Adversarial-week fixture content (planner reads M008 `live-anti-flattery.test.ts` 2026-02-14 fixture for precedent + adapts to weekly-review shape)
- Exact `fire_dow` value (1=Mon..7=Sun convention OR 0=Sun..6=Sat — planner reads `src/rituals/types.ts:47` `RitualConfigSchema.fire_dow` constraint to confirm)
- Exact `next_run_at` SQL expression handling for same-Sunday-after-fire case (planner picks CASE expression)

## Deferred Ideas

- DIFF-2 wellbeing trajectory in observation (defer to v2.5 once variance signal is real-data-validated)
- DIFF-3 question-style taxonomy (defer to v2.5 once enough weekly reviews exist)
- DIFF-5 forecast-resolved-this-week observation style (defer to v2.5)
- Single-composite wellbeing alternative (defer to v2.5 if 3-tap proves too high)
- Embedded-question detection in Stage-1 (Stage-2 Haiku catches genuine compounds; v2.5 if false rejects prove common)
- EN/FR/RU Stage-1 union regex evolution (more leading words, accent-tolerant matching, additional languages)
- Operator-tunable wellbeing variance threshold (0.4 hardcoded; future v2.5 config option)
- Backfill weekly observations for past weeks (scripts/backfill-weekly-review.ts; defer until M010+ profile inference needs them)
