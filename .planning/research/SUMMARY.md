# Research Summary — M011 Psychological Profiles

**Project:** Project Chris v2.6 — M011 Psychological Profiles (HEXACO + Schwartz + Attachment schema)
**Domain:** Speech-based psychological trait inference layered on M010 operational profile substrate
**Researched:** 2026-05-13
**Confidence:** HIGH (all four research files grounded in live codebase inspection + published psychometrics literature)

---

## Executive Summary

M011 extends the M010 operational profile layer with three new slow-moving inferred profiles: HEXACO Big Six personality dimensions, Schwartz Ten Universal Values, and an attachment-style schema (population deferred). The correct inference engine is Sonnet 4.6 called with Greg's own speech as substrate — lexicon-based alternatives (LIWC-22, Boyd-Pennebaker Schwartz dictionary) have no viable npm port, are English-only validated, and produce lower accuracy (r ≈ .20-.30) than LLM-direct inference on personal diary text (r ≈ .38-.58). Zero new npm dependencies are required. The entire M011 implementation fits within the existing M010 stack: `@anthropic-ai/sdk`, Drizzle ORM, Zod v3+v4 dual-schema, `node:crypto` SHA-256, `node-cron`, and Luxon.

The recommended architecture mirrors M010 patterns exactly but in a parallel namespace: a forked prompt assembler (`assemblePsychologicalProfilePrompt`), a separate substrate loader (`loadPsychologicalSubstrate` with word-count gate and strict `source='telegram'` filter), a sibling orchestrator (`updateAllPsychologicalProfiles`), and a separate reader API (`getPsychologicalProfiles`). The critical separation is `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` as a new constant distinct from `PROFILE_INJECTION_MAP`, injecting into REFLECT and PSYCHOLOGY modes only — never COACH (D027 Hard Rule risk). One atomic migration (0013) ships all three tables with the full Never-Retrofit Checklist applied to each.

The primary risks are trust-level: psychological trait scores injected into the system prompt can generate sycophancy that masquerades as insight ("given your high conscientiousness, your instinct is sound"). This is the D027 Hard Rule violation with empirical cover. The injection block must carry an explicit Hard Rule extension reminding Sonnet that traits are not evidence — and the milestone gate (PTEST-M011) must include an adversarial trait-authority prompt (3-of-3 live). The secondary risk is source contamination: the substrate loader must filter strictly to `source='telegram'` entries (Greg's own Telegram speech), excluding Gmail, Immich, Drive, episodic summaries, and RITUAL_RESPONSE-tagged entries. Both risks are preventable at design time; both are catastrophic if discovered post-deploy.

---

## Key Findings

### Stack Additions (Zero New Dependencies — Confirmed)

All four research files agree: M011 requires no new npm packages. The M010 stack handles every M011 requirement.

**Core technologies (unchanged from M010):**
- `@anthropic-ai/sdk ^0.90.0` — Sonnet 4.6 inference for HEXACO + Schwartz; `zodOutputFormat` + `messages.parse` pattern is stable
- `drizzle-orm ^0.45.2` + PostgreSQL 16 — three new wide tables; `.$type<T>()` jsonb inference unchanged
- `zod ^3.24.0` (v3 readers) + `zod/v4` subpath (SDK boundary) — same dual-schema discipline as M010
- `node:crypto` SHA-256 (built-in, Node 22) — `computeSubstrateHash` pattern from `src/memory/profiles/shared.ts`
- `node-cron ^4.2.1` (already installed) — new `psychologicalProfileUpdaterCron` alongside existing Sunday cron
- `luxon ^3.7.2` (already installed) — DST-safe calendar-month boundary computation

**Word-counting strategy (inline pure-TypeScript, no library):**
Whitespace-split word counting (`text.trim().split(/\s+/).filter(s => s.length > 0).length`) is accurate to ±2% for EN/FR/RU at 5,000-word scale. Russian Cyrillic words are space-delimited; French elision ("j'ai") counts as 1 word — acceptable rounding at this threshold scale. The `words-count` npm package offers no meaningful accuracy advantage. The `@anthropic-ai/sdk messages.countTokens` API is the wrong unit — a 5,000-word Russian text is ~9,000-11,000 tokens (2× inflation), making token-count gating prohibitive for Russian-heavy substrates.

**Inter-period consistency math (reuse existing `computeStdDev`):**
The `computeStdDev` function already exists in `src/rituals/weekly-review-sources.ts`. The preferred implementation injects the last N monthly snapshots from `profile_history` into the Sonnet prompt (as `prevState`) and lets Sonnet report `data_consistency` as a combined volume + consistency signal — avoiding host-side arithmetic that produces NaN on first fire or artificial high consistency at N=2.

**wordSaturation constant (first estimate: 20,000 words):**
Lock to 20,000 for Phase 37 planning; flag for calibration after 4-8 months of real M011 operation.

---

### Features: Table Stakes vs Differentiators vs Anti-Features

**Table stakes — M011 is not shippable without these:**

| Feature | Notes |
|---------|-------|
| `profile_hexaco` table, 6 dims as jsonb | Migration 0013, Never-Retrofit Checklist |
| `profile_schwartz` table, 10 dims as jsonb | Migration 0013, same checklist |
| `profile_attachment` table, schema-only | Migration 0013; population gated on D028 activation trigger |
| 5,000-word floor (Greg's telegram speech only) | Word count, NOT entry count; NOT token count |
| Monthly cron, 1st of each month 09:00 Paris | `0 9 1 * *` — resolved below |
| Per-dimension `{score, confidence, last_updated}` jsonb | Per-dim `dimension_consistency` + overall `data_consistency` |
| `getPsychologicalProfiles()` reader API | Separate from `getOperationalProfiles()`; never-throw contract |
| `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` (REFLECT + PSYCHOLOGY only) | Separate constant; COACH explicitly absent |
| `/profile` command extended with HEXACO + Schwartz sections | Replaces M011 placeholder; narrative display by default |
| Insufficient-data branch UX ("need X more words") | `word_count_at_last_run` column enables this without re-querying |
| Cold-start seed rows (`overall_confidence=0`, all dims null) | Insert in migration; first cron fire → below-threshold → no Sonnet call |
| Synthetic fixture test (1k words / 6k words / signature detection) | `synthesize-delta.ts --psych-profile-bias` flag; designed personality signature |
| Live 3-of-3 anti-hallucination milestone gate (PTEST-M011) | Includes adversarial Hard-Rule trait-authority test |

**Differentiators — valuable, not required for M011 ship:**

| Feature | When |
|---------|------|
| Per-dimension confidence with textual qualifier bracket | Include in schema from day 1; display in Phase 3 |
| Inter-period consistency confidence modulation (3+ monthly fires) | v2.6.1 |
| HEXACO × Schwartz cross-validation ("independently corroborated") | M013/M014 |
| Attachment profile activation (weekly sweep trigger) | Post-M011; schema ships in M011 |
| HEXACO change-detection alerts (shifts ≥ 0.5 month-over-month) | v2.6.1 |
| Grouped Schwartz display by circumplex sector | M011 Phase 3 or M014 |
| Narrative psychological profile summary | M014 — high hallucination risk without life-chapter grounding |

**Anti-features — explicitly do not build in M011:**

| Anti-Feature | Reason |
|--------------|--------|
| Real-time HEXACO/Schwartz update on every message | Traits are slow-moving; noise > signal |
| Attachment dimension population | D028: sparse relational speech produces stereotypes worse than no profile |
| MBTI or Big Five mixing | MBTI unvalidated; HEXACO adds Honesty-Humility not in Big Five |
| Narrative summarization of psychological profiles | Interpretation of inference = hallucination amplifier; M014 only |
| Psychological profiles in COACH mode | D027 Hard Rule violation risk |
| VIA Character Strengths | PROJECT.md explicitly excludes |
| Per-message word count accumulation | Compute at inference time only |
| Word counting from episodic summaries | D035 boundary: summaries are Chris's interpretation |

---

### Architecture Decisions (All Locked)

**Table strategy:** Three wide tables (`profile_hexaco`, `profile_schwartz`, `profile_attachment`), each holding all dimensions as jsonb columns. Mirrors M010 four-table pattern. Per-dimension EAV rows rejected: breaks `ProfileRow<T>` contract, requires JOINs, incompatible with Drizzle `.$type<T>()` inference. HEXACO's 6 dims and Schwartz's 10 dims are fixed academic constructs.

**Migration shape:** ONE atomic migration (0013) for all three tables + Never-Retrofit Checklist columns + seed-row INSERTs. `profile_history` requires no ALTER TABLE — its `profile_table_name text NOT NULL` discriminator already accommodates new values by design.

**Never-Retrofit Checklist for all 3 tables (must ship in 0013):**
- `schema_version int NOT NULL DEFAULT 1`
- `substrate_hash text NOT NULL DEFAULT ''`
- `name text NOT NULL UNIQUE DEFAULT 'primary'`
- `overall_confidence real CHECK (>= 0 AND <= 1) NOT NULL DEFAULT 0`
- `word_count_at_last_run int NOT NULL DEFAULT 0`
- ALL planned dimension columns (even if null by default)
- `profile_attachment` additionally: `relational_word_count int NOT NULL DEFAULT 0`, `activated boolean NOT NULL DEFAULT false`

**Prompt assembler fork:** `assemblePsychologicalProfilePrompt` in new `src/memory/psychological-profile-prompt.ts`. Must NOT extend `assembleProfilePrompt`'s `ProfilePromptDimension` union — would break every exhaustive switch consuming it. Reuse `CONSTITUTIONAL_PREAMBLE` and `DO_NOT_INFER_DIRECTIVE` by import. New type: `PsychologicalProfileDimension = 'hexaco' | 'schwartz' | 'attachment'` (one value per TABLE, not per trait).

**Orchestrator split:** `updateAllPsychologicalProfiles()` in new `src/memory/psychological-profile-updater.ts`. Existing `updateAllOperationalProfiles` in `src/memory/profile-updater.ts` is NOT modified.

**Reader API split:** `getPsychologicalProfiles(): Promise<PsychologicalProfiles>` added to `src/memory/profiles.ts` after `getOperationalProfiles`. Must NOT extend `getOperationalProfiles` return type — 8+ existing call sites.

**PSYCHOLOGICAL_PROFILE_INJECTION_MAP (separate constant — mandatory):**
```
REFLECT: ['hexaco', 'schwartz']
PSYCHOLOGY: ['hexaco', 'schwartz']
// COACH: intentionally absent — D027 Hard Rule risk
```
Disagreement resolved: ARCHITECTURE.md proposes REFLECT gets only `['schwartz']`; FEATURES.md and STACK.md propose both. **Resolution: both.** REFLECT synthesizes the full self-picture; HEXACO traits are as relevant as values for reflective synthesis.

**D047 Boundary Statement (locked):** Operational profiles capture Greg's current facts-of-record. Psychological profiles infer stable trait-level dispositions. Cross-reading permitted (PSYCHOLOGY may consume operational context). Cross-writing forbidden: operational generators must never emit psychological trait scores; psychological generators must never emit operational facts.

**Major components:**

| Component | File | Responsibility |
|-----------|------|----------------|
| Schema | `src/db/schema.ts` (modified) | Three new table exports after `profileFamily`, before `profileHistory` |
| Schemas | `src/memory/profiles/schemas.ts` (modified) | Zod v3+v4 dual schemas for HEXACO, Schwartz, Attachment |
| Substrate Loader | `src/memory/psychological-profiles/shared.ts` (new) | Calendar-month substrate + `userWordCount` (telegram only) + `relationalWordCount` |
| Prompt Builder | `src/memory/psychological-profile-prompt.ts` (new) | `assemblePsychologicalProfilePrompt` — forked, different epistemological framing |
| Generators | `src/memory/psychological-profiles/{hexaco,schwartz,attachment}.ts` (new) | Per-profile Sonnet call + threshold gate + upsert + `profile_history` write-before-upsert |
| Orchestrator | `src/memory/psychological-profile-updater.ts` (new) | `updateAllPsychologicalProfiles()` via `Promise.allSettled` |
| Reader | `src/memory/profiles.ts` (modified) | `getPsychologicalProfiles()`, `PSYCHOLOGICAL_PROFILE_INJECTION_MAP`, `formatPsychologicalProfilesForPrompt()` |
| Display | `src/bot/handlers/profile.ts` (modified) | `/profile` extended; `formatHexacoForDisplay()`, `formatSchwartzForDisplay()` |
| Cron | `src/cron-registration.ts` (modified) | `psychologicalProfileUpdate` status + `0 9 1 * *` monthly registration |

---

### Critical Pitfalls (Prioritized by Trust Impact)

**1. D027 Hard Rule violation via trait-authority framing (CRITICAL)**
Injecting "Conscientiousness: 4.5/5.0" causes Sonnet to produce "given your strong conscientiousness, your instinct is sound." The injection block must carry an explicit Hard Rule extension inline — not only in `CONSTITUTIONAL_PREAMBLE`. PTEST-M011 must include adversarial prompt baiting trait validation; forbidden phrases: `'consistent with your'`, `'aligns with your'`, `'given your [trait]'`, `'fits your'`, `'as someone with your'`. HARD CO-LOC: injection map + system-prompt framing + PTEST-M011 adversarial test.

**2. Speech-source contamination (CRITICAL)**
M010's substrate loader does NOT filter by source — correct for operational profiles, wrong for psychological. M011 must define `loadPsychologicalSubstrate()` with `WHERE source = 'telegram' AND epistemic_tag NOT IN ('RITUAL_RESPONSE')`. Gmail, Immich, Drive, episodic summaries excluded from word count. Mirror `boundary-audit.test.ts` with `psych-boundary-audit.test.ts`. HARD CO-LOC: substrate loader + source filter + boundary audit test.

**3. Sparse-data overconfidence above 5,000-word floor (HIGH)**
The floor prevents profile creation below threshold but not high confidence just above it. Both entry-count gate AND word-count gate must fire — word count first (cheaper). Volume-weight ceiling directive must bind `data_consistency` below 0.5 until sufficient history. Sparse test: (a) 4,800 words → no profile; (b) 5,200 words + few entries → confidence < 0.5. HARD CO-LOC: `MIN_SPEECH_WORDS` constant + word-count gate + sparse-threshold test.

**4. Migration 0013 Never-Retrofit incompleteness (HIGH)**
All five non-retrofittable columns must ship for all three tables. `profile_attachment` additionally needs `relational_word_count`, `activated`. Apply D042 verbatim. HARD CO-LOC (#M11-1): migration 0013 + schema.ts exports + meta snapshots + journal entry + test.sh psql line.

**5. Monthly unconditional fire vs substrate-hash-skip (HIGH)**
Resolved: **unconditional monthly fire.** Skipping a month on unchanged substrate breaks the inter-period consistency time series — a skipped month creates a permanent data gap. The M010 hash-skip pattern does NOT apply to psychological profiles. Three-cycle test must assert Cycle 3 fires on calendar-month boundary even with identical substrate.

**6. PROFILE_INJECTION_MAP token-budget collision (MEDIUM)**
`PSYCHOLOGICAL_PROFILE_INJECTION_MAP` is a required architectural separation, not code style. Per-dim char cap: 500 chars (vs M010's 2,000-char operational cap). JOURNAL negative invariant: `formatPsychologicalProfilesForPrompt('JOURNAL', ...)` returns `""`. HARD CO-LOC (#M11-4): injection map + formatter + `ChrisContextExtras` wiring + PSYCHOLOGY handler.

**7. Synthetic fixture signal erasure (MEDIUM)**
Haiku style-transfer averages toward Greg's habitual register, potentially erasing the designed personality signature. Assert `OPENNESS_SIGNAL_PHRASES.some(p => fixture.includes(p))` BEFORE running inference. Accuracy-bounded assertions required: `Openness >= 4.0`, not just `confidence > 0`. HARD CO-LOC (#M11-3): display formatter + golden snapshot test.

---

## Implications for Roadmap

### Phase 37: Schema + Substrate

**Rationale:** Migration 0013 is the dependency anchor for everything in M011. Drizzle ORM type inference requires table definitions before generator code can compile. Word-count gate and source-filter substrate loader must exist before engine calls them.

**Delivers:**
- Migration 0013 (3 tables + Never-Retrofit Checklist + seed rows) — HARD CO-LOC #M11-1
- `src/db/schema.ts` three new table exports
- `src/memory/profiles/schemas.ts`: `HexacoProfileData`, `SchwartzProfileData`, `AttachmentProfileData` (Zod v3+v4 dual schemas)
- `src/memory/confidence.ts`: `MIN_SPEECH_WORDS = 5000`, `RELATIONAL_WORD_COUNT_THRESHOLD = 2000`, `isAboveWordThreshold()`
- `src/memory/psychological-profiles/shared.ts`: `loadPsychologicalSubstrate()` with `source='telegram'` filter + `userWordCount`
- `psych-boundary-audit.test.ts`: source-filter invariant test
- Word-count sparse test (under-floor and just-above-floor cases)

**Must avoid:** Missing Never-Retrofit columns; reusing `loadProfileSubstrate` with a parameter; checking entry count instead of word count.

**Research flag:** Standard patterns. Skip `/gsd-research-phase` — migration 0013 mirrors migration 0012.

---

### Phase 38: Inference Engine

**Rationale:** Engine depends on Phase 37 substrate loader and Zod schemas. All three generators ship here, including attachment (with activation gate returning `'profile_below_threshold'` unconditionally until threshold met).

**Delivers:**
- `src/memory/psychological-profile-prompt.ts`: `assemblePsychologicalProfilePrompt` (forked)
- `src/memory/psychological-profiles/hexaco.ts`: `generateHexacoProfile()` — 1 Sonnet call, 6 dims
- `src/memory/psychological-profiles/schwartz.ts`: `generateSchwartzProfile()` — 1 Sonnet call, 10 dims
- `src/memory/psychological-profiles/attachment.ts`: `generateAttachmentProfile()` with `activated` gate
- `src/memory/psychological-profile-updater.ts`: `updateAllPsychologicalProfiles()` via `Promise.allSettled`
- `src/cron-registration.ts`: `psychologicalProfileUpdate` status + `0 9 1 * *` monthly cron
- Three-cycle substrate-hash regression test — HARD CO-LOC #M11-2
- Monthly cadence test including unconditional-fire assertion
- DST-safe monthly boundary test (February + spring-forward edge cases)

**Batching decision (locked):** 2 Sonnet calls per monthly fire (1 HEXACO, 1 Schwartz). Not 16 per-dimension calls. Not 1 combined call. HEXACO dims are one theoretical framework benefiting from cross-dimension coherence. Schwartz dims are a circumplex — splitting destroys cross-value evidence. Performance: 2 calls × ~10s = ~20s vs 16 calls × ~10s = 160s.

**Cron expression (resolved):** `0 9 1 * *`. STACK.md says `0 0 1 * *`; ARCHITECTURE.md and FEATURES.md both say `0 9 1 * *`. Resolution: `0 9 1 * *` — morning timing for investigability; two-source majority.

**Must avoid:** Per-dimension Sonnet calls; custom "has it been 30 days?" check; skipping fire on unchanged substrate hash.

**Research flag:** Phase 38 needs `/gsd-research-phase` for the **unconditional-fire + substrate-hash interaction** — specifically, how the hash is written on unconditional fires vs how second-fire-same-month is prevented.

---

### Phase 39: Surfaces

**Rationale:** Reader API depends on tables (Phase 37) and seed row (Phase 38). All four surface components ship atomically to avoid unexercised code paths (HARD CO-LOC #M11-4).

**Delivers:**
- `getPsychologicalProfiles()` reader + `PsychologicalProfiles` interface in `src/memory/profiles.ts`
- `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` (REFLECT + PSYCHOLOGY, COACH absent)
- `formatPsychologicalProfilesForPrompt()` with JOURNAL negative invariant
- `ChrisContextExtras.psychologicalProfiles?: string` in `src/chris/personality.ts`
- REFLECT mode handler: both HEXACO + Schwartz blocks
- PSYCHOLOGY mode handler: both HEXACO + Schwartz blocks with heaviest epistemic-distance framing + explicit Hard Rule extension inline
- `/profile` command: HEXACO + Schwartz + attachment sections; narrative display by default; removes M011 placeholder
- `formatHexacoForDisplay()` and `formatSchwartzForDisplay()` pure formatters
- Golden-output snapshot test — HARD CO-LOC #M11-3
- JOURNAL negative-invariant test
- HARD CO-LOC #M11-4: all four injection circuit pieces together

**Must avoid:** Flat injection into existing `PROFILE_INJECTION_MAP`; raw numeric scores in default `/profile` output; missing Hard Rule extension in injection block; COACH receiving psychological profiles.

**Research flag:** Standard patterns. Skip `/gsd-research-phase`.

---

### Phase 40: Tests

**Rationale:** Full test pyramid requires all other phases. Synthetic fixture test needs display formatter (Phase 39) and inference engine (Phase 38). PTEST-M011 milestone gate must cover both anti-hallucination AND adversarial Hard-Rule trait-authority assertions.

**Delivers:**
- `synthesize-delta.ts --psych-profile-bias` flag — designed signature injection into Haiku style-transfer
- `m011-30days` primed fixture (30+ days, 6,000+ words; signature: High Openness, High Conscientiousness, Low Conformity, Low Power, High Benevolence)
- Signal-phrase retention assertion before inference runs
- Three-assertion synthetic fixture test: (1) 1,000 words → `overall_confidence=0`; (2) 6,000 words → `overall_confidence > 0`; (3) Openness ≥ 4.0, Conformity ≤ 2.5 within ±0.8 tolerance
- PTEST-M011 live 3-of-3: anti-hallucination + adversarial trait-authority prompt
- Forbidden phrases: `'consistent with your'`, `'aligns with your'`, `'as someone with your'`, `'fits your'`, `'given your [trait]'`
- Cost callout in docblock: ~5-8 Sonnet calls, ~$0.15-0.25 per run

**Must avoid:** Asserting only `confidence > 0` without accuracy-bounded score check; missing `FIXTURE_PRESENT` third gate (D045); fixture signal erasure without verification.

**Research flag:** Phase 40 needs `/gsd-research-phase` for **fixture design** — `synthesize-delta.ts --psych-profile-bias` flag and signal-phrase injection are novel (no M010 equivalent).

---

### Phase Ordering Rationale

- Schema before engine: Drizzle type inference requires table definitions; generators cannot compile without schema exports
- Engine before surfaces: reader needs seed row from at least one generator run; injection map needs reader
- Surfaces before full tests: golden snapshot test requires formatter; PTEST-M011 requires injection wiring
- Word-count gate with substrate (Phase 37), not engine (Phase 38): gate is cheap; must exist before engine calls it; enables sparse-threshold test co-location

### Research Flags

Phases needing `/gsd-research-phase` during planning:
- **Phase 38:** Unconditional-fire + substrate-hash interaction — how hash is written on unconditional monthly fires and how same-month second-fire is prevented without hash-skip
- **Phase 40:** Fixture design — `synthesize-delta.ts --psych-profile-bias` flag and controlled signal injection (novel, no M010 equivalent)

Phases with standard patterns (skip research-phase):
- **Phase 37:** Mirrors migration 0012 pattern exactly
- **Phase 39:** Mirrors M010 surfaces phase; PROFILE_INJECTION_MAP pattern well-documented in codebase

---

### Open Questions Resolved by Research (lock these in phase plans)

| Question | Resolution | Source |
|----------|------------|--------|
| Monthly fire: unconditional vs hash-skip | **Unconditional** — skipped months break consistency time series | PITFALLS.md explicit recommendation |
| Batching: per-dim vs grouped | **2 calls** (1 HEXACO, 1 Schwartz) | FEATURES.md + STACK.md consensus; PITFALLS.md performance trap |
| Word-floor window: all-time vs rolling 60-day | **All-time** for the 5,000-word gate | M011 spec; rolling window is for substrate content, not the gate |
| wordSaturation constant | **20,000** (first estimate) | STACK.md; FEATURES.md suggests 30,000 — use 20,000, flag for calibration |
| Cron expression | **`0 9 1 * *`** | ARCHITECTURE.md + FEATURES.md (2-source majority over STACK.md midnight) |
| REFLECT injection scope | **Both HEXACO + Schwartz** | FEATURES.md + STACK.md; ARCHITECTURE.md Schwartz-only rejected |

### Open Questions for Post-M011 Planning

- Attachment activation-trigger mechanism: weekly sweep extension vs monthly cron guard — flag for Phase 38 detailed planning
- M013 monthly-ritual collision avoidance: verify M013 cron expression does not collide with `0 9 1 * *`

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Zero-dep conclusion confirmed by all 4 research files; word-counting strategy verified against multilingual token-count divergence data |
| Features | HIGH | Table-stakes derived from M011 spec + M010 precedent + PROJECT.md decisions D028, D042-D046 |
| Architecture | HIGH | All integration points verified at actual file:line in live codebase; component boundaries locked |
| Pitfalls | HIGH | Derived entirely from live codebase inspection; every code reference verified |

**Overall confidence: HIGH**

### Gaps to Address During Planning

- **`wordSaturation` calibration:** 20,000 words is a first estimate. Flag in code: `// SATURATION: first estimate 20,000 — calibrate after 4-8 monthly fires`.
- **Attachment activation-trigger mechanism:** D028 specifies weekly sweep; trigger wiring is deferred post-M011. Schema and `activated` column ship in Phase 37; trigger wiring is a Phase 38+ concern for a separate plan.
- **HEXACO × Schwartz internal consistency validation:** Cross-validation assertion ("both profiles point same direction") needs specification in Phase 40 planning — exact assertion undefined.
- **Confidence display thresholds:** Textual qualifier brackets (0-30% / 31-59% / 60-79% / 80-100%) are reasonable first estimates; may need adjustment after first 3 monthly fires.

---

## HARD CO-LOC Summary

| ID | What Ships Together | Why |
|----|---------------------|-----|
| **#M11-1** | Migration 0013 SQL + `schema.ts` exports + `meta/0013_snapshot.json` + `_journal.json` entry + `test.sh` psql line + `regen-snapshots` bump + `schemas.ts` type exports | Drizzle requires migration + meta + table def consistency; incoherent intermediate state causes spurious ALTER TABLE |
| **#M11-2** | `psychological-profiles/shared.ts` substrate hash logic + three-cycle regression test | Substrate hash correctness untestable without a test detecting second-fire blindness at hash-introduction time |
| **#M11-3** | `/profile` psychological display formatters + golden-output snapshot test | Prevents framing regression (raw-JSON-dump aesthetic) from reaching surfaces |
| **#M11-4** | `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` + `formatPsychologicalProfilesForPrompt` + `ChrisContextExtras.psychologicalProfiles` + PSYCHOLOGY mode handler wiring | Four pieces form one logical circuit; any piece missing silently fails to inject |

---

## Sources

### Primary (HIGH confidence — live codebase)
- `src/memory/profiles/shared.ts`, `src/memory/profile-prompt.ts`, `src/memory/profiles.ts`, `src/memory/confidence.ts`, `src/memory/profile-updater.ts` — M010 pattern baseline
- `src/db/schema.ts:536-658`, `src/db/migrations/0012_operational_profiles.sql` — table shape and migration precedent
- `src/chris/personality.ts`, `src/cron-registration.ts`, `src/rituals/cadence.ts`, `src/rituals/idempotency.ts` — integration points
- `PROJECT.md` Key Decisions D027–D046 — architectural constraints

### Primary (HIGH confidence — M011 spec)
- `M011_Psychological_Profiles.md` — canonical feature spec and acceptance criteria

### Secondary (MEDIUM confidence — empirical accuracy)
- JMIR 2025: Psychometric Evaluation of LLM Embeddings for Personality Trait Prediction (r ≈ .38–.58 LLM-direct vs r ≈ .20–.35 lexicon)
- arXiv 2509.13244: Evaluating LLM Alignment on Personality Inference from Real-World Interview
- arXiv 2508.00742: Applying Psychometrics to LLM Simulated Populations (HEXACO)
- Boyd & Pennebaker ICWSM 2015: Values in Words (Schwartz dictionary — rejected for M011: no npm port, English-only, lower accuracy)
- Shrout & Fleiss 1979: ICC (rejected for M011 — inapplicable rater-equivalence assumptions for sequential LLM observations)

---

*Research completed: 2026-05-13*
*Ready for roadmap: yes*
*Phases suggested: 4 (Phase 37 Schema+Substrate → Phase 38 Inference Engine → Phase 39 Surfaces → Phase 40 Tests)*
