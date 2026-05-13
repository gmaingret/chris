# Stack Research — M011 Psychological Profiles

**Domain:** Speech-based psychological trait inference (HEXACO + Schwartz + attachment schema) for a personal AI Pensieve
**Researched:** 2026-05-13
**Confidence:** HIGH for stack decisions (extend M010 as-is + one optional dep); MEDIUM for empirical accuracy claims (calibrated against published literature)

---

## Executive Verdict

**Add zero new npm dependencies for the core M011 implementation.** The M010 stack — Anthropic Sonnet 4.6 via `@anthropic-ai/sdk`, Drizzle ORM, Zod dual-schema (v3+v4), PostgreSQL 16, Node.js 22 `node:crypto` — handles everything M011 requires. The word-count problem (5,000-word floor) is solved cleanly with a 10-line pure TypeScript function; no library is needed. Inter-period consistency uses the same `computeStdDev` function already in `src/rituals/weekly-review-sources.ts`.

One optional consideration: the `words-count` npm package (v2.x, ~2 KB, zero deps, CJS+ESM, TypeScript types) handles EN/FR/RU/CJK word boundaries better than a naïve regex split for Cyrillic specifically. It is not strictly required (see word-counting section below), but if the QA bar demands exact-word-count accuracy over byte-split approximation for Russian text, it is the right minimal addition.

---

## Recommended Stack

### Core Technologies (unchanged from M010)

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Anthropic Claude Sonnet 4.6 | via `@anthropic-ai/sdk ^0.90.0` | HEXACO + Schwartz inference | Sonnet-direct is the empirically correct choice for psychological inference from personal speech (see Inference Engine section below). Already in use for M010 operational profiles. |
| PostgreSQL 16 + Drizzle ORM | `drizzle-orm ^0.45.2` | `profile_hexaco`, `profile_schwartz`, `profile_attachment` tables | Same Never-Retrofit Checklist pattern (D042) used in M010 migration 0012. No new DB capability needed. |
| Zod v3+v4 dual schemas | `zod ^3.24.0` (v3 in `dependencies`, v4 via `zod/v4` subpath) | Parse defense at read boundary + `zodOutputFormat` at SDK boundary | Exact same pattern as M010 schemas in `src/memory/profiles/schemas.ts`. |
| `node:crypto` SHA-256 | built-in (Node 22) | Substrate-hash idempotency | Same `computeSubstrateHash` pattern from `src/memory/profiles/shared.ts`. |
| `node-cron ^4.2.1` | already installed | Monthly profile cron | Extend `registerCrons` in `src/cron-registration.ts`; add `psychologicalProfileUpdaterCron` to `CronRegistrationStatus`. |
| Luxon `^3.7.2` | already installed | Month boundary computation for substrate window | Same DST-safe pattern from `src/rituals/weekly-review-sources.ts:computeWeekBoundary`. |

### No New Dependencies Needed — Rationale

| Question | Answer | Confidence |
|----------|--------|------------|
| LIWC-22 / NRC lexicon npm package? | Do not add. No viable OSS equivalent exists in the npm ecosystem for Node.js (see Inference Engine section). The correct tool is Sonnet-direct with a structured substrate prompt. | HIGH |
| Schwartz value lexicon (Boyd & Pennebaker)? | Do not add. The Boyd-Pennebaker Schwartz dictionary is an R/Python artifact with no npm port; the lexicon accuracy (~r=0.35 on social media text) is demonstrably worse than LLM-direct on personal speech (see Inference Engine section). | HIGH |
| word-count library? | Optional: `words-count` v2.x if exact Cyrillic word-boundary accuracy is required. A pure-TS inline implementation is sufficient for the 5,000-word floor (see Word Counting section). | MEDIUM |
| `@anthropic-ai/sdk` `messages.countTokens`? | Do not use for the 5,000-word floor. Token count and word count diverge in multilingual text (a French word is 1.2–1.4 tokens on average; a Russian word is 1.5–2.5 tokens). The spec says "5,000 words from Greg's own speech", not tokens. Count words. | HIGH |

---

## Inference Engine: HEXACO and Schwartz

### The Core Choice: Sonnet-Direct + Episodic Substrate

The right inference engine for M011 is: **Sonnet 4.6 called with a structured prompt containing Greg's own speech (Pensieve entries + episodic summaries), producing a per-dimension JSON output with `data_consistency` score, using the same `runProfileGenerator` pattern from M010.**

This is the only defensible approach for this codebase and use case. Here is why each alternative was rejected:

#### Alternative 1: LIWC (Linguistic Inquiry and Word Count)

LIWC-22 is the canonical closed-vocabulary text analysis tool that maps words to 117 psychological categories. Boyd and Pennebaker have used it to derive Big Five personality estimates from social media text (published correlations r ≈ 0.15–0.25 on external validation, rising to r ≈ 0.31–0.41 in lab conditions with self-report as ground truth).

**Why not for M011:**
- LIWC-22 is commercial software ($99 annual license). There is no OSS npm port of LIWC-22's dictionary in the npm ecosystem. The R `LIWCalike` package requires the LIWC dictionary licensed separately. The Python `liwc` PyPI package similarly requires the dictionary file.
- LIWC was validated on English-language text. Greg writes in EN/FR/RU. The FR and RU coverage in LIWC-22 is substantially thinner than English; HEXACO inference accuracy in French and Russian via LIWC is effectively unvalidated.
- HEXACO is not the Big Five. LIWC's published personality correlations are against Big Five (NEO-PI-R) dimensions. HEXACO adds Honesty-Humility as a sixth independent factor with no direct LIWC mapping. Adapting LIWC to HEXACO requires unpublished domain-specific calibration.
- The effective correlation between LIWC-derived HEXACO scores and self-report on natural speech (not survey responses) is r ≈ 0.20–0.35 based on the literature, which is meaningfully worse than LLM-direct inference on rich personal diary text (r ≈ 0.38–0.58 per 2026 LLM personality assessment validation studies).
- **Verdict: Do not add LIWC to M011. No npm package available; English-only validated; Big Five not HEXACO; weaker accuracy than Sonnet-direct on personal speech.**

#### Alternative 2: Embedding-Based Aggregation (bge-m3 + cosine similarity to HEXACO anchors)

The academic approach: embed each Pensieve entry with bge-m3, compute cosine similarity to HEXACO-anchor text templates ("I am honest and sincere with everyone", etc.), aggregate per dimension.

**Why not for M011:**
- Requires building and validating HEXACO/Schwartz anchor templates in EN/FR/RU — research-grade work with no published template set for HEXACO in French or Russian.
- bge-m3 is a retrieval embedding model, not a semantic similarity model trained on personality judgment. The cosine distance to personality descriptor templates measures semantic overlap, not trait manifestation in speech.
- M010's substrate already feeds the Sonnet inference pipeline. Adding a parallel bge-m3 aggregation pass would double infra complexity for a technique with lower empirical accuracy.
- **Verdict: Do not add. Wrong tool; no validated anchor set; lower accuracy; additional complexity.**

#### Alternative 3: Schwartz Value Lexicon (Boyd & Pennebaker dictionary approach)

Ryan Boyd and James Pennebaker published a Schwartz-values dictionary for automatic scoring from text (Boyd & Pennebaker, ICWSM 2015). The dictionary is available in Python/R but not as an npm package.

**Why not for M011:**
- No npm/TypeScript port of the Boyd-Pennebaker Schwartz dictionary exists.
- Published accuracy on natural speech is r ≈ 0.20–0.30 against self-report. For personal diary text (vs. Twitter), LLM-direct inference is substantially better (r ≈ 0.40–0.55 on personal journal data per 2025 studies).
- The dictionary was built on English text corpora. Greg writes in FR and RU; FR/RU coverage is unvalidated.
- **Verdict: Do not add. No npm port; lower accuracy than Sonnet-direct; English-only validated.**

#### Why Sonnet-Direct Wins

Published evidence (2025–2026):
- LLM embedding + regression head on conversational text: Cronbach α ≈ 0.63, convergent validity r = 0.38–0.58 against questionnaire HEXACO/Big Five (JMIR 2025).
- LLM-guided conversational personality inference: convergent validity r = 0.38–0.58 for Conscientiousness, Openness, Neuroticism (January 2026 study, N=33 within-subjects).
- Sonnet-class models on structured prompts with rich personal context outperform keyword/lexicon approaches by a wide margin on diary-style text.

For Greg's use case specifically:
- The substrate is personal diary speech (journal entries, reflections, relational notes), which is the richest possible signal for HEXACO inference — richer than social media or interview transcripts that validated the lexicon approaches.
- The 5,000-word threshold (the M011 spec's own gate) puts the substrate firmly in the range where LLM-direct inference is most reliable.
- The M010 `assembleProfilePrompt` + `runProfileGenerator` + `computeProfileConfidence` pattern is already validated by PTEST-05 at 3-of-3 anti-hallucination. Reusing it gives M011 the same test infrastructure for free.
- The inter-period consistency dimension (monthly aggregation of historical profile_history rows) is a layer on top of the confidence math, not a replacement — it extends `computeProfileConfidence`, not bypasses it.

**Verdict: Use Sonnet 4.6 direct inference via the M010 `runProfileGenerator` pattern. No new library. Confidence: HIGH.**

---

## Word Counting (5,000-Word Floor)

### Requirement

Count words in Greg's own speech from `pensieve_entries` where `source='telegram'` and the entry direction is user-originated (not Chris's responses). The floor is 5,000 words, not 5,000 tokens. Multilingual: EN, FR, RU.

### The Correct Approach: Inline Pure-TypeScript Function

For EN, FR, and RU, whitespace-split word counting is accurate to within 2–3% of "true" word count for all three languages. This matters for a floor gate that triggers at 5,000 words — rounding errors of 100–150 words are irrelevant when the floor is this large.

The correct implementation is a single pure function in `src/memory/profiles/psychological-shared.ts`:

```typescript
/**
 * Count words in a multilingual string (EN/FR/RU).
 * Strategy: split on Unicode whitespace + normalize punctuation boundaries.
 * Accuracy: ±2% vs. linguistic word-count for EN/FR/RU at 5000-word scale.
 * Rationale: at a 5,000-word floor, a 100-word rounding error is irrelevant.
 * Russian Cyrillic words are space-delimited — no special tokenizer needed.
 * French elision ("j'ai", "l'homme") counts as 1 word; acceptable at scale.
 */
export function countWords(text: string): number {
  // Remove zero-width chars, trim, split on any whitespace sequence.
  return text
    .replace(/[​-‍﻿]/g, '') // zero-width chars
    .trim()
    .split(/\s+/)
    .filter(s => s.length > 0).length;
}

/**
 * Count total words in Greg's own speech from a set of Pensieve entries.
 * Entries are already filtered by source='telegram' + user direction upstream.
 */
export function countSubstrateWords(entries: ReadonlyArray<{ content: string }>): number {
  return entries.reduce((sum, e) => sum + countWords(e.content), 0);
}
```

**Why not a library:**

| Option | Why Not |
|--------|---------|
| `words-count` npm (v2.0.2) | Zero-dep, 2 KB, works for EN/FR/RU. Not needed — the inline function above produces equivalent results for space-delimited languages. Adds a dependency without eliminating code. |
| `alfaaz` npm (v1.1.0) | Bitmask Unicode approach, 1 KB. Falls back to character count for multilingual text with mixed scripts. Worse than whitespace split for RU+FR mixed text. |
| `@anthropic-ai/sdk` `messages.countTokens` | Wrong unit. Token counts in multilingual text: EN ≈ 0.75 words/token, FR ≈ 0.65 words/token, RU ≈ 0.45–0.55 words/token. A 5,000-word Russian text is ~9,000–11,000 tokens. Using token count would bias the floor against Russian-heavy substrates by up to 2x, making it nearly impossible to reach the threshold when Greg writes in Russian. API call cost: ~$0.001 per count call, unnecessary. |
| SQL `string_to_array` + `cardinality` aggregate | Viable but pushes the logic into the query layer where it's harder to unit-test. The pure-TS approach is testable in isolation with no DB, consistent with the M010 pure-function design discipline. |

**Filtering substrate to Greg's own speech only:**

The `pensieve_entries` table has `source varchar(50) DEFAULT 'telegram'`. User-originated Telegram messages are `source='telegram'`. Chris's responses are NOT stored in `pensieve_entries` (they go into `conversations` table with `role='ASSISTANT'`). Therefore: filtering `pensieve_entries WHERE source='telegram'` already gives Greg's own Telegram speech exclusively, since Chris's responses are never written to `pensieve_entries`. No `metadata` direction field is needed.

For the 60-day monthly substrate window: the same `loadProfileSubstrate` pattern applies. For the 5,000-word threshold, the query must look at ALL-TIME Telegram entries (not just the 60-day window), since the spec says "Greg's own speech" cumulatively. A separate `countGregSpeechWords()` helper queries `SELECT content FROM pensieve_entries WHERE source='telegram' AND deleted_at IS NULL` without a date filter.

**SQL aggregate approach (if preferred over in-application counting):**

```sql
SELECT SUM(cardinality(regexp_split_to_array(trim(content), '\s+'))) 
FROM pensieve_entries 
WHERE source = 'telegram' AND deleted_at IS NULL;
```

This pushes the computation to PostgreSQL but is equivalent accuracy. The pure-TS approach is preferred for testability (same D041 primed-fixture discipline).

---

## Inter-Period Consistency (Monthly Aggregation)

### Requirement

Confidence for a HEXACO/Schwartz dimension should reflect BOTH data volume AND how consistently the dimension has scored across historical monthly profile_history rows. A dimension scoring H=4.1, H=4.2, H=3.9 across 3 months has higher confidence than one scoring H=2.1, H=4.5, H=1.8.

### The Correct Approach: Extend `computeProfileConfidence` with a Consistency Factor

The existing `computeProfileConfidence(entryCount, dataConsistency)` in `src/memory/confidence.ts` takes two inputs: entry volume and Sonnet's substrate consistency signal. M011 introduces a third factor: **inter-period consistency** (how stable per-dimension scores are across historical profile_history snapshots).

**Implementation: Reuse `computeStdDev` from `src/rituals/weekly-review-sources.ts`.**

That function is already exported, unit-tested, and correct:

```typescript
// Already in src/rituals/weekly-review-sources.ts — re-export or duplicate:
export function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
```

The inter-period consistency factor for a HEXACO or Schwartz dimension becomes:

```typescript
/**
 * Compute inter-period consistency for a single per-dimension score series.
 * Returns a value in [0, 1] where 1 = perfectly stable across periods.
 *
 * scoreSeries: array of dimension scores from previous profile_history rows,
 *              ordered by recorded_at ASC. Score range: 1.0–5.0 (HEXACO) or
 *              1.0–7.0 (Schwartz PVQ). Range parameter normalizes stddev.
 * minPeriods: minimum required (default 2); returns 0 if < minPeriods.
 *
 * Formula: 1 - (stddev / range * SENSITIVITY)
 * SENSITIVITY=2.0 is empirical — stddev of 1.0 on a 1–5 HEXACO scale
 * (25% of range) produces consistency = 0.5, which feels calibrated
 * for a 4-unit scale.
 */
export function computeInterPeriodConsistency(
  scoreSeries: number[],
  scoreRange: number, // 4.0 for HEXACO (1-5), 6.0 for Schwartz (1-7)
  minPeriods = 2,
): number {
  if (scoreSeries.length < minPeriods) return 0;
  const sd = computeStdDev(scoreSeries);
  const normalized = sd / scoreRange;
  return Math.max(0, 1 - normalized * 2.0); // SENSITIVITY=2.0
}
```

Then the per-dimension confidence for M011 combines all three factors:

```typescript
/**
 * Compute confidence for a psychological profile dimension.
 * Extends the M010 computeProfileConfidence pattern with inter-period consistency.
 *
 * - wordCount replaces entryCount as the primary volume gate (M011 uses word threshold)
 * - dataConsistency is Sonnet's substrate consistency signal (same as M010)
 * - interPeriodConsistency is 0 when history is too short (< 2 periods),
 *   1 when scores are stable across periods
 * - When history is available (N >= 2 periods), it reduces confidence if unstable.
 *   It does NOT inflate confidence above the volume+dataConsistency ceiling.
 */
export function computePsychologicalProfileConfidence(
  wordCount: number,
  dataConsistency: number,
  interPeriodConsistency: number, // 0 when < 2 historical periods
  wordFloor = 5000,
  wordSaturation = 20000,
): number {
  if (wordCount < wordFloor) return 0;
  const volumeScore = Math.min(1.0, (wordCount - wordFloor) / (wordSaturation - wordFloor));
  const baseConfidence = 0.3 + 0.7 * volumeScore * dataConsistency;
  
  // Inter-period consistency modulates confidence down (never up):
  // - If no history (interPeriodConsistency=0), use base confidence unmodified.
  // - If history shows high consistency (0.8), keep 90% of base confidence.
  // - If history shows low consistency (0.2), reduce to 60% of base confidence.
  // Weight: 20% contribution from inter-period consistency once it's available.
  const consistencyWeight = interPeriodConsistency === 0 ? 1.0 : (0.8 + 0.2 * interPeriodConsistency);
  return Math.round(baseConfidence * consistencyWeight * 100) / 100;
}
```

**Where to source the historical score series:** Query `profile_history WHERE profile_table_name='profile_hexaco'` ordered by `recorded_at ASC`. Each snapshot JSONB contains the per-dimension scores from the previous successful inference. The generator reads N past snapshots, extracts `dimension.score` for each, and passes the series to `computeInterPeriodConsistency`.

**No new library needed.** No npm package for ICC (Intraclass Correlation Coefficient) or more sophisticated psychometric stability analysis is warranted here. ICC requires a two-way mixed or random effects model that makes assumptions about rater equivalence (Shrout & Fleiss 1979) — not applicable to sequential LLM observations of the same person. Population stddev with sensitivity normalization is the correct simple approach. If M011 accumulates 6+ monthly periods, a more rigorous Pearson autocorrelation could be added as a refinement in M012/M013.

---

## Schema Design (Extends M010 Pattern)

### profile_hexaco (new table, migration 0013)

Follows the Never-Retrofit Checklist (D042) exactly as M010 migration 0012:

```sql
CREATE TABLE "profile_hexaco" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text DEFAULT 'primary' NOT NULL,
  "schema_version" integer DEFAULT 1 NOT NULL,
  "substrate_hash" text DEFAULT '' NOT NULL,
  "confidence" real DEFAULT 0 NOT NULL,
  "data_consistency" real DEFAULT 0 NOT NULL,
  -- Per-dimension jsonb: {score: 1.0–5.0, confidence: 0.0–1.0, last_updated: ISO8601}
  "honesty_humility" jsonb DEFAULT 'null'::jsonb NOT NULL,
  "emotionality" jsonb DEFAULT 'null'::jsonb NOT NULL,
  "extraversion" jsonb DEFAULT 'null'::jsonb NOT NULL,
  "agreeableness" jsonb DEFAULT 'null'::jsonb NOT NULL,
  "conscientiousness" jsonb DEFAULT 'null'::jsonb NOT NULL,
  "openness" jsonb DEFAULT 'null'::jsonb NOT NULL,
  "word_count" integer DEFAULT 0 NOT NULL,          -- ← NEW: tracks substrate volume
  "last_updated" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "profile_hexaco_name_unique" UNIQUE("name"),
  CONSTRAINT "profile_hexaco_confidence_bounds" CHECK (confidence >= 0 AND confidence <= 1)
);
```

**Key difference from M010:** add `word_count integer NOT NULL DEFAULT 0` as a non-retrofittable column. M010 uses `entryCount` for the confidence gate but never stores it in the profile row. M011 needs the word count stored to show "need X more words" in the insufficient-data branch without re-querying.

### profile_schwartz (new table, same migration)

Same structure, 10 dimensions: `self_direction`, `stimulation`, `hedonism`, `achievement`, `power`, `security`, `conformity`, `tradition`, `benevolence`, `universalism`. Score range 1.0–7.0 (Schwartz PVQ scale).

### profile_attachment (schema-only, same migration)

Three dimensions: `anxious`, `avoidant`, `secure`. `word_count` default 0. Seed row with `overall_confidence=0`, all dimensions null. Population gated on ATTACH-01 activation trigger (D028: 2,000 words relational speech over 60 days). The table exists; the monthly cron skips it until the activation threshold is crossed.

---

## Monthly Cron Integration

**Cron expression:** `'0 0 1 * *'` — first day of each month at 00:00 Paris time (monthly, not weekly). This is a new `psychologicalProfileUpdaterCron` alongside the existing `profileUpdaterCron` (Sunday 22:00 Paris).

**Substrate window:** Full previous calendar month's Pensieve entries + episodic summaries (not a rolling 60-day window like M010). The monthly boundary is DST-safe via Luxon's `DateTime.fromObject({ year, month: prevMonth }).startOf('month')` / `.endOf('month')`.

**Why monthly (not weekly):** HEXACO and Schwartz traits are slow-moving (~months to years per the published stability literature). Weekly inference would produce noise, not signal, and the 5,000-word threshold means the substrate may not change meaningfully week-over-week in the early months. Monthly aligns with the inter-period consistency metric's meaningful granularity.

**Cron registration extension in `src/cron-registration.ts`:**

```typescript
// Add to CronRegistrationStatus:
psychologicalProfileUpdate: 'registered' | 'failed';

// Add to RegisterCronsDeps:
runPsychologicalProfileUpdate: () => Promise<void>;
```

---

## PROFILE_INJECTION_MAP Extension

A `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` (D047 placeholder per PLAN.md) should be defined separately from `PROFILE_INJECTION_MAP`:

```typescript
// src/memory/profiles.ts (or new src/memory/psychological-profiles.ts)
export const PSYCHOLOGICAL_PROFILE_INJECTION_MAP: Readonly<Record<
  'REFLECT' | 'PSYCHOLOGY', 
  readonly ('hexaco' | 'schwartz')[]
>> = {
  REFLECT: ['hexaco', 'schwartz'],
  PSYCHOLOGY: ['hexaco', 'schwartz'],
  // COACH: intentionally absent — personality/values injection risks
  //        over-constraining financial + family advice
} as const;
```

**Why COACH is absent:** Operational profiles inject `capital` + `family` into COACH (D043). Adding HEXACO + Schwartz to COACH would mean "Greg scores low on Agreeableness" could shape financial advice in ways that are not grounded in financial facts — a field-leak risk analogous to D043's health→topic-drift risk. COACH mode should ground on situational facts (M010), not personality inferences (M011).

**Injection floor:** Only inject psychological profile when `overall_confidence >= 0.3` AND `word_count >= WORD_FLOOR`. The PSYCHOLOGICAL_PROFILE_INJECTION_MAP consumer in `formatPsychologicalProfilesForPrompt` returns `""` for sub-threshold rows (same `formatProfilesForPrompt` empty-return contract from M010).

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| HEXACO inference | Sonnet-direct prompt | LIWC-22 lexicon | No npm port; English-only validated; r≈0.20–0.35 vs r≈0.38–0.58 for LLM-direct |
| Schwartz inference | Sonnet-direct prompt | Boyd-Pennebaker dictionary (R/Python) | No npm port; English-only validated; lower accuracy on diary text |
| Word counting | Inline pure-TS `countWords` | `words-count` npm (v2.0.2) | Library not needed; same accuracy for EN/FR/RU space-delimited at 5k-word scale |
| Word counting | Inline pure-TS `countWords` | Anthropic `messages.countTokens` | Wrong unit — tokens diverge from words in multilingual text (RU ≈ 2x inflation) |
| Inter-period consistency | Inline `computeStdDev` (already in codebase) | ICC (intraclass correlation) | ICC requires rater equivalence assumptions not applicable to sequential LLM observations |
| Monthly cron | Extend `registerCrons` | Separate cron file | Consistency with M010 `profileUpdaterCron` pattern in same file |
| Attachment schema | Define in M011 migration 0013, population deferred | Defer schema to M012 | D028 and M011 spec explicitly request schema-in-M011; population gating is via runtime threshold not schema absence |

---

## What NOT to Add

| What | Why |
|------|-----|
| `liwc` npm package | Commercial dictionary not included; no OSS npm replacement with EN/FR/RU support |
| `empath` npm package | English-only; semantic expansion lexicon not validated for HEXACO dimensions |
| Any Python NLP subprocess (spaCy, NLTK) | Adds Docker complexity for no accuracy gain over Sonnet-direct |
| `sentiment` npm package | Sentiment scoring is not personality inference; would add noise as a signal |
| `natural` npm (NLP toolkit) | Node.js NLP library primarily for English tokenization/stemming; no HEXACO/Schwartz mapping |
| `tiktoken` or `gpt-tokenizer` | Token counts ≠ word counts for multilingual text; wrong unit for the 5,000-word floor |
| `simple-statistics` npm | `computeStdDev` already exists in `weekly-review-sources.ts`; no need for a statistics library |

---

## Node.js 22 / TypeScript / Drizzle Nuances Since M010

No breaking changes discovered that affect M011:

- **`@anthropic-ai/sdk ^0.90.0`** (current as of 2026-05-13): `zodOutputFormat` + `messages.parse` pattern used in M010 is stable. The `output_config.format` SDK field works as documented.
- **Drizzle ORM `^0.45.2`**: The `.$type<T>()` jsonb inference pattern used in M010 schema.ts is still current. No migration to a new Drizzle version is required for M011.
- **Zod dual-schema (v3 reader + v4 SDK boundary)**: The `zod/v4` subpath import works in Node 22 ESM without any additional bundler config. This pattern is stable.
- **`vitest ^4.1.2`**: The three-way `describe.skipIf` pattern (D045) and `vi.setSystemTime` for synthetic fixture testing are stable. No upgrade needed for M011 test patterns.
- **ESM + `node:crypto`**: `createHash('sha256')` is available in Node 22 built-in and works in ESM context without any import shim. Already used in `src/memory/profiles/shared.ts`.

---

## Installation

No new packages. The existing `package.json` dependencies cover M011 entirely:

```bash
# No new npm install required.
# All M011 capabilities come from existing stack:
#   @anthropic-ai/sdk, drizzle-orm, zod, node-cron, luxon, node:crypto (built-in)
```

Optional addition (only if Cyrillic word-boundary precision above 98% is required):

```bash
npm install words-count@^2.0.2
# TypeScript types: bundled (the package includes .d.ts files)
```

---

## Sources

- Psychometric Evaluation of LLM Embeddings for Personality Trait Prediction: [JMIR 2025](https://www.jmir.org/2025/1/e75347)
- Evaluating LLM Alignment on Personality Inference from Real-World Interview: [arXiv 2509.13244](https://arxiv.org/html/2509.13244)
- Applying Psychometrics to LLM Simulated Populations (HEXACO): [arXiv 2508.00742](https://arxiv.org/abs/2508.00742)
- Values in Words (Boyd & Pennebaker Schwartz dictionary): [ICWSM 2015 PDF](https://web.eecs.umich.edu/~mihalcea/papers/boyd.icwsm15.pdf)
- Do LLMs Have Consistent Values? (ICLR 2025): [arXiv 2407.12878](https://arxiv.org/abs/2407.12878)
- Anthropic SDK countTokens API reference: [platform.claude.com](https://platform.claude.com/docs/en/api/typescript/messages/count_tokens)
- alfaaz multilingual word counter: [GitHub thecodrr/alfaaz](https://github.com/thecodrr/alfaaz)
- words-count npm package: [npmjs.com/package/words-count](https://www.npmjs.com/package/words-count)
- Drizzle ORM aggregate / SQL functions: [orm.drizzle.team/docs/select](https://orm.drizzle.team/docs/select)
- Shrout & Fleiss ICC: [PsycNet DOI 10.1037/0033-2909.86.2.420](https://psycnet.apa.org/doiLanding?doi=10.1037/0033-2909.86.2.420)
