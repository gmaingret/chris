# Phase 9: Praise Quarantine - Research

**Researched:** 2026-04-13
**Domain:** Engine post-processing, Haiku API pattern, TypeScript module structure
**Confidence:** HIGH

## Summary

Phase 9 adds a deterministic Haiku post-processor that rewrites reflexive flattery out of JOURNAL, REFLECT, and PRODUCE responses before they reach the user. The implementation is well-scoped and follows a pattern already established in the codebase: contradiction detection (engine.ts lines 207-228) uses the exact same Haiku-with-timeout pattern, so praise quarantine is essentially a second instance of that pattern with a rewrite task instead of a detection task.

The scope is a new self-contained module (`src/chris/praise-quarantine.ts`) plus a small edit to `processMessage()` in `engine.ts`. No database changes, no schema changes, no new dependencies. The Haiku client (`anthropic` + `HAIKU_MODEL`) and the timeout-race pattern are already present and tested.

COACH and PSYCHOLOGY are explicitly excluded from the post-processor by a mode check before the Haiku call. This avoids unnecessary latency for modes whose prompts already prohibit flattery at the generation level (decision D-06).

**Primary recommendation:** Model praise-quarantine.ts directly on the contradiction detection module structure (types, stripFences, try/catch, never-throw contract) with one key difference: it returns a string (possibly rewritten) instead of an array of findings.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Haiku receives the response and rewrites it if it detects reflexive flattery in the opening. Detect-and-rewrite — not detect-and-strip. Haiku rephrases the opening to remove flattery while preserving meaning and tone.
- **D-02:** Post-processor returns the rewritten response (or the original if no flattery detected). Single Haiku call per applicable response.
- **D-03:** Target reflexive opening praise only — "Great question!", "That's a really insightful observation", "What a thoughtful point", "I love that you're thinking about this", "That's so important that you're exploring this."
- **D-04:** Mid-response genuine engagement is NOT flattery. "That's worth exploring further" or "interesting angle" used substantively in context are fine. Quarantine targets vacuous openers, not all positive language.
- **D-05:** Pipeline order: mode handler → praise quarantine (JOURNAL/REFLECT/PRODUCE only) → contradiction detection → save response → relational memory.
- **D-06:** COACH and PSYCHOLOGY skip praise quarantine entirely — checked by mode before calling Haiku.
- **D-07:** If Haiku post-processing fails (API timeout, error, malformed response), pass through original response unchanged. Log the error. A response with mild flattery is better than no response.
- **D-08:** Use a timeout consistent with the existing pattern (contradiction detection uses 3s). Praise quarantine Haiku call should have a similar timeout guard.

### Claude's Discretion

- Exact Haiku prompt text for the rewrite instruction
- Whether to add a confidence/change indicator in logs (e.g., "rewrite applied" vs "no change needed")
- Exact timeout value (2-4s range)
- Whether the Haiku prompt should receive the user's original message for context or just the response text

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYCO-04 | Praise quarantine post-processor (Haiku) strips reflexive flattery from JOURNAL/REFLECT/PRODUCE responses | New `praise-quarantine.ts` module + engine.ts pipeline insertion between mode handler return and contradiction detection block |
| SYCO-05 | COACH and PSYCHOLOGY modes bypass praise quarantine (already forbid flattery at prompt level) | Mode check `if (mode !== 'COACH' && mode !== 'PSYCHOLOGY' && mode !== 'INTERROGATE' && mode !== 'PHOTOS')` before calling quarantine function |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | ^0.80.0 | Haiku API call for rewrite | Already a project dependency; `HAIKU_MODEL` and `anthropic` client already configured in `src/llm/client.ts` |
| TypeScript (ESM) | ^5.7.0 | Module authoring | Project-wide standard |
| `vitest` | ^4.1.2 | Unit tests | Project-wide standard |

[VERIFIED: package.json] — no new packages required for this phase.

### Supporting

No new dependencies. The existing `logger` from `src/utils/logger.js` handles structured logging of rewrites vs. no-ops vs. errors.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Haiku rewrite call | Regex stripping | Regex can't rewrite gracefully — leaves choppy openers (D-01 chose rewrite explicitly) |
| Haiku rewrite call | Prompt-only rule | Prompt rules drift across modes and long sessions; deterministic post-processing always fires (D025) |

**Installation:** No new packages needed.

## Architecture Patterns

### Recommended Project Structure

```
src/chris/
├── engine.ts              # Add praise quarantine step (modify)
├── praise-quarantine.ts   # New self-contained module (create)
├── refusal.ts             # Reference for module interface pattern
└── contradiction.ts       # Reference for Haiku call + timeout pattern
```

### Pattern 1: Self-Contained Post-Processing Module

**What:** The module exports a single async function with a never-throw contract. Errors are caught, logged at warn level, and the function returns the original input.
**When to use:** Any engine post-processing step that must not block the response.
**Example (modeled on contradiction.ts):**

```typescript
// Source: src/chris/contradiction.ts — never-throw pattern
export async function quarantinePraise(
  response: string,
  mode: ChrisMode,
): Promise<string> {
  // Gate: skip modes that bypass quarantine (D-06)
  if (mode === 'COACH' || mode === 'PSYCHOLOGY') {
    return response;
  }
  try {
    // ... Haiku call ...
    return rewritten;
  } catch (error) {
    logger.warn({ error: ... }, 'chris.praise_quarantine.error');
    return response; // D-07: passthrough on failure
  }
}
```

[VERIFIED: src/chris/contradiction.ts]

### Pattern 2: Timeout Race in Engine

**What:** `Promise.race()` between the post-processing call and a `setTimeout` fallback that returns the original response. This ensures latency spike from Haiku never blocks the user.
**When to use:** All Haiku post-processing steps in processMessage().
**Example (exact existing pattern):**

```typescript
// Source: src/chris/engine.ts lines 207-228
const QUARANTINE_TIMEOUT_MS = 3000; // consistent with contradiction detection (D-08)
try {
  const rewritten = await Promise.race([
    quarantinePraise(response, mode),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve(response), QUARANTINE_TIMEOUT_MS)
    ),
  ]);
  response = rewritten;
} catch (quarantineError) {
  logger.warn(
    { error: quarantineError instanceof Error ? quarantineError.message : String(quarantineError) },
    'chris.engine.praise_quarantine.error',
  );
  // D-07: response unchanged
}
```

[VERIFIED: src/chris/engine.ts lines 207-228]

### Pattern 3: Haiku JSON Response with stripFences

**What:** Haiku returns structured JSON. The module strips markdown code fences before parsing (the `stripFences` helper is already duplicated in both engine.ts and contradiction.ts — copy the same pattern).
**Example:**

```typescript
// Source: src/chris/contradiction.ts (and engine.ts)
function stripFences(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  return match ? match[1]!.trim() : text.trim();
}
```

Haiku prompt should ask for a JSON response: `{ "flattery_detected": boolean, "rewritten": string }`.
If `flattery_detected` is false, `rewritten` equals the original. This avoids a conditional branch and makes the contract uniform.

[VERIFIED: src/chris/contradiction.ts, src/chris/engine.ts]

### Pattern 4: Pipeline Position (D-05)

**What:** Praise quarantine runs BEFORE contradiction detection, AFTER the mode handler returns. In `engine.ts` the contradiction detection block starts at line 207. The praise quarantine block inserts immediately before it.

```typescript
// After switch (mode) { ... } block ends at line 205
// Insert:
//   praise quarantine (JOURNAL/REFLECT/PRODUCE only) — phase 9
// Then existing:
//   contradiction detection (JOURNAL/PRODUCE only) — lines 207-228
```

[VERIFIED: src/chris/engine.ts lines 167-228]

### Anti-Patterns to Avoid

- **Detect-then-strip (sentence removal):** Removes sentences, leaving choppy transitions. Use detect-and-rewrite (D-01).
- **Prompt-rule only:** Prompt rules for anti-flattery already exist (CONSTITUTIONAL_PREAMBLE) and still produce occasional flattery. Post-processing is the enforcement layer — don't conflate them.
- **Calling quarantine for COACH/PSYCHOLOGY:** Adds latency, adds cost, solves a problem that doesn't exist for those modes. Check mode before calling (D-06).
- **Blocking on timeout:** `Promise.race()` must win; do not `await` the Haiku call directly without a timeout guard (D-08).
- **Throwing from the quarantine function:** Never-throw contract. All errors caught inside the module, original response returned (D-07).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Flattery detection regex | Custom regex pattern list | Haiku rewrite | Regex can't handle all phrasings, variants, and tones; Haiku understands context |
| Response stripping | Sentence removal | Haiku rewrite | Stripping leaves choppy openers — D-01 chose rewrite explicitly |
| Anthropic client | Custom HTTP wrapper | `anthropic` from `src/llm/client.ts` | Already configured with API key, model constants |
| Timeout machinery | Custom timer | `Promise.race()` with `setTimeout` | Exact pattern already proven in contradiction detection |

**Key insight:** The hard parts (Haiku client setup, timeout pattern, error swallowing, logging) are already solved. The implementation is a thin new module using established primitives.

## Common Pitfalls

### Pitfall 1: Mode Set Mismatch

**What goes wrong:** Contradiction detection runs on `JOURNAL || PRODUCE`. Praise quarantine must run on `JOURNAL || REFLECT || PRODUCE`. Adding a third mode is easy to miscopy from the existing block.
**Why it happens:** Copy-paste from the contradiction detection condition.
**How to avoid:** Write the condition explicitly: `if (mode === 'JOURNAL' || mode === 'REFLECT' || mode === 'PRODUCE')`.
**Warning signs:** REFLECT responses still contain flattery; engine tests for REFLECT mode don't verify quarantine was called.

### Pitfall 2: Haiku Response Parse Failure Silently Drops Rewrite

**What goes wrong:** Haiku returns malformed JSON or plain text. `JSON.parse` throws. If the catch block doesn't return the original, response is undefined.
**Why it happens:** Missing fallback in the catch.
**How to avoid:** Always `return response` in every catch path. The never-throw contract is the module's primary guarantee.
**Warning signs:** Empty or undefined responses in test output.

### Pitfall 3: Rewrite Applied to Non-Opening Flattery

**What goes wrong:** Haiku rewrites "That's a great insight you've shown throughout this journal" in the middle of a paragraph, changing meaning.
**Why it happens:** Prompt doesn't specify "opening flattery only."
**How to avoid:** Prompt must explicitly state: "Look only at the FIRST sentence or two. If the response opens with reflexive flattery (e.g., 'Great question!', 'That's a really insightful observation'), rewrite that opening to remove the flattery. Do not change anything else."
**Warning signs:** Tests show response content changes beyond the first sentence.

### Pitfall 4: Timeout Value Inconsistency

**What goes wrong:** Contradiction detection uses 3000ms. If praise quarantine uses a different value without reason, future readers will wonder why.
**Why it happens:** Guessing or using a different number.
**How to avoid:** Use 3000ms (matching contradiction detection per D-08). Define as `const QUARANTINE_TIMEOUT_MS = 3000` at the top of the engine block.
**Warning signs:** Code review catches inconsistent timeout constants.

### Pitfall 5: Engine Test Suite Doesn't Mock praise-quarantine.ts

**What goes wrong:** `engine.test.ts` imports `engine.ts` which now imports `praise-quarantine.ts`, which makes real Anthropic API calls (or throws because the mock isn't set up).
**Why it happens:** New module added without adding corresponding mock to `engine.test.ts`.
**How to avoid:** Add `vi.mock('../praise-quarantine.js', ...)` to engine.test.ts immediately when the module is created. See the existing mock pattern for `contradiction.js` in engine.test.ts line 123.
**Warning signs:** Engine tests fail with API key errors or import errors.

## Code Examples

### Haiku Prompt for Rewrite

```typescript
// Claude's discretion: recommended prompt text
const PRAISE_QUARANTINE_PROMPT = `You are a response editor. Your only job is to detect and remove reflexive flattery from the opening of a response.

Reflexive flattery means vacuous openers like:
- "Great question!"
- "That's a really insightful observation"
- "What a thoughtful point"
- "I love that you're thinking about this"
- "That's so important that you're exploring this"

Rules:
- Look only at the FIRST 1-2 sentences.
- If the response opens with reflexive flattery, rewrite that opening to remove it while preserving the rest of the response exactly.
- Do NOT change anything after the opening.
- If no reflexive flattery is found, return the original response unchanged.
- Mid-response positive language ("that's worth exploring further") is NOT flattery — leave it alone.

Respond with JSON only:
{ "flattery_detected": boolean, "rewritten": string }`;
```

[ASSUMED] — prompt text is Claude's discretion; exact wording subject to tuning.

### Module Interface

```typescript
// src/chris/praise-quarantine.ts — recommended interface
import { anthropic, HAIKU_MODEL } from '../llm/client.js';
import { logger } from '../utils/logger.js';
import type { ChrisMode } from './engine.js';

const PRAISE_QUARANTINE_PROMPT = `...`;

export async function quarantinePraise(
  response: string,
  mode: ChrisMode,
): Promise<string> {
  // Gate: COACH and PSYCHOLOGY bypass (D-06)
  if (mode === 'COACH' || mode === 'PSYCHOLOGY') {
    return response;
  }
  try {
    const result = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1024,
      system: PRAISE_QUARANTINE_PROMPT,
      messages: [{ role: 'user', content: response }],
    });

    const textBlock = result.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      logger.warn({}, 'chris.praise_quarantine.no_text_block');
      return response;
    }

    const cleaned = stripFences(textBlock.text);
    const parsed = JSON.parse(cleaned) as { flattery_detected: boolean; rewritten: string };

    logger.info(
      { flattery_detected: parsed.flattery_detected, mode },
      'chris.praise_quarantine',
    );

    return parsed.rewritten ?? response;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'chris.praise_quarantine.error',
    );
    return response; // D-07: passthrough on failure
  }
}
```

[VERIFIED: pattern from src/chris/contradiction.ts]

### Engine Insertion Point

```typescript
// src/chris/engine.ts — insert after switch block (after line 205), before contradiction detection

// ── Praise quarantine (JOURNAL, REFLECT, PRODUCE only) ──────────────
if (mode === 'JOURNAL' || mode === 'REFLECT' || mode === 'PRODUCE') {
  try {
    const QUARANTINE_TIMEOUT_MS = 3000;
    response = await Promise.race([
      quarantinePraise(response, mode),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve(response), QUARANTINE_TIMEOUT_MS)
      ),
    ]);
  } catch (quarantineError) {
    logger.warn(
      {
        error: quarantineError instanceof Error
          ? quarantineError.message
          : String(quarantineError),
      },
      'chris.engine.praise_quarantine.error',
    );
  }
}

// ── Contradiction detection (JOURNAL and PRODUCE only) ──────────────
// [existing block lines 207-228]
```

[VERIFIED: engine.ts structure confirmed]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Prompt-only anti-flattery rule | Deterministic Haiku post-processing | Phase 9 (D025) | Flattery elimination becomes session-invariant; prompt drift cannot reintroduce it |

**Deprecated/outdated:**
- Relying solely on `CONSTITUTIONAL_PREAMBLE` to prevent flattery: preamble is a floor (D022), not a guarantee. Post-processing is the enforcement layer.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Haiku prompt text as written will reliably detect "Great question!" type openers without false-positiving on mid-response positive language | Code Examples | Rewriter changes substantive content; needs empirical prompt tuning |
| A2 | `max_tokens: 1024` is sufficient for typical response rewrites | Code Examples | Truncated rewrite if response + rewrite overhead exceeds limit; bump to 2048 if needed |
| A3 | Providing only the response text (not the user's original message) is sufficient for Haiku to identify flattery in context | Code Examples | If Haiku needs user message for context judgment — a discretion item in CONTEXT.md — add it to the `messages` array |

**Verified claims:** All structural patterns (timeout, try/catch, stripFences, module interface, engine insertion point, mock pattern) are verified against actual source files.

## Open Questions (RESOLVED)

1. **Haiku prompt receives only response text vs. response + user message**
   - What we know: CONTEXT.md marks this as Claude's discretion
   - What's unclear: Whether Haiku needs the user question to correctly classify "That's interesting" as contextual vs. vacuous
   - Recommendation: Start with response-only (simpler, less token cost). If false positives appear in testing, add user message as context.
   - RESOLVED: Response-only (Claude's discretion, implemented in Plan 01 Task 1)

2. **max_tokens ceiling for rewrite**
   - What we know: Haiku response must contain the full rewritten response
   - What's unclear: Typical response length from Sonnet in JOURNAL/REFLECT/PRODUCE modes
   - Recommendation: Set `max_tokens: 1500` to be safe for most conversational responses. Add a comment noting this can be tuned.
   - RESOLVED: max_tokens: 1500 (implemented in Plan 01 Task 1)

## Environment Availability

Step 2.6: SKIPPED — no external dependencies beyond existing Anthropic API (already integrated and tested in previous phases).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.2 |
| Config file | `vitest.config.ts` (root: src, include: `**/__tests__/**/*.test.ts`) |
| Quick run command | `npx vitest run src/chris/__tests__/praise-quarantine.test.ts` |
| Full suite command | `npm test` (Docker postgres + full vitest run) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYCO-04 | quarantinePraise rewrites reflexive opener in JOURNAL response | unit | `npx vitest run src/chris/__tests__/praise-quarantine.test.ts` | Wave 0 |
| SYCO-04 | quarantinePraise returns original when no flattery detected | unit | `npx vitest run src/chris/__tests__/praise-quarantine.test.ts` | Wave 0 |
| SYCO-04 | quarantinePraise passes through original on Haiku timeout | unit | `npx vitest run src/chris/__tests__/praise-quarantine.test.ts` | Wave 0 |
| SYCO-04 | quarantinePraise passes through original on Haiku error | unit | `npx vitest run src/chris/__tests__/praise-quarantine.test.ts` | Wave 0 |
| SYCO-04 | engine calls quarantinePraise for JOURNAL mode | unit | `npx vitest run src/chris/__tests__/engine.test.ts` | exists — needs new tests |
| SYCO-04 | engine calls quarantinePraise for REFLECT mode | unit | `npx vitest run src/chris/__tests__/engine.test.ts` | exists — needs new tests |
| SYCO-04 | engine calls quarantinePraise for PRODUCE mode | unit | `npx vitest run src/chris/__tests__/engine.test.ts` | exists — needs new tests |
| SYCO-05 | quarantinePraise returns original for COACH mode (no Haiku call) | unit | `npx vitest run src/chris/__tests__/praise-quarantine.test.ts` | Wave 0 |
| SYCO-05 | quarantinePraise returns original for PSYCHOLOGY mode (no Haiku call) | unit | `npx vitest run src/chris/__tests__/praise-quarantine.test.ts` | Wave 0 |
| SYCO-05 | engine does NOT call quarantinePraise for COACH | unit | `npx vitest run src/chris/__tests__/engine.test.ts` | exists — needs new tests |
| SYCO-05 | engine does NOT call quarantinePraise for PSYCHOLOGY | unit | `npx vitest run src/chris/__tests__/engine.test.ts` | exists — needs new tests |

### Sampling Rate

- **Per task commit:** `npx vitest run src/chris/__tests__/praise-quarantine.test.ts`
- **Per wave merge:** `npx vitest run` (unit suite only, fast)
- **Phase gate:** `npm test` (full Docker suite) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/chris/__tests__/praise-quarantine.test.ts` — covers all SYCO-04/05 module-level behaviors
- [ ] Mock for `../praise-quarantine.js` in `src/chris/__tests__/engine.test.ts` — prevents real Haiku calls from engine tests

*(Existing test infrastructure: vitest, mocking patterns all established. No framework install needed.)*

## Security Domain

> `security_enforcement` not explicitly set in `.planning/config.json` — treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a — internal engine processing, no new auth surface |
| V3 Session Management | no | n/a |
| V4 Access Control | no | n/a — quarantine only touches response text, no access logic |
| V5 Input Validation | yes | Response text passed to Haiku is already generated by Sonnet — same input surface as contradiction detection; no user-controlled injection risk |
| V6 Cryptography | no | n/a |

### Known Threat Patterns for Haiku Post-Processing

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via Haiku-rewritten response | Tampering | Haiku output is treated as plain text and returned to user — not executed or parsed as code; no injection risk |
| Response content modification beyond intended scope | Tampering | Prompt explicitly constrains Haiku to opening sentences only; test suite verifies body is unchanged |
| API key exposure in logs | Information Disclosure | Use structured logger (pino); never log API key; existing pattern confirmed in contradiction.ts |

**Assessment:** No new security surface introduced. Praise quarantine is a text transformation within an existing authenticated pipeline. The threat model is identical to contradiction detection.

## Sources

### Primary (HIGH confidence)

- `src/chris/engine.ts` — processMessage pipeline, contradiction detection block (lines 207-228), mode routing, existing import structure [VERIFIED: read in session]
- `src/llm/client.ts` — HAIKU_MODEL constant, anthropic client [VERIFIED: read in session]
- `src/chris/contradiction.ts` — Haiku call pattern, stripFences, never-throw contract, JSON parsing [VERIFIED: read in session]
- `src/chris/refusal.ts` — self-contained module pattern, type exports, function interface [VERIFIED: read in session]
- `src/chris/personality.ts` — buildSystemPrompt, CONSTITUTIONAL_PREAMBLE, mode routing context [VERIFIED: read in session]
- `src/chris/__tests__/engine.test.ts` — mock pattern for contradiction.js (line 123), vi.mock structure [VERIFIED: read in session]
- `.planning/phases/09-praise-quarantine/09-CONTEXT.md` — all locked decisions D-01 through D-08 [VERIFIED: read in session]
- `package.json` — dependency versions, test scripts [VERIFIED: read in session]
- `vitest.config.ts` — test configuration [VERIFIED: read in session]

### Secondary (MEDIUM confidence)

None — all claims are directly verified from codebase source files.

### Tertiary (LOW confidence)

- A1, A2, A3 in Assumptions Log — Haiku prompt behavior, token limits: not empirically tested; require execution-time validation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; existing patterns verified in source
- Architecture: HIGH — direct extension of contradiction detection pattern; both files read and verified
- Pitfalls: HIGH — derived from actual source code structure, not speculation
- Haiku prompt content: LOW — discretion item, requires empirical tuning

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable domain — Anthropic SDK, TypeScript, vitest are all pinned in package.json)
