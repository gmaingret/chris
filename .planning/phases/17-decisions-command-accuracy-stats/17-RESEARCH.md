# Phase 17: `/decisions` Command & Accuracy Stats - Research

**Researched:** 2026-04-16
**Domain:** Telegram slash-command expansion, Haiku 2-axis classification, Wilson CI, Drizzle/Postgres SQL windows
**Confidence:** HIGH — all findings grounded in direct codebase reading and locked CONTEXT.md decisions.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01** Classification timing = second Haiku call in `handleResolution()`, immediately after existing `classifyOutcome()`. Phase 16's single-axis classifier is untouched.

**D-02** Outcome reuse = reuse the `OutcomeClass` returned by `classifyOutcome()`. The reasoning classifier receives the known outcome and returns `sound | lucky | flawed`.

**D-03** Storage format = combined string in `accuracy_class` column (e.g. `"hit/sound"`, `"miss/flawed"`, `"ambiguous/sound"`). Model version in `accuracy_model_version`. Both written to the `decisions` projection row and captured in a `classified` event in `decision_events`.

**D-04** Fail-closed to `"<outcome>/unknown"` on Haiku timeout or parse failure. `unknown` reasoning is treated like `unverifiable` for stats (excluded from denominator).

**D-05** `/decisions` (no args) = counts-only dashboard. One bubble: open/due/reviewed/stale counts + 90-day accuracy if N>=10 + available sub-commands.

**D-06** `/decisions open` = compact one-liner per decision, truncated title + resolve_by + domain tag, sorted soonest-first.

**D-07** `/decisions recent` = compact one-liner per decision, last 5-10 resolved/reviewed, sorted newest-first.

**D-08** `/decisions stats [30|90|365]` = flat text block. Overall accuracy + Wilson CI `[low-high%]`, unverifiable count on separate line, domain-tag breakdown. Below N=10 per row: `N=<count>, threshold not met`. Default window = 90d.

**D-09** All output is plain text. No emoji in stat lines. Localized via `getLastUserLanguage()`.

**D-10** `/decisions reclassify` = batch all reviewed decisions with a `resolution` value. Sequential Haiku calls. Reports `"Reclassified N decisions."` when done.

**D-11** Reclassify preserves originals via append-only event log. New `classified` event is appended; `decisions` projection row is overwritten with latest values.

**D-12** No version-checking optimization in reclassify. Reclassifies ALL reviewed decisions regardless of `accuracy_model_version`. Greg-scale (<=20 decisions).

**D-13** Phase 17 adds `/decisions suppressions` (list) and `/decisions unsuppress <phrase>` (remove by exact match).

**D-14** Id-based suppression (`suppress id:<uuid>`) is deferred.

**D-15** Wilson 95% CI computed in application code, not SQL. Formula: `(p + z²/2n ± z·sqrt(p·(1-p)/n + z²/4n²)) / (1 + z²/n)` where z=1.96.

**D-16** Rolling windows via SQL `FILTER (WHERE resolved_at >= now() - interval 'N days')`. Single query, one window at a time (the arg).

**D-17** `unverifiable` decisions excluded from accuracy denominator; surfaced as explicit count: `"Unverifiable: N (excluded)"`.

### Claude's Discretion

- Exact wording of all localized output strings (EN/FR/RU).
- Whether `handleResolution()` modification lives in `resolution.ts` directly or a separate `classify-accuracy.ts` utility called from it.
- Whether `/decisions recent` shows 5 or 10 decisions as the default page size.
- Wilson CI display precision (integer % vs one decimal).
- How `decision_text` is truncated for the compact one-liner format (character limit, ellipsis placement).

### Deferred Ideas (OUT OF SCOPE)

- Synthetic-fixture end-to-end + live ACCOUNTABILITY Sonnet suite → Phase 18.
- Id-based suppression (`suppress id:<uuid>`) → deferred.
- Per-channel `/mute decisions` → deferred.
- Charts, graphs, or visualizations (OOS-M007-06).
- Unprompted stat pushes (OOS-M007-05).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STAT-01 | `/decisions` Telegram command with sub-commands; pull-only | §Architecture Patterns — command router extension; §Code State — handler stubs verified |
| STAT-02 | 2-axis Haiku classification cached on `decision_events` with model version; never recomputed on read | §Classification Pattern; §DB Columns Already Present |
| STAT-03 | N≥10 floor; no percentage below threshold; Wilson 95% CI above | §Wilson CI Formula; §Guard C6 |
| STAT-04 | Rolling 30/90/365-day windows via SQL FILTER; `unverifiable` as separate denominator | §SQL Pattern |
| STAT-05 | Domain-tag breakdown; `/decisions reclassify` preserves originals | §Reclassify Mechanics; §Event Log Append Pattern |
</phase_requirements>

---

## Summary

Phase 17 is a feature-completion phase. The infrastructure built in Phases 13-16 (schema, lifecycle, capture, resolution) is fully in place. This phase wires up the user-facing command surface (`handleDecisionsCommand` already has a router with stubs) and adds the accuracy classification layer that was intentionally left for this phase.

The highest-risk item is the `classifyAccuracy()` addition to `handleResolution()` — it must be a second sequential Haiku call that fail-closes cleanly without breaking the resolution flow. Every other piece (stats queries, Wilson CI, output formatting, suppression CRUD) is straightforward plumbing with well-established patterns already in the codebase.

The stat computation is application-side: one SQL round-trip fetches raw counts, Wilson CI is computed in TypeScript. The N=10 floor and `unverifiable` exclusion are the structural anti-sycophancy guards (C6, C2) that make this feature trustworthy.

**Primary recommendation:** Build in four logical waves: (1) `classifyAccuracy()` + resolution hook, (2) stats query module + Wilson CI, (3) command handler sub-commands, (4) suppression CRUD additions. Each wave is independently testable.

---

## Standard Stack

### Core (all already in project)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | (project-pinned) | SQL queries with typed results | [VERIFIED: schema.ts] All queries use Drizzle |
| @anthropic-ai/sdk | (project-pinned) | Haiku calls for classification | [VERIFIED: client.ts] `anthropic.messages.create` pattern throughout |
| grammy | (project-pinned) | Telegram bot command handler | [VERIFIED: bot.ts] All slash commands use grammy `bot.command()` |
| vitest 4.x | ^4.1.2 | Test runner | [VERIFIED: package.json] |

### No new dependencies required

Phase 17 requires zero new npm packages. The Wilson CI formula is pure arithmetic (no external stats library needed at Greg-scale). All patterns are established in the codebase.

**Installation:** none required.

---

## Architecture Patterns

### Pattern 1: `classifyAccuracy()` — Reasoning-Axis Haiku Classifier

**What:** A new function modeled exactly on `classifyOutcome()` (`resolution.ts:99-174`). Takes the known `OutcomeClass` and resolution text; returns `'sound' | 'lucky' | 'flawed' | 'unknown'`. Fail-closes to `'unknown'` on timeout/parse failure (D-04).

**Where it lives:** Either inline in `resolution.ts` or extracted to `src/decisions/classify-accuracy.ts` (Claude's discretion). If in a separate file, `resolution.ts` imports it.

**Call site in `handleResolution()`:** After line 294 (`classifyOutcome` call), before the Pensieve writes:

```typescript
// [VERIFIED: resolution.ts lines 294-304 — insertion point]
const outcome = await classifyOutcome(text, decision.prediction, decision.falsificationCriterion);

// Phase 17 addition — immediately after:
const reasoning = await classifyAccuracy(text, outcome, decision.prediction);
const accuracyClass = `${outcome}/${reasoning}`;

// Write to decisions projection row:
await db.update(decisions).set({
  accuracyClass,
  accuracyClassifiedAt: new Date(),
  accuracyModelVersion: HAIKU_MODEL,
  updatedAt: new Date(),
}).where(eq(decisions.id, decisionId));

// Write classified event to decision_events (append-only, D-11):
await db.insert(decisionEvents).values({
  decisionId,
  eventType: 'classified',
  snapshot: { accuracyClass, accuracyModelVersion: HAIKU_MODEL },
  actor: 'system',
});
```

**Haiku prompt pattern** (mirrors `classifyOutcome` exactly):

```typescript
// [ASSUMED] — exact wording; reuse classifyOutcome structure
const systemPrompt =
  'Given the outcome of a prediction and Greg\'s resolution account, classify the ' +
  'quality of the original reasoning. ' +
  'Respond with ONLY valid JSON: {"reasoning": "sound" | "lucky" | "flawed"}. ' +
  'sound = the reasoning process was sound regardless of outcome. ' +
  'lucky = the outcome was correct but for wrong reasons. ' +
  'flawed = the reasoning process was demonstrably poor.';

const userMessage =
  `Outcome: ${outcome}\nOriginal prediction: ${prediction}\nGreg\'s account: ${resolutionText}`;
```

### Pattern 2: Stats SQL Query — Single Round-Trip with FILTER

**What:** One query that returns counts for the requested window.

```typescript
// [VERIFIED: D-16, STAT-04 — locked pattern]
// For a single window (e.g. 90 days):
const rows = await db
  .select({
    accuracyClass: decisions.accuracyClass,
    domainTag: decisions.domainTag,
  })
  .from(decisions)
  .where(
    and(
      eq(decisions.chatId, chatIdBig),
      inArray(decisions.status, ['reviewed']),
      gte(decisions.resolvedAt, sql`now() - interval '90 days'`),
    )
  );
```

The application then partitions `rows` into `hit/*`, `miss/*`, `ambiguous/*`, `unverifiable/*`, `*/unknown` buckets. No SQL aggregation needed — Greg-scale means rows <= 20.

### Pattern 3: Wilson Score CI (Application Code)

**What:** Computes Wilson 95% CI for a proportion. [VERIFIED: D-15]

```typescript
function wilsonCI(hits: number, n: number): { lo: number; hi: number } {
  const z = 1.96;
  const p = hits / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const denom = 1 + (z * z) / n;
  return { lo: center - margin / denom, hi: center + margin / denom };
  // Note: formula from D-15 needs careful application — see Common Pitfalls §Wilson
}
```

Precision: integer percent is recommended (Claude's discretion). `"65% [45-80%]"` is cleaner in a Telegram message than `"65.3% [44.7-80.2%]"`.

### Pattern 4: Command Router Extension

The existing `handleDecisionsCommand()` already dispatches on `sub.toLowerCase()`. Phase 17 replaces the stub cases:

```typescript
// [VERIFIED: decisions.ts lines 48-51 — current stubs]
if (['open', 'recent', 'stats', 'reclassify'].includes(sub!.toLowerCase())) {
  await ctx.reply(phase17Message(lang));
  return;
}
```

Replace with individual `if` blocks for each sub-command. Add `suppressions` and `unsuppress` cases alongside. The no-args path (line 24-27) changes from `usageMessage()` to the counts-only dashboard.

### Pattern 5: Event Log `classified` Write for Reclassify

`decision_events` already has `'classified'` in the `decisionEventTypeEnum`. [VERIFIED: schema.ts line 92]

For reclassify, the `snapshot` field stores `{ accuracyClass, accuracyModelVersion, reclassifiedAt }`. The `decisions` projection row's `accuracyClass` and `accuracyModelVersion` are overwritten with the latest. `fromStatus` and `toStatus` are null for `classified` events (no status change).

### Pattern 6: `removeSuppression()` Addition

`listSuppressions()` already exists in `suppressions.ts` (line 59). [VERIFIED] Only `removeSuppression()` is missing. Pattern mirrors `addSuppression`:

```typescript
// [ASSUMED] exact implementation; follows established Drizzle delete pattern
export async function removeSuppression(chatId: bigint, phrase: string): Promise<void> {
  const normalized = phrase.trim().toLowerCase();
  await db
    .delete(decisionTriggerSuppressions)
    .where(
      and(
        eq(decisionTriggerSuppressions.chatId, chatId),
        eq(decisionTriggerSuppressions.phrase, normalized),
      )
    );
}
```

### Recommended Project Structure (new files)

```
src/decisions/
├── classify-accuracy.ts   # (discretionary) reasoning-axis Haiku classifier
├── stats.ts               # Wilson CI, SQL query, output formatting helpers
└── __tests__/
    ├── classify-accuracy.test.ts   # Unit: fail-closed, valid outputs
    ├── stats.test.ts               # Integration: counts, CI, N<10 floor, domain breakdown
    └── decisions-command.test.ts   # Integration: command routing, reply formatting
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stats interval math | Custom statistics library | Wilson formula in ~8 lines of arithmetic | Greg-scale (<=20 decisions); no external dep needed |
| Haiku JSON parsing | Custom parser | Exact `classifyOutcome` pattern (clean + trim + JSON.parse) | [VERIFIED: resolution.ts 147] Pattern already battle-tested |
| SQL time windows | Date arithmetic in JS | `sql\`now() - interval 'N days'\`` | [VERIFIED: D-16 locked] Timezone-correct, single round-trip |
| Telegram message truncation | Custom word-wrap | Hard character limit + `…` suffix | Simple, predictable, grep-testable |

**Key insight:** The classification and stats logic in this phase is deceptively simple at Greg-scale. Resist over-engineering — a 20-row result set processed in memory beats a complex SQL aggregation for maintainability.

---

## Common Pitfalls

### Pitfall 1: Wilson CI Formula Application Error

**What goes wrong:** The D-15 formula in the CONTEXT.md has a subtle grouping: the margin term `z·sqrt(...)` is divided by `denom` but the center term `p + z²/2n` is also divided by `denom`. The raw formula as written applies the division only to the margin, producing wrong bounds.

**Correct application:** Both numerator components are divided by `(1 + z²/n)`:
```
lo = (p + z²/2n - z·sqrt(p(1-p)/n + z²/4n²)) / (1 + z²/n)
hi = (p + z²/2n + z·sqrt(p(1-p)/n + z²/4n²)) / (1 + z²/n)
```

**How to avoid:** Write a unit test with known values (e.g., 6/10 → expected ~30-85% at 95% CI from published tables).

**Warning signs:** CI bounds outside [0,1], or asymmetry that looks wrong at p=0.5.

### Pitfall 2: `classifyAccuracy()` Failure Breaking `handleResolution()`

**What goes wrong:** The new Haiku call after `classifyOutcome()` throws unexpectedly (network error, not timeout). If not wrapped in its own try/catch, the entire resolution handler aborts — Greg gets no acknowledgment, no post-mortem question, and the `due → resolved` transition has already committed (step 6).

**How to avoid:** Wrap `classifyAccuracy()` in try/catch. On any error, log and fall through with `accuracyClass = `${outcome}/unknown``. Accuracy classification is a side effect, not part of the user-visible response path. Never let it fail the reply.

**Warning signs:** Resolution tests failing with unhandled rejections; Greg stops receiving post-mortem questions.

### Pitfall 3: `classified` Event Violates `transitionDecision()` Assumption

**What goes wrong:** `transitionDecision()` always sets `fromStatus` and `toStatus` on events. A `classified` event has no status change — calling `transitionDecision()` for this is wrong. Using it would throw `InvalidTransitionError`.

**How to avoid:** Write classified events with a direct `db.insert(decisionEvents)` — the same way the event is written in the `handleResolution()` call site shown above. Do NOT route through `transitionDecision()`. [VERIFIED: lifecycle.ts — transitionDecision requires fromStatus/toStatus and validates them]

**Warning signs:** `InvalidTransitionError` at runtime; event log missing `classified` type entries.

### Pitfall 4: No-Args `/decisions` Returns Usage Instead of Dashboard

**What goes wrong:** The current handler returns `usageMessage(lang)` when `!after` (no argument). Phase 17 replaces this with the counts-only dashboard. Easy to miss because the stub behavior looks correct during development.

**How to avoid:** The no-args path is the first branch (lines 24-27 of decisions.ts). Replace `usageMessage(lang)` with a call to a new `buildDashboard(chatId, lang)` function. Verify with a test that `/decisions` (no arg) returns counts, not usage text.

### Pitfall 5: `unverifiable` Counted Toward Accuracy Denominator

**What goes wrong:** Decisions with `accuracyClass` starting with `unverifiable/` are included in the hit/total fraction, making N look larger and accuracy lower (since unverifiable is neither hit nor miss).

**How to avoid:** Filter: denominator = rows where `accuracyClass` starts with `'hit/'` or `'miss/'`. Unverifiable rows are tallied separately. `*/unknown` rows (Haiku timeout) are also excluded. [VERIFIED: D-17]

### Pitfall 6: Reclassify Running in Parallel

**What goes wrong:** Parallel Haiku calls for reclassify could hit rate limits and produce partial updates where some `decision_events` rows are missing.

**How to avoid:** D-12 mandates sequential. Use a `for...of` loop with `await`, not `Promise.all()`. [VERIFIED: CONTEXT.md D-12]

### Pitfall 7: `decisionText` Truncation Missing for Compact Lines

**What goes wrong:** A 200-character decision text in a compact one-liner blows out the Telegram bubble and makes `/decisions open` unreadable.

**How to avoid:** Truncate `decision_text` at 40-50 characters with `…` suffix. The exact limit is Claude's discretion but must be applied consistently across `open` and `recent` formatters.

---

## Code Examples

### Existing Pattern: `classifyOutcome` (Reuse for `classifyAccuracy`)

```typescript
// Source: src/decisions/resolution.ts lines 99-174 [VERIFIED]
// The exact timeout/fail-closed/JSON-parse pattern to reuse verbatim.
const OUTCOME_CLASSIFY_TIMEOUT_MS = 5000;

const raw = await Promise.race([
  anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 30,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
  }),
  new Promise<null>((r) => setTimeout(() => r(null), OUTCOME_CLASSIFY_TIMEOUT_MS)),
]);
if (raw === null) { return 'unknown'; }  // timeout fail-closed
```

### Existing Pattern: Language-Switched Output Strings

```typescript
// Source: src/bot/handlers/decisions.ts lines 60-98 [VERIFIED]
// All output helpers follow this exact shape — replicate for all new strings.
function someMessage(l: 'en' | 'fr' | 'ru'): string {
  switch (l) {
    case 'en': return 'English text';
    case 'fr': return 'French text';
    case 'ru': return 'Russian text';
  }
}
```

### Existing Pattern: Drizzle Insert to `decision_events`

```typescript
// Source: src/decisions/lifecycle.ts lines 119-126 [VERIFIED]
await tx.insert(decisionEvents).values({
  decisionId: id,
  eventType: 'status_changed',
  fromStatus,
  toStatus,
  snapshot: snapshotForEvent(updated[0]!),
  actor,
});
// For classified events: fromStatus and toStatus are omitted (null by default).
```

### Stats Output Format (D-08 specification)

```
// EN output for /decisions stats 90 (N>=10):
90-day accuracy: 65% [45-80% CI]
Unverifiable: 3 (excluded)

By domain:
  career: 4/6 (67%) [30-90% CI]
  health: 2/4 (50%) [14-86% CI]
  technical: N=2, threshold not met

// EN output for /decisions stats 90 (N<10):
90-day window: N=6, threshold not met (need 10 resolved)
Unverifiable: 2 (excluded)
```

### Counts-Only Dashboard (D-05 specification)

```
// EN output for /decisions (no args), 90-day N>=10:
5 open · 2 due · 12 reviewed · 1 stale
90-day accuracy: 65% [45-80% CI]

/decisions open · recent · stats [30|90|365] · suppress <phrase> · suppressions · unsuppress <phrase> · reclassify
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Bare accuracy percentage | Wilson CI with N-floor | Guards C6: small N shows wide CI, makes uncertainty visible |
| Single-axis outcome class | 2-axis outcome×reasoning | Distinguishes lucky hits from sound reasoning |
| Classify on read | Classify once at resolution, cache | Guards M4: no classification drift across Haiku model versions |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `classifyAccuracy()` Haiku prompt wording (sound/lucky/flawed definitions) | Architecture Patterns §1 | Reasoning classification may be noisy; can be tuned at execution time |
| A2 | `removeSuppression()` implementation using Drizzle delete with and() | Architecture Patterns §6 | Low risk — exact SQL is straightforward; can differ in style |
| A3 | Wilson CI numerics (lo/hi bounds split) | Architecture Patterns §3 + Common Pitfalls §1 | Wrong bounds if formula misapplied; unit test catches this |
| A4 | Decision text truncation at 40-50 chars | Architecture Patterns | Output aesthetics only; Greg can report if too short/long |

**All other claims verified against source files directly.**

---

## Open Questions (RESOLVED)

1. **`classify-accuracy.ts` as separate file or inline in `resolution.ts`?**
   - What we know: CONTEXT.md leaves this as Claude's discretion.
   - What's unclear: `resolution.ts` is already 386 lines; adding a full Haiku classifier inline will push it past ~450.
   - RESOLVED: Extract to `src/decisions/classify-accuracy.ts`. Keeps `resolution.ts` focused on the conversational flow. Cost is one extra import.

2. **`/decisions recent`: 5 or 10 decisions?**
   - What we know: CONTEXT.md says "5 or 10, Claude's discretion".
   - RESOLVED: Default to 5. PITFALLS m4 flags message overflow risk; `/decisions recent 10` is easy to add later.

3. **Wilson CI display: integer % or one decimal?**
   - RESOLVED: Integer percent. `"65% [45-80%]"` fits a Telegram line cleanly. One decimal adds noise at small N where the interval is already wide.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 17 has no new external dependencies. All tooling (Docker Postgres, Vitest, Anthropic SDK) was verified operational in prior phases.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/decisions/__tests__/` |
| Full suite command | `bash scripts/test.sh` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STAT-01 | `/decisions` no-args returns dashboard | integration | `npx vitest run src/decisions/__tests__/decisions-command.test.ts` | Wave 0 |
| STAT-01 | `/decisions open` returns sorted one-liners | integration | same file | Wave 0 |
| STAT-01 | `/decisions recent` returns newest-first | integration | same file | Wave 0 |
| STAT-01 | `/decisions suppressions` lists active phrases | integration | same file | Wave 0 |
| STAT-01 | `/decisions unsuppress <phrase>` removes exact match | integration | same file | Wave 0 |
| STAT-02 | `classifyAccuracy()` returns sound/lucky/flawed/unknown | unit | `npx vitest run src/decisions/__tests__/classify-accuracy.test.ts` | Wave 0 |
| STAT-02 | `classifyAccuracy()` fail-closes to `unknown` on timeout | unit | same file | Wave 0 |
| STAT-02 | `handleResolution()` writes `accuracy_class` to decisions row | integration | `npx vitest run src/decisions/__tests__/resolution.test.ts` | EXISTS |
| STAT-02 | `handleResolution()` appends `classified` event to decision_events | integration | same file | EXISTS (extend) |
| STAT-03 | N<10: returns counts only, no percentage | unit | `npx vitest run src/decisions/__tests__/stats.test.ts` | Wave 0 |
| STAT-03 | N>=10: returns percentage + Wilson CI | unit | same file | Wave 0 |
| STAT-03 | Wilson CI bounds are mathematically correct (known values) | unit | same file | Wave 0 |
| STAT-04 | SQL FILTER window excludes records outside window | integration | same file | Wave 0 |
| STAT-04 | `unverifiable` count surfaced separately | unit | same file | Wave 0 |
| STAT-05 | Domain-tag breakdown in stats output | integration | same file | Wave 0 |
| STAT-05 | `/decisions reclassify` appends new classified event, preserves old | integration | `npx vitest run src/decisions/__tests__/decisions-command.test.ts` | Wave 0 |
| STAT-05 | Reclassify runs sequentially (no parallel) | unit (mock) | same file | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/decisions/__tests__/`
- **Per wave merge:** `bash scripts/test.sh`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/decisions/__tests__/classify-accuracy.test.ts` — covers STAT-02 unit (timeout, fail-closed, valid outputs)
- [ ] `src/decisions/__tests__/stats.test.ts` — covers STAT-03, STAT-04, STAT-05 (Wilson CI math, SQL window, domain breakdown)
- [ ] `src/decisions/__tests__/decisions-command.test.ts` — covers STAT-01 command routing, reply formatting, reclassify

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Telegram auth already handled in bot middleware |
| V3 Session Management | no | Stateless command handler |
| V4 Access Control | yes | chatId scoping on all DB queries (existing pattern) |
| V5 Input Validation | yes | phrase length check for unsuppress (mirror suppress's 200-char guard) |
| V6 Cryptography | no | No new crypto |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| ChatId confusion — stats from wrong user | Information Disclosure | `WHERE chat_id = $chatId` on all decisions queries [VERIFIED: existing pattern] |
| Log leaking suppression phrase | Information Disclosure | logger.warn logs `{chatId, error.message}` only — do NOT log the phrase itself [VERIFIED: decisions.ts lines 38-41] |
| Reclassify hammering Haiku | Denial of Service | D-12: sequential loop + Greg-scale volume (<=20) makes DoS moot |

---

## Sources

### Primary (HIGH confidence — direct file reads)

- `src/bot/handlers/decisions.ts` — current command router shape, stub cases, isoLang helper [VERIFIED]
- `src/decisions/resolution.ts` — `classifyOutcome()` full pattern (lines 99-174), `handleResolution()` insertion point (line 294) [VERIFIED]
- `src/decisions/lifecycle.ts` — `transitionDecision()` shape, `decisionEvents` insert pattern [VERIFIED]
- `src/decisions/suppressions.ts` — `listSuppressions()` exists (line 59), `removeSuppression()` absent [VERIFIED]
- `src/db/schema.ts` — `accuracyClass`, `accuracyClassifiedAt`, `accuracyModelVersion`, `domainTag` columns confirmed present; `classified` in `decisionEventTypeEnum` [VERIFIED]
- `src/llm/client.ts` — `HAIKU_MODEL` constant, `callLLM` helper [VERIFIED]
- `.planning/research/PITFALLS.md` — C2, C6, M4 prevention strategies [VERIFIED]
- `.planning/research/ARCHITECTURE.md` — `/decisions` command placement, accuracy classification strategy [VERIFIED]
- `.planning/phases/17-decisions-command-accuracy-stats/17-CONTEXT.md` — all locked decisions D-01 through D-17 [VERIFIED]
- `.planning/REQUIREMENTS.md` — STAT-01 through STAT-05 full text [VERIFIED]

### Secondary (MEDIUM confidence)

- Wilson score interval formula — standard statistical result, consistent across multiple published sources [ASSUMED correctly stated in CONTEXT.md D-15; unit test will validate]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, all verified in codebase
- Architecture: HIGH — all patterns verified against live source files
- Pitfalls: HIGH — derived from direct code reading and locked CONTEXT.md decisions
- Wilson CI formula: MEDIUM — standard statistics, but application correctness requires unit test validation

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (stable codebase; extend if Phases 13-16 completion reveals schema changes)
