# Phase 26: Daily Voice Note Ritual — Context

**Gathered:** 2026-04-26
**Status:** Ready for planning
**Mode:** `--auto` (recommended defaults auto-selected for each gray area)

<domain>
## Phase Boundary

Phase 26 ships the **first real ritual** of v2.4 M009 on top of Phase 25's substrate. After this phase, Greg gets a 21:00 Europe/Paris evening Telegram message with one of 6 rotating prompts, dictates an answer via the Android STT keyboard, and his free-text reply lands in `pensieve_entries` tagged `RITUAL_RESPONSE` with `metadata.source_subtype = 'ritual_voice_note'` — and Chris generates ZERO chat response. The phase exercises the highest-risk integration point in the milestone (PP#5 ritual-response detector at engine position 0). Migration 0007 inserts the seed `daily_voice_note` row into `rituals` with the v1 prompt set, shuffled-bag rotation state, 21:00 Paris fire time, and 3-arg `computeNextRunAt` cadence advancement. The voice-note handler replaces Plan 25-03's `dispatchRitualHandler` "not implemented" throw for the `daily_voice_note` ritual name. A `bot.on('message:voice')` polite-decline handler (~10 LOC, EN/FR/RU per `franc`) prevents silent drops when Greg sends an actual Telegram voice message instead of typing via STT.

**In scope (6 requirements):**
- VOICE-01 — PP#5 ritual-response detector at engine position 0 (BEFORE PP#0); `ritual_pending_responses` lookup by chat-id within `RESPONSE_WINDOW_HOURS` (default 18); on hit, write Pensieve entry as `RITUAL_RESPONSE` with `metadata.source_subtype = 'ritual_voice_note'`, return empty string, IN-02 silent-skip
- VOICE-02 — 6 rotating prompts in spec order in `src/rituals/voice-note.ts` with `PROMPT_SET_VERSION = 'v1'`
- VOICE-03 — Shuffled-bag rotation via `rituals.config.prompt_bag: number[]`; property-test verifiable (600 fires = ~100 each, no consecutive dupes, max gap ≤ 11)
- VOICE-04 — 21:00 Europe/Paris default fire (configurable via `rituals.config.fire_at`); pre-fire suppression: if ≥5 telegram JOURNAL-mode entries already today, skip fire and advance `next_run_at` to tomorrow without incrementing skip_count (`system_suppressed` outcome)
- VOICE-05 — `bot.on('message:voice')` polite-decline handler (~10 LOC) — replies in EN/FR/RU per `franc` detection on the user's last text message language; suggests Android STT keyboard mic icon; does NOT transcribe via Whisper
- VOICE-06 — STT filler tagging — `metadata.source_subtype = 'ritual_voice_note'` set on every Pensieve entry written by the PP#5 detector

**Out of scope (deferred to later phases or upstream):**
- Wellbeing snapshot ritual + inline keyboard + callback_query (Phase 27)
- Skip-tracking discriminated outcome union + adjustment dialogue + 30-day pause (Phase 28; Phase 26 only emits the `system_suppressed` outcome for VOICE-04, no skip_count increment)
- Weekly review handler + Sonnet generation + two-stage single-question enforcement + `CONSTITUTIONAL_PREAMBLE` injection (Phase 29)
- 14-day primed-fixture integration test + cron-registration regression test + live anti-flattery test (Phase 30)
- HARN-04..06 fixture refresh (Phase 30)
- Server-side Whisper transcription (OOS-3 PLAN.md anti-feature)
- Free-text custom prompts via Haiku (OOS-10 anti-feature)

</domain>

<decisions>
## Implementation Decisions

### Migration 0007 — voice note seed insert (D-26-01)

**D-26-01:** **New migration `0007_daily_voice_note_seed.sql`** inserts the seed `daily_voice_note` row into `rituals` (RIT-09 substrate already shipped the table in Phase 25 / migration 0006). Phase 25 Open Q1 RESOLVED: Phases 26 / 27 / 29 own their respective ritual seed inserts in their own migrations.

- **Migration filename:** `0007_daily_voice_note_seed.sql` (next slot after `0006_rituals_wellbeing.sql`).
- **Hand-authored SQL** with idempotency guards (`INSERT ... ON CONFLICT (name) DO NOTHING`) — re-running against a populated DB is a no-op. Rationale: matches Plan 25-01 D-25-01-A hybrid hand-SQL + drizzle-snapshot pattern; `INSERT INTO ... SELECT` with a literal jsonb config is not auto-generatable from `schema.ts` (drizzle-kit doesn't model row inserts).
- **Seed shape:**
  ```sql
  INSERT INTO rituals (name, type, next_run_at, enabled, config)
  VALUES (
    'daily_voice_note',
    'daily',
    -- next 21:00 Europe/Paris from migration timestamp; computed via SQL because
    -- migrations have no Luxon access. Fallback: a fixed near-future timestamp;
    -- first cron tick will recompute via computeNextRunAt regardless.
    (date_trunc('day', now() AT TIME ZONE 'Europe/Paris')
       + interval '1 day'
       + interval '21 hours') AT TIME ZONE 'Europe/Paris',
    true,
    '{
      "fire_at": "21:00",
      "prompt_bag": [],
      "skip_threshold": 3,
      "mute_until": null,
      "time_zone": "Europe/Paris",
      "prompt_set_version": "v1",
      "schema_version": 1
    }'::jsonb
  )
  ON CONFLICT (name) DO NOTHING;
  ```
- **Drizzle meta-snapshot regeneration:** `scripts/regen-snapshots.sh` invocation (mirrors Plan 25-01 D-25-01-A pattern) regenerates `meta/0007_snapshot.json` + appends `_journal.json` entry. The seed insert is idempotent so re-application via `scripts/test.sh` raw-psql path doesn't produce duplicates.
- **`scripts/test.sh` extension:** add psql line confirming the seed row exists post-migration: `psql ... -c "SELECT 1 FROM rituals WHERE name = 'daily_voice_note' LIMIT 1"` exits 0 and matches expected single row. Mirrors Plan 25-01's `6|1|3` substrate gate shape.
- **Rejected alternative — fold seed into 0006_rituals_wellbeing.sql:** Rejected because Phase 25 already shipped 0006 (committed); modifying a shipped migration breaks the lineage invariant (TECH-DEBT-19-01 class). New migration slot is the right call.
- **Rejected alternative — runtime seed via app boot:** Considered (idempotent INSERT in `src/index.ts:main()` after `runMigrations`), rejected because seeding-via-app-boot is a per-environment hidden side effect and complicates `scripts/manual-sweep.ts` testability (which expects rituals to exist after `runMigrations`). SQL migration is the explicit, reproducible mechanism.

### PP#5 implementation: position, query shape, return path (D-26-02)

**D-26-02:** **PP#5 ritual-response detector lives at the absolute top of `processMessage` body in `src/chris/engine.ts`**, BEFORE the existing PP#0 active-decision-capture block (currently at lines ~166-217). It queries `ritual_pending_responses` by chat_id, takes the most-recent non-consumed row whose `expires_at > now()`, and on a hit:

1. Writes a Pensieve entry via `storePensieveEntry(text, 'telegram', { source_subtype: 'ritual_voice_note', ritual_id, ritual_pending_response_id })`. The `epistemic_tag = 'RITUAL_RESPONSE'` is written via a new direct-tag code path (NOT the Haiku auto-tagger — see D-26-03).
2. Updates the `ritual_pending_responses` row: `consumed_at = now()`. Mutual-exclusion enforced by `WHERE consumed_at IS NULL` predicate (atomic UPDATE so a concurrent message in the same tick can't double-consume).
3. Inserts a `ritual_responses` row linking the Pensieve entry id back to the ritual + fire timestamp (so longitudinal queries can follow the prompt → response → Pensieve chain).
4. **Returns empty string** from `processMessage` — `handleTextMessage`'s existing IN-02 silent-skip path (`src/bot/bot.ts:54` `if (response) await ctx.reply(response);`) treats empty as "no reply". No `saveMessage` call (the ritual response belongs in Pensieve, NOT in conversation history — mirrors how AWAITING_RESOLUTION skips conversation save).
5. Crucially, the function **returns BEFORE** PP#0 capture lookup, PP#1 trigger detection, mute, refusal, language detection, mode detection, and any LLM call. Cumulative `expect(mockAnthropicCreate).not.toHaveBeenCalled()` regression test (Pitfall 6 + Pitfall 24) is the empirical proof.

- **`RESPONSE_WINDOW_HOURS = 18`** (default) as `SCREAMING_SNAKE_CASE` constant at top of `src/rituals/voice-note.ts`. `expires_at` is set by the fire-side handler to `firedAt + RESPONSE_WINDOW_HOURS * 3600 * 1000`. Tunable per OPEN-1 in research SUMMARY — defensible 12h/18h/24h/36h range, revisit after 30 days of real use with skip-tracking telemetry.
- **Query shape:** `SELECT id, ritual_id, fired_at, expires_at FROM ritual_pending_responses WHERE chat_id = $1 AND consumed_at IS NULL AND expires_at > $2 ORDER BY fired_at DESC LIMIT 1`. Indexed lookup — Phase 26 adds a `(chat_id, consumed_at, expires_at)` composite index in migration 0007 so PP#5's hot-path query is index-only. Worst case (chat with hundreds of responses over years) still <1ms.
- **Index addition in migration 0007:** `CREATE INDEX IF NOT EXISTS ritual_pending_responses_chat_id_active_idx ON ritual_pending_responses (chat_id, expires_at) WHERE consumed_at IS NULL;` — partial index on active rows only (mirrors Plan 25-01 D34 partial-index precedent for `rituals_next_run_at_enabled_idx`).
- **HARD CO-LOCATION #1 ENFORCED:** PP#5 detector + voice note handler ship in the SAME plan (Plan 26-02). Splitting them = Pitfall 6 regression.
- **Rejected alternative — PP#5 between PP#0 and PP#1:** Rejected because a stale capture state from a previous unrelated decision flow could hijack a ritual response. PP#5 must be position 0 (per research ARCHITECTURE.md §3 + spec interpretation locked at v2.4 kickoff).
- **Rejected alternative — text-heuristic detection (no DB lookup):** Rejected per Pitfall 6 mitigation — state-table lookup is the load-bearing invariant. Heuristics on the message text would conflate organic JOURNAL deposits with ritual responses.
- **Rejected alternative — separate handler bypassing `processMessage`:** Considered routing voice-note responses through a separate `bot.on('message:text')` registered first. Rejected because Pitfall 24 (Phase 14 mock-chain regression class) explicitly forbids it: ritual response must flow through the same `processMessage` pipeline that the 14-day fixture tests; a separate handler creates the Pitfall 24 false-coverage trap.

### Direct-tag write path for `RITUAL_RESPONSE` (D-26-03)

**D-26-03:** **Add an explicit `epistemicTag` parameter to `storePensieveEntry`** so the PP#5 detector can write the entry with `epistemic_tag = 'RITUAL_RESPONSE'` directly, bypassing the Haiku auto-tagger entirely. The auto-tagger (`src/pensieve/tagger.ts`) would otherwise classify ritual responses into one of the 12 organic tags and overwrite the explicit ritual classification.

- **API change:** `storePensieveEntry(content, source, metadata?, opts?: { epistemicTag?: typeof epistemicTagEnum.enumValues[number] })`. Backward-compatible — existing callers omit `opts`. PP#5 passes `{ epistemicTag: 'RITUAL_RESPONSE' }`.
- **Why not metadata flag (`metadata.preTagged: true`):** Considered but rejected — metadata flags are Pensieve-internal hints, not explicit type declarations. Adding `epistemicTag` to the function signature makes the contract explicit at the call site and type-checked by TypeScript.
- **Tagger interaction:** PP#5 does NOT invoke `tagEntry` after writing the entry (the entry already has its tag). Future fire-and-forget `tagEntry` calls in retrieval paths are a non-issue because they only run on entries with `epistemic_tag IS NULL` (verified by reading `src/pensieve/tagger.ts` lines ~80-85 update `WHERE` predicate).
- **HARD CO-LOCATION #5 ENFORCED:** Mock-chain coverage update (engine.test.ts + new ritual-response handler test family) ships in the SAME plan as PP#5 introduction (Plan 26-02). Splitting = v2.0/v2.1 Phase 14 mock-chain regression repeats (Pitfall 24).
- **Rejected alternative — write entry with `epistemic_tag = NULL` then update via tagEntry:** Rejected because there's a window where the entry exists with NULL tag and might be misclassified by background retrieval; explicit tag at insert is the safer contract.

### Plan split structure (4 plans) (D-26-04)

**D-26-04:** **4 plans** for Phase 26, partitioned by HARD CO-LOCATION constraints + surface cleavage. Total estimated LoC ~450, in line with milestone research.

- **Plan 26-01 — Migration 0007 + voice-note constants module (substrate):** `0007_daily_voice_note_seed.sql` with seed insert + `ritual_pending_responses_chat_id_active_idx` partial index; drizzle meta-snapshot regenerated via `scripts/regen-snapshots.sh`; `scripts/test.sh` extended with seed-row assertion. NEW `src/rituals/voice-note.ts` module with `PROMPTS` ordered array (6 strings, spec order, frozen), `PROMPT_SET_VERSION = 'v1'` constant, `RESPONSE_WINDOW_HOURS = 18` constant, **and** the pure shuffled-bag rotation function `chooseNextPromptIndex(currentBag: number[]): { index: number; newBag: number[] }` with property-test coverage (600 fires, distribution / no-consecutive-dupes / max-gap invariants per VOICE-03). NO handler logic, NO bot wiring, NO engine edit. **Requirements: VOICE-02, VOICE-03 (rotation primitive only).** ~120 LoC + ~80 LoC test.

- **Plan 26-02 — Voice note handler + PP#5 detector + mock-chain coverage update (HARD CO-LOC #1 + #5 enforced atomically):** `fireVoiceNote(ritual, cfg, deps)` in `src/rituals/voice-note.ts` — pops next prompt from bag, sends Telegram message via `bot.api.sendMessage`, inserts `ritual_pending_responses` row (chatId from `config.telegramAuthorizedUserId`, expiresAt = now + 18h), writes back updated bag to `rituals.config.prompt_bag`. Wire `dispatchRitualHandler` in `src/rituals/scheduler.ts` to dispatch `daily_voice_note` (by `ritual.name`) to `fireVoiceNote` — REPLACES the Phase 25 "not implemented" throw for that ritual name only. **Add the `epistemicTag` parameter to `storePensieveEntry`** (D-26-03 API change). **Insert PP#5 ritual-response detector at position 0 of `processMessage`** in `src/chris/engine.ts` — looks up `ritual_pending_responses` by chat_id, on hit calls `recordRitualVoiceResponse(pendingRow, chatId, text)` (new helper in `src/rituals/voice-note.ts`) which writes Pensieve entry with `RITUAL_RESPONSE` tag + `source_subtype = 'ritual_voice_note'` (VOICE-06), inserts `ritual_responses` row linking back, marks `ritual_pending_responses.consumed_at = now()` atomically, then returns empty string from `processMessage`. **Mock-chain coverage update** in `src/chris/__tests__/engine.test.ts` + `engine-mute.test.ts` + `engine-refusal.test.ts` (the existing engine test family) — add `vi.mock('../../rituals/voice-note.js', ...)` chain stubs so PP#5's new call site doesn't break existing tests with mock-chain failures (v2.0/v2.1 Phase 14 regression class). New test file `src/chris/__tests__/engine-pp5.test.ts` asserts the cumulative `expect(mockAnthropicCreate).not.toHaveBeenCalled()` regression contract end-to-end (Pitfall 6 + Pitfall 24). **Requirements: VOICE-01, VOICE-02 (handler usage), VOICE-03 (handler usage), VOICE-06.** ~250 LoC + ~150 LoC test.

- **Plan 26-03 — Pre-fire suppression (VOICE-04):** Add the pre-fire suppression check to `fireVoiceNote` (or extracted helper `shouldSuppressVoiceNoteFire(now)`): query `SELECT COUNT(*) FROM pensieve_entries WHERE source = 'telegram' AND created_at >= today_start_local AND metadata->>'mode' = 'JOURNAL'` (count using `dayBoundaryUtc` from `src/episodic/sources.ts` to compute the local-Paris day start). If count ≥ `RITUAL_SUPPRESS_DEPOSIT_THRESHOLD` (default 5) — skip the fire, emit `system_suppressed` outcome (Phase 28 will formalize the discriminated union; Phase 26 just adds the literal as a string-typed peer to existing outcomes), do NOT increment `skip_count`, advance `next_run_at` to tomorrow's 21:00 Paris via `computeNextRunAt(now, 'daily', config)`. Real-DB integration test simulates 5 JOURNAL-mode entries on same date + asserts suppression behavior. Configurability: `RITUAL_SUPPRESS_DEPOSIT_THRESHOLD` is a module-scope `SCREAMING_SNAKE_CASE` constant — not yet promoted to `rituals.config` (deferred per Pitfall 9 mention of `config.suppress_if_deposits_above`; Phase 28's adjustment dialogue will surface it for tuning). **Requirements: VOICE-04.** ~80 LoC + ~80 LoC test.

- **Plan 26-04 — Polite-decline voice handler (VOICE-05):** Register `bot.on('message:voice', handleVoiceMessageDecline)` in `src/bot/bot.ts` (alongside existing `bot.on('message:text', ...)` and `bot.on('message:document', ...)`). Handler in `src/bot/handlers/voice-decline.ts` (~30 LoC): detect language via `getLastUserLanguage(chatId.toString())` (re-use existing language tracker from `src/chris/language.ts` — `franc` is already a dep, no version bump), reply in EN/FR/RU with templated message suggesting Android STT keyboard mic icon. **No transcription, no Whisper.** Handler test asserts the right language is selected per stored `lastLanguage`, asserts no Pensieve write, asserts no `processMessage` call. **Requirements: VOICE-05.** ~50 LoC + ~80 LoC test.

- **Rejected alternative — 3 plans collapsing PP#5 + suppression + handler:** Rejected. The suppression check (VOICE-04) is independent of the deposit-only contract (VOICE-01); landing them in the same plan creates a >8-file plan harder to review and forces the suppression test to depend on the PP#5 mock chain. Splitting reduces blast radius without violating any HARD CO-LOC.
- **Rejected alternative — 5 plans extracting prompt-rotation primitive into its own plan:** Rejected. The shuffled-bag function is ~30 LoC of pure logic + property test; it's the natural co-tenant of the seed migration (both establish the static substrate). Promoting it to its own plan adds boundary cost for no reduction in risk.
- **Rejected alternative — bundle voice-decline handler with PP#5 plan:** Rejected. The polite-decline handler is independent of the PP#5 deposit pipeline (it's `message:voice` not `message:text`); bundling expands Plan 26-02's surface unnecessarily and risks Plan 26-02 timeout.

### Pre-fire suppression: query mechanism (D-26-05)

**D-26-05:** **Use `dayBoundaryUtc` from `src/episodic/sources.ts` to compute the local-Paris day-start UTC instant**, then query `pensieve_entries` directly for telegram-source JOURNAL-mode rows since that instant. Threshold = 5 (matches Pitfall 9 default).

- **Mechanism:**
  ```typescript
  const dayStart = dayBoundaryUtc(now, config.proactiveTimezone, 'start');  // existing helper
  const [{ count }] = await db.select({ count: sql<number>`COUNT(*)::int` })
    .from(pensieveEntries)
    .where(and(
      eq(pensieveEntries.source, 'telegram'),
      gte(pensieveEntries.createdAt, dayStart),
      sql`metadata->>'mode' = 'JOURNAL'`,
    ));
  return count >= RITUAL_SUPPRESS_DEPOSIT_THRESHOLD;
  ```
- **Why query Pensieve directly (not `conversations` table):** `conversations` records both USER and ASSISTANT roles + has `mode` enum column. The Pensieve `metadata.mode` field is set by the Pensieve writer based on the originating engine path; for JOURNAL-mode user messages, the writer puts `mode: 'JOURNAL'` into metadata. Pensieve is the authoritative store (D035) and the right query target. Verified shape via grep `metadata.*mode` in existing handlers.
- **Rejected alternative — count `conversations.role = 'USER' AND mode = 'JOURNAL'`:** Considered for symmetry with Pitfall 9 phrasing, rejected because conversations is a transient relational store tied to chat lifecycle while Pensieve persists ritually-relevant deposits. Counting Pensieve entries matches Pitfall 9's mitigation language ("≥5 deposits today").
- **Rejected alternative — count `ritual_responses` rows fired today:** Rejected — that counts ritual fires, not user deposits. Pitfall 9 specifically targets days when Greg has been heavily journaling outside the ritual.

### Outcome shape for VOICE-04 suppression (D-26-06)

**D-26-06:** **Phase 26 ships the `'system_suppressed'` outcome as a string literal extension to the existing `RitualFireOutcome` union in `src/rituals/types.ts`**. Phase 28 will formalize the discriminated `RitualFireOutcome` union (SKIP-01); Phase 26 just appends `'system_suppressed'` as a peer to `'fired' | 'caught_up' | 'muted' | 'race_lost' | 'in_dialogue' | 'config_invalid'`.

- **Why now and not Phase 28:** VOICE-04 demands `system_suppressed` semantics in Phase 26 (success criterion 3 in ROADMAP §Phase 26). Waiting until Phase 28 leaves Phase 26 with no clean outcome string for the suppression case. Adding the literal now is forward-compatible — Phase 28 just enriches the union with discriminator fields if needed (per SKIP-01 spec).
- **Phase 28 boundary:** Phase 28 is responsible for the `ritual_fire_events` append-only log + `skip_count` increment-only-on-`fired_no_response` semantics. Phase 26 does NOT write to `ritual_fire_events` (Phase 28 will retrofit the call sites to log every outcome including `'system_suppressed'`).
- **Skip count discipline:** Phase 26 NEVER increments `skip_count` for `system_suppressed`. Phase 26 also doesn't increment for `caught_up` or `race_lost` (already true in Plan 25-03 — `tryFireRitualAtomic` doesn't touch skip_count; the count rebuild from events lives in Phase 28).

### Mock-chain test family update scope (D-26-07)

**D-26-07:** **Update mock chains in `src/chris/__tests__/engine.test.ts`, `engine-mute.test.ts`, and `engine-refusal.test.ts`** as part of Plan 26-02 (HARD CO-LOC #5). Phase 14 (v2.1) regression class precedent: when adding a new call site to `engine.ts`, every existing engine test file must update its mock chain to cover the new module imports (`vi.mock('../../rituals/voice-note.js')` chain stubs returning empty/null pending lookups so existing tests still see the no-pending path).

- **Files updated:**
  - `engine.test.ts` — add `vi.mock('../../rituals/voice-note.js')` with `findActivePendingResponse` returning `null` by default; existing mode-detection tests are unaffected because PP#5 falls through.
  - `engine-mute.test.ts` — same mock; mute tests run after PP#5 falls through (no pending response).
  - `engine-refusal.test.ts` — same mock; refusal tests run after PP#5 falls through.
  - `boundary-audit.test.ts` — verify it doesn't import `engine.ts` transitively (if it does, add the mock).
- **New test file:** `src/chris/__tests__/engine-pp5.test.ts` — REAL-DB integration test (mirrors `src/rituals/__tests__/idempotency.test.ts` pattern from Plan 25-02) asserting the full pipeline:
  1. Insert ritual + ritual_pending_responses rows directly via Drizzle.
  2. Spy on `mockAnthropicCreate` (Anthropic client mock).
  3. Call `processMessage(chatId, userId, "today was about the team meeting")`.
  4. Assert returned string === ''.
  5. Assert `expect(mockAnthropicCreate).not.toHaveBeenCalled()` cumulative.
  6. Assert exactly 1 row in `pensieve_entries` with `epistemic_tag = 'RITUAL_RESPONSE'` AND `metadata->>'source_subtype' = 'ritual_voice_note'`.
  7. Assert `ritual_pending_responses.consumed_at IS NOT NULL` post-call.
- **Cumulative regression contract:** the `not.toHaveBeenCalled()` assertion is the load-bearing contract per Pitfall 6 mitigation. Re-asserting at the END of the test (afterAll-style) catches any branch that accidentally invokes Sonnet or Haiku.
- **Rejected alternative — only mock-update in engine.test.ts:** Rejected because v2.1 Phase 14 specifically failed by leaving sibling test files with stale mocks; HARD CO-LOC #5 demands the full family update.

### Dispatch keying: `ritual.name` vs `ritual.type` (D-26-08)

**D-26-08:** **Dispatch in `dispatchRitualHandler` keys on `ritual.name`** (e.g. `'daily_voice_note'`), NOT on `ritual.type` (which is the cadence enum: `'daily'|'weekly'|'monthly'|'quarterly'`). The Phase 25 skeleton's "not implemented for ${ritual.type}" message is misleading — `ritual.type` is the cadence, multiple rituals share the same cadence.

- **Concrete shape:**
  ```typescript
  async function dispatchRitualHandler(ritual): Promise<void> {
    switch (ritual.name) {
      case 'daily_voice_note':
        return fireVoiceNote(ritual, parseRitualConfig(ritual.config));
      // future Phases 27, 29:
      // case 'daily_wellbeing': return fireWellbeing(ritual, cfg);
      // case 'weekly_review':   return fireWeeklyReview(ritual, cfg);
      default:
        throw new Error(`rituals.dispatch: handler not implemented for ${ritual.name}`);
    }
  }
  ```
- **Rationale:** The `rituals.name` UNIQUE constraint (Phase 25 schema) makes name a reliable dispatch key; cadence is a behavioral property not a routing property. This aligns with the seed-migration design (each phase seeds its own named ritual row).
- **Rejected alternative — add a `kind` column to `rituals` table:** Rejected. `name` is already UNIQUE and serves the routing purpose. Adding `kind` would denormalize without value (RIT-01 already locked the column set via Phase 25 D-08).

### Voice-decline handler language source (D-26-09)

**D-26-09:** **Use `getLastUserLanguage(chatId.toString())` from `src/chris/language.ts`** as the language source for the polite-decline message. Do NOT run `franc` against the voice message itself (voice messages have no text to detect).

- **Mechanism:** `getLastUserLanguage` returns `'English' | 'French' | 'Russian' | null` per existing M006 stickiness contract. Map to `'en'|'fr'|'ru'` for response template. If `null` (first interaction is a voice message), default to English.
- **Templated messages:**
  - EN: "I can only read text messages — try the microphone icon on your Android keyboard to dictate."
  - FR: "Je ne lis que les messages texte — essaie l'icône micro de ton clavier Android pour dicter."
  - RU: "Я понимаю только текстовые сообщения — попробуй значок микрофона на клавиатуре Android для диктовки."
- **No `franc` invocation:** Voice messages contain no text to feed to `franc`. The spec language ("`franc` detection on user's last text message") is honored by reading the language stored from the user's PRIOR text messages (which is exactly what `getLastUserLanguage` returns — populated by PP#4 in `processMessage`).
- **Rejected alternative — Whisper transcribe + franc on transcript:** Rejected per OOS-3 PLAN.md anti-feature (server-side Whisper transcription).
- **Rejected alternative — always reply in English:** Rejected — Greg writes in EN/FR/RU and would notice an English-only reply as a regression vs M006 multilingual support.

### Claude's Discretion

- **Exact file names:** `src/rituals/voice-note.ts` (single module, not split into separate `prompt-rotation.ts`); `src/bot/handlers/voice-decline.ts`; `src/chris/__tests__/engine-pp5.test.ts`; `src/rituals/__tests__/voice-note.test.ts` + `voice-note-suppression.test.ts`.
- **Exact log-event names:** planner picks per `rituals.fire.*` precedent — recommended: `rituals.voice_note.fired`, `rituals.voice_note.suppressed`, `chris.engine.pp5.hit`, `chris.engine.pp5.miss`, `bot.voice.declined`.
- **Index name in migration 0007:** `ritual_pending_responses_chat_id_active_idx` (planner verifies against existing naming convention in `src/db/migrations/0006_rituals_wellbeing.sql:108-110`).
- **`recordRitualVoiceResponse` exact return type and error handling:** planner picks; recommend returning `{ pensieveEntryId: string; consumedAt: Date }` for traceability and throwing `StorageError` on Pensieve write failure (the engine PP#5 catches and falls through to normal pipeline — better to deposit-as-JOURNAL than to lose the message).
- **Test data approach:** Plans 26-01..26-04 don't need primed fixtures — substrate-only. The 14-day primed-fixture integration test is Phase 30. PP#5 unit/integration tests in Plan 26-02 use real Docker postgres (real-DB pattern from Plan 25-02 idempotency.test.ts).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone-level research (the bedrock for Phase 26)
- `.planning/research/SUMMARY.md` — TS-1..TS-3c voice note features; HARD CO-LOC #1 + #5 verbatim; Disagreement #5 (shuffled-bag rotation) + #8 (voice message handling). **Read first.**
- `.planning/research/PITFALLS.md` — Pitfall 6 (engine responds to ritual voice note, CRITICAL), Pitfall 7 (prompt rotation stuck), Pitfall 8 (STT filler tagging), Pitfall 9 (pre-fire suppression), Pitfall 24 (mock-chain coverage). All five inform Phase 26 plans.
- `.planning/research/ARCHITECTURE.md` — §3 Daily voice note handler & PP#-1 problem (note: research uses "PP#-1" naming; spec/CONTEXT use "PP#5" — same concept, position 0). Section 3 has the canonical shape including SQL query and concrete engine.ts insertion point.
- `.planning/research/STACK.md` — Confirms `franc` is installed (zero version bump for VOICE-05).
- `.planning/research/FEATURES.md` — TS-1..TS-3c expected features list.

### Roadmap + requirements
- `.planning/ROADMAP.md` §Phase 26 — Goal, requirements list, HARD CO-LOC #1 + #5, 4 success criteria. **Authoritative scope.**
- `.planning/REQUIREMENTS.md` — VOICE-01..06 verbatim.
- `.planning/STATE.md` — Current position, "Spec interpretations locked at v2.4 kickoff" #4 (voice message polite-decline, no Whisper) and #5 (shuffled-bag rotation), accumulated context.

### Project plan + decisions
- `PLAN.md` — Project Chris implementation plan; Key Decisions D004 (append-only Pensieve), D026 (wellbeing separate from voice note — informs Phase 27), D031 (boundary marker pattern), D035 (Pensieve authoritative), D041 (primed-fixture pipeline supersedes calendar-time waits).

### Codebase intel (subset relevant to Phase 26)
- `.planning/codebase/ARCHITECTURE.md` §engine.ts — pre-processor ordering (PP#0 capture, PP#1 trigger, mute, refusal, language); IN-02 silent-skip pattern at `src/bot/bot.ts:54`.
- `.planning/codebase/CONVENTIONS.md` — TypeScript strict ESM, `.js` suffix imports, kebab-case files, SCREAMING_SNAKE_CASE constants, box-drawing section dividers.
- `.planning/codebase/TESTING.md` — Real-DB pattern for concurrency / persistence tests (Plan 25-02 precedent); vitest-4 fork-IPC hang exclusion list (M009 new test files must avoid the hang).

### Phase 25 LEARNINGS to inherit
- `.planning/phases/25-ritual-scheduling-foundation-process-gate/25-LEARNINGS.md` — Hybrid hand-SQL + drizzle-snapshot pattern (D-25-01-A) for migration 0007; real-postgres concurrency tests (D-25-02-A); ESM entry-point guard pattern; scope-reduction failure mode (planner cannot amend CONTEXT.md inline); honest-docstring vs grep-guard tension.
- `.planning/phases/25-ritual-scheduling-foundation-process-gate/25-CONTEXT.md` — D-04 (3/day channel ceiling — relevant because voice note is one of the 3 rituals counted), D-09 (3-arg `computeNextRunAt(now, cadence, config)` signature), D-08 (regen-snapshots.sh extension pattern for migration 0007).
- `.planning/phases/25-ritual-scheduling-foundation-process-gate/25-RESEARCH.md` §1 — SQL specifics for migration 0006 inform 0007's seed-insert SQL shape; §6 atomic UPDATE pattern is reused implicitly by `tryFireRitualAtomic` from Phase 25.

### Source files Phase 26 reads or modifies (full paths)
- `src/chris/engine.ts` — PP#5 inserted at top of `processMessage` body (BEFORE PP#0 currently at lines ~166).
- `src/bot/bot.ts` — Add `bot.on('message:voice', handleVoiceMessageDecline)` registration (peer to existing `message:text` + `message:document`).
- `src/bot/handlers/` — NEW `voice-decline.ts` handler.
- `src/rituals/scheduler.ts` — `dispatchRitualHandler` switch updated to route `daily_voice_note` to `fireVoiceNote` (REPLACES the throwing skeleton for that name).
- `src/rituals/voice-note.ts` — NEW module; owns PROMPTS array, PROMPT_SET_VERSION, RESPONSE_WINDOW_HOURS, RITUAL_SUPPRESS_DEPOSIT_THRESHOLD constants; `fireVoiceNote` handler; `chooseNextPromptIndex` rotation primitive; `recordRitualVoiceResponse` deposit helper; `findActivePendingResponse` PP#5 query helper; `shouldSuppressVoiceNoteFire` suppression helper.
- `src/rituals/types.ts` — Append `'system_suppressed'` to `RitualFireOutcome` union (D-26-06).
- `src/pensieve/store.ts` — Add `epistemicTag` parameter to `storePensieveEntry` signature (D-26-03).
- `src/db/migrations/0007_daily_voice_note_seed.sql` — NEW migration: seed insert + partial index on `ritual_pending_responses(chat_id, expires_at) WHERE consumed_at IS NULL`.
- `src/db/migrations/meta/0007_snapshot.json` — Regenerated via `scripts/regen-snapshots.sh`.
- `scripts/test.sh` — Add psql line confirming seed row exists post-migration.
- `scripts/regen-snapshots.sh` — Extend hardcoded loop to include 0007 (mirrors Plan 25-01 D-25-01-A extension).
- `src/chris/__tests__/engine.test.ts` + `engine-mute.test.ts` + `engine-refusal.test.ts` — Mock-chain updates (D-26-07, HARD CO-LOC #5).
- `src/chris/__tests__/engine-pp5.test.ts` — NEW real-DB integration test (Pitfall 6 + 24 regression contract).
- `src/rituals/__tests__/voice-note.test.ts` + `voice-note-suppression.test.ts` + `prompt-rotation-property.test.ts` — NEW test files.
- `src/bot/handlers/__tests__/voice-decline.test.ts` — NEW handler test.
- `src/chris/language.ts` — `getLastUserLanguage` re-used by voice-decline handler (no changes).
- `src/episodic/sources.ts` — `dayBoundaryUtc` re-used by suppression check (no changes).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/episodic/sources.ts` `dayBoundaryUtc` Luxon helper** — used by Plan 26-03 suppression check to compute local-Paris day-start UTC. Don't reinvent.
- **`src/chris/language.ts` `getLastUserLanguage` + `franc`** — `franc` already installed (verified via `package.json` `"franc": "^6.2.0"`). Voice-decline handler reads from existing language tracker; no new dep.
- **`src/bot/bot.ts:54` IN-02 silent-skip pattern** — `if (response) await ctx.reply(response);` already implements PP#5's "return empty string → no reply" contract. PP#5 doesn't need new bot wiring for the silent-skip path.
- **`src/rituals/scheduler.ts` `dispatchRitualHandler`** — Phase 25 skeleton throws "not implemented for ${ritual.type}". Plan 26-02 replaces with name-keyed switch; the `daily_voice_note` case is the first real handler dispatch.
- **`src/rituals/types.ts` `RitualFireOutcome` union + `RitualConfigSchema`** — Phase 25 substrate. Plan 26-03 appends `'system_suppressed'` literal; no schema change needed (`config.prompt_bag` already declared in `RitualConfigSchema`).
- **`src/rituals/cadence.ts` `computeNextRunAt(now, cadence, config)` (3-arg per D-09)** — Plan 26-03 calls it with `'daily'` to advance `next_run_at` to tomorrow's 21:00 Paris.
- **`src/rituals/idempotency.ts` `tryFireRitualAtomic`** — already invoked by Phase 25 `runRitualSweep`; Plan 26-02 doesn't re-invoke it (the sweep's atomic UPDATE happens BEFORE handler dispatch). Suppression in Plan 26-03 needs to advance `next_run_at` to tomorrow without firing — this happens inside the handler via direct `db.update(rituals).set({ nextRunAt }).where(...)` since the sweep already advanced it once; on suppression we re-advance further to tomorrow.
- **`src/pensieve/store.ts` `storePensieveEntry`** — Plan 26-02 adds `epistemicTag` parameter (additive, backward-compat; existing 4 call sites pass through unchanged).
- **`scripts/regen-snapshots.sh` clean-slate replay** — Plan 26-01 invokes for 0007 meta-snapshot regeneration. Phase 25 surprised on `pipefail` SIGPIPE bug (`yes '' | drizzle-kit introspect` → exit 141); the fix `</dev/null` redirect is already in the script (verified post-Phase 25).
- **Real-DB test pattern from `src/rituals/__tests__/idempotency.test.ts` (Plan 25-02)** — Plan 26-02's engine-pp5.test.ts mirrors: connect to Docker postgres on port 5434, insert seed rows directly via Drizzle, run `processMessage` against real DB.

### Established Patterns
- **`.js` suffix on every internal import** — non-negotiable; Drizzle/Luxon/Zod/franc stay bare.
- **SCREAMING_SNAKE_CASE for tunables at module top** — `RESPONSE_WINDOW_HOURS`, `PROMPT_SET_VERSION`, `RITUAL_SUPPRESS_DEPOSIT_THRESHOLD` all live at top of `src/rituals/voice-note.ts`.
- **Box-drawing section dividers** — `src/rituals/voice-note.ts` likely crosses 100 lines (handler + 3 helpers + constants); use `// ── Section ─────` form.
- **Test files co-located** in `__tests__/<module>.test.ts` next to the source.
- **Migration files hand-authored SQL** with idempotency guards (`ON CONFLICT DO NOTHING`, `CREATE INDEX IF NOT EXISTS`).
- **Idempotency via atomic `UPDATE … RETURNING *`** — M007 D-28 + Plan 25-02 D-25-02-A precedent. PP#5 consume-step uses `UPDATE ritual_pending_responses SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id` to enforce mutual exclusion.
- **Honest-docstring vs grep-guard tension (Lesson from Plan 25-02)** — if any plan acceptance criterion uses `grep` for forbidden patterns (e.g. "no Whisper imports"), the verification regex must anchor on `import|require|from` to skip prose docstrings, OR the docstring must abstract the forbidden pattern.

### Integration Points
- **`src/chris/engine.ts:processMessage`** — PP#5 inserted at body top. The line numbers will shift; planner records the exact insertion point at plan-write time. Existing PP#0 block stays untouched (PP#5 returns early on hit; on miss, falls through unchanged).
- **`src/bot/bot.ts`** — Append `bot.on('message:voice', handleVoiceMessageDecline as any)` after the existing `bot.on('message:text', ...)` registration. The `as any` cast follows existing precedent (e.g. line 26 `bot.command('sync', ...)`).
- **`src/rituals/scheduler.ts:dispatchRitualHandler`** — Replace skeleton `throw` with name-keyed switch. Other ritual names (`daily_wellbeing`, `weekly_review`) keep throwing until Phases 27/29 land.
- **`src/pensieve/store.ts:storePensieveEntry` signature change** — additive `opts?: { epistemicTag?: ... }` parameter. Existing 4 call sites continue to work without modification (verified via grep-count of `storePensieveEntry` invocations across `src/`).
- **`src/db/schema.ts`** — NO schema changes for tables/enums (Phase 25 already shipped `ritual_pending_responses`); Plan 26-01 does add the partial index in migration 0007 SQL but does NOT need to declare it in `schema.ts` (drizzle-kit `.where()` partial indexes work either way; matching Plan 25-01's `rituals_next_run_at_enabled_idx` precedent of declaring in schema.ts is cleaner — planner picks).

</code_context>

<specifics>
## Specific Ideas

- **Migration filename:** `0007_daily_voice_note_seed.sql` (next slot after Phase 25's `0006_rituals_wellbeing.sql`).
- **Seed ritual `name` value:** exactly `'daily_voice_note'` (matches dispatch key in D-26-08 + ROADMAP success criterion 1's `npx tsx scripts/fire-ritual.ts daily_voice_note` reference).
- **`PROMPT_SET_VERSION = 'v1'`:** literal string constant. Future prompt re-wordings bump to `'v2'` and reset `prompt_bag = []`.
- **6 prompts (frozen, spec order, `as const`):**
  ```typescript
  export const PROMPTS = [
    'What mattered today?',
    "What's still on your mind?",
    'What did today change?',
    'What surprised you today?',
    'What did you decide today, even if it was small?',
    'What did you avoid today?',
  ] as const;
  ```
- **`RESPONSE_WINDOW_HOURS = 18`** default; tunable in v2.5 per OPEN-1.
- **`RITUAL_SUPPRESS_DEPOSIT_THRESHOLD = 5`** default per Pitfall 9.
- **Property test for shuffled-bag (VOICE-03):** simulate 600 fires; assert (a) every prompt index 0..5 fires between 90 and 110 times (uniform within ±10%); (b) zero consecutive duplicates; (c) max gap between any prompt index's appearances ≤ 11.
- **PP#5 query SQL:** `SELECT id, ritual_id, fired_at, expires_at FROM ritual_pending_responses WHERE chat_id = $1 AND consumed_at IS NULL AND expires_at > $2 ORDER BY fired_at DESC LIMIT 1` — backed by `ritual_pending_responses_chat_id_active_idx` partial index added in migration 0007.
- **Cumulative no-LLM-call assertion (Pitfall 6 + 24):** `expect(mockAnthropicCreate).not.toHaveBeenCalled()` AT END OF TEST (afterAll) in `engine-pp5.test.ts`. Catches any branch that accidentally invokes Sonnet/Haiku within the PP#5 hit path.
- **Voice-decline reply in EN/FR/RU:**
  - EN: "I can only read text messages — try the microphone icon on your Android keyboard to dictate."
  - FR: "Je ne lis que les messages texte — essaie l'icône micro de ton clavier Android pour dicter."
  - RU: "Я понимаю только текстовые сообщения — попробуй значок микрофона на клавиатуре Android для диктовки."

</specifics>

<deferred>
## Deferred Ideas

- **Whisper STT transcription (server-side)** — OOS-3 explicit anti-feature; revisit in v2.5+ if review/confirm-before-storage flow ships first (PLAN.md `## Out of Scope and Deferred` gate).
- **`config.suppress_if_deposits_above` per-ritual override** — per Pitfall 9; Phase 26 ships module-scope `RITUAL_SUPPRESS_DEPOSIT_THRESHOLD = 5`; Phase 28 adjustment dialogue can promote to `rituals.config` for tuning.
- **`RESPONSE_WINDOW_HOURS` retuning** — defensible 12h/18h/24h/36h; revisit after 30 days of real use with skip-tracking telemetry (open question OPEN-1 in research SUMMARY).
- **Cleaned-projection `pensieve_entries.cleaned_for_quote_retrieval` for STT filler removal** — Pitfall 8 mentions this; deferred to a future M010+ phase. Phase 26 only ships the `source_subtype = 'ritual_voice_note'` tag (VOICE-06) which downstream consumers can filter on.
- **Skip-tracking on missed voice notes (`fired_no_response` outcome)** — Phase 28 territory. Phase 26 emits `'system_suppressed'` for VOICE-04 only; skip detection at next-fire-time happens in Phase 28.
- **AI follow-up question after voice deposit** — OOS-1 explicit anti-feature (kills the habit; D026 forbids).
- **Free-text custom prompts via Haiku** — OOS-10 anti-feature (major test surface; conflicts with curated 6-prompt design).
- **14-day primed-fixture integration test asserting full Pitfall 6 regression contract** — Phase 30 territory (TEST-25 specifically). Phase 26's `engine-pp5.test.ts` proves the contract for a single fire; Phase 30's fixture proves it across 14 simulated days.
- **`scripts/fire-ritual.ts` operator script for manual ritual fires** — referenced in ROADMAP success criterion 1 (`npx tsx scripts/fire-ritual.ts daily_voice_note`). Phase 25 shipped `scripts/manual-sweep.ts` (D-07) which fires all due rituals; a dedicated `fire-ritual.ts` that takes a name argument is a small UX add — planner decides whether to ship in Plan 26-02 (handler plan, fits naturally) or defer to Phase 30 operator-tooling work. **Recommendation: ship in Plan 26-02** as a thin wrapper around `runRitualSweep` with a name-filter argument; ~30 LoC; matches `scripts/backfill-episodic.ts` convention. If planner defers, Phase 26's success criterion 1 verification falls back to `scripts/manual-sweep.ts` after manually setting `next_run_at <= now()` for the seeded ritual.

</deferred>

---

*Phase: 26-Daily Voice Note Ritual*
*Context gathered: 2026-04-26*
