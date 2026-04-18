---
phase: 14-capture-flow
plan: 02
type: execute
wave: 1
depends_on: [01]
files_modified:
  - src/decisions/triggers.ts
  - src/decisions/index.ts
autonomous: true
requirements: [CAP-01]
must_haves:
  truths:
    - "detectTriggerPhrase(text) returns match info for EN/FR/RU PRD phrases"
    - "detectTriggerPhrase rejects negated / meta-reference / past-tense phrasings"
    - "classifyStakes(text) returns structural | moderate | trivial and fail-closes to trivial on timeout / error / bad JSON"
    - "Phase A hit + Phase B structural is the ONLY combination that should downstream-activate capture"
  artifacts:
    - path: "src/decisions/triggers.ts"
      provides: "Phase A regex + Phase B Haiku stakes classifier (CAP-01 atomic)"
      exports: ["detectTriggerPhrase", "classifyStakes", "TriggerMatch", "StakesTier"]
  key_links:
    - from: "src/decisions/triggers.ts"
      to: "src/decisions/triggers-fixtures.ts"
      via: "pattern entries derived from fixture phrases"
      pattern: "triggers-fixtures"
    - from: "src/decisions/triggers.ts"
      to: "src/llm/prompts.ts"
      via: "STAKES_CLASSIFICATION_PROMPT import"
      pattern: "STAKES_CLASSIFICATION_PROMPT"
---

<objective>
Implement CAP-01 in full: Phase A bilingual trigger regex with negative lookahead guards (EN/FR/RU, PRD phrases per D-01 extended to 4 per language for D-03 parity) + Phase B Haiku stakes classifier (fail-closed to `trivial` per D-06, 3s hard timeout per D-08, no caching per D-07).

Purpose: Deterministic cheap gate before Haiku call (C3 mitigation) + semantic tier judgment. Only `structural` activates capture downstream.
Output: `src/decisions/triggers.ts` exporting `detectTriggerPhrase`, `classifyStakes`. Turns `src/decisions/__tests__/triggers.test.ts` from RED to GREEN.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/14-capture-flow/14-CONTEXT.md
@.planning/phases/14-capture-flow/14-RESEARCH.md
@src/chris/refusal.ts
@src/chris/engine.ts
@src/decisions/triggers-fixtures.ts
@src/llm/prompts.ts
@src/llm/client.ts
@src/decisions/__tests__/triggers.test.ts

<interfaces>
From src/chris/refusal.ts (mirror exactly — bilingual PatternEntry shape):
```typescript
type PatternEntry = [RegExp, number | null];  // [regex, capture_group_index]
const EN_PATTERNS: PatternEntry[] = [...];
const FR_PATTERNS: PatternEntry[] = [...];
const RU_PATTERNS: PatternEntry[] = [...];
// Iterate with .exec(); first match wins.
```

From src/llm/client.ts:
```typescript
export const anthropic: Anthropic;
export const HAIKU_MODEL: string;
```

From src/chris/engine.ts (fail-soft Haiku pattern to mirror verbatim):
```typescript
// detectMode(): Promise.race([anthropic.messages.create(...), setTimeout(resolve, TIMEOUT_MS)]);
// Try/catch wrapping; JSON.parse(stripFences(text)); default-value fallback on any failure.
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement detectTriggerPhrase (Phase A regex)</name>
  <files>src/decisions/triggers.ts, src/decisions/index.ts</files>
  <read_first>
    - src/chris/refusal.ts (full — lines 24–121 contain the PatternEntry convention, lookahead guards, iterate-with-exec loop)
    - src/decisions/triggers-fixtures.ts (positives + negatives to satisfy)
    - src/decisions/__tests__/triggers.test.ts (exact assertion shape — tests drive the API)
    - .planning/phases/14-capture-flow/14-CONTEXT.md §"Trigger regex & meta-guards" (D-01, D-02, D-03 full specs)
    - .planning/phases/14-capture-flow/14-RESEARCH.md §"Code Examples → Phase A Trigger Regex" (exact regex literals to reproduce)
  </read_first>
  <behavior>
    Tests in `triggers.test.ts` require:
    - `detectTriggerPhrase(text)` returns `{ trigger_phrase: string, language: 'en'|'fr'|'ru', topic: string | null } | null`.
    - Every EN/FR/RU positive yields a match whose `trigger_phrase` matches the fixture entry's canonical phrase (case-insensitive).
    - Every EN/FR/RU negative yields null (negations, meta-reference, past-tense reports all rejected).
    - Fixture parity `|EN|==|FR|==|RU|==4` is structurally enforced (assert at module-load via a compile-time-like check — e.g. a `const _ = ASSERT(...)` throwing if lengths differ).
  </behavior>
  <action>
    Create `src/decisions/triggers.ts`. Start with imports:

    ```typescript
    import Anthropic from '@anthropic-ai/sdk';
    import { anthropic, HAIKU_MODEL } from '../llm/client.js';
    import { STAKES_CLASSIFICATION_PROMPT } from '../llm/prompts.js';
    import { EN_POSITIVES, FR_POSITIVES, RU_POSITIVES } from './triggers-fixtures.js';
    import { logger } from '../observability/logger.js';  // or wherever the project logger lives — mirror refusal.ts import

    export type StakesTier = 'trivial' | 'moderate' | 'structural';

    export interface TriggerMatch {
      trigger_phrase: string;
      language: 'en' | 'fr' | 'ru';
      topic: string | null;
    }

    type PatternEntry = [RegExp, number | null, string];  // [regex, topic_capture_group, canonical_phrase]
    ```

    Declare EN_TRIGGER_PATTERNS, FR_TRIGGER_PATTERNS, RU_TRIGGER_PATTERNS. Use the RESEARCH.md §"Code Examples → Phase A Trigger Regex" regex literals VERBATIM but extend FR+RU to 4 entries each by adding:
    - FR: `/^(?!.*\b(?:ai\s+dit|n'?ai\s+pas)\b).*je\s+dois\s+choisir\s+(.+)/i` with canonical `"je dois choisir"`
    - RU: `/^(?!.*\b(?:сказал|не)\b).*мне\s+нужно\s+выбрать\s+(.+)/i` with canonical `"мне нужно выбрать"`

    Include in past-tense negative guard words: `told`, `said`, `mentioned`, `explained` for EN; `ai dit` for FR; `сказал`, `говорил` for RU. Include negation guards: `not`, `don't` for EN; `n'ai pas`, `ne` for FR; `не` for RU.

    Parity assertion at top of module (throws at import time if violated):
    ```typescript
    if (EN_TRIGGER_PATTERNS.length !== FR_TRIGGER_PATTERNS.length ||
        FR_TRIGGER_PATTERNS.length !== RU_TRIGGER_PATTERNS.length) {
      throw new Error(`triggers.ts: EN/FR/RU trigger pattern arrays must have equal length (D-03)`);
    }
    ```

    Implement `detectTriggerPhrase(text: string): TriggerMatch | null`:
    - Normalize: use `text` as-is (regex flags handle case).
    - Iterate EN then FR then RU, first match wins.
    - For each `[regex, groupIdx, canonical]`, call `regex.exec(text)`. If match:
      - `topic = groupIdx !== null ? match[groupIdx]?.trim() ?? null : null;`
      - return `{ trigger_phrase: canonical, language, topic }`.
    - If no match after all three languages, return null.

    Export from `src/decisions/index.ts` (add export line; do not reorder existing).
  </action>
  <verify>
    <automated>DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" npx vitest run src/decisions/__tests__/triggers.test.ts -t "detectTriggerPhrase\|parity\|positive\|negative"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "^export function detectTriggerPhrase" src/decisions/triggers.ts` returns 1.
    - `grep -c "^export type TriggerMatch\|^export interface TriggerMatch" src/decisions/triggers.ts` returns 1.
    - `grep -cE "EN_TRIGGER_PATTERNS|FR_TRIGGER_PATTERNS|RU_TRIGGER_PATTERNS" src/decisions/triggers.ts` returns ≥3.
    - `grep -c "je dois choisir" src/decisions/triggers.ts` returns ≥1 (4th FR pattern for parity).
    - `grep -c "мне нужно выбрать" src/decisions/triggers.ts` returns ≥1 (4th RU pattern for parity).
    - `grep -c "throw new Error.*D-03\|equal length" src/decisions/triggers.ts` returns ≥1 (parity assertion).
    - All triggers.test.ts cases about `detectTriggerPhrase`, fixture-parity, positives, and negatives pass: `npx vitest run src/decisions/__tests__/triggers.test.ts 2>&1 | grep -E "(detectTriggerPhrase|positives|negatives|parity)"` shows only `✓` not `✗`.
  </acceptance_criteria>
  <done>All `detectTriggerPhrase` test cases in `triggers.test.ts` are GREEN. Negated/meta/past-tense phrases still rejected. Parity invariant holds at import time.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement classifyStakes (Phase B Haiku + fail-closed)</name>
  <files>src/decisions/triggers.ts, src/decisions/index.ts</files>
  <read_first>
    - src/chris/engine.ts lines 60–120 (`detectMode()` fail-soft pattern — exact shape to mirror)
    - src/chris/engine.ts lines 230–265 (`Promise.race` timeout pattern used for contradiction detection)
    - src/decisions/triggers.ts (after Task 1 — add to same file)
    - src/llm/prompts.ts (confirm `STAKES_CLASSIFICATION_PROMPT` export exists)
    - src/decisions/__tests__/triggers.test.ts (`classifyStakes` assertions — timeout, valid JSON, invalid JSON)
  </read_first>
  <behavior>
    - `classifyStakes(text)` returns `Promise<StakesTier>`.
    - On happy path: parses Haiku's `{"tier":"structural"}` style JSON.
    - On timeout (> 3000ms): returns `'trivial'`.
    - On any exception (network, bad JSON, missing field, SDK throw): returns `'trivial'` (fail-closed per D-06).
    - No caching (D-07): every call hits Haiku (or the mock, in tests).
    - Logs `{ tier, latencyMs }` on success, `{ error, latencyMs }` on failure — never logs the raw input text (Security: Log exposure of decision content from RESEARCH §Security Domain).
  </behavior>
  <action>
    Append to `src/decisions/triggers.ts`:

    ```typescript
    const STAKES_TIMEOUT_MS = 3000;  // D-08
    const VALID_TIERS: ReadonlySet<StakesTier> = new Set(['trivial', 'moderate', 'structural']);

    function stripFences(s: string): string {
      // mirror the stripFences helper used by detectMode — if already imported from a shared util,
      // import it; otherwise inline: strip ```json ... ``` or ``` ... ``` wrappers.
      return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    }

    export async function classifyStakes(text: string): Promise<StakesTier> {
      const start = Date.now();
      try {
        const response = await Promise.race([
          anthropic.messages.create({
            model: HAIKU_MODEL,
            max_tokens: 30,
            system: [{
              type: 'text',
              text: STAKES_CLASSIFICATION_PROMPT,
              cache_control: { type: 'ephemeral' },
            }],
            messages: [{ role: 'user', content: text }],
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), STAKES_TIMEOUT_MS)),
        ]);
        if (!response) {
          logger.warn({ latencyMs: Date.now() - start }, 'decisions.stakes.timeout');
          return 'trivial';  // D-06 fail-closed on timeout
        }
        const block = response.content.find((b) => b.type === 'text');
        if (!block || block.type !== 'text') return 'trivial';
        const parsed = JSON.parse(stripFences((block as {text: string}).text));
        const tier = VALID_TIERS.has(parsed.tier) ? (parsed.tier as StakesTier) : 'trivial';
        logger.info({ tier, latencyMs: Date.now() - start }, 'decisions.stakes.classify');
        return tier;
      } catch (error) {
        logger.warn({
          error: error instanceof Error ? error.message : String(error),
          latencyMs: Date.now() - start,
        }, 'decisions.stakes.error');
        return 'trivial';  // D-06 fail-closed on exception
      }
    }
    ```

    Export `classifyStakes` and `StakesTier` from `src/decisions/index.ts` (add export lines; preserve existing).

    User message content goes in `messages[0].content`, NEVER into the system prompt (T-14-02-01 prompt-injection mitigation).
  </action>
  <verify>
    <automated>DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" npx vitest run src/decisions/__tests__/triggers.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "^export async function classifyStakes" src/decisions/triggers.ts` returns 1.
    - `grep -c "STAKES_TIMEOUT_MS.*3000" src/decisions/triggers.ts` returns 1.
    - `grep -c "return 'trivial'" src/decisions/triggers.ts` returns ≥2 (timeout + exception paths — D-06 fail-closed).
    - `grep -c "messages: \[{ role: 'user'" src/decisions/triggers.ts` returns ≥1 (user text in messages slot, NOT system — security T-14-02-01).
    - `grep -c "cache_control" src/decisions/triggers.ts` returns ≥1 (system prompt cached ephemeral).
    - No raw `text` parameter logged: `grep -E "logger\.(info|warn|error).*\btext\b" src/decisions/triggers.ts` returns 0.
    - `npx vitest run src/decisions/__tests__/triggers.test.ts` exits 0 (ALL triggers test cases GREEN).
  </acceptance_criteria>
  <done>`triggers.test.ts` fully GREEN — classifier returns parsed tier, fail-closes to `'trivial'` on timeout/invalid-JSON/exception; no user content leaks to logs; no user content reaches system prompt.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Greg's message text → Phase A regex | Arbitrary user-language text; regex must be RE2-safe (no ReDoS) |
| Greg's message text → Phase B Haiku system prompt | User text MUST go in `messages[].content`, never interpolated into system prompt |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14-02-01 | Tampering | STAKES_CLASSIFICATION_PROMPT | mitigate | User text passed via `messages[0].content`; system prompt is static; verified by grep acceptance criterion |
| T-14-02-02 | DoS (ReDoS) | Phase A regex patterns | mitigate | All patterns use lookahead-anchored-at-start `^(?!...)` + single capture group + no nested quantifiers; mirror refusal.ts which was reviewed; fixture negatives test resists catastrophic backtracking |
| T-14-02-03 | DoS (Haiku runaway) | classifyStakes | mitigate | 3s hard `Promise.race` timeout; fail-closed to `'trivial'` on expiry (never hangs the engine turn) |
| T-14-02-04 | Information Disclosure | classifyStakes logging | mitigate | Logger receives only `{tier, latencyMs}` / `{error message, latencyMs}` — raw user text never logged (grep criterion) |
| T-14-02-05 | Tampering | Prompt injection via user text nudging Haiku to misclassify | accept | Single-user bot; Greg is the only message source; worst case is a legitimate structural decision classified trivial (reverts to no-capture — same as fail-closed default) |
</threat_model>

<verification>
- `npx vitest run src/decisions/__tests__/triggers.test.ts` exits 0.
- All EN/FR/RU positive fixtures yield non-null matches; all negatives yield null.
- Parity invariant holds at module-load time.
- Stakes classifier fail-closes on timeout, invalid JSON, and exception.
</verification>

<success_criteria>
CAP-01 is satisfied end-to-end: Phase A regex correctly partitions trigger vs non-trigger; Phase B Haiku returns tier with fail-closed defaults; triggers.test.ts fully GREEN.
</success_criteria>

<output>
After completion, create `.planning/phases/14-capture-flow/14-02-SUMMARY.md`.
</output>
