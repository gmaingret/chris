/**
 * src/memory/psychological-profile-prompt.ts — Phase 38 Plan 38-01 (M011 / PGEN-01)
 *
 * Pure-function prompt assembler for the two M011 psychological-profile
 * generators (HEXACO + Schwartz). Zero side effects: no DB calls, no LLM
 * calls, no fs reads, no env access. Forked sibling of M010's
 * src/memory/profile-prompt.ts (NOT under profiles/) per D-04, with the
 * eight divergences locked in 38-CONTEXT.md D-03..D-10 + D-23.
 *
 * HARD CO-LOC #M11-2 anchor: this file MUST ship before plan 38-02 — both
 * generators import `assemblePsychologicalProfilePrompt` to construct their
 * Sonnet system text. Splitting risks per-profileType prompt drift (the
 * M010-06 lesson applied to M011).
 *
 * Locked decisions (from 38-CONTEXT.md):
 *   - D-03: `assemblePsychologicalProfilePrompt(profileType, substrate,
 *           prevState, wordCount)` returns `{ system, user }`. Pure function.
 *   - D-04: file location at sibling of `src/memory/profile-prompt.ts`, NOT
 *           under `profiles/`.
 *   - D-05: CONSTITUTIONAL_PREAMBLE first section — imported from
 *           `src/chris/personality.ts` verbatim.
 *   - D-06: DO_NOT_INFER_DIRECTIVE imported (named import) from
 *           `./profile-prompt.js` — one source of truth across M010 + M011.
 *           NOT redeclared.
 *   - D-07: PSYCHOLOGICAL_HARD_RULE_EXTENSION is an INLINE exported const;
 *           phrasing locked VERBATIM from PITFALLS.md §1 (D027 trait-authority
 *           sycophancy mitigation point #1). Phase 39 PSURF-02 will re-export
 *           this same constant at the surface-level injection block for
 *           mitigation point #2. Both points are required.
 *   - D-08: word-count framing tells Sonnet to emit `data_consistency` AND
 *           `overall_confidence` directly; explicitly forbids emitting a
 *           top-level `confidence` field. Replaces M010's volume-weight
 *           ceiling (M011 word-count gating is upstream in
 *           loadPsychologicalSubstrate per PSCH-08; the 5,000-word floor is
 *           already enforced before this builder is called).
 *   - D-09: prevState injection conditional on `prevState !== null`. When
 *           non-null, renders the snapshot verbatim as JSON.stringify with
 *           2-space indent under `## CURRENT PROFILE STATE`.
 *   - D-10: per-profileType directive blocks — HEXACO emphasizes 6-dim
 *           cross-framework coherence; Schwartz emphasizes the 10-value
 *           circumplex with opposing-value tradeoffs. Both include the
 *           verbatim `r ≈ .31–.41` empirical-limits ceiling framing.
 *   - D-23: `PsychologicalProfilePromptType = 'hexaco' | 'schwartz'` — narrower
 *           than Phase 37's `PsychologicalProfileType` union (which also
 *           includes 'attachment'). Attachment population deferred to v2.6.1 /
 *           ATT-POP-01.
 *
 * NOT in scope here (Plans 38-02 + 38-03):
 *   - Calling Sonnet (anthropic.messages.parse + zodOutputFormat)
 *   - Loading the substrate (loadPsychologicalSubstrate from
 *     profiles/psychological-shared.ts)
 *   - Computing substrate hash / writing profile_history / upsert
 *   - Orchestrator (Promise.allSettled across both generators)
 *   - Monthly cron registration ('0 9 1 * *' Europe/Paris)
 *
 * Tests: src/memory/__tests__/psychological-profile-prompt.test.ts
 * The structural tests grep the output for specific anchor substrings — do
 * NOT edit anchor phrases below without updating the tests.
 *
 * Mirror: src/memory/profile-prompt.ts (M010 operational analog). Same 9-ish
 * section structure, same pure-function contract, same CONSTITUTIONAL_PREAMBLE
 * section-1 placement.
 */
import { CONSTITUTIONAL_PREAMBLE } from '../chris/personality.js';
import { DO_NOT_INFER_DIRECTIVE } from './profile-prompt.js';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * The 2 M011 psychological-profile types this builder supports. Narrower
 * than Phase 37's `PsychologicalProfileType` union (which also includes
 * 'attachment') per D-23 — attachment population is deferred to v2.6.1 /
 * ATT-POP-01 weekly sweep, and including it in this union would falsely
 * suggest the activation orchestration is in M011 scope.
 *
 * Lowercase verbatim — interpolated into the user prompt (toUpperCase'd at
 * render time) and used as the dispatch key for `PROFILE_TYPE_DIRECTIVES`.
 */
export type PsychologicalProfilePromptType = 'hexaco' | 'schwartz';

/**
 * Return shape of `assemblePsychologicalProfilePrompt` per D-03. The `system`
 * string is passed to `anthropic.messages.parse({ system: [{type:'text',
 * text: system, cache_control: {type:'ephemeral'}}], messages: [{role:'user',
 * content: user}], ... })` by each Plan 38-02 generator.
 */
export type AssembledPsychologicalProfilePrompt = { system: string; user: string };

/**
 * Structural type for the substrate slice this prompt builder reads. Plan
 * 38-02 generators narrow Phase 37's discriminated-union substrate
 * (`PsychologicalSubstrate<T>`) on the above-threshold branch, then pass
 * the relevant fields here as this read-only view.
 *
 * Field minimums:
 *   - corpus: pensieve rows from the previous calendar month, filtered
 *     SQL-side (`source='telegram'` AND `epistemic_tag != 'RITUAL_RESPONSE'`)
 *     per Phase 37 PSCH-07. `epistemicTag` is nullable — untagged rows pass
 *     through; only RITUAL_RESPONSE is excluded.
 *   - episodicSummaries: M008 episodic summaries in the same window.
 *   - wordCount: total whitespace-split word count across the corpus —
 *     already gated above 5,000 (MIN_SPEECH_WORDS) by
 *     `loadPsychologicalSubstrate` per PSCH-08.
 *
 * NOTE: no `decisions` array — psychological substrate is corpus-only per
 * Phase 37 D-20 (direct divergence from M010's operational substrate which
 * threads resolved decisions through `assembleProfilePrompt`).
 */
export type PsychologicalProfileSubstrateView = {
  corpus: ReadonlyArray<{
    id: string;
    epistemicTag: string | null;
    content: string;
    createdAt: Date;
  }>;
  episodicSummaries: ReadonlyArray<{
    summaryDate: string;
    summary: string;
  }>;
  wordCount: number;
};

// ── Public constants ────────────────────────────────────────────────────────

/**
 * Hard Rule D027 extension injected into every assembled system string
 * (D-07; Pitfall 1 mitigation point #1).
 *
 * D027 ("Chris never tells Greg he is right because of who he is") applies
 * universally to all modes via CONSTITUTIONAL_PREAMBLE. This extension binds
 * the rule SPECIFICALLY to the psychological-profile-inference task, where
 * trait-authority sycophancy is the most-likely failure mode (Sonnet sees
 * personality data and constructs "you-are-the-kind-of-person-who" advice).
 *
 * Phrasing is locked VERBATIM from 38-CONTEXT.md D-07 / PITFALLS.md §1.
 * Phase 39 PSURF-02 will RE-EXPORT this same constant by import and inject
 * it again at the surface-level prompt-injection block — those are TWO
 * enforcement points (here at the inference layer, there at the consumer
 * layer); absence of either fails the Hard Rule contract.
 *
 * Do NOT paraphrase. The Plan 38-01 structural test asserts each line as
 * a verbatim substring of the constant.
 */
export const PSYCHOLOGICAL_HARD_RULE_EXTENSION = [
  '## Psychological Profile Framing (D027 extension — REQUIRED)',
  '',
  'These trait scores describe statistical tendencies inferred from speech patterns,',
  'NOT facts about who Greg is. You MUST NOT:',
  '- Use these scores to tell Greg he is "the kind of person who..."',
  '- Appeal to his trait scores as evidence that his current reasoning is correct',
  '- Construct advice that validates his existing position by citing his personality',
  'The Hard Rule (D027) applies here with additional force: psychological traits are',
  'not evidence. Evaluate every claim on its merits regardless of what the profile says.',
].join('\n');

// ── Private helpers (Phase 43 Plan 01 — INJ-02 / D-04 + D047 boundary) ──────

/**
 * sanitizeSubstrateText — Phase 43 Plan 01 / INJ-02. LOCAL re-implementation
 * of the helper in src/memory/profiles/shared.ts. DO NOT import from shared.ts —
 * D047 (Phase 38 WR-05) forbids cross-vocabulary imports between the operational
 * and psychological boundaries. Three lines of regex is below the cost of a
 * shared abstraction.
 *
 * Two transforms applied in order (matching the operational helper):
 *   1. `(^|\n)(#+\s)` → `$1\$2` — escape line-start markdown headers (D-01).
 *   2. ` ``` ` → `'''` — neutralize triple-backtick fences (D-02 / Phase 38 WR-01).
 *
 * Total + idempotent. The structural test in the M010 profile-prompt.test.ts
 * locks the contract for the operational copy; the M011
 * psychological-profile-prompt.test.ts mirrors the same expectations for this
 * local copy.
 */
function sanitizeSubstrateText(text: string): string {
  return text
    .replace(/(^|\n)(#+\s)/g, '$1\\$2')
    .replace(/```/g, "'''");
}

// ── Private constants ───────────────────────────────────────────────────────

/**
 * Per-profileType directive blocks (D-10). Each block tells Sonnet what to
 * focus on for that profile type and re-iterates the empirical-limits
 * ceiling. Locked HERE (not in the per-generator config) so Plan 38-02's
 * config objects cannot drift from the structural-test anchor phrases.
 *
 * HEXACO directive emphasizes cross-dimension coherence (the 6 HEXACO
 * dimensions are one theoretical framework; coherent inference requires
 * considering all 6 together, not independently).
 *
 * Schwartz directive emphasizes the circumplex structure (10 values arranged
 * in a circular motivational continuum; coherent inference acknowledges
 * opposing-value tradeoffs, e.g. Self-Direction ↔ Conformity).
 *
 * Both directives include the verbatim empirical-limits framing
 * (`r ≈ .31–.41`) — the speech-based personality inference accuracy bound
 * communicated to Sonnet at prompt level. (Phase 38 D-33 explicitly excludes
 * a Zod `.refine()` ceiling on `overall_confidence` at the SDK boundary —
 * this prompt-level directive is the only enforcement of the ceiling.)
 */
const PROFILE_TYPE_DIRECTIVES: Record<PsychologicalProfilePromptType, string> = {
  hexaco: [
    '## Profile Focus — HEXACO Big-Six Personality',
    "For this profile, infer Greg's HEXACO Big-Six scores across all 6 dimensions: honesty-humility, emotionality, extraversion, agreeableness, conscientiousness, openness. The 6 dimensions are ONE theoretical framework, not independent measurements — coherent inference requires considering all 6 together. A high honesty-humility score interacts with low agreeableness in interpretable ways; do not score each dimension in isolation.",
    "",
    "Empirical-limits ceiling: speech-based personality inference accuracy bound is r ≈ .31–.41 (peer-reviewed estimate); confidence should reflect this ceiling, not project precision the substrate cannot support. An overall_confidence above 0.7 on speech-only data is implausible.",
  ].join('\n'),
  schwartz: [
    '## Profile Focus — Schwartz Universal Values',
    "For this profile, infer Greg's Schwartz value priorities across all 10 universal values: self-direction, stimulation, hedonism, achievement, power, security, conformity, tradition, benevolence, universalism. The 10 values are arranged in a circular motivational continuum (Schwartz circumplex); coherent inference acknowledges opposing-value tradeoffs — Self-Direction sits opposite Conformity, Achievement opposite Benevolence. Scoring all 10 high simultaneously is incoherent under the circumplex model.",
    "",
    "Empirical-limits ceiling: speech-based personality inference accuracy bound is r ≈ .31–.41 (peer-reviewed estimate); confidence should reflect this ceiling, not project precision the substrate cannot support. An overall_confidence above 0.7 on speech-only data is implausible.",
  ].join('\n'),
};

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Assemble the full Sonnet system + user prompt for one psychological-profile
 * generator fire.
 *
 * Returns { system, user }. The caller (Plan 38-02 generator) passes `system`
 * to the Anthropic SDK `messages.parse({ system: [...] })` call and `user` to
 * the `messages: [{role:'user', content: user}]` slot.
 *
 * Pure: same inputs → same outputs across repeated calls. Zero side effects.
 *
 * Section ordering (mirrors src/memory/profile-prompt.ts:175-223 with locked
 * M011 divergences):
 *   1. CONSTITUTIONAL_PREAMBLE — D-05 anchor. FIRST so the anti-sycophancy
 *      floor binds before any role framing.
 *   2. Role preamble — psychological-trait-inference framing (pattern
 *      aggregation across many statements, not quotation extraction from any
 *      single one).
 *   3. DO_NOT_INFER_DIRECTIVE — D-06 / imported from M010 profile-prompt.ts.
 *   4. PSYCHOLOGICAL_HARD_RULE_EXTENSION — D-07 / Pitfall 1 mitigation #1.
 *      Bound INLINE between the M010-shared anti-hallucination floor and the
 *      word-count / per-profileType framing, so it cannot be silently
 *      stripped by a future refactor.
 *   5. Word-count framing — D-08 (replaces M010's volume-weight ceiling).
 *      Tells Sonnet to emit `data_consistency` AND `overall_confidence`;
 *      forbids a top-level `confidence` field.
 *   6. Previous-state injection — D-09. CONDITIONAL on `prevState !== null`.
 *   7. Per-profileType directive — D-10.
 *   8. Substrate block — corpus + episodic summaries (NO decisions per Phase
 *      37's substrate shape).
 *   9. Structured-output directive — LAST, naming the v4 boundary schema.
 *
 * @param profileType  'hexaco' | 'schwartz' (D-23 — narrower than Phase 37 union)
 * @param substrate    read-only view of the above-threshold substrate slice
 * @param prevState    prior `profile_history` snapshot, or null on cold start
 * @param wordCount    total whitespace-split words in the substrate corpus
 */
export function assemblePsychologicalProfilePrompt(
  profileType: PsychologicalProfilePromptType,
  substrate: PsychologicalProfileSubstrateView,
  prevState: unknown | null,
  wordCount: number,
): AssembledPsychologicalProfilePrompt {
  const sections: string[] = [];

  // 1. CONSTITUTIONAL_PREAMBLE — D-05 first-section anchor.
  // Structural test asserts `system.startsWith('## Core Principles (Always Active)')`.
  sections.push(CONSTITUTIONAL_PREAMBLE.trimEnd());

  // 2. Role preamble — psychological-trait-inference framing.
  sections.push(buildRolePreamble(profileType));

  // 3. DO_NOT_INFER_DIRECTIVE — D-06 / imported from M010 profile-prompt.ts.
  // NAMED import only — Pitfall 3 mitigation per D-06 (named import keeps the
  // module-graph dependency on a single symbol; `import *` would pull every
  // operational-vocab token into the bundle even though tree-shaking would
  // drop it at build time, risking boundary-audit confusion).
  sections.push(DO_NOT_INFER_DIRECTIVE);

  // 4. PSYCHOLOGICAL_HARD_RULE_EXTENSION — D-07 / Pitfall 1 mitigation #1.
  // Bound INLINE between the M010-shared anti-hallucination floor and the
  // word-count framing. Phase 39 PSURF-02 will re-inject this same constant
  // at the surface-level prompt-injection block (mitigation point #2); both
  // points are required.
  sections.push(PSYCHOLOGICAL_HARD_RULE_EXTENSION);

  // 5. Word-count framing — D-08. Replaces M010's volume-weight ceiling
  // (M011's word-count gating is upstream in loadPsychologicalSubstrate per
  // PSCH-08; the 5,000-word floor is already enforced before this builder is
  // called). Sonnet is told to emit `data_consistency` AND `overall_confidence`
  // at the top level and is explicitly forbidden from emitting a top-level
  // `confidence` field (RESEARCH Finding 1 — the v4 boundary schema accepts
  // both fields directly; no host-side computation).
  sections.push(buildWordCountFraming(wordCount));

  // 6. Previous-state injection — D-09. CONDITIONAL.
  if (prevState !== null) {
    sections.push(buildPreviousStateBlock(prevState));
  }

  // 7. Per-profileType directive — D-10.
  sections.push(PROFILE_TYPE_DIRECTIVES[profileType]);

  // 8. Substrate block — corpus + episodic only (NO decisions per Phase 37
  // psychological-shared substrate shape — direct divergence from M010 which
  // threads resolved decisions through assembleProfilePrompt).
  sections.push(buildSubstrateBlock(substrate));

  // 9. Structured-output directive — LAST. Names the v4 boundary schema
  // (Plan 38-02 Task 1 will define these by extending Phase 37's v4 schemas
  // with top-level `data_consistency` + `overall_confidence` per RESEARCH
  // Finding 1).
  sections.push(buildStructuredOutputDirective(profileType));

  return {
    system: sections.join('\n\n'),
    user: `Generate the ${profileType.toUpperCase()} psychological profile for Greg.`,
  };
}

// ── Private section builders (pure, no side effects) ────────────────────────

/**
 * Role preamble — psychological-trait-inference framing. Higher-level than
 * the per-profileType directive (section 7) which names the specific
 * framework. This section establishes the inference discipline: pattern
 * aggregation across many statements, NEVER quotation extraction from any
 * single one.
 */
function buildRolePreamble(profileType: PsychologicalProfilePromptType): string {
  const frameworkLine =
    profileType === 'hexaco'
      ? 'You are scoring Greg against the HEXACO Big-Six framework.'
      : 'You are scoring Greg against the Schwartz Universal Values framework (10-value circumplex).';
  return [
    '## Your Role',
    "You are inferring stable trait-level dispositions from a corpus of Greg's first-person speech. Trait inference is pattern aggregation across many statements — never quotation extraction from any single one. A single sentence is never evidence for a trait score; consistent patterns across many entries are.",
    '',
    frameworkLine,
    '',
    "Discipline:",
    "- Trait inference operates over the WHOLE corpus, not individual statements. Do not anchor a dimension score on one striking quote.",
    "- When the corpus is sparse for a given dimension, lower the per-dimension `confidence` and let `overall_confidence` drop accordingly. Empty or low-confidence dimensions are CORRECT outputs.",
    "- Trait scores are slow-moving. Substantial month-over-month shifts are implausible without a major life event signaled in the substrate.",
  ].join('\n');
}

/**
 * Word-count framing — D-08 (REPLACES M010's volume-weight ceiling).
 *
 * Communicates `wordCount` explicitly so Sonnet sees the substrate scale,
 * then locks the structured-output contract: emit `data_consistency` AND
 * `overall_confidence` at the top level; do NOT emit a top-level `confidence`
 * field. Per-dimension `confidence` values within each dimension object ARE
 * still required (the Phase 37 v4 schema declares them).
 *
 * The structural test asserts these substrings:
 *   - 'data_consistency'
 *   - 'overall_confidence'
 *   - 'do NOT emit a `confidence` field'
 *   - the literal wordCount value (e.g., '6247')
 */
function buildWordCountFraming(wordCount: number): string {
  return [
    '## Volume & Confidence Reporting',
    `The substrate contains ${wordCount} words of Greg's first-person Telegram speech from the previous calendar month.`,
    '',
    'Report `data_consistency` in the 0.0–1.0 range as a combined volume + cross-month consistency signal:',
    '  - 0.0 = substrate is internally contradictory; no coherent picture emerges',
    '  - 0.3 = substrate is sparse OR contains few aligned signals surrounded by noise',
    '  - 0.5 = substrate paints a moderately coherent picture; minor inconsistencies present',
    '  - 0.7 = substrate is clear and aligned across multiple distinct entries',
    '  - 1.0 = substrate is highly consistent across many distinct entries',
    '',
    'Report `overall_confidence` in the 0.0–1.0 range as your top-level confidence in the profile inference as a whole. This is distinct from per-dimension `confidence` values (which remain required inside each dimension object). The host code reads `data_consistency` and `overall_confidence` directly — do NOT emit a `confidence` field at the top level.',
    '',
    'Both fields are REQUIRED at the top level of your structured output. Per-dimension `confidence` values within each dimension object are ALSO required (do not omit them).',
  ].join('\n');
}

/**
 * Previous-state block — D-09. Rendered ONLY when `prevState !== null`.
 * The structural test asserts:
 *   - prevState=null → system does NOT contain '## CURRENT PROFILE STATE'
 *   - prevState!=null → system DOES contain '## CURRENT PROFILE STATE' AND
 *     `JSON.stringify(prevState, null, 2)` appears verbatim.
 *
 * Update-discipline phrasing is adjusted for the slow-moving-trait domain
 * (parallel to M010-03's "3+ supporting substrate entries" rule, but cast
 * in cross-month behavioral-evidence language because trait scores are
 * slow-moving by definition).
 */
function buildPreviousStateBlock(prevState: unknown): string {
  return [
    '## CURRENT PROFILE STATE',
    'The current profile snapshot (from the most recent successful fire) is shown below as JSON. Use this as the baseline.',
    '',
    JSON.stringify(prevState, null, 2),
    '',
    "Update discipline: trait scores are slow-moving by definition. Update a high-confidence dimension score ONLY when substantial cross-month behavioral evidence justifies the change. When the substrate does not provide new evidence on a dimension, carry the prior score forward with adjusted `last_updated`. Single-entry signals are NEVER sufficient to overturn a high-confidence prior value.",
  ].join('\n');
}

/**
 * Substrate block — corpus + episodic summaries. NO decisions section
 * (Phase 37 substrate is corpus-only per D-20; direct divergence from M010
 * which threads resolved decisions through assembleProfilePrompt).
 *
 * Each pensieve row is rendered as `YYYY-MM-DD [tagOrUntagged] truncatedContent`.
 * `epistemicTag` is nullable in the corpus per PSCH-07 (untagged rows pass
 * the source-filter); null tags render as `[untagged]`.
 */
function buildSubstrateBlock(substrate: PsychologicalProfileSubstrateView): string {
  const lines: string[] = ['## Substrate'];

  lines.push('');
  lines.push(`### Pensieve corpus (${substrate.corpus.length} rows)`);
  if (substrate.corpus.length === 0) {
    lines.push('(no corpus rows in window)');
  } else {
    for (const entry of substrate.corpus) {
      const date = entry.createdAt.toISOString().slice(0, 10);
      // Phase 43 / INJ-02 + D-06: epistemicTag allowlist closes the Phase 38
      // WR-05 boundary leak. Allow alphanumeric + _- only; everything else
      // (whitespace, markdown anchors, etc.) is stripped before rendering.
      const rawTag = entry.epistemicTag ?? 'untagged';
      const tag = rawTag.replace(/[^A-Za-z0-9_-]/g, '');
      const truncated =
        entry.content.length > 200
          ? entry.content.slice(0, 197) + '...'
          : entry.content;
      // Phase 43 / INJ-02: sanitize AFTER truncation so the 200-char size
      // guard still bounds total length even when escape chars are added.
      lines.push(`- ${date} [${tag}] ${sanitizeSubstrateText(truncated)}`);
    }
  }

  lines.push('');
  lines.push(`### Episodic summaries (${substrate.episodicSummaries.length})`);
  if (substrate.episodicSummaries.length === 0) {
    lines.push('(no episodic summaries in window)');
  } else {
    for (const s of substrate.episodicSummaries) {
      const truncated =
        s.summary.length > 200 ? s.summary.slice(0, 197) + '...' : s.summary;
      // Phase 43 / INJ-02: episodic summaries are M008-derived but may
      // contain copied user fragments; sanitize defensively.
      lines.push(`- ${s.summaryDate}: ${sanitizeSubstrateText(truncated)}`);
    }
  }

  lines.push('');
  lines.push(`Total word count: ${substrate.wordCount}`);

  return lines.join('\n');
}

/**
 * Structured-output directive — LAST section. Names the v4 boundary schema
 * Sonnet's response will be parsed against (Plan 38-02 Task 1 will define
 * these by extending Phase 37's v4 schemas with top-level `data_consistency`
 * + `overall_confidence` per RESEARCH Finding 1). Re-iterates the required
 * top-level fields.
 *
 * The profileType argument selects the schema name. Plan 38-02's generators
 * pass the actual Zod schema via `zodOutputFormat(v4BoundarySchema, 'profile')`
 * — this prompt section is a redundant Sonnet-side anchor (defense-in-depth
 * alongside the SDK's structured-output enforcement).
 */
function buildStructuredOutputDirective(
  profileType: PsychologicalProfilePromptType,
): string {
  const schemaName =
    profileType === 'hexaco'
      ? 'HexacoProfileSchemaV4Sdk'
      : 'SchwartzProfileSchemaV4Sdk';

  return [
    '## Structured Output Contract',
    `Return JSON conforming to ${schemaName} (the host enforces this via the SDK structured-output channel — your output will be rejected if it does not parse).`,
    '',
    'Required top-level fields:',
    '  - Per-dimension objects (one per dimension in the framework), each containing the score + per-dimension `confidence` (0-1) + `last_updated` per the Phase 37 v4 schema.',
    '  - `data_consistency` — number in 0.0..1.0; the combined volume + cross-month consistency signal defined above.',
    '  - `overall_confidence` — number in 0.0..1.0; your top-level confidence in the profile inference, bounded by the empirical r ≈ .31–.41 ceiling.',
    '',
    'Forbidden field: a top-level `confidence`. The host code reads `data_consistency` and `overall_confidence` directly; emitting a top-level `confidence` violates the contract. (Per-dimension `confidence` values inside each dimension object are still required.)',
    '',
    "Empty / unknown dimensions: lower the per-dimension `confidence` toward 0 rather than inventing a score. A 0-confidence dimension is a CORRECT output when the substrate is silent.",
  ].join('\n');
}
