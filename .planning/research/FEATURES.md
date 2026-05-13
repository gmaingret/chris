# Feature Research — M011 Psychological Profiles

**Domain:** Psychological trait + values inference from personal speech corpus (HEXACO Big Six + Schwartz Ten Values + attachment schema)
**Researched:** 2026-05-13
**Confidence:** HIGH (direct codebase read of M010 patterns; MEDIUM for empirical accuracy bounds from literature)

---

## Prerequisite: What M010 Already Established (Do Not Re-Spec)

The following M010 patterns are FIXED CONTRACTS that M011 must mirror exactly, not re-invent:

- `runProfileGenerator` shared helper in `src/memory/profiles/shared.ts` — single call entry point for all profile dimension generation
- `Promise.allSettled` orchestration fan-out in `src/memory/profile-updater.ts`
- SHA-256 substrate-hash idempotency (D044 three-cycle pattern)
- Zod v3 `.strict()` read schemas + Zod v4 (no `.strict()`) write schemas, both in lock-step
- `ProfileGeneratorConfig<TData extends { data_consistency: number }>` generic config shape
- `computeProfileConfidence(entryCount, dataConsistency)` formula in `src/memory/confidence.ts`
- `PROFILE_INJECTION_MAP` per-mode subset in `src/memory/profiles.ts`
- `formatProfileForDisplay` pure formatter pattern in `src/bot/handlers/profile.ts`
- `loadPrimedFixture(name)` FK-safe test loader
- Never-Retrofit Checklist columns: `schema_version`, `substrate_hash`, `name UNIQUE DEFAULT 'primary'`
- Three-way `describe.skipIf` for live tests (D045): `RUN_LIVE_TESTS && ANTHROPIC_API_KEY && FIXTURE_PRESENT`

---

## Table Stakes (M011 Must Ship These)

Features that define the milestone as done. Missing any = M011 is not shippable.

| Feature | Why Expected | Complexity | M010 Dependency |
|---------|--------------|------------|-----------------|
| `profile_hexaco` table with 6 dims | Core milestone goal; already specced in M011 spec | MEDIUM | Mirrors M010 profile table schema; Never-Retrofit Checklist columns ship in new migration |
| `profile_schwartz` table with 10 dims | Core milestone goal; already specced | MEDIUM | Same as above |
| `profile_attachment` table, schema-only | D028 in PROJECT.md locks this as deferred-but-schema-defined | LOW | Migration ships alongside HEXACO/Schwartz |
| Per-dimension `{score, confidence, last_updated}` jsonb structure | M011 spec mandates this; mirrors M010 jsonb column shape | LOW | Exact same jsonb-column pattern as M010 health/family dims |
| 5,000-word floor (Greg's speech only) | M011 spec mandates; empirical minimum for defensible HEXACO/Schwartz inference (r ≈ .31–.41 per literature) | LOW | Extends M010 `MIN_ENTRIES_THRESHOLD` pattern; new word-count gate replaces entry-count gate for psychological profiles |
| Monthly cron (previous calendar month) | M011 spec mandates; slower cadence than operational profiles is correct — HEXACO/Schwartz are slow-moving traits | LOW | Adds a new cron entry to `cron-registration.ts` alongside M010 Sunday cron; different day to avoid API contention |
| Per-dimension `data_consistency` + host-computed `overall_confidence` | Anti-inflation: same hybrid model as M010 — Sonnet reports substrate consistency, host computes final confidence | LOW | Reuses `computeProfileConfidence()` directly; same formula |
| `getPsychologicalProfiles()` reader API | M011 spec mandates; REFLECT/COACH/PSYCHOLOGY need it for mode injection | MEDIUM | Mirrors `getOperationalProfiles()` in `src/memory/profiles.ts`; new function in same file or sibling `profiles-psychological.ts` |
| `PROFILE_INJECTION_MAP` extension for HEXACO + Schwartz | Operational profiles already inject via this map; psychological profiles extend it | LOW | Extend existing map constant or add `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` constant |
| `/profile` command extended with HEXACO + Schwartz sections | M011 spec mandates; replaces M010 placeholder reply | MEDIUM | Extends `handleProfileCommand` in `src/bot/handlers/profile.ts`; adds 2 new dimension blocks |
| Insufficient-data branch UX in `/profile` | M011 spec mandates; below 5,000 words → actionable "need X more words" message per dimension | LOW | Mirrors M010 zero-confidence branch; `MSG.insufficientData` pattern |
| Cold-start behavior (row exists, `overall_confidence=0`, all dims show "insufficient data — need X more words") | System ships before any monthly data; first cron fire finds empty substrate | LOW | Phase 33 seed-row pattern: insert initial row with `substrate_hash=''`, `overall_confidence=0`, all dims null; first fire always proceeds to Sonnet and returns below-threshold outcome |
| Synthetic fixture test (1,000 words → no profile; 6,000 words → populated; signature detectable) | M011 spec mandates; D041 primed-fixture pipeline applies | HIGH | Requires `synthesize-delta.ts --psych-profile-bias` flag; 30+ synthetic days; designed personality signature in generated speech |
| Live 3-of-3 anti-hallucination milestone-gate against real Sonnet | M010 PTEST-05 precedent; required by PROJECT.md sequencing discipline | MEDIUM | Three-way `describe.skipIf` per D045; ~$0.10-0.15 cost per D046 |

---

## Feature Detail: HEXACO Extraction Pattern (Q1)

**Table-stakes pattern: single Sonnet call per profile type, all 6 dimensions in one prompt, returning structured JSON.**

Do NOT use six separate Sonnet calls — one per dimension. Rationale:
- HEXACO dimensions are theoretically correlated (e.g. Honesty-Humility inversely predicts Agreeableness); splitting calls loses cross-dimension coherence
- M010 uses a single Sonnet call per profile dimension, not per field — but that is because M010's dimensions are topically independent (jurisdictional vs capital vs health vs family). HEXACO's 6 dims are one psychological framework and belong together
- Research literature on Schwartz (19 values in one prompt, all returned as JSON ratings) confirms the single-call pattern as standard in NLP-based value inference
- Token economy: 6,000 words of substrate + 6 HEXACO prompts in one call ≈ ~9,000 tokens; six separate calls would be 6× the API cost for worse coherence

**Pattern mirrors M010 at the profile-type level, not the dimension level:**
- One `generateHexacoProfile({ substrate })` function = one Sonnet call
- One `generateSchwartzProfile({ substrate })` function = one Sonnet call
- Both called via `Promise.allSettled` in the monthly orchestrator
- Each returns `ProfileGenerationOutcome` discriminated union (same as M010)

**Prompt shape for HEXACO (per research + M010 DO_NOT_INFER_DIRECTIVE pattern):**
```
System: CONSTITUTIONAL_PREAMBLE + role preamble + DO_NOT_INFER_DIRECTIVE + volume-weight ceiling + previous-state block (conditional) + HEXACO dimension definitions + substrate block + structured-output directive

User: "Infer the HEXACO personality profile from the substrate above."

Output schema (v4 Zod): {
  honesty_humility: { score: 1.0–5.0, dimension_consistency: 0.0–1.0 } | null,
  emotionality: { score: 1.0–5.0, dimension_consistency: 0.0–1.0 } | null,
  extraversion: { score: 1.0–5.0, dimension_consistency: 0.0–1.0 } | null,
  agreeableness: { score: 1.0–5.0, dimension_consistency: 0.0–1.0 } | null,
  conscientiousness: { score: 1.0–5.0, dimension_consistency: 0.0–1.0 } | null,
  openness: { score: 1.0–5.0, dimension_consistency: 0.0–1.0 } | null,
  data_consistency: 0.0–1.0  // substrate-wide; feeds computeProfileConfidence
}
```

Each dimension has its OWN `dimension_consistency` (per-dim evidence quality) PLUS a `data_consistency` at the top level (overall substrate coherence for the `computeProfileConfidence` formula). This gives per-dim confidence AND overall confidence.

**Key HEXACO definitions to inject in prompt** (all 6 must be in the system prompt to anchor Sonnet's interpretation to the correct academic framework, not layman synonyms):
- Honesty-Humility: sincerity, fairness, avoidance of greed and deception
- Emotionality: anxiety, dependence, sentimentality, emotional sensitivity
- Extraversion: social self-esteem, social boldness, sociability, liveliness
- Agreeableness: forgiveness, gentleness, flexibility, patience
- Conscientiousness: organization, diligence, perfectionism, prudence
- Openness: aesthetic appreciation, inquisitiveness, creativity, unconventionality

---

## Feature Detail: Schwartz Values Extraction Pattern (Q2)

**Table-stakes pattern: single Sonnet call returning all 10 value scores.**

Schwartz's 10 values are designed as a circular motivational structure — adjacent values share motivations, opposing values conflict. Splitting into 10 separate calls destroys this circumplex structure and loses cross-value evidence. Single-call is the correct pattern (confirmed by NLP literature which treats all 19 Schwartz values in one prompt).

**Output schema:**
```
{
  self_direction: { score: 1.0–5.0, dimension_consistency: 0.0–1.0 } | null,
  stimulation: ...,
  hedonism: ...,
  achievement: ...,
  power: ...,
  security: ...,
  conformity: ...,
  tradition: ...,
  benevolence: ...,
  universalism: ...,
  data_consistency: 0.0–1.0
}
```

**Value definitions to anchor in prompt** (each is a motivational goal, not a behavior):
- Self-Direction: independent thought/action, freedom, creativity
- Stimulation: novelty, excitement, challenge
- Hedonism: pleasure, self-gratification
- Achievement: personal success, competence, ambition
- Power: social status, prestige, control over others/resources
- Security: safety, stability, harmony of self and society
- Conformity: restraint of actions that violate social norms
- Tradition: respect for and commitment to cultural/religious customs
- Benevolence: care for close others (family, friends)
- Universalism: understanding, appreciation, and protection of all people/nature

**Prompt discipline:** The prompt must explicitly instruct Sonnet to infer values from Greg's EXPRESSED BEHAVIOR and STATED PREFERENCES as recorded in the Pensieve — not from his abstract self-description ("I think I value freedom"). Behavior is more reliable than self-report for value inference.

---

## Feature Detail: Attachment Schema (Q3)

**Population deferred. Schema must be defined in M011 migration.**

The schema captures adult attachment dimensions as established in research (Ainsworth ECR-R model — two-dimensional: anxious + avoidant, with secure as derived from low scores on both):

```sql
profile_attachment (
  id uuid pk,
  name text NOT NULL UNIQUE DEFAULT 'primary',  -- Never-Retrofit Checklist
  schema_version int NOT NULL DEFAULT 1,          -- Never-Retrofit Checklist
  substrate_hash text,                             -- Never-Retrofit Checklist
  
  -- Per-dimension scores (null until activation threshold met)
  anxious jsonb DEFAULT '{"score": null, "dimension_consistency": null}'::jsonb,
  avoidant jsonb DEFAULT '{"score": null, "dimension_consistency": null}'::jsonb,
  secure jsonb DEFAULT '{"score": null, "dimension_consistency": null}'::jsonb,
  
  overall_confidence real CHECK (overall_confidence >= 0 AND overall_confidence <= 1) DEFAULT 0,
  last_updated timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW()
)
```

**Activation trigger (weekly sweep):** A new weekly sweep check counts words of RELATIONAL SPEECH (Greg describing interactions with people he is emotionally involved with — identified by RELATIONSHIP-tagged entries mentioning emotional content, not just any mention of people). When count ≥ 2,000 words over ≥ 60 days of history, the sweep sets a flag (`profile_attachment.overall_confidence > 0`) and activates the inference path.

**Cold-start UX:** Row exists from migration seed with all dims null and `overall_confidence=0`. `/profile` shows: "Attachment profile: insufficient relational data — Chris needs 2,000+ words describing your close relationships over 60+ days." The word count should be shown: "currently ~X words."

**Why 2,000 words over 60 days (not entries):** Attachment patterns are revealed in how Greg describes relational dynamics (pronoun usage, emotional valence, distance/closeness framing, conflict resolution language) — not in factual entries about where he lives. A month of daily journaling that never mentions close relationships yields nothing. The threshold is about content quality, not volume.

---

## Feature Detail: Per-Dimension Confidence (Q4)

**Table-stakes: numeric confidence [0,1] shown as percentage, plus textual qualifier bracket.**

The M010 pattern (`computeProfileConfidence(entryCount, dataConsistency)`) is the foundation. M011 extends it with:

1. **Per-dimension confidence** (DIFFERENTIATOR, not table stakes): each HEXACO/Schwartz dimension gets its own `dimension_consistency` from Sonnet, which enables per-dim confidence display. M010 only has overall profile confidence.

2. **Table-stakes display format:**
   ```
   Openness: 4.2 (confidence 62%)
   Conscientiousness: 3.8 (confidence 71%)
   ```

3. **Textual qualifier brackets** (table stakes for psychological profiles — raw numbers without context mislead):
   | Range | Label |
   |-------|-------|
   | 0–30% | "weak evidence — single month or sparse data" |
   | 31–59% | "moderate evidence — pattern emerging" |
   | 60–79% | "good evidence — consistent across months" |
   | 80–100% | "strong evidence — stable signal across multiple months" |

4. **Below-threshold UX:** When `overall_confidence=0` (below 5,000-word floor), no scores are shown. Instead: "HEXACO profile: insufficient data — need ~X more words of your own speech (currently ~Y words)." The word count estimate prevents Greg from wondering how far away he is.

5. **Range vs point estimate:** M011 uses point estimates (matching M010 pattern), not ranges. Ranges (e.g. "2.8–3.4") add visual complexity without meaningfully adding defensibility for a personal-use system where Greg understands the limitations. The textual qualifier bracket communicates uncertainty more clearly than a numeric range.

**Confidence formula for psychological profiles:**

The M010 formula (`0.3 + 0.7 * volumeScore * dataConsistency`) uses entry-count saturation. M011 must adapt:

- Threshold gate: 5,000 words of Greg's speech (not entry count — richer signal for psychological inference)
- Volume component: word count → `volumeScore = min(1.0, (wordCount - 5000) / (PSYCH_SATURATION - 5000))` where `PSYCH_SATURATION = 30000` (first estimate; calibrate after 4-8 months of real M011 operation — same discipline as M010 SATURATION=50)
- Consistency component: `data_consistency` from Sonnet (same as M010)
- Formula: identical structure, different saturation point

---

## Feature Detail: Monthly Cadence and Cron (Q5)

**"Previous calendar month" definition (not rolling 30 days):**

Use previous CALENDAR month for substrate window, not rolling 30 days. Rationale:
- Greg can reason about a calendar month ("last month I was mostly working on X") — a rolling 30-day window shifts every day and is harder to reason about
- Episodic summaries are keyed by `summary_date` (date column) — calendar month boundary is a clean query: `WHERE summary_date >= first_day_of_prev_month AND summary_date < first_day_of_this_month`
- Rolling 30 days adds no psychological inference value (HEXACO/Schwartz are slow-moving traits; the boundary precision is irrelevant)

**Cron timing:**

M010 Sunday 22:00 Paris = `0 22 * * 0` (weekly, Sunday evenings).
M011 monthly cron must NOT fire on Sundays (API contention with M010). Use the 1st of each month at a different hour:

**Recommended: `0 9 1 * *` (1st of month, 09:00 Paris)**

Rationale:
- Day 1 fires after the previous calendar month is fully closed
- 09:00 is a low-API-activity hour (M010 Sunday 22:00, M009 weekly_review Sunday 20:00, episodic 23:00 — no conflict)
- Morning timing means if the cron fails, Greg can investigate during waking hours
- 1st-of-month anchor is easy to reason about in logs

**Cold-start behavior on first fire:** First time the cron fires (e.g. 2026-07-01), previous month (June 2026) has substrate. The substrate loader queries for previous calendar month's entries — if M010 has been running since May, June will have episodic summaries and Pensieve entries. Word-count check runs first; if below 5,000 words, returns `profile_below_threshold` outcome. No Sonnet call. Row stays at `overall_confidence=0`. This is correct behavior.

---

## Feature Detail: Inter-Period Consistency Confidence Boost (Q6)

**What makes consistency defensible:** Not averaging scores across months, but checking whether Sonnet's per-dimension scores are STABLE across months. A dimension that scored 4.1, 3.9, 4.2 across 3 months is more reliable than one that scored 4.1, 2.3, 3.8.

**Implementation (DIFFERENTIATOR — not table stakes for Phase 1 of M011):**

For initial M011 ship: confidence is volume-only + current-month Sonnet `data_consistency`. No consistency boost yet.

After 3+ months of real history: add a `consistency_bonus` term:
- Read previous 2 profile snapshots from `profile_history` (already being written by M010 write-before-upsert pattern, D029)
- Compute stddev of previous dim scores + current score
- If stddev < 0.3: `consistency_bonus = 0.1` (max cap at 1.0)
- If stddev < 0.5: `consistency_bonus = 0.05`
- If stddev >= 0.5: `consistency_bonus = 0` (inconsistent — no boost)

**Cold-start UX before history exists (first 1-2 months):** Confidence is volume + Sonnet consistency only. No consistency label in display. After 3+ monthly cycles, display shows "consistent across N months" or "emerging pattern (N months)". The `profile_history` table already captures full-row snapshots — no new schema needed.

**Minimum months for a "consistency claim":** 3 months minimum (2 prior + current). 2-month comparison is a line, not a pattern. 3 months establishes direction. This is an explicit threshold that must be checked before the `consistency_bonus` is applied or shown to Greg.

---

## Feature Detail: Mode-Handler Injection (Q7)

**PSYCHOLOGICAL profiles should inject into REFLECT and PSYCHOLOGY only. NOT COACH.**

Rationale per D043 (M010 PROFILE_INJECTION_MAP pattern) and the psychological-vs-operational boundary (D047-to-be):

| Mode | Operational Profiles | Psychological Profiles | Rationale |
|------|---------------------|----------------------|-----------|
| REFLECT | All 4 dims | HEXACO + Schwartz (both) | REFLECT synthesizes the full self-picture; psychological traits are core to reflection |
| COACH | capital + family | **None** | COACH is about decisions and constraints — injecting slow-moving traits risks Coach becoming "you're a conscientious person so you should..." (The Hard Rule D027 violation). Capital + family remain. |
| PSYCHOLOGY | health + jurisdictional | HEXACO + Schwartz (both) | PSYCHOLOGY already does depth analysis; psychological profiles are grounding context, not interpretation triggers |
| Others (JOURNAL, INTERROGATE, PRODUCE, ACCOUNTABILITY) | None | **None** | Same rationale as M010 D043 negative invariant |

**Implementation:** Add a new `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` constant (separate from operational `PROFILE_INJECTION_MAP`) in the reader module:

```typescript
export const PSYCHOLOGICAL_PROFILE_INJECTION_MAP: Readonly<
  Record<'REFLECT' | 'PSYCHOLOGY', readonly PsychDimension[]>
> = {
  REFLECT: ['hexaco', 'schwartz'],
  PSYCHOLOGY: ['hexaco', 'schwartz'],
} as const;
// COACH is explicitly absent — D047 psychological-vs-operational boundary
```

**Token budget for injection:** HEXACO + Schwartz injected as two blocks, capped at 1,500 chars each (smaller than M010's 2,000-char cap per dim, because there are more dims). Format follows M010 `renderDimensionForPrompt` pattern: confidence-qualified key-value pairs, "moderate evidence" qualifier shown inline, staleness note if > 60 days old (slower cadence = longer staleness window than M010's 21-day threshold).

---

## Feature Detail: /profile Command Extension (Q8)

**Table-stakes output format:**

The M010 `/profile` handler sends 5 sequential `ctx.reply` calls. M011 extends to 7:
- jurisdictional (M010)
- capital (M010)
- health (M010)
- family (M010)
- HEXACO profile (NEW)
- Schwartz values (NEW)
- [Remove M011 placeholder, replace with actual content]

**Sufficient-data branch (HEXACO):**
```
HEXACO Personality Profile (confidence 68%)

Honesty-Humility: 4.1 (per-dim: strong)
Emotionality: 3.2 (per-dim: moderate)
Extraversion: 2.8 (per-dim: moderate)
Agreeableness: 3.9 (per-dim: good)
Conscientiousness: 4.3 (per-dim: good)
Openness: 4.7 (per-dim: strong)

Based on 3 months of data. Pattern stable across months.
```

**Insufficient-data branch (HEXACO):**
```
Chris needs more of your own speech to infer a personality profile.
Currently ~3,200 words from your speech. Threshold: 5,000 words.
Write more about your experiences, thoughts, and feelings to unlock this.
```

**Sufficient-data branch (Schwartz):**
```
Schwartz Values Profile (confidence 55%)

Leading values (score ≥ 4.0):
- Openness to change: Self-Direction 4.4, Stimulation 3.9
- Enhancement: Achievement 3.7

Moderate values (score 3.0–3.9):
[grouped by Schwartz circumplex sectors]

Conservation values (score < 2.5):
- Conformity 2.1, Tradition 1.9

Moderate evidence — pattern emerging from 2 months of data.
```

**Insufficient-data branch (Schwartz):**
```
Insufficient data for values inference. Same data threshold as HEXACO profile.
```

**Implementation notes:**
- Both sections are a single `ctx.reply` per profile type (not one reply per dimension — 16 individual replies would be overwhelming)
- EN/FR/RU localization follows M010 MSG pattern
- Staleness threshold for psychological profiles: 60 days (monthly cron; 21-day M010 threshold would always show staleness on a monthly cadence)
- Golden-output snapshot test is mandatory (HARD CO-LOC pattern from M010)

---

## Feature Detail: Synthetic Fixture for M011 Test (Q10)

**Designed personality signature: HIGH Openness, HIGH Conscientiousness, LOW Conformity, LOW Power, HIGH Benevolence**

This signature is detectable from speech because:
- High Openness: frequent mentions of new ideas, aesthetic experiences, curiosity about systems, non-conventional solutions
- High Conscientiousness: explicit planning language, follow-through entries, frustration when details slip
- Low Conformity: entries that describe rejecting social expectations, questioning defaults, choosing unusual paths
- Low Power: absent language about status, hierarchy, influence; discomfort when others defer to him
- High Benevolence: entries about helping close others, emotional investment in partner/family wellbeing

**Schwartz signature that should co-emerge:** High Self-Direction, High Universalism, Low Security, Low Tradition

**HEXACO + Schwartz mapping consistency (internal validation):** When the prompt-engineered fixture produces consistent HEXACO + Schwartz signatures, the test asserts both profiles point in the same direction (e.g., High HEXACO Openness should co-occur with High Schwartz Self-Direction and Stimulation). Inconsistency between the two profiles on the same fixture signals a prompt engineering or schema problem.

**Fixture design (6,000 words, 30+ synthetic days):**

The `synthesize-delta.ts --psych-profile-bias` flag extension should inject the personality signature into the Haiku style-transfer generation. Specifically:
- 40% of synthetic entries describe intellectual curiosity, novel approaches, aesthetic appreciation (Openness signal)
- 25% describe careful planning, self-monitoring, organized execution (Conscientiousness signal)
- 20% describe social dynamics where Greg opts out of conventional expectations (Low Conformity)
- 15% describe care for close others, investment in relationships (Benevolence)

**Three-assertion test structure (mirroring M011 spec):**
1. Load 1,000-word fixture → `overall_confidence=0`, all dims "insufficient data" ← threshold gate works
2. Load 6,000-word fixture → `overall_confidence>0`, HEXACO + Schwartz populated ← inference fires
3. Loaded 6,000-word fixture scores: Openness ≥ 4.0, Conscientiousness ≥ 3.8, Conformity ≤ 2.5 within ±0.8 tolerance ← signature detectable (empirical accuracy bound r ≈ .31–.41 justifies wide tolerance)

---

## Differentiators (Competitive Advantage — Not Required for M011 Ship, But Valuable Later)

| Feature | Value Proposition | Complexity | When to Add |
|---------|-------------------|------------|-------------|
| Per-dimension confidence in HEXACO (separate from overall) | Greg can see "my Openness score is well-evidenced but my Extraversion is weak — need more social entries" | LOW | Add in M011 Phase 1 — schema already supports `dimension_consistency` per dim |
| Consistency bonus after 3+ months | Rewards longitudinal stability — confidence grows as pattern holds across months | MEDIUM | Add in v2.6.1 after first 3 monthly fires |
| HEXACO × Schwartz cross-validation check | When two independent frameworks point the same direction, confidence label upgrades ("independently corroborated") | MEDIUM | Add in M013/M014 after both profiles have 3+ months of history |
| Attachment profile activation when threshold met | Reveals relational patterns that neither HEXACO nor Schwartz captures | HIGH | Defer to post-M011 weekly sweep; schema ships in M011 |
| HEXACO change-detection (dimension shifts ≥ 0.5 points month-over-month) | Alerts Greg when a trait is moving — possible life phase signal | MEDIUM | Add in v2.6.1 after profile_history has 2+ rows |
| Grouped Schwartz display by circumplex sector | Organizes 10 values into meaningful clusters (Openness to Change / Self-Enhancement / Conservation / Self-Transcendence) | LOW | Add in M011 Phase 2 or M014 narrative; makes Schwartz output scannable |
| Narrative summary of psychological profile | "Chris's read: you're a high-autonomy, high-care person with weak deference to convention..." | HIGH | Explicitly defer to M014 — high hallucination risk without strong grounding |

---

## Anti-Features (Explicitly NOT Build in M011)

| Anti-Feature | Why Avoid | What to Build Instead |
|--------------|-----------|----------------------|
| Real-time HEXACO updates on every message | HEXACO/Schwartz are slow-moving personality traits; updating monthly is ALREADY psychologically aggressive. Real-time updates would be noisy, expensive, and contradict the "slow-moving" nature of traits | Monthly cron on 1st of month only |
| Attachment dimension population | Sparse relational speech produces stereotypes worse than no profile (D028); 60 days / 2,000 words minimum is a hard floor, not a guideline | Schema-only in M011; weekly sweep activation trigger post-M011 |
| MBTI or Big Five mixing | MBTI is not empirically validated; Big Five (OCEAN) and HEXACO overlap but are not the same model (HEXACO adds Honesty-Humility as a 6th factor not in Big Five). Mixing them pollutes the schema and confuses interpretation | HEXACO only; if Big Five is referenced in conversation, Chris can explain the difference |
| Narrative summarization of psychological profiles | LLMs summarizing LLM-inferred traits is a hallucination amplifier — interpretation of interpretation with no ground truth | Defer to M014 Narrative Identity which has proper grounding in life chapters |
| Automatic profile text injection into COACH mode | COACH is about decisions; injecting trait profiles risks The Hard Rule D027 violation ("you're a conscientious person so you should decide X") — circular reasoning from inferred traits to coaching conclusions | Keep COACH injection restricted to operational profiles (capital + family) as per D043 |
| VIA Character Strengths | Explicitly excluded per PROJECT.md: "Generic and low-signal for Greg specifically. Strengths are visible in his behavior already." | No action; skip entirely |
| Per-message word count accumulation | Running a word counter on every message is a maintenance burden and a privacy surface if the count is surfaced | Compute word count at inference time from the substrate window; no persistent counter |
| Scoring directly from epsiodic summaries | Summaries are interpretations (D035 Pensieve boundary). Psychological inference must be from Greg's own speech in Pensieve entries, not from Chris's interpretation of that speech | Filter substrate to Pensieve entries by source=telegram; exclude episodic summaries from word count gate |

---

## Feature Dependencies

```
profile_hexaco table (migration)
    └──requires──> Never-Retrofit Checklist columns (schema_version, substrate_hash, name UNIQUE)

profile_schwartz table (migration)
    └──requires──> Never-Retrofit Checklist columns

profile_attachment table (migration, schema-only)
    └──requires──> Never-Retrofit Checklist columns

generateHexacoProfile()
    └──requires──> profile_hexaco table
    └──requires──> runProfileGenerator shared helper (M010, already exists)
    └──requires──> loadPsychologicalSubstrate() (NEW — word-count substrate, different from M010 entry-count substrate)
    └──requires──> HexacoProfileSchemaV3 + HexacoProfileSchemaV4 (NEW Zod schemas)

generateSchwartzProfile()
    └──requires──> profile_schwartz table
    └──requires──> same runProfileGenerator helper
    └──requires──> loadPsychologicalSubstrate()
    └──requires──> SchwartzProfileSchemaV3 + SchwartzProfileSchemaV4

loadPsychologicalSubstrate()
    └──requires──> pensieve_entries (Greg's speech only, source=telegram, all epistemic tags)
    └──requires──> episodic_summaries (for context, but NOT for word count gate — D035 boundary)
    └──uses──> word count from pensieve content (NOT entry count)

updateAllPsychologicalProfiles() [monthly orchestrator]
    └──requires──> generateHexacoProfile()
    └──requires──> generateSchwartzProfile()
    └──calls via──> Promise.allSettled (isolation)

getPsychologicalProfiles() [reader API]
    └──requires──> profile_hexaco table
    └──requires──> profile_schwartz table
    └──requires──> HexacoProfileSchemaV3 + SchwartzProfileSchemaV3 (for safeParse)

PSYCHOLOGICAL_PROFILE_INJECTION_MAP
    └──requires──> getPsychologicalProfiles() reader
    └──wired into──> buildSystemPrompt() via ChrisContextExtras (same as M010 operationalProfiles)

/profile command extension
    └──requires──> getPsychologicalProfiles() reader
    └──requires──> formatHexacoForDisplay() pure formatter (NEW)
    └──requires──> formatSchwartzForDisplay() pure formatter (NEW)
    └──replaces──> M011 placeholder reply (last ctx.reply in handleProfileCommand)

Monthly cron (1st of month 09:00 Paris)
    └──requires──> updateAllPsychologicalProfiles()
    └──registered in──> cron-registration.ts (new CronRegistrationStatus field: psychProfileUpdate)

Synthetic fixture test
    └──requires──> synthesize-delta.ts --psych-profile-bias flag (NEW)
    └──requires──> 30+ day fixture with designed personality signature
    └──uses──> loadPrimedFixture() (existing)

Attachment weekly sweep activation
    └──requires──> profile_attachment table (schema ships M011)
    └──requires──> word count of RELATIONSHIP-tagged entries ≥ 2,000 words over ≥ 60 days
    └──deferred to──> post-M011 weekly sweep extension
```

### Dependency Notes

- **`loadPsychologicalSubstrate()` is NEW and different from M010's `loadProfileSubstrate()`:** M010 uses entry count and filters by FACT/RELATIONSHIP/INTENTION/EXPERIENCE tags. M011 needs WORD COUNT of Greg's own speech (source=telegram, all tags) over the previous calendar month PLUS episodic summaries as context. These are structurally different enough to warrant a separate function rather than extending the existing one.

- **`profile_history` table is shared (already exists):** M010 Phase 33 created `profile_history` with `profile_table_name + profile_id + snapshot jsonb`. M011 psychological profile upserts should also write to this table before update (same D029 write-before-upsert discipline). No schema change needed.

- **`PSYCHOLOGICAL_PROFILE_INJECTION_MAP` and `PROFILE_INJECTION_MAP` are separate constants:** They must NOT be merged into one map. The mode subsets differ (COACH gets operational but not psychological). Merging creates the D027 violation risk (trait injection into COACH). The separation is a safety invariant, not just code style.

- **Word count substrate vs entry count:** The 5,000-word gate operates on character/word count of `pensieve_entries.content` where `source='telegram'` (Greg's own messages). External sources (Gmail, Drive, Immich) are excluded — they are not Greg's psychological speech. This is different from M010's `entryCount` metric.

---

## MVP Definition for M011

### Phase 1: Schema + Substrate (ship first)

- [ ] Migration with `profile_hexaco`, `profile_schwartz`, `profile_attachment` tables + Never-Retrofit Checklist columns
- [ ] Zod v3 + v4 schemas for HEXACO and Schwartz
- [ ] `loadPsychologicalSubstrate()` with word-count gate
- [ ] Cold-start seed rows with `overall_confidence=0`

### Phase 2: Inference Engine (depends on Phase 1)

- [ ] `generateHexacoProfile()` and `generateSchwartzProfile()` using `runProfileGenerator` pattern
- [ ] `updateAllPsychologicalProfiles()` monthly orchestrator via `Promise.allSettled`
- [ ] Monthly cron registration (1st of month 09:00 Paris) in `cron-registration.ts`
- [ ] SHA-256 substrate-hash idempotency (three-cycle test)

### Phase 3: Surfaces (depends on Phase 2)

- [ ] `getPsychologicalProfiles()` reader API
- [ ] `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` (REFLECT + PSYCHOLOGY only)
- [ ] `buildSystemPrompt()` extended with `psychologicalProfiles` in `ChrisContextExtras`
- [ ] `/profile` command extended (replace M011 placeholder with actual HEXACO + Schwartz sections)
- [ ] Golden-output snapshot test

### Phase 4: Tests (depends on all above)

- [ ] `synthesize-delta.ts --psych-profile-bias` flag
- [ ] `m011-30days` primed fixture (designed personality signature)
- [ ] Three-assertion synthetic fixture test (1k words / 6k words / signature detection)
- [ ] Live 3-of-3 anti-hallucination milestone-gate against real Sonnet

### Defer to Post-M011 (v2.6.1)

- [ ] Inter-period consistency confidence boost (requires 3+ monthly fires)
- [ ] Attachment profile population + weekly sweep activation
- [ ] HEXACO change-detection alerts
- [ ] HEXACO × Schwartz cross-validation

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| HEXACO 6-dim schema + inference | HIGH — core M011 goal | MEDIUM — mirrors M010 pattern | P1 |
| Schwartz 10-value schema + inference | HIGH — core M011 goal | MEDIUM — same pattern | P1 |
| 5,000-word floor + insufficient-data UX | HIGH — prevents hallucinated profiles | LOW — word count gate replaces entry count gate | P1 |
| Monthly cron (1st of month) | HIGH — cadence is the product | LOW — follows M010 cron-registration pattern | P1 |
| `/profile` extension with golden snapshot | HIGH — Greg-visible surface | MEDIUM — new formatter functions | P1 |
| PSYCHOLOGICAL_PROFILE_INJECTION_MAP | HIGH — REFLECT/PSYCHOLOGY modes get richer context | LOW — new constant + buildSystemPrompt wiring | P1 |
| Attachment schema (table only, no population) | MEDIUM — enables future activation | LOW — schema only | P1 |
| Synthetic fixture + live gate | HIGH — quality guarantee | HIGH — new synthesize-delta flag needed | P1 |
| Per-dimension confidence with textual qualifier | MEDIUM — adds defensibility to display | LOW — per-dim dimension_consistency field | P1 (include in schema from day 1) |
| Inter-period consistency boost | LOW — requires 3+ months before meaningful | MEDIUM — read profile_history + compute stddev | P3 (v2.6.1) |
| Attachment population + sweep | MEDIUM — D028 deferred by design | HIGH — new sweep logic | P3 (post-M011) |
| Narrative profile summaries | LOW — high hallucination risk | HIGH | P3 (M014) |

---

## Sources

- M010 codebase: `src/memory/profiles/`, `src/memory/profile-updater.ts`, `src/memory/profiles.ts`, `src/bot/handlers/profile.ts`, `src/memory/confidence.ts`
- PROJECT.md decisions D028, D041–D046 (substrate-hash idempotency, never-retrofit checklist, injection map)
- M011_Psychological_Profiles.md (full spec)
- HEXACO model: [Wikipedia HEXACO model](https://en.wikipedia.org/wiki/HEXACO_model_of_personality_structure), [hexaco.org](https://hexaco.org/)
- Schwartz values inference from text: [EAVIT: Efficient and Accurate Human Value Identification from Text](https://www.ijcai.org/proceedings/2025/0934.pdf), [From Post to Values: Mining Schwartz Values from Social Media](https://link.springer.com/chapter/10.1007/978-3-662-45558-6_19)
- LLM personality inference empirical accuracy: [Applying Psychometrics to LLM Simulated Populations: HEXACO](https://arxiv.org/abs/2508.00742), [Large Language Models for Psychological Assessment](https://journals.sagepub.com/doi/pdf/10.1177/25152459251343582)
- Attachment style communication patterns: [Attachment Styles and Digital Communication (MosaicChats)](https://www.mosaicchats.com/blog/attachment-styles-digital-communication)
- Schwartz multi-prompt approach: [Value Portrait: Assessing Language Models](https://aclanthology.org/anthology-files/anthology-files/pdf/acl/2025.acl-long.838.pdf)

---
*Feature research for: M011 Psychological Profiles (HEXACO + Schwartz + attachment schema)*
*Researched: 2026-05-13*
