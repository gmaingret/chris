# Phase 14: Capture Flow — Research

**Researched:** 2026-04-15
**Domain:** Decision-trigger detection + conversational Haiku extraction + engine pre-processor wiring on the existing Chris bot (Grammy / Drizzle / Postgres / Anthropic SDK)
**Confidence:** HIGH (grounded in direct reads of the live codebase + frozen CONTEXT.md decisions)

## Summary

Phase 14 sits atop a fully-shipped Phase 13 foundation: the `decisions`, `decision_events`, and `decision_capture_state` tables exist, the `transitionDecision()` chokepoint is live with two distinct error classes and optimistic concurrency, and `getActiveDecisionCapture(chatId)` already returns `null`-clean. Phase 14 adds the conversational layer that drives those primitives: two-phase trigger detection (regex + Haiku stakes), a single greedy Haiku extractor per turn, a one-shot vague-prediction validator, an engine pre-processor chain reordering (PP#0 + PP#1 before mute/refusal/language/mode), one new table (`decision_trigger_suppressions`), and a `/decisions suppress <phrase>` slash command.

The existing codebase provides tight templates for every new component: `src/chris/refusal.ts` is the shape for Phase A trigger regex (per-language `PatternEntry[]` + negative-lookbehind meta-guards). `detectMode()` in `engine.ts` is the fail-soft Haiku structured-output pattern (JSON schema in system prompt, `stripFences`, try/catch, default-value fallback) reused for the stakes classifier, the capture extractor, the vague validator, and the resolve-by parser. `detectContradictions()` is invoked verbatim by LIFE-05 (0.75 threshold + 3s timeout already hardcoded). `bot.command('sync', ...)` is the slash-command template. The Phase 13 `src/decisions/__tests__/` suite demonstrates the live-Docker-Postgres test pattern (beforeAll/afterAll/afterEach truncation).

**Primary recommendation:** Mirror existing module shapes mechanically. New code lives in `src/decisions/triggers.ts`, `src/decisions/capture.ts`, `src/decisions/suppressions.ts` (+ fixtures file), schema extension in `src/db/schema.ts` + a migration `0004_*.sql`, and the engine pre-processor block inserted at the top of `processMessage()` BEFORE the existing mute pre-processor at line 140. Every Haiku call reuses the `detectMode()` structured-output-plus-fail-soft shape. No new infrastructure is invented.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Phase A regex = PRD phrases only (EN: `I'm thinking about` / `I need to decide` / `I'm weighing` / `I'm not sure whether`; FR: `je réfléchis à` / `je dois décider` / `j'hésite`; RU: `я думаю о` / `мне нужно решить` / `я колеблюсь`). Extensions deferred.
- **D-02:** Meta-reference guards = hard negative-lookbehind regex (no Haiku to reject obvious negations). Mirrors `refusal.ts` discipline.
- **D-03:** Cardinality CI guard = shared fixture file; test asserts `|EN| == |FR| == |RU|`. No per-phrase semantic-id parity.
- **D-04:** Abort phrases (final): EN `never mind` / `nevermind` / `stop` / `skip`; FR `annule` / `laisse tomber` / `oublie`; RU `отмена` / `забудь` / `пропусти`. Case-insensitive word/prefix match against trimmed user message. No Haiku abort-intent fallback.
- **D-05:** Stakes-classifier prompt = tier definitions + 3 positive examples per tier (work / relationships / finances). Negative examples deferred.
- **D-06:** Haiku stakes failure mode = **fail-closed** → treat as `trivial` → no capture → fall through.
- **D-07:** No caching of stakes verdicts.
- **D-08:** Stakes-classifier timeout = **3s hard cap**, matching `detectContradictions`.
- **D-09:** Capture extractor = **single greedy Haiku structured-output pass per user turn**. Input: current draft jsonb + user reply + canonical slot schema. Output: updated draft jsonb. One Haiku call per capture turn, not per slot.
- **D-10:** Stage ordering = suggested canonical (`DECISION → ALTERNATIVES → REASONING → PREDICTION → FALSIFICATION`) for the question Chris asks; extractor accepts ANY slot in ANY reply.
- **D-11:** 3-turn follow-up cap behavior = **auto-commit as `open-draft` silently** at turn 3. Writes `decisions` row, appends `decision_events`, writes Pensieve entry tagged `DECISION`, clears `decision_capture_state`. No confirmation prompt.
- **D-12:** Re-trigger mid-capture = ignored; stay on current capture. PP#0 routes to `handleCapture()` regardless.
- **D-13:** Vagueness detection = Haiku judgment with hedge-word prior (hedge words seed; Haiku evaluates `prediction + falsification_criterion` together for concrete-observable falsifiability).
- **D-14:** Pushback UX = **one round, at the FALSIFICATION slot** (after PREDICTION + FALSIFICATION both filled). Validator runs once; next user reply accepted regardless.
- **D-15:** Second-vague landing = **`open-draft`** (never force-accept to `open`).
- **D-16:** Phase-14 suppression surface = `/decisions suppress <phrase>` only. Phrase-only, case-insensitive substring. No id-based, no list, no unsuppress.
- **D-17:** Suppression persistence = DB-backed, not in-memory; substring match applied to full user message before regex evaluation.
- **D-18:** `resolve_by` parser = Haiku structured-output, 2s timeout.
- **D-19:** Resolve-by fallback = **one explicit clarifier turn** ("a week, a month, three months, or a year?"). If still unparseable → silent `+30d` BUT loudly announced in reply ("I'll check back in a month — you can change this later.").
- **D-20:** LIFE-05 fires **exactly once**, on the **first commit landing at `status='open'`** (NOT on `open-draft` commits). Fire-and-forget; 0.75 threshold; 3s timeout. No re-scan when a draft later promotes.
- **D-21:** Contradictions surface via existing `formatContradictionNotice` path in Chris's NEXT normal turn — not during capture.
- **D-22:** `language_at_capture` populated by `franc` on the exact triggering message; stored on draft, copied into `decisions.language_at_capture` at first commit; never updated.
- **D-23:** `open-draft → open` promotion happens **only during active capture** when required slots fill. No background sweep, no `/decisions promote` command. Drafts age out via Phase-13's 24h GC.
- **D-24:** PP#0 (active-capture check) + PP#1 (trigger detection) added to `engine.ts::processMessage()` in exact order, BEFORE mute/refusal/language/mode detection. Phase 14 implements the `CAPTURING` handler; Phase 16 fills resolution/post-mortem handlers but the branch structure ships here.
- **D-25:** Abort-phrase check evaluated INSIDE PP#0 (handler entry) — clears active state and falls through.

### Claude's Discretion

- Exact Drizzle schema for `decision_trigger_suppressions` (single-column text list vs structured per-chat table with timestamps) — planner's call.
- Whether `resolve_by` Haiku parser is colocated in `capture.ts` or a dedicated `src/decisions/resolve-by.ts` — colocate unless tests argue otherwise.
- Prompt wording for the one vague-pushback question and the resolve-by clarifier question in EN/FR/RU — planner drafts, executor can tune; must preserve neutrality.
- Whether stakes-classifier Haiku call runs in parallel with next Chris response pipeline or inline — default inline unless profiling shows lag.
- File split within `src/decisions/` for capture-layer code (one `capture.ts` vs multiple).

### Deferred Ideas (OUT OF SCOPE)

- Extended trigger phrases ("should I", "devrais-je", "стоит ли").
- Haiku abort-intent fallback for off-phrase aborts.
- Negative examples in stakes-classifier prompt.
- `/decisions suppress id:<uuid>` form.
- Full CRUD for suppression (`list` / `unsuppress`) — Phase 17.
- Sweep-based `open-draft → open` auto-promotion — rejected permanently.
- `/decisions promote <id>` manual command — rejected for Phase 14.
- Stakes-verdict caching by phrase hash.
- Per-phrase semantic-id parity guard across EN/FR/RU.
- Two rounds of vague-prediction pushback — rejected.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAP-01 | Two-phase detection: regex (EN/FR/RU) + Haiku stakes classifier; only `structural` activates capture | `refusal.ts` per-language `PatternEntry[]` + negative-lookbehind template; `detectMode()` Haiku fail-soft template |
| CAP-02 | Conversational 5-slot capture (Haiku structured-output extraction, one-message multi-answer consolidation) | `detectMode()` structured-output shape; Phase 13 `decision_capture_state` jsonb draft column already shipped |
| CAP-03 | 3-turn cap + EN/FR/RU abort phrase | Phrase list locked in D-04; turn counter lives in `draft` jsonb (update helper call per turn) |
| CAP-04 | `open-draft` partial-commit path | Status enum already includes `open-draft` (Phase 13); `transitionDecision()` legal map already permits `null`→`open-draft` INSERT |
| CAP-05 | Natural-language `resolve_by` + 7/30/90/365d fallback ladder (clarifier, not silent) | Haiku structured-output pattern; 2s timeout; `parseMuteDuration` in `src/proactive/mute.ts` is the closest analog |
| CAP-06 | `/decisions suppress <phrase>` persistent (substring match, case-insensitive) | `bot.command('sync', handleSyncCommand)` template at `src/bot/bot.ts:22`; new table required |
| LIFE-05 | Contradiction detection extended to `decisions.reasoning` at first `open` commit | `detectContradictions()` already has 0.75 threshold + 3s gate; invoke with `decisions.reasoning` text, fire-and-forget via `void` |
| SWEEP-03 | Engine pre-processor #0 checks `decision_capture_state` BEFORE mute/refusal/language/mode | Existing preprocessor chain in `engine.ts` lines 140–183; insert block at top of `try { ... }` in `processMessage()` |

## Project Constraints (from CLAUDE.md)

`./CLAUDE.md` does not exist at the repo root. No per-repo constraint file loaded. Auto-memory reminds: **always run full Docker tests** (never skip integration tests, always start real Postgres). This matches `scripts/test.sh` and prior-phase CONTEXT observations.

## Standard Stack

### Core (already installed — verified in `package.json`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | ^0.80.0 | Haiku + Sonnet invocation for stakes classifier, extractor, vague validator, resolve-by parser | D001 three-tier LLM — Haiku is the canonical cheap classifier across Chris [VERIFIED: package.json] |
| `drizzle-orm` | ^0.45.2 | Schema for new `decision_trigger_suppressions` table; existing decision tables | Entire schema layer already uses it; migrations auto-run via `src/db/migrate.ts` [VERIFIED: package.json + schema.ts] |
| `drizzle-kit` | ^0.31.10 | Generate migration 0004 via `npm run db:generate` | Existing migrations 0000–0003 were generated this way; snapshot file lives in `src/db/migrations/meta/` [VERIFIED: package.json] |
| `franc` | ^6.2.0 | `language_at_capture` detection (D-22) | Already wrapped by `src/chris/language.ts::detectLanguage`; EN/FR/RU only [VERIFIED: package.json + language.ts] |
| `grammy` | ^1.31.0 | Slash command `/decisions suppress <phrase>` via `bot.command('decisions', ...)` | Existing `/sync` command uses same pattern [VERIFIED: bot.ts:22] |
| `vitest` | ^4.1.2 | Unit + integration tests against live Docker Postgres | Phase 13 test suite (`src/decisions/__tests__/*.test.ts`) is the template [VERIFIED: package.json] |

**No new dependencies required.** Every capability Phase 14 needs is already in the tree.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Haiku structured-output for stakes classifier | Regex-only tier heuristics | Regex cannot evaluate "is this structural" — tier boundaries require semantic judgment (D-05 tier defs); regex-only would over-trigger on every PRD phrase match |
| `franc` at capture-open time | `getLastUserLanguage(chatId)` | D-22 explicitly rejects this — franc on the exact triggering message is locked |
| DB-backed suppressions | In-memory `Map<chatId, string[]>` | D-17 explicitly requires persistence across restarts |

## Architecture Patterns

### Recommended Project Structure

```
src/decisions/
├── capture-state.ts       # Phase 13 READ helper — EXTEND with write helpers (createDraft/updateDraft/clearCapture)
├── lifecycle.ts           # Phase 13 chokepoint — NO CHANGES; just called from capture commit
├── errors.ts              # Phase 13 — NO CHANGES
├── regenerate.ts          # Phase 13 — NO CHANGES
├── index.ts               # Phase 13 — may re-export new modules
├── triggers.ts            # NEW — Phase A regex + Phase B Haiku stakes classifier (CAP-01)
├── triggers-fixtures.ts   # NEW — shared EN/FR/RU positive + negative phrase fixture (D-03 parity guard)
├── capture.ts             # NEW — handleCapture(chatId, text, state), Haiku extractor, 3-turn cap, commit (CAP-02/03/04)
├── vague-validator.ts     # NEW — hedge-word prior + Haiku judgment (D-13, D-14)
├── resolve-by.ts          # NEW (or folded into capture.ts) — Haiku NL parser + clarifier ladder (D-18, D-19)
├── suppressions.ts        # NEW — DB helpers: addSuppression, listSuppressions(chatId), isSuppressed(text, chatId)
└── __tests__/
    ├── triggers.test.ts           # NEW — fixture parity test + negative-lookbehind assertions
    ├── capture.test.ts            # NEW — stage progression, greedy multi-slot fill, 3-turn cap, abort
    ├── vague-validator.test.ts    # NEW — hedge-word prior behavior, one-pushback discipline
    ├── resolve-by.test.ts         # NEW — NL parsing + clarifier + +30d default-with-announcement
    ├── suppressions.test.ts       # NEW — persistence across sim'd restart, substring match
    ├── engine-capture.test.ts     # NEW — PP#0/PP#1 ordering, mid-capture re-trigger ignored, abort falls through
    └── (existing tests unchanged)

src/db/schema.ts           # EXTEND — add decisionTriggerSuppressions table
src/db/migrations/
├── 0004_decision_trigger_suppressions.sql   # NEW — drizzle-kit generated
└── meta/0004_snapshot.json                  # NEW — auto-generated

src/chris/engine.ts        # EXTEND — insert PP#0 + PP#1 at top of processMessage() try-block, before line 140

src/bot/bot.ts             # EXTEND — register bot.command('decisions', handleDecisionsCommand) BEFORE bot.on('message:text')
src/bot/handlers/
└── decisions.ts           # NEW — /decisions suppress <phrase> handler (mirrors sync.ts shape)

src/llm/prompts.ts         # EXTEND — add STAKES_CLASSIFICATION_PROMPT, CAPTURE_EXTRACTION_PROMPT, VAGUE_VALIDATOR_PROMPT, RESOLVE_BY_PARSER_PROMPT

scripts/test.sh            # EXTEND — append MIGRATION_4_SQL="src/db/migrations/0004_*.sql"
```

### Pattern 1: Fail-Soft Haiku Structured Output

**What:** Every Phase 14 Haiku call follows the exact shape of `detectMode()` in `src/chris/engine.ts:71–115`.

**When to use:** Stakes classifier, capture extractor, vague validator, resolve-by parser — all four Haiku calls in Phase 14.

**Example (from `src/chris/engine.ts:71–115`):**
```typescript
// Source: src/chris/engine.ts (verbatim shape to mirror) [VERIFIED: live read]
export async function detectMode(text: string): Promise<ChrisMode> {
  const start = Date.now();
  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 50,                           // classifiers: < 200
      system: [{
        type: 'text',
        text: MODE_DETECTION_PROMPT,
        cache_control: { type: 'ephemeral' },   // always cache the system prompt
      }],
      messages: [{ role: 'user', content: text }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') return 'JOURNAL';   // fail-soft default
    const cleaned = stripFences((textBlock as {text: string}).text);
    const parsed = JSON.parse(cleaned);
    const mode: ChrisMode = VALID_MODES.has(parsed.mode) ? parsed.mode : 'JOURNAL';
    logger.info({ mode, latencyMs: Date.now() - start }, 'chris.mode.detect');
    return mode;
  } catch (error) {
    logger.warn({ error: ... }, 'chris.mode.detect');
    return 'JOURNAL';   // fail-soft default
  }
}
```
Phase 14 mappings:
- Stakes classifier → default `'trivial'` on any exception (D-06 fail-closed)
- Capture extractor → return draft unchanged (no new slots filled)
- Vague validator → default `'acceptable'` (don't pushback on error — protects anti-interrogation ethos)
- Resolve-by parser → return `null` so handler routes to clarifier (D-19)

**Timeout enforcement** via `Promise.race` — pattern used at `engine.ts:237–243` for quarantinePraise and at `engine.ts:259–262` for contradiction detection:
```typescript
// Source: src/chris/engine.ts [VERIFIED]
const result = await Promise.race([
  haikuCall(),
  new Promise<T>((resolve) => setTimeout(() => resolve(defaultValue), TIMEOUT_MS)),
]);
```

### Pattern 2: Bilingual Regex Pre-processor with Meta-guards

**What:** Per-language `PatternEntry[]` = `[RegExp, number | null][]`; iterate with `exec()`; first match wins; no early compile.

**When to use:** Phase A trigger detection (`triggers.ts::detectTriggerPhrase(text)`).

**Example (from `src/chris/refusal.ts:24–55`):**
```typescript
// Source: src/chris/refusal.ts [VERIFIED]
const EN_PATTERNS: PatternEntry[] = [
  [/^(?!.*\b(?:told|said|mentioned|explained)\b).*\bi\s+don'?t\s+want\s+to\s+(?:talk|think|speak)\s+about\s+(.+)/i, 1],
  // ... negative lookAHEAD (matches refusal.ts style)
];
```
**Important delta for Phase 14:** CONTEXT.md D-02 says "hard negative-lookbehind". Node.js ES2018+ supports lookbehind `(?<!...)`. `refusal.ts` actually uses negative lookahead `^(?!...)` scoped to the whole message — the planner's call on which flavor is cleaner. Both work; lookahead-anchored-at-start is the project's existing flavor and is safer for variable-length negations (lookbehinds must be fixed-width in some older engines — Node 18+ supports variable-width but it's simpler to mirror refusal.ts exactly). Recommend using **lookahead-anchored-at-start** per existing convention, which is semantically equivalent for this use case.

### Pattern 3: Engine Pre-processor Short-Circuit

**What:** Detect condition → (optionally mutate state) → `saveMessage(USER)` + `saveMessage(ASSISTANT)` → `return response`.

**When to use:** PP#0 capture-state handler and PP#1 trigger-opening.

**Example (from `src/chris/engine.ts:140–174`):**
```typescript
// Source: src/chris/engine.ts [VERIFIED]
const muteResult = await detectMuteIntent(text);
if (muteResult.muted) {
  await setMuteUntil(muteResult.muteUntil);
  const ack = await generateMuteAcknowledgment(...);
  await saveMessage(chatId, 'USER', text, 'JOURNAL');
  await saveMessage(chatId, 'ASSISTANT', ack, 'JOURNAL');
  return ack;
}
```
**Phase 14 application:**
- PP#0 (active-capture check) MUST come BEFORE line 140. Reads `getActiveDecisionCapture(chatId)` — if row exists and stage is `CAPTURING` (or one of the DECISION/ALTERNATIVES/REASONING/PREDICTION/FALSIFICATION sub-stages), route to `handleCapture()`. Phase 16 will add branches for `AWAITING_RESOLUTION` / `AWAITING_POSTMORTEM` but ship the branch structure now.
- PP#1 (trigger detection) sits AFTER PP#0 but before line 140. Phase A regex → if hit → Phase B Haiku stakes → if `structural` → insert `decision_capture_state` row with `stage=DECISION`, draft=`{language_at_capture: franc(text), turnCount: 0}`, reply with Q1 (localized), save messages, return.
- Abort handling (D-25): lives INSIDE PP#0 handler entry — check abort phrases against `text.trim().toLowerCase()`; if hit → `clearCapture(chatId)` → `return await processMessage(...)` recursively OR simply fall through by letting PP#0 return nothing and continuing (planner's call; recursion preferred for clarity).

### Pattern 4: Slash Command Registered Before Text Handler

**What:** `bot.command('name', handler)` registered before `bot.on('message:text', ...)` so Grammy dispatches commands first.

**When to use:** `/decisions suppress <phrase>` command.

**Example (from `src/bot/bot.ts:22`):**
```typescript
// Source: src/bot/bot.ts [VERIFIED]
bot.command('sync', handleSyncCommand as any);
// ...
bot.on('message:text', handleTextMessage as any);
```
Phase 14 adds `bot.command('decisions', handleDecisionsCommand)` immediately after the `/sync` registration. Handler parses `ctx.message.text` for the sub-command (`suppress`) and the phrase argument. Unrecognized sub-commands respond with brief help in Greg's last language (via `getLastUserLanguage(chatId.toString())`).

### Pattern 5: Fire-and-forget Side Effect with Internal Try/Catch

**What:** `void someAsync()` where `someAsync` has its own try/catch+logger.warn so a failure never bubbles.

**When to use:** LIFE-05 contradiction scan on `decisions.reasoning` after first `open` commit.

**Example (from `src/chris/engine.ts:289`):**
```typescript
// Source: src/chris/engine.ts [VERIFIED]
if (mode === 'JOURNAL') {
  void writeRelationalMemory(chatId, text, response);
}
```
Phase 14 adds (inside `handleCapture` at the moment of first `open` commit — NOT `open-draft`, per D-20):
```typescript
if (committedStatus === 'open') {
  void (async () => {
    try {
      const detected = await Promise.race([
        detectContradictions(decisionsRow.reasoning),
        new Promise<never[]>((r) => setTimeout(() => r([]), 3000)),
      ]);
      // D-21: surface via formatContradictionNotice on Chris's NEXT normal turn —
      // NOT during capture. Means: stash detected contradictions into the same
      // surfacedContradictions state mechanism engine.ts already uses, so the next
      // non-capture turn's contradiction-detection pass emits them.
    } catch (e) { logger.warn({ error: ... }, 'capture.contradiction.error'); }
  })();
}
```
**Caveat:** the existing `detectContradictions(text, entryId?)` takes a pensieve entry id; for decisions.reasoning we have a `decision_id` not a pensieve entry id. The planner must decide: (a) write the Pensieve entry FIRST with tag=DECISION (Phase 14 already does this per D-11/D-23), then call `detectContradictions(reasoning, pensieveEntryId)`; or (b) call `detectContradictions(reasoning)` without an entryId (dedup via the `contradictions` table is skipped in that branch — re-read `src/chris/contradiction.ts:196–221`). Option (a) is cleaner and matches the existing dedup semantics — recommend writing the Pensieve entry before the fire-and-forget contradiction scan.

### Anti-Patterns to Avoid

- **Don't reuse `INTENTION` epistemic tag for decision summaries.** Phase 13 shipped a dedicated `DECISION` tag (schema.ts line 33) to prevent the commitment trigger double-firing (LIFE-06). Use `DECISION` at capture commit.
- **Don't make capture commit go around `transitionDecision()`.** Even the `null → open-draft` transition at capture commit goes through the chokepoint. LIFE-03 and the chokepoint-audit test (`src/decisions/__tests__/chokepoint-audit.test.ts`) enforce this at CI.
- **Don't introduce an eighth Chris mode (`DECIDE`).** ARCHITECTURE.md §2a rejected this — mode detection is probabilistic and fragile; the pre-processor pattern is deterministic and bilingual.
- **Don't skip the PP#0-before-mute ordering.** SWEEP-03 is a structural guarantee — a user mid-capture saying "not now" (which is a mute-detection candidate) must route to capture-abort, not to mute. PP#0 MUST run first.
- **Don't cache stakes verdicts.** D-07 locks no-cache. Haiku prompt evolves; stale verdicts would silently suppress capture for known phrases.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Natural-language timeframe parsing | Custom regex ladder ("next week" / "in 3 months" / "by June") | Haiku structured-output (D-18, 2s timeout) + explicit 7/30/90/365d fallback clarifier | Edge cases (`"end of year"`, `"before my birthday"`, `"по русски следующий вторник"`) are combinatorial; Haiku handles them natively. The clarifier ladder is the DETERMINISTIC backstop, not the primary parser. |
| Date math for "+N days" | Hand-rolled Date arithmetic | `new Date(Date.now() + N * 86_400_000)` or `parseMuteDuration` shape in `src/proactive/mute.ts:42–80` | `parseMuteDuration` already demonstrates the pattern for `days` / `weeks` / `until_date` from a Haiku hint — reuse the shape. |
| Vagueness detection | Regex-only hedge-word filter | Hedge-word prior + Haiku judgment (D-13) | Hedge-word regex misses semantic vagueness ("it'll go well", "things will work out"). Catches ≈50%; Haiku catches ≈90%. Hedge words only SEED the Haiku prompt per D-13. |
| Language detection | Custom language detector | `franc` via `detectLanguage(text, prev)` wrapper in `src/chris/language.ts` | Already installed, already wrapped, already handles the short-text + `und` fallback (LANG-02) |
| Contradiction scanning on `decisions.reasoning` | New ad-hoc scanner | `detectContradictions()` from `src/chris/contradiction.ts` verbatim | Has 0.75 threshold + 3s timeout already hardcoded; LIFE-05 ACs match exactly |
| Session state for capture turn-count | In-memory map | `draft.turnCount` in `decision_capture_state.draft` jsonb | Already DB-backed; survives restart; no drift between engine replicas |
| "Only one capture per chat" invariant | Guard code checking before insert | `decision_capture_state.chatId` is the PRIMARY KEY | Enforced at DB layer; re-triggered insert would 23505; D-12 routes re-triggers to existing capture anyway |
| Illegal transition guard for capture commit | Manual `if`-chain | `transitionDecision(id, fromStatus, toStatus)` — throws `InvalidTransitionError` for illegal | Already shipped + covered by `src/decisions/__tests__/lifecycle.test.ts` |

**Key insight:** The entire foundation (schema, enums, chokepoint, concurrency, capture-state table, `franc` wrapper, bilingual regex template, Haiku fail-soft template, contradiction detector, slash-command template, fire-and-forget template) is already in the tree. Phase 14 is almost entirely composition of existing primitives plus four new Haiku prompts and a handful of EN/FR/RU regex patterns. Hand-rolled infrastructure in Phase 14 would be a red flag.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **New:** rows in `decisions`, `decision_events`, `decision_capture_state`, `decision_trigger_suppressions`, `pensieve_entries` (DECISION-tagged). **Existing:** Phase 13 shipped empty-table schema; no migrations of existing data needed. | Schema migration 0004 only. No data backfill. |
| Live service config | None — no external service integrations added. Grammy bot auto-registers the new `/decisions` command at boot; no manual config. | None. |
| OS-registered state | None — no cron jobs, no systemd units, no Windows tasks touched. Phase 15 adds the sweep trigger, not Phase 14. | None. |
| Secrets / env vars | **None new.** `HAIKU_MODEL`, `SONNET_MODEL`, `ANTHROPIC_API_KEY` already in `.env`. No new keys required. | None. |
| Build artifacts | `dist/` TypeScript output will include new `src/decisions/*.js`, `src/bot/handlers/decisions.js` after `npm run build`. Drizzle snapshot `src/db/migrations/meta/0004_snapshot.json` committed alongside the `.sql`. | Standard `npm run build` + commit snapshot. |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Everything | ✓ (existing) | >=18 (ES2018 lookbehind) | — |
| Docker + docker-compose | Integration tests | ✓ (existing — `docker-compose.local.yml`) | Existing | Tests would fail — user memory: NEVER skip Docker tests |
| Postgres 16 | All schema work | ✓ (existing) | 16 | — |
| Anthropic API key | Haiku calls | ✓ (existing) | — | Unit-test stubs for non-live tests; live calls require live key |
| `franc` | `language_at_capture` | ✓ (installed) | ^6.2.0 | — |

**No missing dependencies.** No new installs. No blocking external services.

## Common Pitfalls

### Pitfall 1: Re-Triggering Contradiction Detection on `open-draft` Promotion

**What goes wrong:** A draft commits as `open-draft`, later transitions to `open`; naive reading of LIFE-05 runs contradiction detection on BOTH commits.
**Why it happens:** "First commit landing at `open`" is ambiguous if taken as "first time `status = open`". D-20 resolves this explicitly: **fire exactly once, ONLY on the first commit that lands at `open`** (i.e., skip entirely on `open-draft`). When/if a draft later promotes `open-draft → open`, do NOT re-scan.
**How to avoid:** Gate the `void detectContradictions(...)` call on `committedStatus === 'open' && fromStatus === null` (i.e., direct null→open path). `null → open-draft → open` never hits the condition because the second transition has `fromStatus = 'open-draft'`.
**Warning signs:** Duplicate contradiction notices surfacing across turns; `contradictions` table rows pointing to the same decision_id twice.

### Pitfall 2: Meta-guard Missing Negated Triggers

**What goes wrong:** Phrase like "I'm not thinking about quitting" hits the `I'm thinking about` regex → Haiku stakes fires → capture may open.
**Why it happens:** Naive regex without negative lookbehind/lookahead matches inside negated phrases.
**How to avoid:** Every Phase A pattern has its negative guard ATTACHED as part of the regex (per D-02). Mirror `refusal.ts:24` — each entry is `^(?!.*\b(?:not|n'ai pas|не)\b.*...)I'm thinking about...`. Fixture test includes explicit negative-lookbehind cases: `"I'm not thinking about X"`, `"je ne réfléchis pas à X"`, `"я не думаю о X"` — must all classify as NON-trigger.
**Warning signs:** Haiku stakes classifier seeing high volume of clearly-negated candidates; `trivial` verdicts dominate logs — probably because the regex is over-firing on negations.

### Pitfall 3: Mid-capture Language Drift

**What goes wrong:** Greg triggers capture in FR, then replies in EN. `language_at_capture` is locked to FR (per D-22). Chris's capture questions should also stay in the CAPTURE-time language, not drift with each turn.
**Why it happens:** Natural temptation to re-franc every turn and let Chris respond in the current turn's language.
**How to avoid:** Read `language_at_capture` from the `draft` jsonb in every `handleCapture` turn; use that language for question phrasing, abort-ack phrasing, and the vague-pushback question. Do NOT call `detectLanguage(text, prev)` inside capture. (Outside capture — unchanged.)
**Warning signs:** Greg says "je réfléchis à X" → Chris asks Q1 in FR → Greg replies in EN → Chris drifts to EN for Q2. Test this explicitly.

### Pitfall 4: Abort Phrase False Positives at Capture Open

**What goes wrong:** User message like "stop procrastinating, I need to decide between X and Y" contains `stop` AND a trigger phrase. If abort check happens at the wrong point, capture is aborted before it opens.
**Why it happens:** Abort check placement.
**How to avoid:** Per D-25, abort check is INSIDE PP#0 (active-capture handler entry), NOT at message entry. If no capture is active, abort phrases do nothing — PP#1 runs regex normally. Capture only opens AFTER PP#1 decides; abort can only dismiss an ALREADY-OPEN capture.
**Warning signs:** New captures refusing to open because a trigger message happens to contain `skip` or `stop`.

### Pitfall 5: 3-turn Cap Silent-Commit Writing Incomplete Draft that Violates NOT NULL

**What goes wrong:** `decisions.reasoning` and `decisions.prediction` are `NOT NULL` (verified in `schema.ts` lines 218–219). `decisions.falsification_criterion` is `NOT NULL` (line 220). If the 3-turn cap fires and any of these slots is still empty, `INSERT` will 23502 (not_null_violation).
**Why it happens:** D-11 silent-commit discipline conflicts with DB-level NOT NULLs.
**How to avoid:** On silent-commit, fall-back strings must be written for any unfilled slot — e.g., the verbatim user text from Greg's original triggering message for `decision_text`, an empty-but-nonempty placeholder like `"(not specified in capture)"` or the draft's best-guess for `reasoning` / `prediction` / `falsification_criterion`. Alternatively: DO NOT 3-turn-cap until DECISION + at least one of {PREDICTION, FALSIFICATION} is filled — extend capture indefinitely until minimum-NOT-NULL slots are filled, then cap. Planner must decide. Recommend: explicit placeholder strings + landing status = `open-draft` (never `open`) so accuracy stats never include them.
**Warning signs:** `InsertError: null value in column "reasoning" violates not-null constraint`.

### Pitfall 6: Vague-validator Running Before Both Slots Filled

**What goes wrong:** Extractor fills PREDICTION in turn 2 but FALSIFICATION still empty. Naive validator runs on partial input and either flags everything vague or crashes.
**Why it happens:** D-14 says validator runs "AFTER both PREDICTION and FALSIFICATION slots are filled" — timing must be enforced.
**How to avoid:** Validator invocation gated on `draft.prediction != null && draft.falsification_criterion != null && !draft.vague_validator_run`. The flag prevents re-running. Test this explicitly.
**Warning signs:** Multiple pushbacks in the same capture (violates D-14 one-round discipline).

### Pitfall 7: Suppression Substring Match Too Greedy

**What goes wrong:** Greg suppresses `"I'm thinking about"` — now every future message containing that substring is suppressed, including legitimate new structural decisions.
**Why it happens:** D-16/D-17 explicitly specify "phrase-only, case-insensitive substring". That IS the behavior Greg chose. Phase 17 adds id-based suppression for finer grain.
**How to avoid:** This is by design, not a bug. Surface help text in `/decisions suppress` response: "This suppresses the exact phrase — if you want finer control, wait for `/decisions suppress id:<uuid>` in Phase 17."
**Warning signs:** Greg complaining Chris stopped catching decisions. Check `decision_trigger_suppressions` rows.

## Code Examples

### Phase A Trigger Regex (mirroring refusal.ts shape)

```typescript
// Source: adapted from src/chris/refusal.ts:24–121 [VERIFIED]
// Each entry: [regex, group_index_for_decision_topic | null]
// Negative lookahead guards against meta-talk ("I told her I'm thinking about...")

type PatternEntry = [RegExp, number | null];

const EN_TRIGGER_PATTERNS: PatternEntry[] = [
  [/^(?!.*\b(?:told|said|mentioned|not|don'?t)\b).*\bi'?m\s+thinking\s+about\s+(.+)/i, 1],
  [/^(?!.*\b(?:told|said|mentioned|not|don'?t)\b).*\bi\s+need\s+to\s+decide\s+(.+)/i, 1],
  [/^(?!.*\b(?:told|said|mentioned|not|don'?t)\b).*\bi'?m\s+weighing\s+(.+)/i, 1],
  [/^(?!.*\b(?:told|said|mentioned|not|don'?t)\b).*\bi'?m\s+not\s+sure\s+whether\s+(.+)/i, 1],
];

const FR_TRIGGER_PATTERNS: PatternEntry[] = [
  [/^(?!.*\b(?:ai\s+dit|n'?ai\s+pas)\b).*je\s+r[eé]fl[eé]chis\s+[àa]\s+(.+)/i, 1],
  [/^(?!.*\b(?:ai\s+dit|n'?ai\s+pas)\b).*je\s+dois\s+d[eé]cider\s+(.+)/i, 1],
  [/^(?!.*\b(?:ai\s+dit|n'?ai\s+pas)\b).*j'?h[eé]site\s+(.+)/i, 1],
];

const RU_TRIGGER_PATTERNS: PatternEntry[] = [
  [/^(?!.*\b(?:сказал|не)\b).*я\s+думаю\s+о\s+(.+)/i, 1],
  [/^(?!.*\b(?:сказал|не)\b).*мне\s+нужно\s+решить\s+(.+)/i, 1],
  [/^(?!.*\b(?:сказал|не)\b).*я\s+колеблюсь\s+(.+)/i, 1],
];

// D-03 parity guard:
// |EN_TRIGGER_PATTERNS| === |FR_TRIGGER_PATTERNS| === |RU_TRIGGER_PATTERNS| === 4, 3, 3
// ⚠️ Planner note: PRD set has 4 EN, 3 FR, 3 RU. The strict |EN|==|FR|==|RU| asserted in D-03
// cannot hold with PRD-only. Planner must either (a) reduce EN to 3, (b) extend FR/RU to 4 each,
// or (c) reinterpret D-03 as "parity to within the PRD mapping" — flag for discuss-phase follow-up.
```

**⚠️ Open question for planner:** D-03 asserts `|EN| == |FR| == |RU|` but D-01's PRD phrase set has 4 EN + 3 FR + 3 RU. The planner must resolve this — recommend either (i) adding an obvious 4th FR/RU PRD-equivalent (`"je dois choisir"` / `"мне нужно выбрать"`) to preserve parity, or (ii) dropping EN to 3 (remove `I'm not sure whether`). Option (i) is safer. Log as `[ASSUMED]` in the Assumptions Log below.

### Haiku Stakes Classifier Skeleton

```typescript
// Source: shape derived from src/chris/engine.ts::detectMode [VERIFIED]
export type StakesTier = 'trivial' | 'moderate' | 'structural';

export async function classifyStakes(candidatePhrase: string): Promise<StakesTier> {
  try {
    const response = await Promise.race([
      anthropic.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 30,
        system: [{ type: 'text', text: STAKES_CLASSIFICATION_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: candidatePhrase }],
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),  // D-08 3s cap
    ]);
    if (!response) return 'trivial';  // D-06 fail-closed on timeout
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) return 'trivial';
    const parsed = JSON.parse(stripFences((textBlock as {text:string}).text));
    if (parsed.tier === 'structural' || parsed.tier === 'moderate' || parsed.tier === 'trivial') {
      return parsed.tier;
    }
    return 'trivial';
  } catch {
    return 'trivial';  // D-06 fail-closed
  }
}
```

### Capture State Write Helpers (extend `src/decisions/capture-state.ts`)

```typescript
// Source: extends existing src/decisions/capture-state.ts [VERIFIED read]
import { db } from '../db/connection.js';
import { decisionCaptureState } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface CaptureDraft {
  decision_text?: string;
  alternatives?: string[];
  reasoning?: string;
  prediction?: string;
  falsification_criterion?: string;
  resolve_by?: string;  // ISO string
  language_at_capture: 'en' | 'fr' | 'ru';
  turn_count: number;
  vague_validator_run?: boolean;
  domain_tag?: string;
}

export async function createCaptureDraft(chatId: bigint, initialDraft: CaptureDraft): Promise<void> {
  await db.insert(decisionCaptureState).values({
    chatId,
    stage: 'DECISION',
    draft: initialDraft,
  });
}

export async function updateCaptureDraft(chatId: bigint, patch: Partial<CaptureDraft>, nextStage?: CaptureStage): Promise<void> {
  const current = await getActiveDecisionCapture(chatId);
  if (!current) throw new Error('No active capture to update');
  await db.update(decisionCaptureState)
    .set({
      draft: { ...(current.draft as CaptureDraft), ...patch },
      stage: nextStage ?? current.stage,
      updatedAt: new Date(),
    })
    .where(eq(decisionCaptureState.chatId, chatId));
}

export async function clearCapture(chatId: bigint): Promise<void> {
  await db.delete(decisionCaptureState).where(eq(decisionCaptureState.chatId, chatId));
}
```

### Schema Extension for Suppressions

```typescript
// Source: mirrors schema.ts lines 157–202 (oauthTokens / contradictions) [VERIFIED]
export const decisionTriggerSuppressions = pgTable(
  'decision_trigger_suppressions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    chatId: bigint('chat_id', { mode: 'bigint' }).notNull(),
    phrase: text('phrase').notNull(),                                   // stored trimmed + lowercased
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('decision_trigger_suppressions_chat_id_idx').on(table.chatId),
    unique('decision_trigger_suppressions_chat_id_phrase_unique').on(table.chatId, table.phrase),
  ],
);
```
Rationale for structured-table-over-single-column (CONTEXT Discretion item): cheap query by chat_id; Phase 17's future `/decisions list-suppressions` + `unsuppress` will want timestamps anyway; unique constraint prevents duplicate suppression rows.

### Engine Pre-processor Insertion Point

```typescript
// Location: src/chris/engine.ts inside processMessage() try-block,
// BEFORE current line 140 (`const muteResult = await detectMuteIntent(text);`)
// [VERIFIED: exact line identified]

// ── PP#0: active decision capture check ─────────────────────────────
const activeCapture = await getActiveDecisionCapture(chatId);
if (activeCapture) {
  // Abort-phrase check (D-25): inside PP#0, not top-level
  if (isAbortPhrase(text, (activeCapture.draft as CaptureDraft).language_at_capture)) {
    await clearCapture(chatId);
    const ack = generateCaptureAbortAck((activeCapture.draft as CaptureDraft).language_at_capture);
    await saveMessage(chatId, 'USER', text, 'JOURNAL');
    await saveMessage(chatId, 'ASSISTANT', ack, 'JOURNAL');
    return ack;
  }
  // Normal capture turn — route to handler (CAPTURING stages for now; Phase 16 adds AWAITING_*)
  return await handleCapture(chatId, text, activeCapture);
}

// ── PP#1: decision trigger detection ────────────────────────────────
if (!(await isSuppressed(text, chatId))) {   // D-17 check before regex
  const triggerMatch = detectTriggerPhrase(text);
  if (triggerMatch) {
    const tier = await classifyStakes(text);     // D-06 fail-closed to 'trivial'
    if (tier === 'structural') {
      const detectedLang = detectLanguage(text, getLastUserLanguage(chatId.toString()));
      const lang: 'en'|'fr'|'ru' = langToIso(detectedLang);
      await createCaptureDraft(chatId, { language_at_capture: lang, turn_count: 0 });
      const q1 = questionForStage('DECISION', lang);
      await saveMessage(chatId, 'USER', text, 'JOURNAL');
      await saveMessage(chatId, 'ASSISTANT', q1, 'JOURNAL');
      return q1;
    }
    // trivial/moderate/fail-closed → fall through
  }
}

// ── Existing PP: mute detection (unchanged) ─────────────────────────
const muteResult = await detectMuteIntent(text);
// ... rest of processMessage unchanged
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Multiple Haiku calls per capture turn (one per slot) | Single greedy structured-output extraction per turn | D-09 (Phase 14 CONTEXT) | 5x fewer Haiku calls; handles "I'm weighing quitting vs pivoting; probably pivot; know in a month" in one pass |
| Strict sequential stage flow | Suggested canonical order, any-slot accepted | D-10 | Greg can volunteer ahead; no "wait, let me ask that later" friction |
| Silent fallback ladder for resolve_by | Explicit clarifier menu + announced +30d default | D-19 | User agency; no hidden heuristics |
| Force-accept vague predictions | `open-draft` landing + one pushback only | D-14, D-15 | Anti-interrogation ethos + stats integrity |

**Deprecated/outdated:**
- Nothing to deprecate — Phase 14 is net-new conversational wiring. The Phase 13 API (`transitionDecision`, `getActiveDecisionCapture`) is the current stable contract.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Negative lookahead `^(?!...)` is acceptable in place of D-02's "negative lookbehind" wording — existing `refusal.ts` uses lookahead and it's semantically equivalent for single-message negation-rejection. | Architecture Patterns → Pattern 2 | Low — the planner/executor can switch to true `(?<!...)` lookbehind if a reviewer insists; both expressible in Node 18+. |
| A2 | D-03 "|EN|==|FR|==|RU|" parity guard is INCOMPATIBLE with D-01's PRD-only set (4 EN, 3 FR, 3 RU). Assumed planner will raise to user or pick a resolution (likely extend FR/RU to 4). | Code Examples → Phase A Trigger Regex | Medium — if unresolved, the CI parity test will fail on day 1. **Flag for discuss-phase follow-up.** |
| A3 | `DECISION` Pensieve entry is written BEFORE the fire-and-forget `detectContradictions` call so the detector can record dedup rows against the Pensieve entry id. | Architecture Patterns → Pattern 5 | Low — if written after, contradiction-dedup just skips storage for this decision; still surfaces the notice. |
| A4 | 3-turn cap silent commit writes placeholder strings like `"(not specified in capture)"` for NOT-NULL columns still empty at cap time, landing as `open-draft`. | Common Pitfalls → Pitfall 5 | Medium — alternative is to extend capture until minimum NOT-NULL slots filled. Planner/user should explicitly choose. |
| A5 | `franc` on short triggering messages may return `und`; `language_at_capture` falls back to `getLastUserLanguage(chatId)` then to `'en'` as final default. | Architecture Patterns → Pattern 3 PP#1 | Low — LANG-02 already handles short-text fallback; extend the same discipline to capture. |
| A6 | Stakes classifier inline (not parallel with response pipeline) per Discretion default. Adds ≤3s latency to the triggering message reply but keeps logic simple. | Claude's Discretion item | Low — can be parallelized later if profiling shows noticeable lag. |
| A7 | The `decision_trigger_suppressions` table uses a structured per-chat shape with `created_at` (not single-column text list) to enable Phase 17 `list`/`unsuppress` without migration. | Code Examples → Schema Extension for Suppressions | Low — this is Phase 17 forward-compat; single-column approach also works. |

## Open Questions (RESOLVED)

1. **D-03 parity guard vs D-01 PRD set cardinality mismatch (A2).**
   - What we know: D-01 is PRD-only (4 EN, 3 FR, 3 RU). D-03 requires `|EN|==|FR|==|RU|`.
   - What's unclear: Which wins at CI-test time?
   - RESOLVED: Plan 01 extends FR and RU fixtures to 4 phrases each (adding `je dois choisir entre` and `мне нужно выбрать между`). Plan 02 asserts `|EN|==|FR|==|RU|` at module-load with an explicit throw referencing D-03. Both invariants preserved.

2. **3-turn cap + NOT NULL columns (A4).**
   - What we know: `decisions.reasoning`, `prediction`, `falsification_criterion` are NOT NULL at DB level.
   - What's unclear: What does D-11 "silent commit as open-draft" write for unfilled NOT NULL slots?
   - RESOLVED: Plan 04 Task 4 writes the placeholder string `(not specified in capture)` for any unfilled NOT NULL slot at 3-turn cap commit, with `decision_text` falling back to `triggering_message.slice(0, 500)`. Row lands as `open-draft` via the `null → open-draft` chokepoint path.

3. **Stakes classifier latency budget.**
   - What we know: Triggering message → Phase A hit → Phase B Haiku (up to 3s) → capture-open reply with Q1. Greg experiences ~3s latency on the TRIGGERING turn (only).
   - What's unclear: Does this feel sluggish? Parallelizing with a provisional "Noted — give me a sec" filler isn't in CONTEXT.md.
   - RESOLVED: Ship inline per Discretion default; no action needed in planning. Profile under real use; optimize later if latency proves noticeable.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | None at repo root — relies on Vitest defaults + `scripts/test.sh` orchestration |
| Quick run command | `npm run test:unit -- src/decisions/__tests__/capture.test.ts` (single-file run; no Docker) |
| Full suite command | `npm test` (boots Docker Postgres, runs all migrations 0000→0004, then full vitest) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CAP-01 | Phase A regex matches EN/FR/RU triggers, rejects negated forms | unit | `npx vitest run src/decisions/__tests__/triggers.test.ts` | ❌ Wave 0 |
| CAP-01 | Phase B stakes classifier returns tier; fail-closed to 'trivial' on error | unit (mocked SDK) | `npx vitest run src/decisions/__tests__/triggers.test.ts` | ❌ Wave 0 |
| CAP-01 | Fixture parity: |EN| == |FR| == |RU| | unit | `npx vitest run src/decisions/__tests__/triggers.test.ts` | ❌ Wave 0 |
| CAP-02 | Greedy multi-slot extraction from single message | integration (mocked Haiku) | `npx vitest run src/decisions/__tests__/capture.test.ts` | ❌ Wave 0 |
| CAP-02 | language_at_capture locked to trigger-msg language | integration | same | ❌ Wave 0 |
| CAP-03 | 3-turn cap auto-commits `open-draft` | integration | same | ❌ Wave 0 |
| CAP-03 | Abort phrase clears state + falls through (EN/FR/RU) | integration | same | ❌ Wave 0 |
| CAP-04 | `open-draft` commit path via `transitionDecision(null, 'open-draft')` — legal per Phase 13 map | integration | `npx vitest run src/decisions/__tests__/capture.test.ts` | ❌ Wave 0 |
| CAP-05 | NL timeframe parse; `"next week"` → `+7d` | integration (mocked Haiku) | `npx vitest run src/decisions/__tests__/resolve-by.test.ts` | ❌ Wave 0 |
| CAP-05 | Clarifier menu on parser fail; `+30d` default announced | integration | same | ❌ Wave 0 |
| CAP-06 | Suppression persists across simulated restart (row stays in DB) | integration | `npx vitest run src/decisions/__tests__/suppressions.test.ts` | ❌ Wave 0 |
| CAP-06 | Substring match is case-insensitive | unit | same | ❌ Wave 0 |
| LIFE-05 | Contradiction scan fires exactly once on first `null→open` commit, never on `open-draft` | integration | `npx vitest run src/decisions/__tests__/capture.test.ts` | ❌ Wave 0 |
| SWEEP-03 | PP#0 precedes mute/refusal/language/mode detection | integration | `npx vitest run src/decisions/__tests__/engine-capture.test.ts` | ❌ Wave 0 |
| SWEEP-03 | Re-trigger mid-capture is ignored (stays on current) | integration | same | ❌ Wave 0 |
| Vague validator | One pushback only; second-vague lands `open-draft` | integration (mocked Haiku) | `npx vitest run src/decisions/__tests__/vague-validator.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test:unit -- src/decisions/__tests__/${file}` (single-file, sub-30s)
- **Per wave merge:** `npm test` (full Docker suite incl. Phase 13 regression)
- **Phase gate:** `npm test` green (including all Phase 13 tests still passing — the Phase 13 chokepoint-audit test will scan for new mutations of `decisions.status` outside `transitionDecision()` and fail if any Phase 14 code violates LIFE-03)

### Wave 0 Gaps

- [ ] `src/decisions/__tests__/triggers.test.ts` — covers CAP-01
- [ ] `src/decisions/__tests__/capture.test.ts` — covers CAP-02/03/04 + LIFE-05 timing
- [ ] `src/decisions/__tests__/vague-validator.test.ts` — covers vague-pushback discipline
- [ ] `src/decisions/__tests__/resolve-by.test.ts` — covers CAP-05
- [ ] `src/decisions/__tests__/suppressions.test.ts` — covers CAP-06
- [ ] `src/decisions/__tests__/engine-capture.test.ts` — covers SWEEP-03 + PP ordering + re-trigger
- [ ] `src/decisions/triggers-fixtures.ts` — shared EN/FR/RU phrase fixture (referenced by triggers.test.ts + capture.test.ts seed data)
- [ ] All new tests follow the Phase 13 `src/decisions/__tests__/capture-state.test.ts` shape: `beforeAll` verifies DB reachable; `afterEach` truncates `decisions`, `decision_events`, `decision_capture_state`, `decision_trigger_suppressions`, `pensieve_entries` (where relevant); tests are failing RED in Wave 0 and turn GREEN wave-by-wave.

**Framework install:** None needed — Vitest 4.1.2 already in devDependencies.

## Security Domain

**Status:** `security_enforcement` not set in `.planning/config.json` — treating as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Single-user bot; Telegram auth handled by existing `src/bot/middleware/auth.ts` — no changes in Phase 14 |
| V3 Session Management | no | No web sessions; capture-state is chat-scoped + DB-backed |
| V4 Access Control | partial | `/decisions suppress` is per-chat (`chatId` in table row); ensure handler writes suppressions tied to `ctx.chat.id`, never globally |
| V5 Input Validation | **yes** | User-supplied `<phrase>` for `/decisions suppress`; user message text for Phase A regex |
| V6 Cryptography | no | No new crypto; existing Anthropic SDK handles TLS |

### Known Threat Patterns for {Node + Postgres + Drizzle + Anthropic + Grammy}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via `<phrase>` argument | Tampering | Drizzle parameterized queries — `db.insert(...).values({ phrase })` is safe; never string-concatenate into raw SQL. Phase 13 already uses this pattern throughout. |
| ReDoS (regex denial-of-service) on user input | Denial-of-Service | Phase A regex patterns MUST be linear-time. Lookahead-anchored-at-start `^(?!...)` + single capture group + no nested quantifiers keeps them RE2-safe. Existing `refusal.ts` patterns were reviewed for this; mirror their shape. |
| Prompt injection via `<phrase>` into stakes classifier | Tampering | User text goes in the `messages[0].content` slot, never into the system prompt. Haiku won't execute instructions from user content when the system prompt is framed correctly. Mirror `detectMode()` structure. |
| Log exposure of decision content (PII) | Information Disclosure | Existing `logger` calls log `latencyMs`, `chatId`, `mode`, NEVER full message content. Mirror this — Phase 14 logs `tier`, `stage`, `slotsFilled`, `turnCount`, never raw draft content. |
| Unbounded growth of suppressions table | DoS via storage | Unique constraint on `(chat_id, phrase)` prevents dupes. Single-user bot + phrase-only suppression means growth is inherently bounded (~tens of rows). No explicit GC needed in Phase 14. |
| Concurrent capture opens for same chat | Tampering / race | `decision_capture_state.chatId` is PRIMARY KEY — concurrent inserts fail at 23505. Phase 13 test `capture-state.test.ts` already covers this. |

## Sources

### Primary (HIGH confidence — direct code read)
- `src/chris/engine.ts` (316 lines) — pre-processor ordering, `detectMode()` Haiku pattern, contradiction + quarantine post-processing
- `src/chris/refusal.ts` (193 lines) — bilingual regex + meta-guard template
- `src/chris/contradiction.ts` (358 lines) — `detectContradictions()` signature, 0.75 threshold, 3s behavior
- `src/chris/language.ts` (62 lines) — `franc` wrapper for `language_at_capture`
- `src/decisions/capture-state.ts` (22 lines) — Phase 13 read helper
- `src/decisions/lifecycle.ts` (130 lines) — `transitionDecision` chokepoint + error semantics
- `src/decisions/errors.ts` (37 lines) — `InvalidTransitionError` + `OptimisticConcurrencyError`
- `src/decisions/__tests__/capture-state.test.ts` (69 lines) — test pattern template
- `src/db/schema.ts` (283 lines) — pgEnum + pgTable conventions, decisions/events/capture_state shapes already shipped
- `src/db/migrations/0002_decision_archive.sql` — migration shape template
- `src/bot/bot.ts` (65 lines) — slash command registration pattern
- `src/proactive/mute.ts` (lines 1–80) — `parseMuteDuration` shape for resolve-by analog
- `src/llm/client.ts` (11 lines) — Anthropic SDK wiring, `HAIKU_MODEL` constant
- `package.json` — verified versions (drizzle 0.45.2, franc 6.2.0, grammy 1.31, anthropic 0.80, vitest 4.1.2)
- `scripts/test.sh` — Docker-first integration test orchestration
- `.planning/phases/14-capture-flow/14-CONTEXT.md` — all 25 locked decisions D-01..D-25
- `.planning/phases/13-schema-lifecycle-primitives/13-CONTEXT.md` — Phase 13 shipped contract
- `.planning/REQUIREMENTS.md` — CAP-01..06, LIFE-05, SWEEP-03 ACs
- `.planning/ROADMAP.md` — Phase 14 success criteria + phase-pitfall guard map

### Secondary (MEDIUM confidence — existing research docs)
- `.planning/research/ARCHITECTURE.md` §2a/2b/4/5 — M007 integration terrain
- `.planning/research/PITFALLS.md` §C1 (interrogation) / §C2 (vague-prediction) / §C3 (over-triggering)
- `.planning/research/SUMMARY.md` §"Phase 2: Capture Flow"

### Tertiary (LOW confidence — none)
- No WebSearch / Context7 / external-docs lookups were necessary. The entire terrain is defined by in-repo code + locked CONTEXT.md decisions; Haiku/Anthropic SDK usage mirrors existing patterns verbatim. No ecosystem discovery was required.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency version verified against `package.json`; all templates come from live code reads.
- Architecture: HIGH — pre-processor insertion point, slash-command registration, schema extension, handler file layout all confirmed against existing structures.
- Pitfalls: HIGH (Pitfalls 1–4, 6, 7) / MEDIUM (Pitfall 5 — NOT NULL vs 3-turn-cap resolution is an open planner/user question, flagged as A4).
- Test architecture: HIGH — existing Phase 13 test suite is a 1:1 template.
- Security: MEDIUM — standard Node/Postgres/Anthropic threats surveyed, no Phase-14-specific novel vectors.

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (30 days; stable codebase, locked CONTEXT.md, no fast-moving dependencies)
