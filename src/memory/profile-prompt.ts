/**
 * src/memory/profile-prompt.ts — Phase 34 Plan 01 (M010-04)
 *
 * Pure-function prompt assembler for the four operational-profile generators.
 * Zero side effects: no DB calls, no LLM calls, no fs reads, no env access.
 * Producers of the substrate: Plan 34-02's `loadProfileSubstrate` (TBD).
 * Consumers: Plan 34-02's four per-dimension generators
 * (`src/memory/profiles/{jurisdictional,capital,health,family}.ts`).
 *
 * Satisfies (per 34-CONTEXT.md):
 *   - GEN-04 — `assembleProfilePrompt` shared builder (HARD CO-LOC #M10-2 anchor)
 *   - D-03 — single shared function, dimension-keyed, returns { system, user }
 *   - D-04 — CONSTITUTIONAL_PREAMBLE first section (M010-06 mitigation against
 *            per-dimension prompt drift)
 *   - D-05 — DO_NOT_INFER_DIRECTIVE verbatim in all 4 dimensions (M010-02
 *            anti-hallucination control)
 *   - D-06 — Volume-weight ceiling phrasing tells Sonnet to emit
 *            `data_consistency`, NOT `confidence` (hybrid confidence model —
 *            host code computes final confidence via
 *            `computeProfileConfidence(entryCount, data_consistency)`;
 *            M010-01 confidence-inflation mitigation)
 *   - D-07 — Previous-state injection conditional on `prevState !== null`;
 *            renders prior jsonb field verbatim with the "update only when 3+
 *            supporting substrate entries justify the change" directive
 *            (M010-03 profile-drift mitigation)
 *
 * NOT in scope here (Plan 34-02):
 *   - Calling Sonnet (anthropic.messages.parse + zodOutputFormat)
 *   - Loading the substrate (`loadProfileSubstrate` in profiles/shared.ts)
 *   - Computing substrate hash / threshold check / upsert (per-generator)
 *   - Volume-weight ceiling Zod .refine() (overlay on v4 schema at SDK boundary)
 *
 * Tests: src/memory/__tests__/profile-prompt.test.ts
 * The structural tests grep the output for specific anchor substrings — do
 * NOT edit anchor phrases below without updating the tests.
 *
 * Mirror: src/rituals/weekly-review-prompt.ts:144-188 `assembleWeeklyReviewPrompt`.
 * Same 8-section structure, same pure-function contract, same CONSTITUTIONAL_PREAMBLE
 * section-1 placement.
 */
import { CONSTITUTIONAL_PREAMBLE } from '../chris/personality.js';
import { sanitizeSubstrateText } from './profiles/shared.js';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * The four operational-profile dimensions. Lowercase verbatim per D-03 — the
 * value is interpolated into the user prompt and into the dimension-specific
 * directive selector. Plan 34-02's per-generator config objects key on this
 * exact union.
 */
export type ProfilePromptDimension = 'jurisdictional' | 'capital' | 'health' | 'family';

/**
 * Return shape of `assembleProfilePrompt` per D-03. The `system` string is
 * passed to `anthropic.messages.parse({ system: [{type:'text', text: system,
 * cache_control: {type:'ephemeral'}}], messages: [{role:'user', content: user}], ... })`
 * by each Plan 34-02 generator.
 */
export type AssembledProfilePrompt = { system: string; user: string };

/**
 * Structural type for the substrate slice this prompt builder reads. Plan
 * 34-02 ships the full `ProfileSubstrate` type in `src/memory/profiles/shared.ts`;
 * that type is assignable to this view (fields can be wider). Declaring the
 * structural type here lets the prompt builder compile standalone in Wave 1
 * without a forward-reference to a file that does not yet exist.
 *
 * Field minimums (per <interfaces> in 34-01-PLAN.md):
 *   - pensieveEntries: tagged FACT/RELATIONSHIP/INTENTION/EXPERIENCE entries
 *     in the rolling-context window (Plan 34-02 D-13 + D-14)
 *   - episodicSummaries: M008 episodic summaries in the window
 *   - decisions: resolved decisions in the window (status='resolved')
 *   - entryCount: pensieveEntries.length — the threshold-gate count (D-20)
 */
export type ProfileSubstrateView = {
  pensieveEntries: ReadonlyArray<{
    id: string;
    epistemicTag: string;
    content: string;
    createdAt: Date;
  }>;
  episodicSummaries: ReadonlyArray<{
    summaryDate: string;
    summary: string;
  }>;
  decisions: ReadonlyArray<{
    id: string;
    resolvedAt: Date;
    question: string;
    resolution: string;
  }>;
  entryCount: number;
};

// ── Public constants ────────────────────────────────────────────────────────

/**
 * Anti-hallucination directive injected into every dimension's assembled
 * system string (D-05; M010-02 mitigation). Tone matches CONSTITUTIONAL_PREAMBLE —
 * declarative, second-person, no hedging. Phrasing is locked: the structural
 * test asserts the case-insensitive substring 'do not infer' is present.
 *
 * Why no per-field `sources: uuid[]` in v1: D-33 explicitly defers. The
 * directive IS the only anti-hallucination control in Phase 34; Phase 36's
 * live 3-of-3 atomic test (PTEST-05) quantifies the residual rate.
 */
export const DO_NOT_INFER_DIRECTIVE = [
  '## Hallucination Floor (MANDATORY)',
  'Do not infer facts from related-but-distinct entries. If the substrate does not contain the explicit fact you would need to populate a field, leave that field empty or mark it with the string "insufficient data" exactly. Derivation from category similarity is NOT acceptable: a RELATIONSHIP-tagged entry about Anna is not evidence about Greg\'s tax residency, and a FACT-tagged entry about Tbilisi weather is not evidence about Greg\'s physical_location. When in doubt, leave the field empty and let `data_consistency` drop. Empty fields with low `data_consistency` are CORRECT outputs; plausible-sounding inferences are FAILURES that the operator (Greg) must later detect and correct.',
].join('\n');

// ── Private constants ───────────────────────────────────────────────────────

/**
 * Dimension-specific directives — Claude's Discretion per CONTEXT.md. Each
 * directive tells Sonnet what to focus on for that dimension and what to
 * ignore. Every directive includes the verbatim substring 'focus on' so the
 * (future) per-dimension structural test can grep for the anchor.
 *
 * Locked HERE (not in the per-generator config) so Plan 34-02's generator
 * config objects cannot drift from the structural test's expectations
 * (M010-06 mitigation extension).
 */
const DIMENSION_DIRECTIVES: Record<ProfilePromptDimension, string> = {
  jurisdictional: [
    '## Dimension Focus — Jurisdictional',
    'For this profile, focus on facts about Greg\'s country of residence, physical location, residency statuses (tax/visa/permanent), active legal entities, passport citizenships, and any planned cross-border move. Ignore entries that are purely relationship, health, or capital-allocation in nature — even if they mention a country name in passing. A trip to Tbilisi for a dinner with Anna is NOT evidence of Georgian residency; an explicit "I moved to Tbilisi" or "I applied for Georgian tax residency" IS.',
  ].join('\n'),
  capital: [
    '## Dimension Focus — Capital',
    'For this profile, focus on facts about Greg\'s liquid net worth, recurring income streams, recurring obligations (rent / subscriptions / runway), tax-optimization status, FI phase / target amount, and major allocation decisions. Ignore entries that are purely jurisdictional, health, or relationship in nature. A move to Tbilisi affects capital only via the explicit "Tbilisi rent is X" or "I cancelled the Paris rental" — the move itself is jurisdictional, not capital.',
  ].join('\n'),
  health: [
    '## Dimension Focus — Health',
    'For this profile, focus on facts about Greg\'s physical health (sleep / exercise / diet / energy), medical conditions, ongoing treatments, and any explicit health-related intentions or experiences. Ignore entries that are purely jurisdictional, capital, or relationship in nature. Energy level Likert scores from wellbeing snapshots are a substrate signal; coffee consumption mentioned in a journal entry is NOT health-of-record unless explicitly framed as such.',
  ].join('\n'),
  family: [
    '## Dimension Focus — Family',
    'For this profile, focus on facts about Greg\'s family relationships (partner / parents / siblings / dependents / children), family communication patterns, and any explicit relational-intention entries. Ignore entries that are purely jurisdictional, capital, or health in nature. "Anna is in Tbilisi" is family-substrate if framed as "Anna and I are together"; if framed as "Anna visited for a week", it may be relationship-experience but NOT family-of-record.',
  ].join('\n'),
};

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Assemble the full Sonnet system + user prompt for one operational-profile
 * generator fire.
 *
 * Returns { system, user }. The caller (Plan 34-02 generator) passes `system`
 * to the Anthropic SDK `messages.parse({ system: [...] })` call and `user` to
 * the `messages: [{role:'user', content: user}]` slot.
 *
 * Pure: same inputs → same outputs across repeated calls. Zero side effects.
 *
 * Section ordering (mirrors src/rituals/weekly-review-prompt.ts):
 *   1. CONSTITUTIONAL_PREAMBLE — D-04 / M010-06 anchor. FIRST so the
 *      anti-sycophancy floor binds before any role framing.
 *   2. Role preamble — operational-profile-inference framing (fact-extraction,
 *      not interpretation).
 *   3. DO_NOT_INFER_DIRECTIVE — D-05 / M010-02 mitigation.
 *   4. Volume-weight ceiling — D-06 / M010-01 mitigation (host-computes
 *      confidence; Sonnet emits `data_consistency`).
 *   5. Previous-state injection — D-07 / M010-03 mitigation. CONDITIONAL on
 *      `prevState !== null`. When the seed row (Phase 33 D-11) has not yet
 *      been replaced and the caller passes null, this section is omitted.
 *   6. Dimension-specific directive — Claude's Discretion per CONTEXT.md.
 *      Each dimension's directive tells Sonnet what to focus on and what to
 *      ignore.
 *   7. Substrate block — pensieve entries / episodic summaries / resolved
 *      decisions rendered as text blocks.
 *   8. Structured-output directive — LAST, so any earlier text that tried to
 *      inject conflicting schema instructions is followed by the actual
 *      contract.
 */
export function assembleProfilePrompt(
  dimension: ProfilePromptDimension,
  substrate: ProfileSubstrateView,
  prevState: unknown | null,
  entryCount: number,
): AssembledProfilePrompt {
  const sections: string[] = [];

  // 1. CONSTITUTIONAL_PREAMBLE — D-04 / M010-06 first-section anchor.
  // The structural test asserts `system.startsWith('## Core Principles (Always Active)')`
  // for all 4 dimensions. Drift detector for M010-06 lives in
  // src/memory/__tests__/profile-prompt.test.ts.
  sections.push(CONSTITUTIONAL_PREAMBLE.trimEnd());

  // 2. Role preamble — operational-profile-inference framing.
  sections.push(buildRolePreamble(dimension));

  // 3. DO_NOT_INFER_DIRECTIVE — D-05 / M010-02 mitigation. Verbatim in every
  // dimension's output (structural test parametrizes over all 4 dimensions
  // and asserts presence).
  sections.push(DO_NOT_INFER_DIRECTIVE);

  // 4. Volume-weight ceiling — D-06 / M010-01 mitigation. Locked OQ-2
  // phrasing from 34-RESEARCH.md lines 854-882. The substrings
  // 'data_consistency', 'DO NOT emit a `confidence` field',
  // 'fewer than 20 entries', and 'MUST NOT exceed 0.5' are anchor substrings
  // for the structural test.
  sections.push(buildVolumeWeightCeilingDirective(entryCount));

  // 5. Previous-state injection — D-07 / M010-03 mitigation. Conditional.
  if (prevState !== null) {
    sections.push(buildPreviousStateBlock(prevState));
  }

  // 6. Dimension-specific directive — Claude's Discretion. Locked here so
  // Plan 34-02 generators consume the same text the structural test verifies.
  sections.push(DIMENSION_DIRECTIVES[dimension]);

  // 7. Substrate block — the substrate of the inference.
  sections.push(buildSubstrateBlock(substrate));

  // 8. Structured-output directive — LAST.
  sections.push(buildStructuredOutputDirective(dimension));

  return {
    system: sections.join('\n\n'),
    user: `Generate the operational profile for ${dimension}.`,
  };
}

// ── Private section builders (pure, no side effects) ────────────────────────

function buildRolePreamble(dimension: ProfilePromptDimension): string {
  return [
    '## Your Task',
    `You are Chris, inferring an operational profile for Greg in the ${dimension} dimension from his Pensieve substrate. This is a fact-extraction task, not an interpretation task: your output will be stored as a structured profile row and later read by other modes (REFLECT, COACH, PSYCHOLOGY) as authoritative current-state context.`,
    '',
    'Discipline:',
    '- Extract facts that the substrate ASSERTS. Do not invent, infer, or extrapolate.',
    '- When the substrate is silent on a field, leave it empty or mark "insufficient data" — do NOT guess.',
    '- The substrate represents what Greg has chosen to record. Absence is information: a field he never mentioned is a field that should remain empty.',
    '- You are not interpreting Greg\'s state of mind. You are extracting his facts-of-record for this dimension.',
  ].join('\n');
}

/**
 * Volume-weight ceiling directive — D-06 / M010-01 mitigation. Phrasing
 * locked from 34-RESEARCH.md OQ-2 Resolution (lines 854-882). The structural
 * test asserts these substrings verbatim:
 *   - 'data_consistency'
 *   - 'DO NOT emit a `confidence` field'
 *   - 'fewer than 20 entries'
 *   - 'MUST NOT exceed 0.5'
 *   - '20–49 entries'
 *   - '50+ entries'
 *
 * The `entryCount` arg is currently INFORMATIONAL only — the ceiling rules
 * are stated unconditionally (Sonnet enforces against its own substrate
 * count understanding). Plan 34-02's Zod v4 .refine() at the SDK boundary
 * is the host-side defense; this prompt is the Sonnet-side defense. Both
 * layers must agree (RESEARCH residual risk lines 938-941 — if the .refine()
 * is silently dropped by the SDK cast, this prompt is the only enforcement).
 */
function buildVolumeWeightCeilingDirective(entryCount: number): string {
  return [
    '## Confidence Calibration',
    `Substrate entry count for this fire: ${entryCount}.`,
    '',
    'You will report ONE field that quantifies how internally consistent the substrate is for this profile dimension:',
    '',
    '  `data_consistency`: a number between 0.0 and 1.0 inclusive.',
    '',
    '  - 0.0 = substrate entries contradict each other; no coherent picture emerges',
    '  - 0.3 = substrate is sparse OR contains a few aligned facts surrounded by noise',
    '  - 0.5 = substrate paints a moderately coherent picture; minor inconsistencies present',
    '  - 0.7 = substrate is clear and aligned across multiple distinct entries',
    '  - 1.0 = substrate is highly consistent across many distinct entries with no contradictions',
    '',
    'CRITICAL — you DO NOT emit a `confidence` field. The host application computes the final `confidence` value from a formula combining `data_consistency` (your output) and the count of substrate entries (a SQL aggregate the host already knows). Do NOT attempt to compute or guess the entry count. Do NOT output a `confidence` field of any kind — your output schema does not include one.',
    '',
    'HARD CONSTRAINT — volume-weight ceiling:',
    '  - When the substrate has fewer than 20 entries, your `data_consistency` value MUST NOT exceed 0.5. Reporting 0.7 on a 15-entry substrate would be rejected by the host as confidence inflation.',
    '  - When 20–49 entries, `data_consistency` MAY range freely in 0.0..1.0.',
    '  - When 50+ entries, `data_consistency` MAY range freely in 0.0..1.0.',
  ].join('\n');
}

/**
 * Previous-state block — D-07 / M010-03 mitigation. Rendered ONLY when
 * `prevState !== null`. The structural test asserts:
 *   - prevState=null → system does NOT contain '## CURRENT PROFILE STATE'
 *   - prevState!=null → system DOES contain '## CURRENT PROFILE STATE' AND
 *     renders the prior jsonb field value verbatim
 *
 * The "update high-confidence fields ONLY when 3+ supporting substrate
 * entries justify the change" directive is D-07 verbatim per CONTEXT.md —
 * it is the anti-drift control that prevents Sonnet from rewriting the
 * profile on every fire just because the substrate window slid by a day.
 */
function buildPreviousStateBlock(prevState: unknown): string {
  return [
    '## CURRENT PROFILE STATE',
    'The current operational profile (from the most recent successful fire) is shown below as JSON. Use this as the baseline.',
    '',
    JSON.stringify(prevState, null, 2),
    '',
    'Update discipline: update high-confidence fields ONLY when 3+ supporting substrate entries justify the change. A single new substrate entry is NOT sufficient to overturn a high-confidence prior value — log the discrepancy by leaving the prior value AND describing the new evidence in the appropriate field comment, but do not rewrite. Low-confidence or empty prior fields MAY be updated freely as new substrate arrives.',
  ].join('\n');
}

function buildSubstrateBlock(substrate: ProfileSubstrateView): string {
  const lines: string[] = ['## SUBSTRATE'];

  lines.push('');
  lines.push(`### Pensieve entries (${substrate.pensieveEntries.length})`);
  if (substrate.pensieveEntries.length === 0) {
    lines.push('(no Pensieve entries in window)');
  } else {
    for (const entry of substrate.pensieveEntries) {
      const date = entry.createdAt.toISOString().slice(0, 10);
      const truncated = entry.content.length > 200
        ? entry.content.slice(0, 197) + '...'
        : entry.content;
      // Phase 43 / INJ-01 + D-06: sanitize user-controlled content AFTER
      // truncation (so the 200-char size guard still bounds total length),
      // and apply the alphanumeric+_- allowlist to epistemicTag so a runtime-
      // tagged Pensieve row cannot inject special characters or markdown
      // anchors through the [${tag}] rendering channel.
      const safeContent = sanitizeSubstrateText(truncated);
      const safeTag = entry.epistemicTag.replace(/[^A-Za-z0-9_-]/g, '');
      lines.push(`- ${date} [${safeTag}] ${safeContent}`);
    }
  }

  lines.push('');
  lines.push(`### Episodic summaries (${substrate.episodicSummaries.length})`);
  if (substrate.episodicSummaries.length === 0) {
    lines.push('(no episodic summaries in window)');
  } else {
    for (const s of substrate.episodicSummaries) {
      const truncated = s.summary.length > 200
        ? s.summary.slice(0, 197) + '...'
        : s.summary;
      // Phase 43 / INJ-01: episodic summaries are derived from past Pensieve
      // entries (M008 consolidation), but the consolidation Sonnet may have
      // copied user content verbatim — sanitize defensively.
      lines.push(`- ${s.summaryDate}: ${sanitizeSubstrateText(truncated)}`);
    }
  }

  lines.push('');
  lines.push(`### Resolved decisions (${substrate.decisions.length})`);
  if (substrate.decisions.length === 0) {
    lines.push('(no resolved decisions in window)');
  } else {
    for (const d of substrate.decisions) {
      const date = d.resolvedAt.toISOString().slice(0, 10);
      const q = d.question.length > 100 ? d.question.slice(0, 97) + '...' : d.question;
      const r = d.resolution.length > 100 ? d.resolution.slice(0, 97) + '...' : d.resolution;
      // Phase 43 / INJ-01: both decision question + resolution are
      // user-controlled (Greg's own decision text); sanitize both.
      lines.push(`- ${date} Q: ${sanitizeSubstrateText(q)} → R: ${sanitizeSubstrateText(r)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Structured-output directive — LAST section. Names the v4 schema Sonnet's
 * response will be parsed against, reminds about the `data_consistency`
 * field, and re-iterates the no-`confidence`-field rule.
 *
 * The dimension argument selects the schema name (e.g.
 * 'JurisdictionalProfileSchemaV4'). Plan 34-02's generator passes the actual
 * Zod schema via `zodOutputFormat(schemaV4, 'profile')` — this prompt
 * section is a redundant Sonnet-side anchor (defense-in-depth alongside the
 * SDK's structured-output enforcement).
 */
function buildStructuredOutputDirective(dimension: ProfilePromptDimension): string {
  const schemaName = ({
    jurisdictional: 'JurisdictionalProfileSchemaV4',
    capital: 'CapitalProfileSchemaV4',
    health: 'HealthProfileSchemaV4',
    family: 'FamilyProfileSchemaV4',
  } as const)[dimension];

  return [
    '## Output Format',
    `Return JSON conforming to ${schemaName} (the host enforces this via the SDK structured-output channel — your output will be rejected if it does not parse).`,
    'Required field: `data_consistency` (number in 0.0..1.0; subject to the volume-weight ceiling above).',
    'Forbidden field: `confidence` — the host computes this from `data_consistency` and `entryCount`. Including a `confidence` field in your output is a contract violation.',
    'Empty / unknown fields: use the empty array `[]` for list fields, `null` for nullable scalar fields, and the literal string "insufficient data" only where the schema permits it. Do NOT invent placeholder values to fill a field — empty is the correct output when the substrate does not contain the explicit fact.',
  ].join('\n');
}
