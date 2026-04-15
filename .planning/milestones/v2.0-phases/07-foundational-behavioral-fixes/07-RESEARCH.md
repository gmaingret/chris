# Phase 7: Foundational Behavioral Fixes - Research

**Researched:** 2026-04-13
**Domain:** LLM prompt engineering, language detection, in-memory session state, TypeScript engine pipeline
**Confidence:** HIGH

## Summary

Phase 7 is a surgical, code-only change across three files (`engine.ts`, `personality.ts`, `prompts.ts`) plus one new file for refusal detection. The work falls into four independent tracks: (1) constitutional anti-sycophancy preamble prepended to all 6 mode system prompts, (2) refusal detection as engine pre-processing with session-scoped in-memory state, (3) language detection via `franc` as engine pre-processing with system prompt injection, and (4) question-pressure reduction in `JOURNAL_SYSTEM_PROMPT`. All four tracks are additive — no existing logic is removed, only extended.

The key architectural insight is that `processMessage()` in `engine.ts` already has a pre-processing slot pattern established by mute detection. Refusal and language detection slot into the same position. `buildSystemPrompt()` in `personality.ts` is the single injection point for all prompt modifications — it needs signature extension to accept `language` and `declinedTopics` parameters, then passes them into every mode's system prompt.

`franc` v6.2.0 is confirmed available in the npm registry, is ESM-only (matches `"type": "module"` in package.json), and returns the ISO 639-3 code `'und'` for undetermined short inputs — which aligns precisely with the LANG-02 short-message threshold rule. It is not currently installed.

**Primary recommendation:** Install `franc`, extend `buildSystemPrompt()` signature, add two pre-processing steps to `processMessage()` (refusal detection and language detection), update `JOURNAL_SYSTEM_PROMPT` question wording, and prepend constitutional preamble in `buildSystemPrompt()`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Claude writes the final preamble text using the M006 spec as intent (not verbatim copy). The preamble must encode: (1) usefulness over pleasantness, (2) agreement as conclusion not default, (3) The Hard Rule (no appeals to track record), (4) three forbidden behaviors (never resolve contradictions alone, never extrapolate to novel situations, never optimize for emotional satisfaction).
- **D-02:** Preamble is layered additively — prepended via `buildSystemPrompt()` in `src/chris/personality.ts`. Existing mode-specific guidance (e.g., COACH's directness) stays exactly as-is. The preamble is a floor, not a replacement (confirms D022).
- **D-03:** Refusals are lightweight session-scoped "not right now" deflections, not permanent topic bans. They reset naturally (on process restart or session boundary). Nothing eternal.
- **D-04:** Claude decides pipeline placement (before or after mode detection), persistence mechanism (in-memory vs DB), and exact regex patterns. The 15-20 patterns per language target from TRUST-01 stands but calibration is Claude's discretion.
- **D-05:** Pattern breadth is Claude's discretion — can include soft deflections ("let's move on") or stay strict ("I don't want to talk about X"). Err toward fewer false positives since the stakes are low.
- **D-06:** Questions become rare — roughly 1 in 5 JOURNAL responses should end with a question, down from the current "always ask enriching follow-ups" pattern.
- **D-07:** When Chris does ask, questions can be clarifying (to understand) or deepening (to help Greg think further). The interview-every-message pattern must stop.
- **D-08:** The JOURNAL_SYSTEM_PROMPT wording should shift from encouraging questions to permitting them occasionally. Exact phrasing is Claude's discretion.
- **D-09:** `franc` runs as engine pre-processing. Short messages (<4 words or <15 chars) inherit the language of the previous user message; default to English if no prior context (confirms D021).
- **D-10:** Claude decides how detected language is injected into system prompts — system prompt injection, replacing per-mode rules, or hybrid approach. The goal is a hard override that the LLM cannot ignore.
- **D-11:** Mode detection (Haiku) stays English-only. No changes to MODE_DETECTION_PROMPT for language handling.

### Claude's Discretion
- Final preamble prose (using M006 spec as intent)
- Refusal detection pipeline placement and persistence mechanism
- Refusal pattern breadth and exact regex patterns per language
- Language injection method into system prompts
- Whether to remove existing per-prompt "ALWAYS respond in same language" lines or keep them as backup
- `buildSystemPrompt()` signature changes needed to accept language and declined-topics parameters

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRUST-01 | Chris detects explicit refusals in EN/FR/RU via pattern matching (15-20 regex patterns per language) | New `detectRefusal()` function using regex per language; patterns documented below |
| TRUST-02 | Declined topics persist per-session and are injected into subsequent system prompts | In-memory Map keyed by chatId; injected via `buildSystemPrompt()` extension |
| TRUST-03 | Chris acknowledges a refusal once and never returns to the declined topic in the same conversation | Early-return refusal handler generates one-time acknowledgment; `buildSystemPrompt()` carries declinedTopics into all subsequent prompts |
| TRUST-04 | Refusal handling rule is present in all 6 mode system prompts | `buildSystemPrompt()` prepends preamble block that includes the "declined topics" rule |
| SYCO-01 | Constitutional anti-sycophancy preamble is prefixed to all 6 modes via `buildSystemPrompt()` | Preamble string constant prepended in `buildSystemPrompt()` switch default/all paths |
| SYCO-02 | The Hard Rule — Chris never tells Greg he is right because of who he is (no appeals to track record) | Encoded as explicit forbidden-pattern sentence in constitutional preamble |
| SYCO-03 | Three forbidden behaviors encoded as hard constraints | Encoded in constitutional preamble — never resolve contradictions alone, never extrapolate to novel situations, never optimize for emotional satisfaction |
| LANG-01 | Language detection via `franc` runs as engine pre-processing, not prompt rules | `franc` called in `processMessage()` before `detectMode()`, result passed through to `buildSystemPrompt()` |
| LANG-02 | Messages below 4 words or 15 characters inherit language of previous user message; default English if no prior | Word/char count check before `franc` call; fallback to `lastUserLanguage` from session state |
| LANG-03 | Detected language passed as hard system parameter overriding statistical bias from conversation history | Language injected into system prompt as `## Language Directive` section — authoritative override before all other rules |
| LANG-04 | Question-pressure reduced in JOURNAL prompt — questions are optional, Chris can simply respond | `JOURNAL_SYSTEM_PROMPT` rule updated from "may ask enriching follow-ups" to "questions are occasional, not expected" |
</phase_requirements>

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^4.1.2 | Unit testing | Already in devDependencies [VERIFIED: package.json] |
| typescript | ^5.7.0 | Language | Project standard [VERIFIED: package.json] |

### New Dependency
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| franc | 6.2.0 | Language detection | Specified by D021/LANG-01; lightweight, no API calls, supports EN/FR/RU [VERIFIED: npm registry] |

### Not Needed
| Rejected | Reason |
|----------|--------|
| franc-min | 187-language version; same API, adequate for EN/FR/RU only [VERIFIED: npm registry] |
| franc-all | 400+ language build; overkill; same API, larger bundle [ASSUMED] |
| langdetect | Node.js port of Google's language detect; heavier, less maintained [ASSUMED] |

**Installation:**
```bash
npm install franc
```

**Version verification:** franc@6.2.0 confirmed current via `npm show franc version`. [VERIFIED: npm registry, 2026-04-13]

**ESM compatibility:** `franc` is ESM-only. Project uses `"type": "module"` in package.json. Import as: `import { franc } from 'franc'`. No CJS shim needed. [VERIFIED: npm show franc readme, package.json]

## Architecture Patterns

### Recommended Project Structure
No new directories needed. New files:
```
src/chris/
├── engine.ts          # MODIFY — add refusal/language pre-processing steps
├── personality.ts     # MODIFY — extend buildSystemPrompt() signature, prepend preamble
├── refusal.ts         # NEW — detectRefusal(), session state, acknowledgment generation
src/llm/
├── prompts.ts         # MODIFY — JOURNAL_SYSTEM_PROMPT question-pressure wording
```

### Pattern 1: Engine Pre-Processing Slot (established by mute detection)

The existing `processMessage()` in engine.ts already demonstrates this pattern:

```typescript
// EXISTING PATTERN (from engine.ts, lines 102-122):
const muteResult = await detectMuteIntent(text);
if (muteResult.muted) {
  // early return path
  return ack;
}
// ... normal processing continues
const mode = await detectMode(text);
```

Refusal and language detection follow the identical slot pattern — run before `detectMode()`, return early or enrich state that flows downstream.

**When to use:** Any pre-processing that must happen before mode routing and may produce an early return or must influence the system prompt.

### Pattern 2: Session State via In-Memory Map

`franc` is synchronous and deterministic. Refusal state is session-scoped. Both are best served by module-level Maps in `src/chris/refusal.ts`:

```typescript
// Source: established pattern from proactive/state.ts, adapted for in-process state
// Session-scoped: resets on process restart (D-03: "nothing eternal")

// Declined topics — keyed by chatId string
const declinedTopics: Map<string, string[]> = new Map();

// Last detected language — keyed by chatId string (for LANG-02 short-message fallback)
const lastUserLanguage: Map<string, string> = new Map();
```

**Why in-memory, not DB:** D-03 explicitly says refusals are ephemeral. DB adds async overhead, migration, and persistence that Greg specifically rejected. Session map is ~5 lines, zero dependencies. [CITED: 07-CONTEXT.md D-03]

### Pattern 3: buildSystemPrompt() Signature Extension

Current signature:
```typescript
// Source: src/chris/personality.ts line 18
export function buildSystemPrompt(
  mode: ChrisMode,
  pensieveContext?: string,
  relationalContext?: string,
): string
```

Extended signature (new parameters appended, all optional to avoid breaking callers):
```typescript
export function buildSystemPrompt(
  mode: ChrisMode,
  pensieveContext?: string,
  relationalContext?: string,
  language?: string,           // ISO 639-3 code: 'eng', 'fra', 'rus', or undefined
  declinedTopics?: string[],   // extracted topic phrases, empty array if none
): string
```

The function prepends the constitutional preamble block and appends language/declined-topics directives to the mode-specific prompt. Existing callers (all mode handlers) pass no new arguments and receive the preamble by default.

### Pattern 4: Language Injection — Hard Override Block

Language must override statistical bias from conversation history (LANG-03). The safest injection point is the very beginning of the system prompt (after the preamble, before mode-specific content):

```typescript
// Injected block example — authoritative, explicit, hard to ignore
const LANGUAGE_DIRECTIVE = `## LANGUAGE OVERRIDE (MANDATORY)
The user's current message is in ${languageName}. You MUST respond in ${languageName}. 
This overrides any other language signals in conversation history. Do not respond in any other language.

`;
```

**Why not replace existing "ALWAYS respond in same language" lines:** Keep them as backup redundancy (D-10 discretion — "hybrid approach"). The injected hard override at the top takes precedence; the per-prompt lines act as secondary reinforcement.

### Pattern 5: Refusal Detection — Regex + Early Return

```typescript
// Source: new src/chris/refusal.ts
// Pattern mirrors detectMuteIntent() structure but is synchronous (no LLM call needed)

export interface RefusalResult {
  isRefusal: false;
} | {
  isRefusal: true;
  extractedTopic: string;  // best-effort extraction of what was declined
}

export function detectRefusal(text: string): RefusalResult
```

**Why synchronous:** Pattern matching is CPU-bound, microseconds. No network call. mute detection uses Haiku (LLM) because it needs duration parsing — refusal detection does not. [CITED: PLAN.md D020]

### Anti-Patterns to Avoid

- **Don't store declined topics in DB:** Contradicts D-03 "nothing eternal". Process restart should clear state.
- **Don't modify MODE_DETECTION_PROMPT for language:** D-11 explicitly forbids this.
- **Don't replace existing mode-prompt content:** Preamble is a floor, not replacement (D-02).
- **Don't call `franc` on every assistant response:** Only needed on incoming user messages.
- **Don't use `franc` result directly as ISO 639-1:** franc returns ISO 639-3 (`eng`, `fra`, `rus`). Map to display names for LLM injection.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Language detection | Custom trigram analysis | `franc` | 186-language model, battle-tested, synchronous, ~5 lines to call [VERIFIED: npm registry] |
| Language code display | Manual switch statement | `Intl.DisplayNames` or a simple map | 3 languages needed, small map is fine [ASSUMED] |

**Key insight:** The only custom code needed is regex patterns for refusal detection — and even those should be conservative (D-05: "err toward fewer false positives").

## Common Pitfalls

### Pitfall 1: franc Returns ISO 639-3, Not ISO 639-1
**What goes wrong:** `franc("bonjour")` returns `'fra'`, not `'fr'`. Injecting `'fra'` into the prompt is confusing to the LLM.
**Why it happens:** franc uses ISO 639-3 natively.
**How to avoid:** Map the three target codes to display names: `{ eng: 'English', fra: 'French', rus: 'Russian', und: null }`. If `null`, fall back to previous language or English.
**Warning signs:** LLM responds in wrong language; LLM writes `fra` in its response.

### Pitfall 2: franc Returns 'und' for Short Messages
**What goes wrong:** Single-word messages, emoji-heavy messages, or very short inputs return `'und'` (undetermined). If naively used, this triggers the English default.
**Why it happens:** franc's minimum effective length is ~10 characters (configurable via `minLength` option). [VERIFIED: franc source analysis]
**How to avoid:** Apply LANG-02 rule first: if text is < 4 words OR < 15 chars, skip franc entirely and inherit from `lastUserLanguage` Map. Only call franc on messages that pass the threshold.
**Warning signs:** Language switches to English after Greg sends a short "oui" or "да".

### Pitfall 3: Refusal Extraction Is Imprecise
**What goes wrong:** "I don't want to talk about my father" → topic extracted as "my father" → subsequent system prompt says "declined topic: my father" → LLM interprets narrowly and still asks about Greg's parents.
**Why it happens:** Topic extraction from natural language is hard without an LLM.
**How to avoid:** Store the full declined sentence as a "topic hint" alongside the extracted phrase. The system prompt injection should say "Greg declined this topic (exact phrase: '{originalSentence}')" — gives the LLM the raw signal.
**Warning signs:** Greg declines a topic and Chris immediately asks a related question.

### Pitfall 4: All 6 Mode Handlers Must Pass New Parameters
**What goes wrong:** `buildSystemPrompt()` accepts `language` and `declinedTopics` but callers don't pass them, so the parameters are always undefined.
**Why it happens:** 7 mode files (journal, interrogate, reflect, coach, psychology, produce, photos) all call `buildSystemPrompt()`. If only journal.ts is updated, the other 5 get no language override.
**How to avoid:** Language and declinedTopics must be surfaced from the engine layer and passed down to every handler. Either: (a) pass them as function arguments to each `handle*()` function, or (b) use a module-level session context that handlers read directly. Option (a) is more explicit and testable.
**Warning signs:** Language works in JOURNAL but not REFLECT or COACH.

### Pitfall 5: Constitutional Preamble Undermines COACH/PSYCHOLOGY's Existing Tone
**What goes wrong:** Preamble says "agreement is a conclusion, not a starting point" — COACH mode already says "be direct, don't sugarcoat." If the preamble contradicts COACH's language, the LLM receives mixed signals.
**Why it happens:** Preamble is generic; mode-specific guidance is specialized.
**How to avoid:** Write preamble language that reinforces rather than restates mode guidance. COACH already handles directness — the preamble should cover the anti-sycophancy angle that COACH doesn't explicitly address (The Hard Rule, forbidden behaviors).
**Warning signs:** COACH responses become more verbose or mealy-mouthed after preamble is added.

### Pitfall 6: ESM Import of franc
**What goes wrong:** `const franc = require('franc')` fails at runtime.
**Why it happens:** franc 6.x is ESM-only. Project uses `tsx` for dev and TypeScript compilation — both support ESM, but require `import` syntax.
**How to avoid:** `import { franc } from 'franc'` — standard ESM import. Already aligned with project `"type": "module"`.
**Warning signs:** `Error: require() of ES module franc is not supported`.

## Code Examples

### franc Usage — Language Detection with Threshold
```typescript
// Source: verified against franc v6.2.0 source analysis
import { franc } from 'franc';

const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English',
  fra: 'French',
  rus: 'Russian',
};

function detectLanguage(
  text: string,
  previousLanguage: string | null,
): string {
  // LANG-02: short message threshold
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount < 4 || text.length < 15) {
    return previousLanguage ?? 'English';
  }

  // franc returns ISO 639-3 code or 'und' for undetermined
  const detected = franc(text, { only: ['eng', 'fra', 'rus'] });
  const languageName = LANGUAGE_NAMES[detected];

  if (!languageName) {
    // 'und' or unrecognized — fall back to previous
    return previousLanguage ?? 'English';
  }

  return languageName;
}
```

### buildSystemPrompt() — Extended Signature with Preamble
```typescript
// Source: src/chris/personality.ts (existing pattern, extended)
const CONSTITUTIONAL_PREAMBLE = `## Core Principles (Always Active)
Your job is to be useful to Greg, not pleasant. Agreement is something you arrive at after examination — never your starting point. Greg will tell you when he wants emotional support; assume the rest of the time he wants honest pressure.

**The Hard Rule:** Never tell Greg he is right because of who he is. His track record, past wins, and reputation are not evidence for current claims. Evaluate arguments on their merits alone.

**Three Forbidden Behaviors:**
1. Never resolve contradictions on your own — surface them, don't paper over them.
2. Never extrapolate from past patterns to novel situations — what worked before is not a guarantee.
3. Never optimize for Greg's emotional satisfaction — optimize for accuracy and usefulness.

`;

export function buildSystemPrompt(
  mode: ChrisMode,
  pensieveContext?: string,
  relationalContext?: string,
  language?: string,
  declinedTopics?: string[],
): string {
  // Build mode-specific body first
  const body = buildModeBody(mode, pensieveContext, relationalContext);

  // Assemble: preamble + body + language directive + declined topics
  let prompt = CONSTITUTIONAL_PREAMBLE + body;

  if (language) {
    prompt += `\n\n## Language Directive (MANDATORY)\nRespond in ${language} only. This overrides any language signals in conversation history.`;
  }

  if (declinedTopics && declinedTopics.length > 0) {
    const topicList = declinedTopics.map(t => `- "${t}"`).join('\n');
    prompt += `\n\n## Declined Topics (Do Not Return To)\nGreg has explicitly declined to discuss these topics this session. Acknowledge was given. Do not raise them again:\n${topicList}`;
  }

  return prompt;
}
```

### Refusal Detection — Pattern-Based Synchronous
```typescript
// Source: new src/chris/refusal.ts — mirrors mute detection structure

// Session-scoped declined topics (keyed by chatId)
const sessionDeclinedTopics = new Map<string, string[]>();
const sessionLastLanguage = new Map<string, string>();

// Refusal patterns — err toward precision over recall (D-05)
const REFUSAL_PATTERNS: Record<string, RegExp[]> = {
  en: [
    /\b(i\s+don'?t\s+want\s+to\s+talk\s+about)\b/i,
    /\b(let'?s?\s+(not|move\s+on|change\s+the\s+subject))\b/i,
    /\b(please\s+don'?t\s+(bring\s+up|mention|ask\s+about))\b/i,
    /\b(i'?d?\s+rather\s+not\s+(discuss|talk\s+about|get\s+into))\b/i,
    /\b(drop\s+it|leave\s+it|enough\s+about)\b/i,
    // ... 10-15 more per D-01 target
  ],
  fr: [
    /\b(je\s+ne\s+veux\s+pas\s+(en\s+)?parler)\b/i,
    /\b(laisse\s+(tomber|ça)|passons\s+à\s+autre\s+chose)\b/i,
    /\b(n'?en\s+parlons\s+plus|changeons\s+de\s+sujet)\b/i,
    // ...
  ],
  ru: [
    /я\s+не\s+хочу\s+(об\s+этом\s+)?говорить/i,
    /давай\s+(не\s+будем|сменим\s+тему)/i,
    /оставь\s+(это|тему)/i,
    // ...
  ],
};
```

### engine.ts — Pre-Processing Slot Addition
```typescript
// Source: src/chris/engine.ts — new steps added after mute check (existing pattern)
// Step 1: mute (existing)
const muteResult = await detectMuteIntent(text);
if (muteResult.muted) { /* ... */ }

// Step 2: refusal detection (new — synchronous)
const chatKey = chatId.toString();
const refusalResult = detectRefusal(text);
if (refusalResult.isRefusal) {
  addDeclinedTopic(chatKey, refusalResult.extractedTopic);
  const ack = generateRefusalAcknowledgment();  // simple template, no LLM
  await saveMessage(chatId, 'USER', text, 'JOURNAL');
  await saveMessage(chatId, 'ASSISTANT', ack, 'JOURNAL');
  return ack;
}

// Step 3: language detection (new — synchronous after franc install)
const previousLanguage = getLastUserLanguage(chatKey);
const detectedLanguage = detectLanguage(text, previousLanguage);
setLastUserLanguage(chatKey, detectedLanguage);

// Step 4: mode detection (existing)
const mode = await detectMode(text);

// Step 5: route to handler — pass language and declinedTopics to handler
const declinedTopics = getDeclinedTopics(chatKey);
// ... handlers need language + declinedTopics passed through
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "ALWAYS respond in same language" prompt rule | `franc` engine pre-processing + hard directive | Phase 7 | Eliminates statistical bias from long English conversation history |
| No refusal state | Session-scoped in-memory Map | Phase 7 | TRUST-01-03 compliance |
| No anti-sycophancy constraint | Constitutional preamble in all 6 prompts | Phase 7 | SYCO-01-03 compliance |
| JOURNAL always ends with question | Questions permitted but not required (~1 in 5) | Phase 7 | LANG-04 compliance |

**Deprecated/outdated:**
- Per-prompt "ALWAYS respond in same language" lines: kept as redundant backup but superseded by engine-level detection (D-10 hybrid approach).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | franc-min (6.2.0) is functionally equivalent to franc with the `only` option | Standard Stack | If franc-min has different API, switch to franc — both at same version |
| A2 | `Intl.DisplayNames` is available in Node 24 for language name lookup | Code Examples | Use a hardcoded 3-entry map instead — minimal risk |
| A3 | The 15-20 refusal patterns per language target is sufficient to cover Greg's natural phrasing | Common Pitfalls | Planner should note that patterns are tunable — start conservative, expand from real usage |

## Open Questions

1. **Handler signature propagation**
   - What we know: 7 handler files call `buildSystemPrompt()`. Language and declinedTopics must reach them.
   - What's unclear: Whether to add `language` and `declinedTopics` as parameters to every `handle*()` function (explicit, testable) or use a module-level context object (less boilerplate).
   - Recommendation: Explicit function parameters — matches existing pattern (`pensieveContext`, `relationalContext` are already explicit). Cleaner to test.

2. **Refusal acknowledgment language**
   - What we know: Greg writes refusals in EN/FR/RU. Acknowledgment should match Greg's language.
   - What's unclear: Whether to use a template ("Got it.") or a Sonnet-generated response in the correct language.
   - Recommendation: Template strings per language (3 languages, 1-2 variants each) — avoids LLM cost for a simple acknowledgment. The session already has detected language available.

3. **PHOTOS mode**
   - What we know: PHOTOS mode uses `JOURNAL_SYSTEM_PROMPT` (personality.ts line 44) and is in the VALID_MODES set.
   - What's unclear: Whether PHOTOS-specific behavior needs special handling for declined topics or language detection.
   - Recommendation: PHOTOS inherits from JOURNAL via `buildSystemPrompt()` — no special case needed.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| franc | LANG-01 | Not installed | 6.2.0 available | None — install required |
| Node.js | Runtime | Available | v24.14.1 | — |
| vitest | Unit tests | Installed | ^4.1.2 | — |
| TypeScript | Build | Installed | ^5.7.0 | — |
| postgres (live) | Integration tests | Assumed running | — | Docker (see CLAUDE.md memory) |

**Missing dependencies with no fallback:**
- `franc` — must be installed: `npm install franc`

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.2 |
| Config file | vitest.config.ts (or package.json scripts.test:unit) |
| Quick run command | `npm run test:unit` |
| Full suite command | `npm test` (runs scripts/test.sh — includes Docker/postgres integration tests) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRUST-01 | detectRefusal() returns isRefusal:true for EN/FR/RU patterns | unit | `npm run test:unit -- --reporter=verbose src/chris/__tests__/refusal.test.ts` | No — Wave 0 |
| TRUST-02 | declinedTopics injected into buildSystemPrompt output | unit | `npm run test:unit -- src/chris/__tests__/personality.test.ts` | No — Wave 0 |
| TRUST-03 | processMessage returns acknowledgment on refusal, does not re-raise topic | unit | `npm run test:unit -- src/chris/__tests__/engine-refusal.test.ts` | No — Wave 0 |
| TRUST-04 | All 6 mode prompts contain declined-topics section when topics present | unit | included in personality.test.ts | No — Wave 0 |
| SYCO-01 | buildSystemPrompt() output starts with constitutional preamble for all modes | unit | included in personality.test.ts | No — Wave 0 |
| SYCO-02 | Preamble text contains Hard Rule prohibition | unit | included in personality.test.ts (string assertion) | No — Wave 0 |
| SYCO-03 | Preamble text encodes all three forbidden behaviors | unit | included in personality.test.ts (string assertion) | No — Wave 0 |
| LANG-01 | detectLanguage() is called in processMessage() before detectMode() | unit | included in engine-refusal.test.ts (mock call order) | No — Wave 0 |
| LANG-02 | Short messages inherit previous language | unit | `npm run test:unit -- src/chris/__tests__/language.test.ts` | No — Wave 0 |
| LANG-03 | Language directive present in buildSystemPrompt output when language set | unit | included in personality.test.ts | No — Wave 0 |
| LANG-04 | JOURNAL_SYSTEM_PROMPT does not use "enriching follow-up questions" pattern | unit | included in personality.test.ts (string assertion) | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test:unit`
- **Per wave merge:** `npm test` (full suite with Docker postgres)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/chris/__tests__/refusal.test.ts` — covers TRUST-01, TRUST-03
- [ ] `src/chris/__tests__/language.test.ts` — covers LANG-01, LANG-02
- [ ] `src/chris/__tests__/personality.test.ts` — covers TRUST-02, TRUST-04, SYCO-01-03, LANG-03, LANG-04
- [ ] `src/chris/__tests__/engine-refusal.test.ts` — covers TRUST-03 (engine integration)
- [ ] franc install: `npm install franc`

## Security Domain

Security enforcement is not explicitly disabled. Applying relevant ASVS categories to this phase's tech surface.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No auth changes |
| V3 Session Management | Yes | In-memory session state — no sensitive data stored (topic phrases only); resets on restart |
| V4 Access Control | No | No access control changes |
| V5 Input Validation | Yes | Regex pattern matching on user input — regex is defensive read-only |
| V6 Cryptography | No | No cryptographic operations |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Regex ReDoS on refusal patterns | Denial of Service | Keep patterns simple; avoid catastrophic backtracking (e.g., no `(a+)+` style). Test patterns with long inputs. |
| Topic injection via refusal text | Tampering | Store full original sentence as a string, not as executable content. System prompt injection is LLM-facing text only — no SQL/shell. |
| Session state leakage between users | Information Disclosure | Map keyed by `chatId.toString()` — verified single-user system (D009: multi-user out of scope). Low risk. |

## Sources

### Primary (HIGH confidence)
- `src/chris/engine.ts` — processMessage() pipeline and mute detection slot pattern [VERIFIED: file read]
- `src/chris/personality.ts` — buildSystemPrompt() current signature [VERIFIED: file read]
- `src/llm/prompts.ts` — all 6 mode system prompts [VERIFIED: file read]
- `07-CONTEXT.md` — all locked decisions D-01 through D-11 [VERIFIED: file read]
- `REQUIREMENTS.md` — TRUST-01-04, SYCO-01-03, LANG-01-04 [VERIFIED: file read]
- npm registry — franc 6.2.0 confirmed current, ESM-only [VERIFIED: npm show franc]
- franc v6.2.0 source analysis — API: `franc(text, {only, minLength})` returns ISO 639-3 or 'und' [VERIFIED: WebFetch github.com/wooorm/franc]

### Secondary (MEDIUM confidence)
- M006_Trustworthy_Chris.md — preamble draft intent and target behaviors [VERIFIED: file read]
- `src/proactive/mute.ts` — mute detection pattern to mirror [VERIFIED: file read]

### Tertiary (LOW confidence)
- None — all claims verified in this session

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — franc version verified via npm registry, project package.json verified
- Architecture: HIGH — all key files read; patterns established from existing code
- Pitfalls: HIGH — most derived from code inspection + franc API analysis; regex ReDoS pattern is standard security knowledge
- Refusal patterns: MEDIUM — English patterns are well-understood; French/Russian patterns need native-speaker validation

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable domain — franc API won't change; prompt engineering knowledge is durable)
