---
phase: 14-capture-flow
plan: 01
type: execute
wave: 0
depends_on: []
files_modified:
  - src/db/schema.ts
  - src/db/migrations/0004_decision_trigger_suppressions.sql
  - src/db/migrations/meta/_journal.json
  - src/db/migrations/meta/0004_snapshot.json
  - scripts/test.sh
  - src/llm/prompts.ts
  - src/decisions/triggers-fixtures.ts
  - src/decisions/__tests__/triggers.test.ts
  - src/decisions/__tests__/capture.test.ts
  - src/decisions/__tests__/vague-validator.test.ts
  - src/decisions/__tests__/resolve-by.test.ts
  - src/decisions/__tests__/suppressions.test.ts
  - src/decisions/__tests__/engine-capture.test.ts
autonomous: true
requirements: [CAP-01, CAP-06]
must_haves:
  truths:
    - "Migration 0004 creates decision_trigger_suppressions and is applied by scripts/test.sh"
    - "Every downstream test file exists and is RED (failing meaningfully, not import errors)"
    - "EN/FR/RU trigger fixture has |EN|==|FR|==|RU|==4 phrases"
    - "Prompt constants for stakes / capture-extract / vague / resolve-by exist in src/llm/prompts.ts"
  artifacts:
    - path: "src/db/migrations/0004_decision_trigger_suppressions.sql"
      provides: "DDL for decision_trigger_suppressions table"
      contains: "CREATE TABLE"
    - path: "src/decisions/triggers-fixtures.ts"
      provides: "Shared EN/FR/RU positive+negative trigger phrase fixture"
    - path: "src/llm/prompts.ts"
      provides: "STAKES_CLASSIFICATION_PROMPT, CAPTURE_EXTRACTION_PROMPT, VAGUE_VALIDATOR_PROMPT, RESOLVE_BY_PARSER_PROMPT"
  key_links:
    - from: "scripts/test.sh"
      to: "src/db/migrations/0004_decision_trigger_suppressions.sql"
      via: "MIGRATION_4_SQL psql apply step"
      pattern: "MIGRATION_4_SQL"
---

<objective>
Wave 0 foundation: DB schema for `decision_trigger_suppressions`, migration 0004 wired into `scripts/test.sh`, Haiku prompt string constants for all four Phase-14 Haiku calls, the shared EN/FR/RU trigger-phrase fixture, and six failing RED test scaffolds that Waves 1–2 turn GREEN.

Purpose: Resolve the schema_push_requirement BLOCKER first (else downstream tests silently run against a half-migrated DB). Put the parity-required trigger fixture and prompt strings in one place so Wave 1 plans (triggers, suppressions, capture) run fully in parallel with zero file overlap.
Output: Green `npm test` on new migration (table exists), RED but meaningful test files for triggers/capture/vague/resolve-by/suppressions/engine-capture.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/14-capture-flow/14-CONTEXT.md
@.planning/phases/14-capture-flow/14-RESEARCH.md
@.planning/phases/13-schema-lifecycle-primitives/13-CONTEXT.md
@src/db/schema.ts
@src/llm/prompts.ts
@src/decisions/__tests__/capture-state.test.ts
@scripts/test.sh

<interfaces>
From src/db/schema.ts (existing patterns to mirror):
```typescript
// pgTable + pgEnum conventions, bigint chatId mode, withTimezone timestamps,
// gen_random_uuid() primary keys, index() + unique() trailing callback.
// decisionCaptureState (Phase 13) is closest analog: chatId PK bigint, jsonb draft.
```

From src/decisions/capture-state.ts (Phase 13, do not modify):
```typescript
export async function getActiveDecisionCapture(chatId: bigint): Promise<{ chatId: bigint; stage: string; draft: unknown; decisionId: string | null; startedAt: Date; updatedAt: Date } | null>;
```

From src/decisions/lifecycle.ts (Phase 13, do not modify):
```typescript
export async function transitionDecision(id: string, toStatus: DecisionStatus, payload: Partial<DecisionFields>): Promise<void>; // throws InvalidTransitionError | OptimisticConcurrencyError
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add decision_trigger_suppressions table + migration 0004 + update scripts/test.sh [BLOCKING]</name>
  <files>src/db/schema.ts, src/db/migrations/0004_decision_trigger_suppressions.sql, src/db/migrations/meta/_journal.json, src/db/migrations/meta/0004_snapshot.json, scripts/test.sh</files>
  <read_first>
    - src/db/schema.ts (full file — see how decisionCaptureState at the bottom is declared)
    - src/db/migrations/0003_add_decision_epistemic_tag.sql (shape of the last migration)
    - src/db/migrations/meta/_journal.json (journal append format)
    - scripts/test.sh (migration list shape — MIGRATION_0..3 declared + psql-applied in order)
    - .planning/phases/14-capture-flow/14-RESEARCH.md §"Schema Extension for Suppressions" (exact Drizzle declaration to reproduce)
  </read_first>
  <action>
    Add Drizzle table to `src/db/schema.ts` (append at bottom, after `decisionCaptureState`):

    ```typescript
    export const decisionTriggerSuppressions = pgTable(
      'decision_trigger_suppressions',
      {
        id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
        chatId: bigint('chat_id', { mode: 'bigint' }).notNull(),
        phrase: text('phrase').notNull(), // stored trimmed + lowercased by caller
        createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
      },
      (table) => [
        index('decision_trigger_suppressions_chat_id_idx').on(table.chatId),
        unique('decision_trigger_suppressions_chat_id_phrase_unique').on(table.chatId, table.phrase),
      ],
    );
    ```

    Generate the migration via `npx drizzle-kit generate --name decision_trigger_suppressions`. The generated file MUST live at `src/db/migrations/0004_decision_trigger_suppressions.sql` (rename if drizzle-kit emits a different slug). Contents must include `CREATE TABLE IF NOT EXISTS "decision_trigger_suppressions"` with columns chat_id bigint NOT NULL, phrase text NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, id uuid DEFAULT gen_random_uuid() PRIMARY KEY, and the unique + index DDL.

    Confirm `src/db/migrations/meta/0004_snapshot.json` exists (auto-emitted by drizzle-kit). Confirm `_journal.json` has an entry pointing at tag `0004_decision_trigger_suppressions`.

    Append to `scripts/test.sh` — insert AFTER the existing `MIGRATION_3_SQL=...` line:
    ```bash
    MIGRATION_4_SQL="src/db/migrations/0004_decision_trigger_suppressions.sql"
    ```
    And insert AFTER the existing `< "$MIGRATION_3_SQL"` psql block, mirroring identical shape (the `docker compose exec -T postgres psql -U chris -d chris -v ON_ERROR_STOP=1 -q < "$MIGRATION_4_SQL"` 3-line block).

    Do NOT reorder existing migration applications. Do NOT rename existing migrations.
  </action>
  <verify>
    <automated>npm test -- src/decisions/__tests__/schema.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "decisionTriggerSuppressions" src/db/schema.ts` returns exactly one export line.
    - `ls src/db/migrations/0004_decision_trigger_suppressions.sql` succeeds.
    - `grep -c "CREATE TABLE.*decision_trigger_suppressions" src/db/migrations/0004_decision_trigger_suppressions.sql` returns ≥1.
    - `grep -c "decision_trigger_suppressions_chat_id_phrase_unique" src/db/migrations/0004_decision_trigger_suppressions.sql` returns ≥1.
    - `grep -c "MIGRATION_4_SQL" scripts/test.sh` returns ≥2 (declaration + psql apply).
    - `grep -c "0004_decision_trigger_suppressions" src/db/migrations/meta/_journal.json` returns ≥1.
    - `npm test` runs to completion with all Phase-13 tests still GREEN (no regressions).
  </acceptance_criteria>
  <done>Migration 0004 applied cleanly by `npm test`'s Docker Postgres harness; schema.test.ts (Phase 13) still green; the table exists in the live DB at test-boot time.</done>
</task>

<task type="auto">
  <name>Task 2: Add Haiku prompt constants + EN/FR/RU trigger fixture</name>
  <files>src/llm/prompts.ts, src/decisions/triggers-fixtures.ts</files>
  <read_first>
    - src/llm/prompts.ts (current shape — which prompt consts already live here; export convention)
    - src/chris/engine.ts (specifically MODE_DETECTION_PROMPT usage + how JSON-schema is embedded in system prompt)
    - .planning/phases/14-capture-flow/14-CONTEXT.md §"Trigger regex & meta-guards" and §"Haiku stakes classifier" (D-01, D-04, D-05 full specifications)
    - .planning/phases/14-capture-flow/14-RESEARCH.md §"Code Examples" + §"Open Questions" (D-03 parity resolution recommendation)
  </read_first>
  <action>
    **(a) Add prompt constants to `src/llm/prompts.ts` (append, all `export const`):**

    - `STAKES_CLASSIFICATION_PROMPT`: Instructs Haiku to classify a user message into tier `trivial | moderate | structural`. Include verbatim tier definitions from CONTEXT.md D-05:
      - `structural` — reversible only at high cost; affects months+ (job change, relationship direction, major purchase/move, health commitment).
      - `moderate` — consequential but reversible in weeks (project selection, learning investment, short-term schedule change).
      - `trivial` — daily/reversible (what to eat, which show to watch, minor task choices).
      Include 3 positive examples per tier (work, relationships, finances domains per D-05). Output schema: `{"tier":"structural"|"moderate"|"trivial"}` single JSON object only, no prose. User message goes in the user role; system prompt holds tier definitions only.
    - `CAPTURE_EXTRACTION_PROMPT`: Instructs Haiku to take `{current_draft_jsonb, user_reply, canonical_slot_schema}` and emit an updated draft jsonb filling any newly-answered slots. Slots: `decision_text`, `alternatives` (array), `reasoning`, `prediction`, `falsification_criterion`, `resolve_by` (natural-language string, NOT parsed date here), `domain_tag` (single short tag). Instruction: fill only slots the user's reply actually answers; do NOT invent content; preserve already-filled slots unchanged. Output schema: single JSON object containing only newly-filled or changed fields.
    - `VAGUE_VALIDATOR_PROMPT`: Instructs Haiku to evaluate `{prediction, falsification_criterion}` together and return `{"verdict":"acceptable"|"vague","reason":"<short>"}`. Mandate: "A prediction + falsification pair is acceptable ONLY if there is a concrete observable event that, if it occurred, would prove the prediction wrong. Hedge words like 'probably', 'fine', 'better', 'peut-être', 'sans doute', 'наверное', 'возможно' are priors nudging toward 'vague' but not determinative — evaluate semantically."
    - `RESOLVE_BY_PARSER_PROMPT`: Instructs Haiku to parse a natural-language timeframe into `{"iso":"<timestamptz>"}` or `{"iso":null}` if unparseable. Include examples: "next week"→+7d, "in 3 months"→+90d, "by June"→next June-01, "end of year"→Dec-31 current year. 2s timeout will be enforced at call-site.

    Each prompt MUST end with a single line: `Respond with valid JSON only. No prose, no code fences.`

    **(b) Create `src/decisions/triggers-fixtures.ts`:**

    ```typescript
    export interface TriggerFixturePhrase {
      positive: string;  // full example user message containing the trigger
      trigger_phrase: string;  // canonical lowercased trigger phrase
    }

    export interface TriggerFixtureNegative {
      text: string;
      reason: 'meta_reference' | 'negation' | 'past_tense_report';
    }

    // Parity invariant: EN.length === FR.length === RU.length === 4
    // Resolves CONTEXT D-01 (PRD set) ∩ D-03 (parity) — research A2 recommendation (i):
    // extend FR+RU to 4 phrases each using the structural-decision analog of the EN "I'm not sure whether".
    export const EN_POSITIVES: TriggerFixturePhrase[] = [
      { positive: "I'm thinking about quitting my job", trigger_phrase: "i'm thinking about" },
      { positive: "I need to decide whether to move to Paris", trigger_phrase: "i need to decide" },
      { positive: "I'm weighing leaving versus staying another year", trigger_phrase: "i'm weighing" },
      { positive: "I'm not sure whether I should propose", trigger_phrase: "i'm not sure whether" },
    ];
    export const FR_POSITIVES: TriggerFixturePhrase[] = [
      { positive: "je réfléchis à quitter mon poste", trigger_phrase: "je réfléchis à" },
      { positive: "je dois décider si je pars", trigger_phrase: "je dois décider" },
      { positive: "j'hésite entre rester ou partir", trigger_phrase: "j'hésite" },
      { positive: "je dois choisir entre Paris et Lyon", trigger_phrase: "je dois choisir" },
    ];
    export const RU_POSITIVES: TriggerFixturePhrase[] = [
      { positive: "я думаю о смене работы", trigger_phrase: "я думаю о" },
      { positive: "мне нужно решить переезжать ли", trigger_phrase: "мне нужно решить" },
      { positive: "я колеблюсь между двумя вариантами", trigger_phrase: "я колеблюсь" },
      { positive: "мне нужно выбрать между Москвой и Питером", trigger_phrase: "мне нужно выбрать" },
    ];

    export const EN_NEGATIVES: TriggerFixtureNegative[] = [
      { text: "I'm not thinking about dinner", reason: 'negation' },
      { text: "She told me I'm thinking about leaving too much", reason: 'meta_reference' },
      { text: "I said I'm weighing the options yesterday but decided already", reason: 'past_tense_report' },
    ];
    export const FR_NEGATIVES: TriggerFixtureNegative[] = [
      { text: "je n'ai pas dit que je réfléchis à ça", reason: 'negation' },
      { text: "il m'a dit je réfléchis trop", reason: 'meta_reference' },
      { text: "j'ai déjà décidé, j'hésite plus", reason: 'negation' },
    ];
    export const RU_NEGATIVES: TriggerFixtureNegative[] = [
      { text: "я не думаю о работе сейчас", reason: 'negation' },
      { text: "она сказала мне нужно решить быстрее", reason: 'meta_reference' },
      { text: "я уже решил, больше не колеблюсь", reason: 'negation' },
    ];

    export const ABORT_PHRASES_EN = ['never mind', 'nevermind', 'stop', 'skip'];
    export const ABORT_PHRASES_FR = ['annule', 'laisse tomber', 'oublie'];
    export const ABORT_PHRASES_RU = ['отмена', 'забудь', 'пропусти'];
    ```
  </action>
  <verify>
    <automated>npm run test:unit -- src/decisions/__tests__/triggers.test.ts 2>&1 | tail -20 || true</automated>
  </verify>
  <acceptance_criteria>
    - `grep -cE "^export const (STAKES_CLASSIFICATION_PROMPT|CAPTURE_EXTRACTION_PROMPT|VAGUE_VALIDATOR_PROMPT|RESOLVE_BY_PARSER_PROMPT) " src/llm/prompts.ts` returns 4.
    - Each of the 4 prompt constants ends with the literal line `Respond with valid JSON only. No prose, no code fences.` (grep each constant's value).
    - `grep -c "structural" src/llm/prompts.ts` returns ≥3 (3 positive examples per tier, minimum).
    - `grep -c "EN_POSITIVES\|FR_POSITIVES\|RU_POSITIVES" src/decisions/triggers-fixtures.ts` returns ≥3.
    - `node -e "const f=require('./dist/decisions/triggers-fixtures.js'); if(f.EN_POSITIVES.length!==4||f.FR_POSITIVES.length!==4||f.RU_POSITIVES.length!==4) process.exit(1)"` after `npm run build` returns exit 0.
    - `grep -c "ABORT_PHRASES_EN\|ABORT_PHRASES_FR\|ABORT_PHRASES_RU" src/decisions/triggers-fixtures.ts` returns ≥3.
  </acceptance_criteria>
  <done>Prompt constants exist with JSON-only instruction; fixture arrays each have length 4 (D-03 parity holds); abort phrase arrays match D-04 exactly.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Scaffold six RED test files for Waves 1–2</name>
  <files>src/decisions/__tests__/triggers.test.ts, src/decisions/__tests__/capture.test.ts, src/decisions/__tests__/vague-validator.test.ts, src/decisions/__tests__/resolve-by.test.ts, src/decisions/__tests__/suppressions.test.ts, src/decisions/__tests__/engine-capture.test.ts</files>
  <read_first>
    - src/decisions/__tests__/capture-state.test.ts (EXACT template — beforeAll DB check, afterEach truncation, bigint chatId, dynamic imports)
    - src/decisions/__tests__/lifecycle.test.ts (how illegal-transition expectations are written)
    - .planning/phases/14-capture-flow/14-VALIDATION.md §"Per-Task Verification Map" (which test covers which requirement)
    - .planning/phases/14-capture-flow/14-RESEARCH.md §"Phase Requirements → Test Map" (behaviors per test file)
  </read_first>
  <behavior>
    Each file MUST be RED (failing meaningfully — the module-under-test does not yet exist OR behavior is unimplemented). Tests import from the yet-to-exist target modules so they fail with "module not found" OR with a throw from a stub. They become GREEN wave-by-wave.
  </behavior>
  <action>
    Create the six test files. Each file starts with the same harness as `src/decisions/__tests__/capture-state.test.ts` (vitest imports, `beforeAll`, `afterEach` truncating `decisions`, `decision_events`, `decision_capture_state`, `decision_trigger_suppressions`, `pensieve_entries`). All `it(...)` cases MUST be real assertions, not `it.todo`.

    **`triggers.test.ts` (CAP-01) — minimum cases:**
    - `it('|EN| == |FR| == |RU| == 4 in fixtures')` — import from `triggers-fixtures.ts`; assert length equality.
    - `it('detectTriggerPhrase matches each EN positive')` — loop EN_POSITIVES; `detectTriggerPhrase(p.positive)` returns non-null, includes `p.trigger_phrase` (case-insensitive).
    - Repeat for FR + RU.
    - `it('detectTriggerPhrase returns null for EN negatives')` — loop EN_NEGATIVES; assert null.
    - Repeat for FR + RU.
    - `it('classifyStakes returns trivial on timeout')` — mock Anthropic SDK to hang > 3s via `vi.mock('../../llm/client.js', ...)`; assert `classifyStakes("any text")` returns `'trivial'` within 3.5s.
    - `it('classifyStakes returns parsed tier for valid JSON response')` — mock SDK returning `{"tier":"structural"}`; assert `'structural'`.
    - `it('classifyStakes fail-closes to trivial on invalid JSON')` — mock SDK returning `not valid json`; assert `'trivial'`.

    **`capture.test.ts` (CAP-02/03/04 + LIFE-05) — minimum cases:**
    - `it('handleCapture greedy extraction fills multiple slots from one user reply')` — mocked Haiku returns multi-slot JSON; assert `draft` has all expected fields after one turn.
    - `it('3-turn cap auto-commits status=open-draft with placeholder NOT-NULL strings')` — drive 3 turns where the extractor returns empty patches; on turn 3 assert a `decisions` row exists with `status='open-draft'`, `reasoning`, `prediction`, `falsification_criterion` each containing literal `(not specified in capture)` (CONTEXT A4 placeholder resolution), and `decision_capture_state` row for that chatId is gone.
    - `it('open-draft commit goes through transitionDecision() chokepoint')` — spy on `transitionDecision`; assert called with `toStatus='open-draft'` and `expectedStatus=null`.
    - `it('language_at_capture is locked to triggering-message language across turns')` — open capture with FR triggering message; turn 2 reply in EN; assert draft.language_at_capture still `'fr'`.
    - `it('abort phrase mid-capture clears state and falls through')` — open capture; send `'never mind'`; assert `getActiveDecisionCapture(chatId)` is null.
    - `it('LIFE-05 contradiction scan fires exactly once on null→open, never on null→open-draft')` — spy on `detectContradictions`; run one full happy-path to `open`, assert called once; run one 3-turn-cap path to `open-draft`, assert NOT called.
    - `it('open-draft → open promotion path does not re-fire contradiction scan')` — spy; walk draft to `open`; assert `detectContradictions` call count stays 1 (from the promotion transition), not re-fired on subsequent turns.

    **`vague-validator.test.ts` — minimum cases:**
    - `it('validateVagueness returns acceptable for concrete observable pair')` — mocked Haiku `{verdict:"acceptable"}`.
    - `it('validateVagueness returns vague when hedge words present and Haiku agrees')` — mocked `{verdict:"vague"}`.
    - `it('validator fires only once per capture — second pass accepts regardless')` — drive two full turns through capture past FALSIFICATION slot; assert `validateVagueness` spy called once.
    - `it('second-vague landing status is open-draft not open')` — force validator → vague both times; assert final decisions row `status='open-draft'`.

    **`resolve-by.test.ts` — minimum cases:**
    - `it('parseResolveBy returns ISO for "next week"')` — mocked Haiku returns `{iso:"<+7d>"}`; assert parse returns a Date roughly now+7d (±1h tolerance).
    - `it('parseResolveBy returns null on Haiku null')` — mocked `{iso:null}`; assert returns null so caller routes to clarifier.
    - `it('clarifier fallback: user picks "a month" → +30d')` — integration via `handleCapture` delivering clarifier turn; assert committed `resolve_by ≈ now+30d`.
    - `it('silent +30d default announced in reply after double-fail')` — Haiku null on initial + on clarifier; assert returned Chris reply contains the literal string `I'll check back in a month` (or localized EN form), and committed row has `resolve_by ≈ now+30d`.

    **`suppressions.test.ts` (CAP-06) — minimum cases:**
    - `it('addSuppression persists row (trimmed + lowercased)')` — add `"  I'm Thinking About  "`; query DB; expect exactly one row with phrase `"i'm thinking about"`.
    - `it('isSuppressed(text, chatId) matches case-insensitive substring')` — add suppression; check against uppercase/different-case containing text.
    - `it('isSuppressed is scoped per chatId')` — add suppression for chatId=1n; assert `isSuppressed(text, 2n)` is false.
    - `it('adding the same phrase twice is a no-op (unique constraint)')` — add twice; assert one row.
    - `it('simulated restart preserves suppressions')` — insert; re-import module (or new `db` handle); assert still there.

    **`engine-capture.test.ts` (SWEEP-03) — minimum cases:**
    - `it('PP#0 precedes mute/refusal/language/mode when capture is active')` — seed `decision_capture_state` with a CAPTURING row; send message that would trigger mute detection (e.g., "mute for 1h"); assert `handleCapture` is reached, `detectMuteIntent` spy NOT called.
    - `it('PP#1 opens capture when structural stakes + trigger regex hit')` — fresh chat; send EN trigger phrase; mock stakes → `structural`; assert `decision_capture_state` row created with `stage='DECISION'`.
    - `it('re-trigger mid-capture is ignored (stays on current)')` — active capture; send another trigger phrase; assert no NEW `decision_capture_state` row, original still present, input routed to `handleCapture`.
    - `it('suppressed phrase skips regex evaluation')` — add suppression `"I'm thinking about"`; send that phrase; assert `classifyStakes` spy NOT called; no capture opened.
    - `it('stakes=trivial falls through without opening capture')` — trigger regex hit; mock stakes `trivial`; assert no `decision_capture_state` row; message flows to normal engine (`detectMode` spy called).

    All files use Vitest's `vi.mock()` / `vi.spyOn()` for module-under-test dependencies. Imports reference the eventual implementation paths (`../triggers.js`, `../capture.js`, `../vague-validator.js`, `../resolve-by.js`, `../suppressions.js`) — these modules don't exist yet, which is why tests are RED.
  </action>
  <verify>
    <automated>DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" npx vitest run src/decisions/__tests__/triggers.test.ts src/decisions/__tests__/capture.test.ts src/decisions/__tests__/vague-validator.test.ts src/decisions/__tests__/resolve-by.test.ts src/decisions/__tests__/suppressions.test.ts src/decisions/__tests__/engine-capture.test.ts 2>&1 | tail -30</automated>
  </verify>
  <acceptance_criteria>
    - All 6 test files exist (`ls src/decisions/__tests__/{triggers,capture,vague-validator,resolve-by,suppressions,engine-capture}.test.ts` succeeds for each).
    - Every file contains `afterEach(` + `TRUNCATE` SQL for `decisions`, `decision_events`, `decision_capture_state`, `decision_trigger_suppressions` (grep each).
    - No `it.todo`, no `it.skip` anywhere: `grep -rE "it\.(todo|skip)" src/decisions/__tests__/{triggers,capture,vague-validator,resolve-by,suppressions,engine-capture}.test.ts` returns 0.
    - Vitest run returns non-zero exit (tests are RED) AND the failures are assertion/module-resolution failures, NOT syntax errors. Verify: `npx vitest run src/decisions/__tests__/triggers.test.ts 2>&1 | grep -E "(Cannot find module|AssertionError|Expected|Error:)"` matches at least once per file.
    - `grep -c "it(" src/decisions/__tests__/triggers.test.ts` ≥ 8; `.../capture.test.ts` ≥ 7; `.../vague-validator.test.ts` ≥ 4; `.../resolve-by.test.ts` ≥ 4; `.../suppressions.test.ts` ≥ 5; `.../engine-capture.test.ts` ≥ 5.
  </acceptance_criteria>
  <done>Six test files exist with real assertions, all failing RED for meaningful reasons (missing modules / missing implementations), harness mirrors Phase 13 template, Phase 13 tests still green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Drizzle-kit generate → migration SQL | Auto-generated file checked into repo; must not expose unexpected DDL or roles |
| scripts/test.sh → psql | Local test harness only (single-user), but ensure `-v ON_ERROR_STOP=1` preserved so migration errors fail the suite |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14-01-01 | Tampering | Migration 0004 DDL | mitigate | Unique `(chat_id, phrase)` constraint in DDL prevents dedup drift exploited by later phases |
| T-14-01-02 | DoS | `ON_ERROR_STOP=1` inheritance | mitigate | New psql block mirrors existing flag exactly; migration failure fails the test suite loudly (no silent half-migrated state) |
| T-14-01-03 | Information Disclosure | Prompt constants | accept | Prompts contain generic domain examples (work/relationships/finances) with no user-specific PII; shipped as static strings |
</threat_model>

<verification>
- `npm test` runs migration 0004 cleanly; all Phase 13 tests remain GREEN.
- Six new test files are RED with meaningful errors (missing modules).
- Fixture parity holds: `|EN_POSITIVES| == |FR_POSITIVES| == |RU_POSITIVES| == 4`.
- Prompt constants exported and each ends in the JSON-only instruction.
</verification>

<success_criteria>
All three tasks pass their acceptance_criteria. Wave 1 can start with guaranteed: (a) live DB schema, (b) shared fixture + prompt constants, (c) RED tests waiting to be turned GREEN.
</success_criteria>

<output>
After completion, create `.planning/phases/14-capture-flow/14-01-SUMMARY.md`.
</output>
