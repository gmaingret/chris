# Phase 29: Weekly Review — Research

**Researched:** 2026-04-26
**Domain:** Sunday 20:00 Europe/Paris weekly review with Sonnet observation generation, two-stage single-question enforcement (Zod refine + Haiku judge), explicit CONSTITUTIONAL_PREAMBLE injection, date-grounding post-check, wellbeing variance gate, Pensieve persistence as RITUAL_RESPONSE
**Confidence:** HIGH — every recommendation either grounded in existing v2.0–v2.3 code (verified by direct file inspection) or in the milestone-level research synthesis (research/SUMMARY.md + PITFALLS.md sections 14-18 + 26).
**Mode:** `--auto` follow-up to `/gsd-discuss-phase --auto` (CONTEXT.md decisions D-01..D-10 are LOCKED)

---

## Summary

Phase 29 ships the **first Sonnet-driven ritual** in M009 — Sunday 20:00 Paris weekly review. Four plans across 9 requirements, no new dependencies, zero version bumps. The atomic plan (HARD CO-LOC #2 + #3) lands the observation generator + two-stage single-question enforcement (Zod refine + Haiku judge) + CONSTITUTIONAL_PREAMBLE explicit injection + date-grounding post-check + Pensieve persistence as `RITUAL_RESPONSE`. The substrate plan delivers the pure prompt assembler + data fetch helpers (first consumer of M008's `getEpisodicSummariesRange`). The wire-up plan delivers the seed migration `0009_weekly_review_seed.sql` + `dispatchRitualHandler` switch case. The live-test scaffolding plan delivers `live-weekly-review.test.ts` skeleton (gated `skipIf(!process.env.ANTHROPIC_API_KEY)`) — Phase 30 flips the gate per HARD CO-LOC #6.

**Primary recommendation:** Plan 29-02 must include the Sonnet generator + Stage-1 Zod refine + Stage-2 Haiku judge + CONSTITUTIONAL_PREAMBLE injection (via assembleWeeklyReviewPrompt from Plan 29-01) + date-grounding post-check + retry cap = 2 + templated fallback + Pensieve persistence in ONE atomic plan. Splitting any of these triggers Pitfall 14 (Sonnet ships unconstrained → compound questions on first weekly review) OR Pitfall 17 (sycophantic flattery on first weekly review). Plan 29-04 ships the live-test FILE alongside the implementation it tests, with the live execution gate in Phase 30 per HARD CO-LOC #6.

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** **4 plans** for Phase 29:
- **Plan 29-01 (Substrate: data fetch + pure prompt assembler):** `loadWeeklyReviewContext(weekStart, weekEnd)` (range-fetch + variance computation) + `assembleWeeklyReviewPrompt(input)` pure function (CONSTITUTIONAL_PREAMBLE injection, mirrors `src/episodic/prompts.ts`). **Requirements: WEEK-01 (range fetch side), WEEK-02 (preamble injection), WEEK-04 (boundary marker constant), WEEK-09 (variance gate).**
- **Plan 29-02 (Generator + enforcement + persistence — HARD CO-LOC #2 + #3 ATOMIC):** `generateWeeklyObservation(input)` + Stage-1 Zod refine + Stage-2 Haiku judge + date-grounding post-check + retry cap = 2 + templated fallback + `fireWeeklyReview(ritual)` orchestrator + Pensieve persist as `RITUAL_RESPONSE`. **Requirements: WEEK-02 (preamble used at SDK boundary), WEEK-03, WEEK-04 (header rendering), WEEK-05, WEEK-06, WEEK-07, WEEK-08.**
- **Plan 29-03 (Wire-up: dispatcher + seed migration):** `0009_weekly_review_seed.sql` + drizzle meta-snapshot regen + `scripts/test.sh` psql line + `dispatchRitualHandler` switch case for `'weekly_review'`. **Requirements: WEEK-01 (fire-side: cron-driven dispatch + seed row).**
- **Plan 29-04 (Live anti-flattery scaffolding — HARD CO-LOC #6 prep):** `src/rituals/__tests__/live-weekly-review.test.ts` skeleton with `skipIf(!process.env.ANTHROPIC_API_KEY)` + adversarial-week fixture content + 17 forbidden-marker scan + 3-of-3 atomic loop. **Requirements: zero new (TEST-31 owned by Phase 30).**

**D-02:** **Mirror M008 CONS-04 pattern** for CONSTITUTIONAL_PREAMBLE injection. `assembleWeeklyReviewPrompt(input)` is a pure function importing `CONSTITUTIONAL_PREAMBLE` from `../chris/personality.js`; section 1 of the assembled string. NO `buildSystemPrompt` mode-handler indirection.

**D-03:** **Stage-1 = Zod `.refine()` on `question` field with TWO checks, both must pass:**
- (a) `(question.match(/\?/g) ?? []).length === 1`
- (b) interrogative-leading-word count ≤ 1 across union EN/FR/RU regex
- EN regex: `\b(what|why|how|when|where|which|who)\b` (case-insensitive)
- FR regex: `\b(qu['e]?est-ce que|qu['e]?est-ce qui|comment|pourquoi|quoi|quand|où|quel|quelle|quels|quelles|qui)\b` (case-insensitive)
- RU regex: `\b(почему|что|как|когда|где|кто|какой|какая|какое|какие|зачем)\b` (case-insensitive)

**D-04:** **Stage-2 = Haiku judge with `{ question_count: number, questions: string[] }` structured output** via `anthropic.messages.parse` + `zodOutputFormat`. Invoked only if Stage-1 passes. Reject if `question_count > 1`. Total retry cap = 2 (initial + 2 = 3 max LLM call cycles); after cap, fall back to templated single-question observation `"What stood out to you about this week?"` (English baseline) with `chris.weekly-review.fallback-fired` log line. Mirrors M008 CONS error policy.

**D-05:** **Date-grounding post-check via Haiku** AFTER successful single-question enforcement. Reject + retry (counts against same cap = 2) if `references_outside_window: true`. Haiku schema: `{ references_outside_window: boolean, dates_referenced: string[] }`.

**D-06:** **Per-dim stddev computed in JS over the 7-day window; ANY dim < 0.4 → omit wellbeing block at PROMPT-ASSEMBLY time.** Insufficient-data threshold = `<4` snapshots → omit. Wellbeing block content = minimal (just the 7-day series; DIFF-2 trajectory analysis deferred to v2.5).

**D-07:** **Pensieve persistence: `epistemic_tag = 'RITUAL_RESPONSE'` + `metadata = { kind: 'weekly_review', week_start, week_end, source_subtype: 'weekly_observation' }`.** Tag override at `storePensieveEntry` boundary (NOT through Haiku auto-tagger). Cross-phase coordination with Phase 26 voice-note needs (whichever ships first defines the API extension).

**D-08:** **`dispatchRitualHandler` switches on `ritual.name`** (NOT on `ritual.type`). Phase 29 adds `case 'weekly_review':` branch. Seed migration sets `name = 'weekly_review'`, `type = 'weekly'`.

**D-09:** **Per-phase migration files: 0007 = Phase 26, 0008 = Phase 27, 0009 = Phase 29.** Append-only, INSERT-only seed migrations (no schema conflicts). Merge-coordination cost accepted. `next_run_at` SQL: `date_trunc('week', now() AT TIME ZONE 'Europe/Paris') + interval '6 days 20 hours'` (Monday→Sunday 20:00) with same-day-after-fire CASE.

**D-10:** **Plan 29-04 ships test FILE with `skipIf(!process.env.ANTHROPIC_API_KEY)` + `// PHASE-30: enable in TEST-31` marker.** Phase 30 flips gate + adds to excluded-suite list. 17 forbidden-marker list combined from M006 conventions: `live-integration.test.ts VALIDATION_MARKERS` + `praise-quarantine.ts REFLEXIVE_OPENER_FIRST_WORDS` + `CONSTITUTIONAL_PREAMBLE` Three Forbidden Behaviors.

### Claude's Discretion

- File names within `src/rituals/` (`weekly-review.ts` vs split `weekly-review-prompt.ts` — recommend split per M008 precedent)
- Log-event naming convention prefix (`rituals.weekly.*` vs `chris.weekly-review.*`)
- FR + RU templated fallback exact text
- Exact Zod schema bounds for `WeeklyReviewSchema` (recommend `observation: string.min(20).max(800)`, `question: string.min(5).max(300)`)
- Adversarial-week fixture content (mirror M008 `live-anti-flattery.test.ts` 2026-02-14 fixture shape)
- Exact `fire_dow` value (read `src/rituals/types.ts:47` for convention; if 1=Mon..7=Sun, use `7` for Sunday)
- `next_run_at` SQL CASE expression for same-Sunday-after-fire edge case

### Deferred Ideas (OUT OF SCOPE)

- DIFF-2 wellbeing trajectory in observation (defer v2.5)
- DIFF-3 question-style taxonomy (defer v2.5)
- DIFF-5 forecast-resolved-this-week observation style (defer v2.5)
- Embedded-question detection in Stage-1 (Stage-2 Haiku catches; v2.5 if false rejects common)
- Operator-tunable wellbeing variance threshold (0.4 hardcoded; v2.5 config option)
- FR/RU templated fallbacks at-launch (English baseline ships first; localization landed by Plan 29-02 if `franc` integration is ready, else v2.5)
- Backfill weekly observations script (defer until M010+ profile inference needs)

</user_constraints>

---

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WEEK-01 | Sunday 20:00 Europe/Paris fire; configurable via `rituals.config.fire_at` + `fire_dow`. Reads via `getEpisodicSummariesRange(weekStart, weekEnd)` (M008 first consumer) + `decisions WHERE resolved_at BETWEEN weekStart AND weekEnd` | §1 (Fire substrate: cron tick already exists from Phase 25 RIT-11; Phase 29 just provides the dispatcher + seed row). §2 (Range fetch via `src/episodic/sources.ts:390`). §3 (Decision query via `src/decisions/index.ts` barrel). |
| WEEK-02 | `assembleWeeklyReviewPrompt()` injects `CONSTITUTIONAL_PREAMBLE` explicitly (CONS-04 / D038 pattern); system prompt explicitly states the date window | §4 (Pure prompt assembler mirroring `src/episodic/prompts.ts:115-163`). §4.1 (CONSTITUTIONAL_PREAMBLE explicit import + section 1 of returned string). |
| WEEK-03 | Sonnet structured output `{ observation, question }` via `messages.parse` + `zodOutputFormat`; strict 7-day window; date-grounding post-check rejects out-of-window observations | §5 (Sonnet generation shape; v3/v4 dual Zod schema mirrors `src/episodic/consolidate.ts:33-81`). §5.1 (Date-grounding Haiku post-check). |
| WEEK-04 | D031 boundary marker on user-facing message header — `Observation (interpretation, not fact):` | §6 (Header rendering: prepend exact string before observation prose; mirrors INTERROGATE pattern). |
| WEEK-05 | **Two-stage single-question enforcement.** Stage 1: Zod refine (`?` count + interrogative-leading-word per EN/FR/RU). Stage 2: Haiku judge with structured output `{ question_count, questions[] }`. Stage 2 invoked only if Stage 1 passes | §7 (Stage-1 Zod `.refine()` shape with both checks). §7.1 (Stage-2 Haiku judge call shape). §7.2 (Sequential pipeline: Stage-1 → Stage-2 → date-grounding). |
| WEEK-06 | Retry cap = 2 on Stage-1 OR Stage-2 OR date-grounding rejection. After cap: templated single-question fallback. Logged as `chris.weekly-review.fallback-fired` | §8 (Retry loop with explicit counter; mirrors `callSonnetWithRetry` from `src/episodic/consolidate.ts:129-183`). §8.1 (Templated fallback hardcoded English baseline). |
| WEEK-07 | Pattern-only observations — explicit prompt instruction NOT to re-surface individual decisions; DIFF-5 deferred to v2.5 | §9 (Prompt-level pattern-only directive in `assembleWeeklyReviewPrompt`). |
| WEEK-08 | Weekly review observation persists to Pensieve as `epistemic_tag = RITUAL_RESPONSE` with `metadata.kind = 'weekly_review'` | §10 (Pensieve write at end of `fireWeeklyReview`; tag override at `storePensieveEntry` boundary; metadata schema). |
| WEEK-09 | Wellbeing variance check: if any dimension's stddev < 0.4 over 7-day window, observation does NOT cite wellbeing | §11 (Stddev computation in JS; conditional wellbeing block in `assembleWeeklyReviewPrompt`; insufficient-data threshold). |

</phase_requirements>

---

## §1 — Cron tick + dispatch substrate (carry-out from Phase 25)

Phase 25 shipped:
- `src/index.ts` registers second cron tick at 21:00 Europe/Paris via `registerCrons(deps)` helper (RIT-11)
- `src/rituals/scheduler.ts:runRitualSweep()` fetches due rituals via `WHERE enabled = true AND next_run_at <= now()` LIMIT 1
- `src/rituals/scheduler.ts:dispatchRitualHandler(ritual)` SKELETON throws for every type — Phase 29 fills the `'weekly_review'` case

**Critical observation:** The Phase 25 cron tick at 21:00 Paris fires the existing 21:00 cron handler (`runRitualSweep`). The 20:00 weekly review fire time is enforced by `next_run_at` (set in the seed migration to next Sunday 20:00 Paris), NOT by an additional cron tick. The 21:00 cron tick at 21:00 Paris runs `runRitualSweep` which queries `WHERE next_run_at <= now()`. On a Sunday at 21:00 Paris, the weekly review (next_run_at = 20:00 Paris) is past-due → fires.

**Why this works:** The 20:00→21:00 gap means the weekly review fires at most 1 hour late. This is acceptable for a weekly cadence (no real user-experience cost). If 20:00 sharp is required, a third cron tick at 20:00 could be added — DEFERRED, not Phase 29 scope.

**Plan 29-03 wires:** `dispatchRitualHandler` switch case `case 'weekly_review': return fireWeeklyReview(ritual);`. One added import (`fireWeeklyReview` from `./weekly-review.js`). One added case label.

## §2 — Range fetch via `getEpisodicSummariesRange` (M008 first consumer)

`src/episodic/sources.ts:390` exports `getEpisodicSummariesRange(from: Date, to: Date): Promise<EpisodicSummary[]>` — never throws, returns empty array on error. Phase 29 is its first production consumer per ARCHITECTURE.md "M009 weekly review will pick it up" line.

**Week boundary computation (Plan 29-01):**
```typescript
import { DateTime } from 'luxon';
import { config } from '../config.js';

function computeWeekBoundary(now: Date): { weekStart: Date; weekEnd: Date } {
  const nowLocal = DateTime.fromJSDate(now, { zone: config.proactiveTimezone });
  const weekStart = nowLocal.minus({ days: 7 }).startOf('day').toJSDate();
  const weekEnd = nowLocal.endOf('day').toJSDate();
  return { weekStart, weekEnd };
}
```

This produces a 7-day rolling window ending at `now` (the Sunday fire time). The window is INCLUSIVE on both bounds (mirrors `getEpisodicSummariesRange` semantics).

**Why Luxon over Date:** DST-safe, IANA-tz-aware. Phase 25 `src/rituals/cadence.ts` is the canonical pattern (computeNextRunAt uses Luxon for the same reason). Mirrors `src/episodic/sources.ts:dayBoundaryUtc` at lines 60-83.

## §3 — Decision query via `src/decisions/index.ts` barrel

M007's `decisions` table is queryable via the barrel. Phase 29 issues a direct Drizzle query (no helper needed in the barrel — the query is one-shot for weekly review):

```typescript
import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { decisions } from '../db/schema.js';

const resolvedDecisions = await db
  .select()
  .from(decisions)
  .where(
    and(
      eq(decisions.status, 'resolved'),
      gte(decisions.resolvedAt, weekStart),
      lte(decisions.resolvedAt, weekEnd),
    ),
  );
```

**Why direct query, not via barrel:** Adding `getResolvedDecisionsBetween(start, end)` to `src/decisions/index.ts` is a 5-line addition that future M010+ consumers might want. Planner discretion — if Plan 29-01 finds 2+ consumers in the codebase already, refactor into the barrel; otherwise inline.

## §4 — Pure prompt assembler (mirrors `src/episodic/prompts.ts`)

**Module location:** `src/rituals/weekly-review-prompt.ts` (planner discretion: split from `weekly-review.ts` if line count exceeds ~150 — M008 precedent at 312 lines).

**Function signature:**
```typescript
export type WeeklyReviewPromptInput = {
  weekStart: string; // ISO 'YYYY-MM-DD'
  weekEnd: string;   // ISO 'YYYY-MM-DD'
  tz: string;        // IANA tz (e.g., 'Europe/Paris')
  summaries: Array<{
    summaryDate: string;
    summary: string;
    importance: number;
    topics: string[];
    emotionalArc: string;
    keyQuotes: string[];
  }>;
  resolvedDecisions: Array<{
    decisionText: string;
    reasoning: string;
    prediction: string;
    falsificationCriterion: string;
    resolution: string;
    resolutionNotes: string | null;
  }>;
  includeWellbeing: boolean;
  wellbeingSnapshots?: Array<{
    snapshotDate: string;
    energy: number;
    mood: number;
    anxiety: number;
  }>;
  language: 'en' | 'fr' | 'ru';
};

export function assembleWeeklyReviewPrompt(input: WeeklyReviewPromptInput): string;
```

### §4.1 — Section composition (8 ordered sections)

1. **Constitutional preamble** (CONS-04 + Pitfall 17 mitigation) — `sections.push(CONSTITUTIONAL_PREAMBLE.trimEnd());`
2. **Role preamble** — `## Your Task` + anti-flattery text specific to weekly review (mirror `src/episodic/prompts.ts:167-172`'s `buildRolePreamble` shape but specialize for "Sonnet generates ONE observation + ONE Socratic question for Greg's past week")
3. **Date-window block** (Pitfall 16 mitigation) — explicit `The current week is ${weekStart} to ${weekEnd}. Only generate observations about events within this window. If you reference an event, the date must fall within this window.`
4. **Pattern-only directive** (WEEK-07) — `Generate observations about PATTERNS across the week, NOT individual decisions. Individual decision resolution is surfaced via M007 ACCOUNTABILITY mode separately. Your observation should aggregate or synthesize across multiple summaries/decisions; do NOT focus on a single decision or single day.`
5. **Wellbeing block** (conditional on `input.includeWellbeing`) — render the 7-day wellbeing series; DIFF-2 trajectory analysis deferred (no analysis directive in Phase 29).
6. **Summaries block** — render each `summaries[i]` as `## Summary ${date} (importance ${i.importance})\n${i.summary}\nTopics: ${i.topics.join(', ')}\nEmotional arc: ${i.emotionalArc}\n` etc.
7. **Resolved decisions block** (conditional on `resolvedDecisions.length > 0`) — render each as `## Decision (resolved ${date})\n${i.decisionText}\nResolution: ${i.resolution}\n` (NO individual surfacing — the prompt instructs Sonnet to AGGREGATE across these, not re-surface).
8. **Structured-output directive** — explicit instruction: `Output JSON: { observation: string, question: string }. The observation is one prose paragraph. The question is exactly ONE Socratic question demanding a verdict — not "how do you feel?", but a question that forces Greg to evaluate or commit. Do NOT include compound questions joined by "and"/"or"/"and also". Do NOT ask multiple questions. Do NOT include a question in your observation — the observation is a statement; the question is separate.`

### §4.2 — Boundary marker constant

`src/rituals/weekly-review.ts` exports the D031 boundary marker as a named constant:
```typescript
export const WEEKLY_REVIEW_HEADER = 'Observation (interpretation, not fact):';
```
Used by `fireWeeklyReview` to prepend before sending the Sonnet output to Telegram. NOT used in the prompt itself (the prompt asks Sonnet for `observation` and `question` separately; the header is rendering-time).

## §5 — Sonnet structured output via `messages.parse` + `zodOutputFormat`

**v3 schema (contract surface):**
```typescript
import { z } from 'zod';
export const WeeklyReviewSchema = z.object({
  observation: z.string().min(20).max(800),
  question: z.string().min(5).max(300)
    .refine(stage1Check, { message: 'must be a single question per Stage-1 enforcement' }),
});
```

**v4 schema (SDK boundary mirror):**
```typescript
import * as zV4 from 'zod/v4';
const WeeklyReviewSchemaV4 = zV4.object({
  observation: zV4.string().min(20).max(800),
  question: zV4.string().min(5).max(300),
  // Stage-1 refine NOT included on v4 schema — SDK doesn't surface refine errors
  // back as actionable retry signals; we re-validate via v3 in the retry loop.
});
```

**Stage-1 refine implementation (D-03):**
```typescript
const INTERROGATIVE_REGEX = /\b(what|why|how|when|where|which|who|qu['e]?est-ce que|qu['e]?est-ce qui|comment|pourquoi|quoi|quand|où|quel|quelle|quels|quelles|qui|почему|что|как|когда|где|кто|какой|какая|какое|какие|зачем)\b/giu;

function stage1Check(question: string): boolean {
  const questionMarks = (question.match(/\?/g) ?? []).length;
  if (questionMarks !== 1) return false;
  const interrogativeMatches = (question.match(INTERROGATIVE_REGEX) ?? []).length;
  return interrogativeMatches <= 1;
}
```

**Sonnet call (mirrors `src/episodic/consolidate.ts:callSonnetWithRetry`):**
```typescript
const response = await anthropic.messages.parse({
  model: SONNET_MODEL,
  max_tokens: 800,
  system: [{ type: 'text', text: assembledPrompt, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: 'Generate the weekly review observation for this week.' }],
  output_config: {
    format: zodOutputFormat(WeeklyReviewSchemaV4 as unknown as any),
  },
});
const parsed = WeeklyReviewSchema.parse(response.parsed_output);
// ↑ v3 re-validation runs Stage-1 refine; throws ZodError on multi-question
```

### §5.1 — Date-grounding post-check (D-05)

After Stage-1 + Stage-2 pass, run:
```typescript
async function runDateGroundingCheck(
  observationText: string, weekStart: string, weekEnd: string,
): Promise<{ inWindow: boolean; datesReferenced: string[] }> {
  const judgePrompt = `You are a date-window auditor. Below is an observation about Greg's past week. The allowed date window is ${weekStart} to ${weekEnd} (inclusive). Identify any dates referenced in the observation, and report whether ANY of them fall outside the window. Output JSON: { references_outside_window: boolean, dates_referenced: string[] }.`;
  const response = await anthropic.messages.parse({
    model: HAIKU_MODEL,
    max_tokens: 200,
    system: [{ type: 'text', text: judgePrompt }],
    messages: [{ role: 'user', content: observationText }],
    output_config: { format: zodOutputFormat(DateGroundingSchemaV4 as unknown as any) },
  });
  const parsed = DateGroundingSchema.parse(response.parsed_output);
  return { inWindow: !parsed.references_outside_window, datesReferenced: parsed.dates_referenced };
}
```

## §6 — D031 header rendering at Telegram-send time

**Implementation in `fireWeeklyReview` (Plan 29-02):**
```typescript
const userFacingMessage = `${WEEKLY_REVIEW_HEADER}\n\n${observation}\n\n${question}`;
await bot.api.sendMessage(config.telegramAuthorizedUserId, userFacingMessage);
```

**Why header is rendering-time (not prompt-time):** The prompt asks Sonnet for structured `{observation, question}`; the header is a UX-layer constant that frames Sonnet's output. Mixing the header into the prompt would require Sonnet to render it correctly — extra failure mode. Render-time injection is robust.

## §7 — Two-stage single-question enforcement (D-03 + D-04)

**Pipeline (Plan 29-02):**
```
1. Sonnet generates structured output via messages.parse
2. v3 schema re-validation runs Stage-1 refine → throws ZodError on fail
3. If Stage-1 passes, run Stage-2 Haiku judge call
4. If Stage-2 passes (question_count === 1), run date-grounding post-check
5. If date-grounding passes, persist + send
6. If ANY of (1)-(4) throws or rejects, retry (cap = 2) → fallback
```

### §7.1 — Stage-2 Haiku judge schema + call

```typescript
import { z } from 'zod';
const StageTwoJudgeSchema = z.object({
  question_count: z.number().int().min(0).max(10),
  questions: z.array(z.string()).max(10),
});

async function runStage2HaikuJudge(question: string): Promise<{ count: number; questions: string[] }> {
  const judgePrompt = `You are a question counter. Given the text below, count how many distinct questions are being asked of the reader. A compound question joined by 'and' or 'or' counts as multiple questions. An embedded question (quoted from someone else's mouth) counts as 1, but the question being directly asked at the end counts separately. Output JSON: { question_count: number, questions: string[] }.`;
  const response = await anthropic.messages.parse({
    model: HAIKU_MODEL,
    max_tokens: 150,
    system: [{ type: 'text', text: judgePrompt }],
    messages: [{ role: 'user', content: question }],
    output_config: { format: zodOutputFormat(StageTwoJudgeSchemaV4 as unknown as any) },
  });
  const parsed = StageTwoJudgeSchema.parse(response.parsed_output);
  return { count: parsed.question_count, questions: parsed.questions };
}
```

### §7.2 — Sequential pipeline ordering rationale

Stage-1 (cheap regex) before Stage-2 (Haiku call ~$0.0003) before date-grounding (Haiku call ~$0.0003). Order minimizes LLM cost on the most common rejection path (Stage-1 catches ~70% of multi-question outputs per Pitfall 14 estimates).

## §8 — Retry cap + templated fallback (D-04)

```typescript
async function generateWeeklyObservation(
  input: WeeklyReviewPromptInput,
): Promise<{ observation: string; question: string; isFallback: boolean }> {
  const MAX_RETRIES = 2;
  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    try {
      // 1. Sonnet call (re-validate via v3 schema with Stage-1 refine)
      const sonnetOut = await callSonnetForWeekly(input);
      // 2. Stage-2 Haiku judge
      const stage2 = await runStage2HaikuJudge(sonnetOut.question);
      if (stage2.count > 1) throw new MultiQuestionError(stage2);
      // 3. Date-grounding post-check
      const dateCheck = await runDateGroundingCheck(sonnetOut.observation, input.weekStart, input.weekEnd);
      if (!dateCheck.inWindow) throw new DateOutOfWindowError(dateCheck);
      // PASS
      return { ...sonnetOut, isFallback: false };
    } catch (err) {
      attempt++;
      logger.warn({ err: err instanceof Error ? err.message : String(err), attempt }, 'rituals.weekly.regen.retry');
      if (attempt > MAX_RETRIES) {
        logger.warn({ err }, 'chris.weekly-review.fallback-fired');
        return {
          observation: 'Reflecting on this week.',
          question: 'What stood out to you about this week?',
          isFallback: true,
        };
      }
    }
  }
  // unreachable, but for TS exhaustiveness
  throw new Error('unreachable');
}
```

### §8.1 — Templated fallback exact text

- **English** (default): `"What stood out to you about this week?"` (Pitfall 14 explicit example)
- **French** (planner discretion if Phase 26 `franc` integration shipped first): `"Qu'est-ce qui t'a marqué cette semaine ?"`
- **Russian** (planner discretion): `"Что вам запомнилось на этой неделе?"`

Default to English if `franc` detection unavailable. Templated fallback observation: short bridge sentence (`"Reflecting on this week."` in English; FR/RU equivalents).

## §9 — Pattern-only observations (WEEK-07)

Enforced at PROMPT-LEVEL (section 4 of `assembleWeeklyReviewPrompt` — see §4.1). The prompt explicitly instructs Sonnet:
```
Generate observations about PATTERNS across the week, NOT individual decisions. Individual decision resolution is surfaced via M007 ACCOUNTABILITY mode separately. Your observation should aggregate or synthesize across multiple summaries/decisions; do NOT focus on a single decision or single day.
```

**No runtime enforcement** beyond the prompt. The risk of Sonnet violating this is bounded — the live anti-flattery test (Plan 29-04 + Phase 30) catches gross violations. DIFF-5 (forecast-resolved-this-week observation style) is the deferred future-work that would require structural enforcement.

## §10 — Pensieve persistence (WEEK-08)

**Mechanism (Plan 29-02):**
```typescript
import { storePensieveEntry } from '../pensieve/store.js';

await storePensieveEntry(
  observationText,
  'telegram',
  {
    epistemic_tag: 'RITUAL_RESPONSE',  // Tag override (bypass Haiku auto-tagger)
    ritual_response_id: ritualResponseRowId,
    kind: 'weekly_review',
    week_start: weekStartIso,
    week_end: weekEndIso,
    source_subtype: 'weekly_observation',
  },
);
```

**Cross-phase coordination:** `storePensieveEntry` extension to accept explicit `epistemic_tag` parameter is the SAME extension Phase 26 voice-note needs (HARD CO-LOC #1). Whichever phase's plan ships the extension first, the other phase reuses. Plan 29-02 documents this in the plan SUMMARY.md "Cross-phase coordination" section. Plan 29-02's executor must check git log for Phase 26's commit BEFORE making the extension; if Phase 26 already shipped, reuse; otherwise ship the extension here.

**Embedding:** Fire-and-forget `embedAndStore` per D005 existing Pensieve pattern. ~50 chars per embed call; negligible cost.

## §11 — Wellbeing variance gate (D-06 + WEEK-09)

**Computation (Plan 29-01):**
```typescript
function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function computeWellbeingVariance(snapshots: WellbeingSnapshot[]) {
  return {
    energy: computeStdDev(snapshots.map((s) => s.energy)),
    mood: computeStdDev(snapshots.map((s) => s.mood)),
    anxiety: computeStdDev(snapshots.map((s) => s.anxiety)),
  };
}

const VARIANCE_THRESHOLD = 0.4;
const INSUFFICIENT_DATA_THRESHOLD = 4;

function shouldIncludeWellbeing(snapshots: WellbeingSnapshot[]): boolean {
  if (snapshots.length < INSUFFICIENT_DATA_THRESHOLD) {
    logger.info({ count: snapshots.length }, 'chris.weekly-review.wellbeing.insufficient-data');
    return false;
  }
  const v = computeWellbeingVariance(snapshots);
  return v.energy >= VARIANCE_THRESHOLD && v.mood >= VARIANCE_THRESHOLD && v.anxiety >= VARIANCE_THRESHOLD;
}
```

**Gate enforced at prompt-assembly time:** Sonnet never sees wellbeing data when `shouldIncludeWellbeing` returns `false` → cannot cite it. This is more robust than a post-hoc Haiku check (which we don't have) or trusting Sonnet to honor a "do not mention wellbeing" instruction (which is brittle).

---

## §12 — Test infrastructure

**New test files:**
- `src/rituals/__tests__/weekly-review-prompt.test.ts` — unit (Plan 29-01): assemble prompt with various input shapes (full, no-wellbeing, no-decisions, sparse), assert sections present + CONSTITUTIONAL_PREAMBLE first
- `src/rituals/__tests__/weekly-review.test.ts` — integration (Plan 29-02): mocked Sonnet returning known structured output, assert Stage-1 + Stage-2 + date-grounding pipeline behavior + Pensieve write
- `src/rituals/__tests__/weekly-review-sources.test.ts` — integration (Plan 29-01): real Docker postgres, fixture data, assert range fetch + variance computation
- `src/rituals/__tests__/live-weekly-review.test.ts` — live (Plan 29-04, gated `skipIf`): adversarial-week fixture, 3-of-3 atomic, 17 forbidden-marker scan

**Test types per requirement:**
- WEEK-01 (range fetch + dispatch): unit (mocked DB) for assembleWeeklyReviewPrompt; integration (real DB) for `loadWeeklyReviewContext`; unit (mocked scheduler) for dispatch case
- WEEK-02 (CONSTITUTIONAL_PREAMBLE): unit grep (`assembleWeeklyReviewPrompt(input)` output starts with `'## Core Principles (Always Active)'`); boundary-audit grep (`grep -L 'CONSTITUTIONAL_PREAMBLE' src/rituals/weekly-review-prompt.ts` returns zero hits)
- WEEK-03 (Sonnet structured output): unit with mocked anthropic SDK; assert call shape + parsed output handling
- WEEK-04 (D031 header): unit (`fireWeeklyReview` mocked Sonnet returning `{observation: 'X', question: 'Y'}` → assert sendMessage called with `'Observation (interpretation, not fact):\n\nX\n\nY'`)
- WEEK-05 (two-stage enforcement): unit (mocked Stage-1 fail → retry; mocked Stage-1 pass + Stage-2 fail → retry; both pass → proceed)
- WEEK-06 (retry cap + fallback): unit (mocked enforce-fail thrice → assert fallback observation + `chris.weekly-review.fallback-fired` log)
- WEEK-07 (pattern-only): manual review of prompt assembler output; unit grep (`assembleWeeklyReviewPrompt` output contains `'PATTERNS across the week'`)
- WEEK-08 (Pensieve persist): integration (real DB) — after `fireWeeklyReview()`, `SELECT * FROM pensieve_entries WHERE metadata->>'kind' = 'weekly_review'` returns exactly 1 row with `epistemic_tag = 'RITUAL_RESPONSE'`
- WEEK-09 (variance gate): unit (mocked snapshots: stddev computation; high-variance → include; low-variance any-dim → omit; <4 snapshots → omit)

**Live test (Plan 29-04, gated, executed in Phase 30):**
- 3-of-3 atomic against real Sonnet
- Adversarial fixture week (rich emotional content baited for flattery)
- 17 forbidden-marker scan (sourced from M006 conventions)
- Asserts ZERO markers across all 3 iterations

**Excluded-suite implication:** Phase 30 adds `live-weekly-review.test.ts` to the 5-file excluded-suite list in `scripts/test.sh` (becomes 6-file). Phase 29 ships the file but with `skipIf` gating so the test doesn't run when API key is unset (Phase 30 flips this).

---

## §13 — Top 5 risks Phase 29 must mitigate

1. **Pitfall 17 (sycophantic weekly observations — HIGH).** CONSTITUTIONAL_PREAMBLE explicit injection in `assembleWeeklyReviewPrompt` per CONS-04 / D038. Live integration test (Plan 29-04 scaffold + Phase 30 execute) is the empirical verification.
2. **Pitfall 14 (single-question check brittle — HIGH).** Two-stage Zod refine + Haiku judge per D-03 + D-04. Stage-1 catches `?` count + interrogative-leading-word; Stage-2 catches semantic compounds.
3. **Pitfall 15 (multi-question regen loop — HIGH).** Retry cap = 2 + templated fallback per D-04. Logged as `chris.weekly-review.fallback-fired`.
4. **Pitfall 16 (stale dates in observation — HIGH).** Strict 7-day window via `getEpisodicSummariesRange` + Haiku date-grounding post-check per D-05.
5. **Pitfall 18 (re-surface individual decisions — MEDIUM).** Pattern-only directive in prompt per WEEK-07. M007 ACCOUNTABILITY handles individual surfacing separately.

## §14 — HARD CO-LOCATION enforcement matrix

| Constraint | Pitfall | Lives in | Atomicity Required |
|------------|---------|----------|-------------------|
| #2 — Single-question enforcement co-located with weekly-review observation generator | 14 | Plan 29-02 | YES (Stage-1 + Stage-2 + observation gen + retry + fallback) |
| #3 — CONSTITUTIONAL_PREAMBLE injection co-located with weekly-review observation generator | 17 | Plan 29-01 (assembler) + Plan 29-02 (consumer) | YES (assembler + consumer in same phase + clear test of injection at SDK boundary) |
| #6 — Live weekly-review test as its own plan | 26 | Plan 29-04 (scaffold) + Phase 30 (execute) | NO (cleavage by execution gate; test FILE in Phase 29, live execution in Phase 30) |

---

## §15 — Source files Phase 29 reads / modifies

**Reads:**
- `src/episodic/sources.ts` — `getEpisodicSummariesRange`
- `src/decisions/index.ts` — barrel for `decisions` table
- `src/db/schema.ts` — `decisions`, `pensieveEntries`, `wellbeingSnapshots` tables
- `src/episodic/prompts.ts` — assembler shape mirror
- `src/episodic/consolidate.ts` — Sonnet retry pattern + v3/v4 dual schema mirror
- `src/chris/personality.ts` — `CONSTITUTIONAL_PREAMBLE` constant
- `src/llm/client.ts` — `anthropic`, `SONNET_MODEL`, `HAIKU_MODEL`
- `src/rituals/scheduler.ts` — `dispatchRitualHandler` switch (extend)
- `src/rituals/types.ts` — `RitualConfigSchema`
- `src/pensieve/store.ts` — `storePensieveEntry` (extend if Phase 26 hasn't already)

**Writes (NEW):**
- `src/rituals/weekly-review.ts` (Plan 29-02) — `fireWeeklyReview`, `generateWeeklyObservation`, retry loop, Pensieve write, header rendering
- `src/rituals/weekly-review-prompt.ts` (Plan 29-01) — `assembleWeeklyReviewPrompt`, section builders, CONSTITUTIONAL_PREAMBLE import
- `src/rituals/weekly-review-sources.ts` (Plan 29-01) — `loadWeeklyReviewContext`, `computeWeekBoundary`, variance helpers
- `src/db/migrations/0009_weekly_review_seed.sql` (Plan 29-03) — INSERT seed row
- `src/db/migrations/meta/0009_snapshot.json` (Plan 29-03) — regenerated via `scripts/regen-snapshots.sh`
- `src/rituals/__tests__/weekly-review.test.ts` (Plan 29-02)
- `src/rituals/__tests__/weekly-review-prompt.test.ts` (Plan 29-01)
- `src/rituals/__tests__/weekly-review-sources.test.ts` (Plan 29-01)
- `src/rituals/__tests__/live-weekly-review.test.ts` (Plan 29-04)

**Modifies:**
- `src/rituals/scheduler.ts` (Plan 29-03) — add `case 'weekly_review':` to dispatcher
- `src/pensieve/store.ts` (Plan 29-02 IF Phase 26 hasn't already) — extend with explicit `epistemic_tag` parameter
- `scripts/regen-snapshots.sh` (Plan 29-03) — extend iterative-replay loop to cover 0009
- `scripts/test.sh` (Plan 29-03) — add psql line confirming `weekly_review` row in `rituals` post-migration
