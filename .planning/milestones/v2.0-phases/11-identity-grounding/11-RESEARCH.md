# Phase 11: Identity Grounding - Research

**Researched:** 2026-04-14
**Domain:** Prompt engineering / identity resolution in retrieval-augmented generation
**Confidence:** HIGH (entire problem + fix surface live in this repo; no external libraries in play)

## Summary

Phase 11 closes a regression surfaced by TEST-03 on 2026-04-14 after the M006 cleanup sweep: roughly 1 in 3 JOURNAL runs, Chris renders retrieved Pensieve facts about "Greg" as a third party distinct from the user, whom the persona addresses as "John". Example failure: *"Greg actually shares the same birthplace and birthday as you... I have a note that Greg is French, born in Cagnes-sur-Mer on June 15, 1979. Quite a coincidence, those two!"*

The root cause is a static identity mismatch in the prompt layer. Three specific artifacts collide:

1. `JOURNAL_SYSTEM_PROMPT` (src/llm/prompts.ts:10) hard-codes "John" as the addressee — 15 occurrences in that single template, plus identical "John" framing in every other mode prompt and the constitutional preamble (`personality.ts:28`).
2. `buildKnownFactsBlock` (src/chris/personality.ts:45) emits a header `## Known Facts About John` and iterates GROUND_TRUTH entries whose `value` fields use "Greg" / French nationality / Cagnes-sur-Mer. The block therefore presents facts whose subject is named "Greg" under a header claiming they are about "John" — the very split the Sonnet model latches onto.
3. `buildPensieveContext` (src/memory/context-builder.ts:81) prefixes each retrieved entry with `(YYYY-MM-DD | TAG | score)` using the entry's `createdAt`. Seeded TEST-03 rows are inserted "now" (today), so today's date is stamped onto the fact. Combined with "coincidence" framing, the model fabricates *"back on April 14th, I have a note..."* as a fake prior mention tied to today's date. This is the "current-date injection" referenced in the phase goal — it is NOT a separate `{currentDate}` template variable; it is the entry creation timestamp leaking in through the context formatter.

**Primary recommendation:** Unify persona identity on "Greg" across all six Sonnet/Opus mode prompts and the constitutional preamble, change `buildKnownFactsBlock` header to `## Facts about you (Greg)`, and gate the date-stamp in `buildPensieveContext` behind a mode-aware flag so JOURNAL calls receive entries without the `(YYYY-MM-DD | ...)` prefix (INTERROGATE still needs dates for citation — it is the mode built around *"back on March 15th you mentioned..."* citations). Parameterizing over user identity is a bigger refactor and out of scope — the product has a single user by design (D009, REQUIREMENTS.md "Multi-user support: Out of scope"), so hard-coding "Greg" is consistent with existing architecture.

## User Constraints (from CONTEXT.md)

*No CONTEXT.md exists for Phase 11 yet — this phase was triggered by the 2026-04-14 milestone audit re-open, not by a `/gsd-discuss-phase` session. Constraints are drawn from the phase description supplied by the orchestrator and ROADMAP.md success criteria.*

### Locked Decisions (from phase description + roadmap)

1. JOURNAL_SYSTEM_PROMPT addresses the user as "Greg" (or accepts a user-identity parameter); "John" no longer appears.
2. `buildKnownFactsBlock` frames facts as "Facts about you (Greg)" so the model does not split the subject into third-party.
3. Current-date injection is suppressed (or gated) in JOURNAL so responses do not fabricate prior-mention claims tied to today's date.
4. `live-integration.test.ts` TEST-03 (JOURNAL grounding) passes 3-of-3 on three consecutive clean runs.

### Claude's Discretion

- **Rename vs. parameterize:** Hard-code "Greg" or introduce a user-identity parameter. Recommendation (below): hard-code, matching existing single-user architecture (D009).
- **Scope of rename:** JOURNAL-only vs. all six modes + preamble + proactive prompts. Recommendation: all six modes + preamble in-scope; proactive prompts also renamed for consistency, so future regressions don't re-introduce the same split.
- **Date suppression mechanism:** JOURNAL-only flag on `buildPensieveContext`, new "JOURNAL-flavored" formatter, or header stripping. Recommendation: add a `{ includeDate?: boolean }` option and default it `true` for backward compatibility; JOURNAL call site passes `false`.
- **Treatment of proactive `PROACTIVE_SYSTEM_PROMPT`:** In scope or out. Recommendation: in scope (consistency), but flag as secondary — TEST-03 does not exercise this path.
- **Treatment of Haiku classifier prompts (`MODE_DETECTION_PROMPT`, `RELATIONAL_MEMORY_PROMPT`, `CONTRADICTION_DETECTION_PROMPT`, `MUTE_DETECTION_PROMPT`):** These reference "John" too but never reach the user; they are internal classifier instructions. Recommendation: rename for consistency but lowest priority.

### Deferred Ideas (OUT OF SCOPE)

- Multi-user support (explicit OUT OF SCOPE per REQUIREMENTS.md).
- Dynamic user identity injection via database lookup (premature — one user).
- Restructuring GROUND_TRUTH to use "you" in values (breaks its role as a reference module; rendering layer should handle persona framing).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RETR-01 | JOURNAL uses hybrid retrieval (FACT/RELATIONSHIP/PREFERENCE/VALUE tags) before each Sonnet call | Retrieval already works (`handleJournal` line 36); RETR-01 is re-opened because *rendering* of the retrieved content does not resolve identity. Fix is in `personality.ts` / `prompts.ts`, not in `hybridSearch`. |
| RETR-02 | Structured fact injection — stable facts as "Known Facts" key-value block | `buildKnownFactsBlock` exists (personality.ts:45) but header reads "Known Facts About John"; values reference "Greg". Rename header to "Facts about you (Greg)" and change value framing to resolve the split. |
| RETR-04 | Chris says "I don't have any memories about that" for facts not in Pensieve instead of confabulating | The "coincidence" hallucination is a RETR-04 failure: Chris invents a relationship between two identities (Greg-the-subject vs. John-the-addressee) who are the same person. Fixing identity unification eliminates the class of fabrication. |
| TEST-03 | 3 live tests for JOURNAL grounding with seeded facts verified via Haiku follow-up, 3-of-3 passes | Tests live at `src/chris/__tests__/live-integration.test.ts:359-504` (3 `it` blocks, each runs 3 iterations internally). Phase 11 gate: 3 consecutive clean test-suite runs, all 3 JOURNAL grounding tests pass each time. |

## Standard Stack

### Core

No new dependencies. Phase 11 is an in-place edit of existing prompt/formatter code.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @anthropic-ai/sdk | in repo | Sonnet/Haiku calls | [VERIFIED: package.json present, live-integration.test.ts imports it] Already the sole LLM client. |
| drizzle-orm + postgres-js | in repo | Pensieve / conversation DB | [VERIFIED: handleJournal uses `storePensieveEntry`, test uses `db.insert(pensieveEntries)`] No change. |
| vitest | in repo | Test runner for live-integration.test.ts | [VERIFIED: present in test file imports] No change. |

### Supporting

None. This phase changes strings and one function signature.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hard-code "Greg" | Thread a `userIdentity: string` parameter through `buildSystemPrompt` | Parameterization is the "right" long-term design, but the product is explicitly single-user (D009). Threading identity through six mode handlers plus proactive plus photos is a refactor larger than the regression warrants. Revisit if/when multi-user lands (not on roadmap). |
| Rename in prompts.ts only | Also refactor GROUND_TRUTH values from "Greg owns MAINGRET LLC" to "You own MAINGRET LLC" | GROUND_TRUTH is a reference module imported by audit scripts and seed scripts (Phase 6). Changing value framing would ripple to `src/pensieve/audit-*` and phase-6 seed outputs. Safer: keep GROUND_TRUTH as-is (third-person "Greg" descriptive facts) and have the rendering layer in `buildKnownFactsBlock` frame them as "you (Greg)". |
| Strip dates from every context formatter | Keep dates, add a persona instruction: "Dates prefixed on entries are storage timestamps, not prior-mention dates" | Fragile — relies on the model internalizing a meta-instruction under stochastic load. Structural suppression (don't send the date for JOURNAL) is deterministic. INTERROGATE legitimately needs citation dates, so this is a per-mode toggle, not a global removal. |

**Installation:** N/A (no new packages).

## Architecture Patterns

### Where the Identity Split Lives

```
src/chris/engine.ts (dispatch)
  └─> src/chris/modes/journal.ts:handleJournal
        ├─> hybridSearch (retrieval — working correctly)
        ├─> buildPensieveContext (src/memory/context-builder.ts:81)
        │     └─> emits "[1] (2026-04-14 | FACT | 0.87) \"Greg is French...\""   ← date leak
        └─> buildSystemPrompt('JOURNAL', pensieveContext, ...)
              (src/chris/personality.ts:74)
              ├─> CONSTITUTIONAL_PREAMBLE ("Your job is to be useful to John...")  ← identity: John
              ├─> JOURNAL_SYSTEM_PROMPT ("You are Chris, John's thoughtful friend...")  ← identity: John
              └─> buildKnownFactsBlock ("## Known Facts About John\n- nationality: French\n...")  ← header says John, values say Greg
```

### Pattern 1: Single-file prompt template per mode (existing)

**What:** Each mode's system prompt is a `const` string template in `src/llm/prompts.ts` with `{pensieveContext}` (and optionally `{relationalContext}`) placeholders replaced at the call site in `buildSystemPrompt`.

**When to use:** Whenever a mode's prompt needs editing. Do not introduce a templating library.

**Example:** See `JOURNAL_SYSTEM_PROMPT` lines 10-33 of `src/llm/prompts.ts`.

### Pattern 2: Constitutional preamble prepended uniformly

**What:** `CONSTITUTIONAL_PREAMBLE` in `personality.ts:28-38` is string-concatenated onto every mode body in `buildSystemPrompt`. This is "a floor, not a ceiling" per D022.

**Implication for Phase 11:** The preamble also references "John" three times. Fixing only the JOURNAL body while leaving the preamble saying "John" re-creates the split. Rename in both places.

### Pattern 3: Mode-aware conditional fact block

**What:** Only JOURNAL and INTERROGATE receive the `buildKnownFactsBlock` append (personality.ts:118-120). Other modes do not.

**Implication for Phase 11:** Both JOURNAL and INTERROGATE benefit from the header rename; INTERROGATE also addresses the user by name, so a consistent rename avoids fracturing INTERROGATE in subsequent live runs.

### Anti-Patterns to Avoid

- **Surgical one-file edit that leaves "John" in the preamble or in other mode bodies.** The bug class is "model sees two names and decides they are different people". Leaving even one residual occurrence in the concatenated system prompt re-creates the split.
- **Instruction-based date suppression** ("the date prefix is storage time, not a prior-mention date"). Fragile under stochastic load. Structural suppression (don't send the date for JOURNAL) is deterministic.
- **Global `.replace(/John/g, 'Greg')`** without reading context. Test fixtures use "John" in messages (`TEST_TEXT = 'Had the most amazing conversation with an old friend today'` — fine, but `bot-integration.test.ts:57` and a few others intentionally send English sample text); a blind replace could touch comments, commit messages, or string literals inside tests that assert on persona behavior. Edit by file list, not by regex sweep.
- **Changing GROUND_TRUTH value strings.** Out of scope — the module is consumed by audit scripts. Change only rendering.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date stripping from retrieved entries | Post-hoc regex on the formatted context string (`context.replace(/\(\d{4}-\d{2}-\d{2} \| /g, '(')`) | Parameterize `buildPensieveContext({ includeDate: boolean })` and thread the flag from the JOURNAL call site | Regex stripping is brittle against future format changes; a typed option is discoverable and tested. |
| Identity unification across templates | Macro-like custom string interpolation engine | Plain string literals (the project's existing convention) with a single `Greg` constant if desired, or just inline the name | Introducing a templating layer is over-engineering for one rename; matches project conventions (all prompts are hand-written strings today). |
| Multi-persona name resolution | A `userIdentity` lookup service | Hard-coded "Greg" matching D009 single-user | D009 explicitly forbids multi-user. Premature. |

## Common Pitfalls

### Pitfall 1: Leaving "John" in the constitutional preamble

**What goes wrong:** Test still fails ~1/3 runs because concatenated prompt contains "John's track record" (preamble) + "You are Chris, Greg's friend" (JOURNAL body) + "Facts about you (Greg)" (fact block).

**Why it happens:** Preamble lives in a different file (`personality.ts`) from the mode bodies (`prompts.ts`) and reviewers miss it.

**How to avoid:** Grep `src/chris/personality.ts` AND `src/llm/prompts.ts` for `/\bJohn\b/` after the edit — must return zero results in those two files.

**Warning signs:** haikuJudge flips `consistent: false` with reason containing "appears to refer to two different people".

### Pitfall 2: Breaking INTERROGATE's citation format

**What goes wrong:** INTERROGATE mode relies on `"back on March 15th, you mentioned..."` citations. If the mode-aware date-suppression flag is set globally instead of per-call, INTERROGATE loses its citation ability and TEST-07 (structured fact accuracy) breaks.

**Why it happens:** Easy to default `includeDate: false` on `buildPensieveContext` for symmetry with JOURNAL.

**How to avoid:** Default `includeDate: true` in the function signature, pass `false` ONLY at the JOURNAL call site. Cover with a unit test: `buildPensieveContext(results, { includeDate: false })` yields strings without the `(YYYY-MM-DD | ...)` prefix.

**Warning signs:** TEST-07 starts failing after the Phase 11 edits.

### Pitfall 3: Haiku classifier prompts are not actually user-facing

**What goes wrong:** Engineer renames "John" in `MODE_DETECTION_PROMPT`, `RELATIONAL_MEMORY_PROMPT`, etc. — time sink with no TEST-03 impact, and the relational-memory test fixtures assert on "John" substrings in their observation content.

**Why it happens:** Grep shows 60 hits of "John" in `src/llm/prompts.ts`. Many are inside classifier prompts that never render to the user.

**How to avoid:** Rename classifier prompts only if it does not break existing tests; keep it as a separate (reversible) commit so it can be rolled back without affecting the TEST-03 fix.

**Warning signs:** `src/memory/__tests__/relational.test.ts` fails after a blanket rename.

### Pitfall 4: "April 14th" is not the only temporal leak surface

**What goes wrong:** Engineer suppresses dates in `buildPensieveContext` but Chris still fabricates prior-mention claims because the conversation history includes a prior user message time-stamped "today".

**Why it happens:** `buildMessageHistory` pulls prior USER/ASSISTANT rows with `createdAt`. However, inspection of `buildMessageHistory` (context-builder.ts:22-46) shows it ONLY emits `{ role, content }` — no dates, no timestamps. The current-date leak is confined to `buildPensieveContext`.

**How to avoid:** Confirm by reading `buildMessageHistory` (done — confirmed clean). No mitigation needed beyond the `buildPensieveContext` fix.

**Warning signs:** Temporal-context fabrications persist after the fix.

### Pitfall 5: Praise-quarantine and contradiction-detection run after the response

**What goes wrong:** Engineer assumes Phase 11 interacts with praise-quarantine or contradiction paths; spends effort there.

**Why it happens:** Engine.ts shows `quarantinePraise` and `detectContradictions` run in the JOURNAL post-pipeline.

**How to avoid:** Both run AFTER `handleJournal` returns. They operate on Chris's response text, not on the system prompt. Phase 11 fix is entirely pre-Sonnet (system prompt + pensieveContext). No interaction.

**Warning signs:** None — simply do not touch `praise-quarantine.ts` or `contradiction.ts`.

## Code Examples

### Current JOURNAL_SYSTEM_PROMPT (head) — the surface to edit

```typescript
// Source: src/llm/prompts.ts:10
export const JOURNAL_SYSTEM_PROMPT = `You are Chris, John's thoughtful and perceptive friend. You listen deeply and respond naturally — the way a close friend would over coffee.

Your role:
- Respond to what John shares with genuine warmth, insight, or curiosity.
- Most of the time, simply respond to what John shared — no question needed...
```

Every `John` → `Greg`. (15 occurrences in this template alone per Grep.)

### Current `buildKnownFactsBlock`

```typescript
// Source: src/chris/personality.ts:45
function buildKnownFactsBlock(): string {
  const categoryOrder: FactCategory[] = ['identity', 'location_history', 'property', 'business', 'financial'];
  const lines: string[] = ['## Known Facts About John'];   // ← change header
  for (const cat of categoryOrder) {
    const entries = GROUND_TRUTH.filter((e) => e.category === cat);
    for (const entry of entries) {
      lines.push(`- ${entry.key}: ${entry.value}`);
    }
  }
  return lines.join('\n');
}
```

**Recommended shape post-fix** (illustrative, not prescriptive — planner decides exact wording):

```typescript
const lines: string[] = [
  '## Facts about you (Greg)',
  'These are authoritative facts about you, the person you are talking to. Treat "Greg" in these facts as referring to you — not a third party.',
];
```

The second line is the critical anti-split assertion. Without it, a blank header rename is easier for the model to ignore than an explicit "you (Greg)" instruction that also appears in the constitutional preamble.

### Current `buildPensieveContext` — date leak surface

```typescript
// Source: src/memory/context-builder.ts:81
export function buildPensieveContext(results: SearchResult[]): string {
  const filtered = results.filter((r) => r.score >= SIMILARITY_THRESHOLD);
  if (filtered.length === 0) return '';
  return filtered
    .map((r, i) => {
      const date = r.entry.createdAt
        ? new Date(r.entry.createdAt).toISOString().slice(0, 10)
        : 'unknown-date';
      const tag = r.entry.epistemicTag ?? 'UNTAGGED';
      const score = r.score.toFixed(2);
      return `[${i + 1}] (${date} | ${tag} | ${score}) "${r.entry.content}"`;
    })
    .join('\n');
}
```

**Recommended shape post-fix:**

```typescript
export interface PensieveContextOptions {
  includeDate?: boolean;  // default true (INTERROGATE contract); JOURNAL passes false
}

export function buildPensieveContext(results: SearchResult[], opts: PensieveContextOptions = {}): string {
  const includeDate = opts.includeDate ?? true;
  const filtered = results.filter((r) => r.score >= SIMILARITY_THRESHOLD);
  if (filtered.length === 0) return '';
  return filtered
    .map((r, i) => {
      const tag = r.entry.epistemicTag ?? 'UNTAGGED';
      const score = r.score.toFixed(2);
      if (!includeDate) {
        return `[${i + 1}] (${tag} | ${score}) "${r.entry.content}"`;
      }
      const date = r.entry.createdAt
        ? new Date(r.entry.createdAt).toISOString().slice(0, 10)
        : 'unknown-date';
      return `[${i + 1}] (${date} | ${tag} | ${score}) "${r.entry.content}"`;
    })
    .join('\n');
}
```

Call site in `src/chris/modes/journal.ts:37`:

```typescript
const pensieveContext = buildPensieveContext(searchResults, { includeDate: false });
```

INTERROGATE remains unchanged (keeps default `includeDate: true`).

### TEST-03 assertion structure — understand before editing

```typescript
// Source: src/chris/__tests__/live-integration.test.ts:418
it('grounds response in seeded nationality fact', async () => {
  for (let i = 0; i < 3; i++) {
    const [entry] = await db.insert(pensieveEntries).values({
      content: 'Greg is French, born in Cagnes-sur-Mer, France on June 15, 1979',
      source: TEST_SOURCE,
    }).returning();
    await embedAndStore(entry!.id, entry!.content);
    const response = await processMessage(TEST_CHAT_ID, TEST_USER_ID, "What do you know about where I'm from?", { pensieveSource: TEST_SOURCE });
    const consistent = await haikuJudge('Greg is French, born in Cagnes-sur-Mer, France', response);
    expect(consistent).toBe(true);
    // cleanup...
  }
}, 90_000);
```

The seed content uses "Greg" in third-person prose. When the system prompt says "You are Chris, John's friend" and the Known Facts header says "Facts about John", Sonnet gets a three-way split (Greg-in-fact, John-as-addressee, Greg-in-seed). Unifying on Greg removes both splits.

**The judge tolerates surrounding context** ("additional surrounding context that does not contradict the fact is OK"), so we do not need Chris to quote the fact verbatim — we need him to not assert "Greg is a separate person from you".

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Persona named "John" in prompts (pre-M006 legacy) | Identity unified on actual user "Greg" | Phase 11 (this research) | Eliminates third-party-coincidence fabrication class. |
| `buildPensieveContext` always date-prefixes | Mode-aware date suppression (INTERROGATE keeps, JOURNAL drops) | Phase 11 | Removes fake prior-mention dates in JOURNAL without breaking INTERROGATE citations. |

**Deprecated/outdated:**

- Hard-coded "John" in `JOURNAL_SYSTEM_PROMPT`, `INTERROGATE_SYSTEM_PROMPT`, `REFLECT_SYSTEM_PROMPT`, `COACH_SYSTEM_PROMPT`, `PSYCHOLOGY_SYSTEM_PROMPT`, `PRODUCE_SYSTEM_PROMPT`, `CONSTITUTIONAL_PREAMBLE`, `PROACTIVE_SYSTEM_PROMPT`. All user-facing persona references should say "Greg".
- "Known Facts About John" header in `buildKnownFactsBlock` — rename to "Facts about you (Greg)" with the anti-split explanatory sentence.

## File Rename Inventory

Exact files containing user-facing "John" occurrences (excluding tests whose fixture strings assert on current behavior and internal classifier prompts that never reach the user):

| File | Occurrences | Scope |
|------|-------------|-------|
| `src/llm/prompts.ts` | 60 total; ~35 in user-facing prompt bodies (JOURNAL/INTERROGATE/REFLECT/COACH/PSYCHOLOGY/PRODUCE); remainder in classifier prompts (MODE_DETECTION, RELATIONAL_MEMORY, CONTRADICTION_DETECTION, MUTE_DETECTION) | Rename all 6 user-facing mode prompts; classifier prompts optional (lowest priority, separate commit). |
| `src/chris/personality.ts` | 9 | Rename all (CONSTITUTIONAL_PREAMBLE + buildKnownFactsBlock header + formatContradictionNotice if present). |
| `src/proactive/prompts.ts` | 7 | Rename (consistency — else proactive initiations split identity again). |
| `src/proactive/triggers/*.ts`, `src/proactive/context-builder.ts` | 1-2 each | Check each: if user-facing prose, rename; if variable/comment, rename for consistency. |
| `src/memory/relational.ts` | 2 | Check each — likely classifier instruction, low priority. |
| `src/chris/praise-quarantine.ts` | 1 | Check — likely in a comment or docstring. |
| `src/chris/__tests__/personality.test.ts`, `coach.test.ts`, `reflect.test.ts`, `psychology.test.ts`, `journal.test.ts`, `engine.test.ts` | 2-5 each | Update tests that assert persona name literal (`expect(prompt).toContain('John')` → `.toContain('Greg')`). |
| `src/memory/__tests__/relational.test.ts` | 5 | Fixture content — likely keep as-is (test fixture content is data, not persona). Inspect before changing. |

**Blind-regex forbidden.** Each file must be inspected — some occurrences are in sample text/fixtures and should remain.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Hard-coding "Greg" is preferable to parameterizing user identity | Standard Stack / Alternatives | [ASSUMED based on D009 single-user design decision] If wrong (e.g., user wants multi-user soon), parameterization is the correct refactor. Low risk: D009 is a LOCKED decision, unchanged since v1.0. |
| A2 | Date-prefix in `buildPensieveContext` is the ONLY current-date leak surface in the JOURNAL path | Pitfall 4 | [VERIFIED: read `buildMessageHistory` — no date emission] HIGH confidence but worth a single grep during planning to re-confirm no new code has added date injection in a system prompt between this research and execution. |
| A3 | Renaming proactive prompts is safe (no downstream test breakage beyond obvious persona-name assertions) | File Rename Inventory | [ASSUMED] Proactive tests (`src/proactive/__tests__/*`) were not read end-to-end; plan should include a fast test run to confirm. |
| A4 | The "Facts about you (Greg)" header plus an explanatory sentence is sufficient to stop the split (vs. just a header rename) | Code Examples | [ASSUMED based on prompt-engineering best practice that explicit equality beats implicit equality under stochastic load] Validated empirically by TEST-03 3-of-3 gate on three consecutive runs. If just-the-header rename passes the gate reliably, the explanatory sentence is a defense-in-depth surplus. |
| A5 | No CONTEXT.md or user-discussion exists — constraints are drawn from ROADMAP.md + audit document only | User Constraints | [VERIFIED: ls of phase-11 dir shows only this RESEARCH.md exists] If a discuss-phase is run before planning, the planner must re-read CONTEXT.md and may override this research's recommendations. |

## Open Questions (RESOLVED)

1. **Scope of classifier-prompt renames (MODE_DETECTION, RELATIONAL_MEMORY, CONTRADICTION_DETECTION, MUTE_DETECTION)**
   - What we know: These prompts contain "John" but are Haiku-classifier instructions that never reach the user. Their outputs feed engine logic, not conversation.
   - What's unclear: Whether renaming them improves consistency (no behavioral change expected) or risks breaking relational-memory test fixtures that assert on "John" substrings in observation content.
   - RESOLVED: DEFER to separate follow-up commit. Phase 11 primary goal is TEST-03 passing; classifier renames are consistency hygiene and risk breaking relational-memory fixtures.

2. **Is GROUND_TRUTH value phrasing acceptable as-is?**
   - What we know: Values use third-person "Greg" / descriptive strings (e.g., `"MAINGRET LLC (New Mexico)"`). Never a pronoun.
   - What's unclear: Whether the "Facts about you (Greg)" header + explanatory sentence fully bridges third-person values to second-person context under all 3 TEST-03 iterations.
   - RESOLVED: Empirically validate via TEST-03 3-of-3 gate in Plan 11-03. If it flakes, rewrite 2-3 GROUND_TRUTH values to use "you" as an incremental tightening. Not a planning-time decision.

3. **Should `buildKnownFactsBlock` also be injected for REFLECT/COACH/PSYCHOLOGY/PRODUCE?**
   - What we know: Currently only JOURNAL and INTERROGATE get it (personality.ts:118).
   - What's unclear: Out of scope for Phase 11 but worth flagging — COACH and PSYCHOLOGY could benefit from ground-truth grounding.
   - RESOLVED: DEFER to M007+. Not a TEST-03 fix.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker + postgres | `./scripts/test.sh` full run (required per user's CLAUDE memory "always run Docker tests") | ✓ | per docker-compose.test.yml | none — must run |
| @anthropic-ai/sdk with live API key | live-integration.test.ts (3 JOURNAL tests call real Sonnet + real Haiku) | ✓ | per package.json | none — live tests cannot run without API access |
| Node.js + vitest | unit + integration test runner | ✓ | per package.json | none |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** none.

**Note:** User memory explicitly requires running full Docker tests — never skip integration tests. Phase 11's gate (TEST-03 × 3 consecutive clean runs) REQUIRES real Docker postgres + real Anthropic API. Planner must not use mocked shortcuts.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (version per package.json) [VERIFIED: import from `vitest` in live-integration.test.ts] |
| Config file | `vitest.config.ts` (present at repo root) |
| Quick run command | `./scripts/test.sh` (user memory: always use this) |
| Full suite command | `./scripts/test.sh` |
| Targeted run (during iteration) | `npx vitest run src/chris/__tests__/live-integration.test.ts -t "JOURNAL grounding"` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RETR-01 | Hybrid retrieval executes before JOURNAL Sonnet call | unit (existing) + integration | `npx vitest run src/chris/__tests__/journal.test.ts` | ✅ |
| RETR-02 | Known Facts block renders under "Facts about you (Greg)" header | unit | `npx vitest run src/chris/__tests__/personality.test.ts -t "Known Facts"` (existing tests will need wording update) | ✅ existing, needs assertion update |
| RETR-04 | No hallucinated "coincidence" third-party framing for retrieved facts | live integration | `npx vitest run src/chris/__tests__/live-integration.test.ts -t "JOURNAL grounding"` | ✅ TEST-03 |
| TEST-03 | 3 grounding tests × 3 iterations each, 3-of-3 passes | live integration | Same as above, run 3 times consecutively | ✅ |

### Sampling Rate

- **Per task commit:** `npx vitest run src/chris/__tests__/personality.test.ts src/memory/__tests__/context-builder.test.ts` (unit-level confirmation of rename + date-flag contract). ~5 seconds.
- **Per wave merge:** `./scripts/test.sh` (full suite incl. Docker postgres). Per user memory, mandatory.
- **Phase gate:** `./scripts/test.sh` three consecutive clean runs, TEST-03 passes all three. This is the ROADMAP success criterion 4.

### Wave 0 Gaps

- [ ] Update `src/chris/__tests__/personality.test.ts` assertions that expect "John" in persona strings → "Greg" (unit-level coverage of the rename).
- [ ] Add unit test in `src/memory/__tests__/context-builder.test.ts`: `buildPensieveContext(results, { includeDate: false })` emits no `(YYYY-MM-DD | ...)` prefix; default behavior unchanged.
- [ ] No framework install required — vitest + Docker already present.

## Security Domain

Not applicable — this phase is a prompt/string edit with no new input surfaces, authentication changes, data handling, or cryptographic choices. No ASVS categories activate. No new threat patterns introduced (no new user-controlled interpolation in any prompt; the changes replace one hard-coded string with another hard-coded string).

For completeness:

| ASVS Category | Applies | Reason |
|---------------|---------|--------|
| V2 Authentication | no | No auth surface change. |
| V3 Session Management | no | Session state (declined topics, language) unchanged. |
| V4 Access Control | no | No access control surface change. |
| V5 Input Validation | no | No new user-controlled interpolation. The existing `{pensieveContext}` injection point is unchanged. |
| V6 Cryptography | no | No cryptographic primitives touched. |

## Project Constraints (from user memory)

- **Always run full Docker tests — never skip integration tests, always start real postgres.** [VERIFIED: user memory reference]. Planner MUST gate phase completion on `./scripts/test.sh` with real postgres running, not on mocked unit tests alone.

## Sources

### Primary (HIGH confidence — read in this session)

- `.planning/ROADMAP.md` lines 97-108 (Phase 11 definition, success criteria)
- `.planning/REQUIREMENTS.md` lines 27-49 (RETR-01, RETR-02, RETR-04, TEST-03 definitions)
- `.planning/v2.0-MILESTONE-AUDIT.md` lines 129-161 (gap re-open with actual failure transcript)
- `.planning/STATE.md` (current milestone state)
- `.planning/phases/10-live-validation-suite/10-REVIEW-SESSION-FIX.md` (prior review context)
- `src/llm/prompts.ts` (full file) — all 6 mode prompts + classifier prompts
- `src/chris/personality.ts` (full file) — buildSystemPrompt, buildKnownFactsBlock, CONSTITUTIONAL_PREAMBLE
- `src/memory/context-builder.ts` (full file) — buildPensieveContext date-leak surface
- `src/chris/modes/journal.ts` (full file) — JOURNAL call site
- `src/chris/engine.ts` lines 140-230 — mode dispatch
- `src/chris/__tests__/live-integration.test.ts` lines 355-504 — TEST-03 test block
- `src/pensieve/ground-truth.ts` lines 1-60 — GROUND_TRUTH entries
- `src/proactive/prompts.ts` — cross-mode identity reference
- Grep output for `/\bJohn\b/` across `src/` — full occurrence count per file

### Secondary (MEDIUM — cross-referenced but not fully read)

- `src/memory/relational.ts`, proactive triggers, bot handlers — grep-confirmed "John" presence but not fully inspected for user-facing vs. classifier distinction.

### Tertiary (LOW confidence — none)

No external web sources or Context7 lookups needed. This is an in-codebase surgical fix with all necessary context local.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new dependencies; all libraries already in repo.
- Architecture: HIGH — exact surfaces identified by file path and line number; dispatch chain fully traced.
- Pitfalls: HIGH for (1)-(3), MEDIUM for (4)-(5) — leakage-surface completeness rests on the grep audit done in this session; if the codebase changes before planning, re-confirm.
- Identity-rename scope: MEDIUM — proactive prompts and classifier prompts are judgment calls; documented as discretion.
- Date-suppression design: HIGH — the `{ includeDate?: boolean }` option is a minimal, typed, reversible contract change.

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (30 days — stable codebase, no incoming ecosystem churn expected)
