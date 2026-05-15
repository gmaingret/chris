/**
 * src/rituals/journal.ts — Phase 26 Plans 26-01..26-03 (renamed Phase 31)
 *
 * Journal ritual handler + PP#5 deposit-only mechanism + shuffled-bag
 * prompt rotation primitive. Owns:
 *   - PROMPTS array + PROMPT_SET_VERSION (VOICE-02 — Plan 26-01)
 *   - chooseNextPromptIndex shuffled-bag rotation (VOICE-03 — Plan 26-01)
 *   - fireJournal handler dispatched from scheduler.ts (VOICE-02..04 — Plan 26-02)
 *   - findActivePendingResponse PP#5 query helper (VOICE-01 — Plan 26-02)
 *   - recordJournalResponse PP#5 deposit helper (VOICE-01, VOICE-06 — Plan 26-02)
 *   - shouldSuppressJournalFire pre-fire suppression check (VOICE-04 — Plan 26-03)
 *
 * HARD CO-LOC #1 (Pitfall 6): PP#5 detector + handler MUST land in same plan
 * (26-02). Splitting them = guaranteed Chris-responds-to-rituals regression.
 * HARD CO-LOC #5 (Pitfall 24): Mock-chain coverage update for engine.test.ts
 * family MUST land with PP#5 introduction (Plan 26-02).
 *
 * Tag override: PP#5 deposits use the new `epistemicTag` parameter on
 * storePensieveEntry (D-26-03) so the Haiku auto-tagger does NOT misclassify
 * ritual responses into one of the 12 organic tags. The auto-tagger
 * (src/pensieve/tagger.ts) only touches entries with epistemic_tag IS NULL.
 *
 * Plan 26-01 ships substrate only: constants + chooseNextPromptIndex pure
 * function. Plans 26-02..04 fill in the rest.
 */
import { and, desc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/connection.js';
import {
  pensieveEntries,
  rituals,
  ritualFireEvents,
  ritualPendingResponses,
  ritualResponses,
} from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { StorageError } from '../utils/errors.js';
import { storePensieveEntry } from '../pensieve/store.js';
import { dayBoundaryUtc } from '../episodic/sources.js';
import { RITUAL_OUTCOME, type RitualConfig, type RitualFireOutcome } from './types.js';
import { bot } from '../bot/bot.js';
import { computeNextRunAt } from './cadence.js';
import { getLastUserLanguageFromDb, langOf, type Lang } from '../chris/language.js';

// ── Constants (M009 Phase 26 — VOICE-02 + VOICE-03 + VOICE-04 tunables) ────

/**
 * PROMPT-SET v1 — per-locale array of 6 prompts (Phase 46 L10N-04).
 *
 * CAP-01 cardinality lock (asserted below at module load): every locale
 * MUST have the same prompt count so `rituals.config.prompt_bag` indices
 * stay valid across locale switching. PROMPT_SET_VERSION stays at 'v1'
 * because the array length and conceptual ordering are preserved — only
 * the text is localized. Bumping to 'v2' is required ONLY if lengths
 * diverge (e.g., a future split where the EN "even if small" clause
 * becomes two FR sentences).
 *
 * FR uses tu-form per CONTEXT.md D-07 (matches `Ta phase FI`, `Tes
 * traitements` in profile.ts). RU uses ты-form (matches `Твой статус`).
 * Greg reviews FR + RU seeds at /gsd-verify-work per D-06.
 *
 * Bumping a prompt's wording requires a new PROMPT_SET_VERSION + reset of
 * any persisted prompt_bag entries (which index into these arrays).
 */
export const PROMPTS: Readonly<Record<Lang, readonly string[]>> = {
  English: [
    'What mattered today?',
    "What's still on your mind?",
    'What did today change?',
    'What surprised you today?',
    'What did you decide today, even if it was small?',
    'What did you avoid today?',
  ],
  French: [
    "Qu'est-ce qui a compté aujourd'hui ?",
    "Qu'est-ce qui te trotte encore dans la tête ?",
    "Qu'est-ce qu'aujourd'hui a changé ?",
    "Qu'est-ce qui t'a surpris aujourd'hui ?",
    "Qu'as-tu décidé aujourd'hui, même de petit ?",
    "Qu'as-tu évité aujourd'hui ?",
  ],
  Russian: [
    'Что было важным сегодня?',
    'Что ещё не выходит у тебя из головы?',
    'Что изменил сегодняшний день?',
    'Что тебя сегодня удивило?',
    'Что ты сегодня решил, пусть и небольшое?',
    'Чего ты сегодня избегал?',
  ],
} as const;

// CAP-01 cardinality lock: all locales MUST have the same prompt count so
// rituals.config.prompt_bag indices remain valid across locale switching.
// Bumping PROMPT_SET_VERSION is required only if these lengths must diverge
// (matches the same discipline as ABORT_PHRASES_EN/FR/RU in
// src/decisions/triggers-fixtures.ts:25).
const PROMPT_COUNTS = {
  English: PROMPTS.English.length,
  French: PROMPTS.French.length,
  Russian: PROMPTS.Russian.length,
};
if (
  PROMPT_COUNTS.English !== PROMPT_COUNTS.French ||
  PROMPT_COUNTS.English !== PROMPT_COUNTS.Russian
) {
  throw new Error(
    `PROMPTS cardinality mismatch: EN=${PROMPT_COUNTS.English}, FR=${PROMPT_COUNTS.French}, RU=${PROMPT_COUNTS.Russian}. ` +
      `Bump PROMPT_SET_VERSION + reset prompt_bag if lengths must diverge.`,
  );
}

/**
 * Locale-agnostic prompt cardinality used by the shuffled-bag rotation
 * (chooseNextPromptIndex) and the test suite. Asserted equal across locales
 * by the CAP-01 module-load guard above; reading EN is the canonical
 * "length-of-prompt-array" everywhere the rotation primitive cares.
 */
export const PROMPTS_COUNT = PROMPTS.English.length;

/**
 * Bumping to 'v2' invalidates all stored prompt_bag indices.
 *
 * Phase 46 L10N-04: shape changed from `readonly string[]` to
 * `Record<Lang, readonly string[]>`, but index semantics are PRESERVED —
 * bag indices remain valid because all locales have the same cardinality
 * (CAP-01 module-load assertion above). No version bump needed.
 */
export const PROMPT_SET_VERSION = 'v1' as const;

/**
 * Window after fire during which a free-text message is interpreted as a
 * ritual response (PP#5 — Plan 26-02). Tunable per OPEN-1 in research
 * SUMMARY (defensible 12h/18h/24h/36h range; revisit after 30 days of real
 * use with skip-tracking telemetry).
 */
export const RESPONSE_WINDOW_HOURS = 18;

/**
 * Pre-fire suppression threshold (Pitfall 9 — Plan 26-03). If today already
 * has at least N telegram JOURNAL Pensieve entries by 21:00 Paris, skip the
 * fire and advance to tomorrow without incrementing skip_count. Tunable per
 * Phase 28 adjustment dialogue (config.suppress_if_deposits_above promotion
 * deferred to v2.5).
 */
export const RITUAL_SUPPRESS_DEPOSIT_THRESHOLD = 5;

// ── Shuffled-bag rotation primitive (VOICE-03 — Plan 26-01) ────────────────

/**
 * chooseNextPromptIndex — shuffled-bag rotation.
 *
 * State stored in `rituals.config.prompt_bag: number[]` — an array of
 * indices not yet used in the current cycle. Each fire pops the first
 * element; when the bag empties, refill via Fisher-Yates shuffle of
 * [0..PROMPTS.length-1] and remove the just-used index from the head if it
 * lands there (no-consecutive-duplicate invariant across cycle boundaries).
 *
 * Pure function — `rng` parameter (defaulting to Math.random) makes the
 * function deterministic when seeded, supporting both the property test
 * (Math.random for organic invariant verification) and unit tests of
 * specific rotation sequences (seeded RNG for determinism).
 *
 * @param currentBag - Array of unused prompt indices in the current cycle.
 *   Empty array triggers a refill.
 * @param rng - Random source returning [0, 1). Defaults to Math.random.
 * @param lastIndex - The index used in the immediately prior fire (for
 *   no-consecutive-duplicate guard at cycle-boundary refill). Optional —
 *   pass undefined for the very first fire.
 * @returns `{ index, newBag }` — index to fire + remaining unused bag.
 */
export function chooseNextPromptIndex(
  currentBag: number[],
  rng: () => number = Math.random,
  lastIndex?: number,
): { index: number; newBag: number[] } {
  if (currentBag.length === 0) {
    // Refill: Fisher-Yates shuffle of [0..PROMPTS_COUNT-1]. PROMPTS_COUNT
    // is the locale-agnostic length (CAP-01 guarantees per-locale lengths
    // agree). Phase 46 L10N-04: PROMPTS shape is Record<Lang, ...>, so the
    // bare `.length` of the prior implementation no longer applies.
    const fresh: number[] = [];
    for (let i = 0; i < PROMPTS_COUNT; i++) fresh.push(i);
    for (let i = fresh.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [fresh[i], fresh[j]] = [fresh[j]!, fresh[i]!];
    }
    // No-consecutive-duplicate guard at cycle boundary: if the new bag's
    // head equals the just-used index, swap with position 1 (uniform
    // distribution preserved because the swap is unconditional on that
    // head-position, not on subsequent positions).
    if (lastIndex !== undefined && fresh[0] === lastIndex && fresh.length > 1) {
      [fresh[0], fresh[1]] = [fresh[1]!, fresh[0]!];
    }
    const idx = fresh.shift()!;
    return { index: idx, newBag: fresh };
  }
  const idx = currentBag[0]!;
  return { index: idx, newBag: currentBag.slice(1) };
}

// ── PP#5 helpers (VOICE-01 — Plan 26-02; per D-26-02) ──────────────────────

/**
 * findActivePendingResponse — PP#5 hot-path query (D-26-02).
 *
 * Returns the most recent non-consumed ritual_pending_responses row for the
 * given chat whose expires_at is in the future, or null if none exists.
 *
 * Backed by the partial index `ritual_pending_responses_chat_id_active_idx`
 * on (chat_id, expires_at) WHERE consumed_at IS NULL (added in migration 0007
 * by Plan 26-01). Index-only scan — sub-millisecond lookup even after years
 * of accumulated rows.
 */
export async function findActivePendingResponse(
  chatIdStr: string,
  now: Date,
): Promise<typeof ritualPendingResponses.$inferSelect | null> {
  const chatId = BigInt(chatIdStr);
  const [row] = await db
    .select()
    .from(ritualPendingResponses)
    .where(
      and(
        eq(ritualPendingResponses.chatId, chatId),
        isNull(ritualPendingResponses.consumedAt),
        gt(ritualPendingResponses.expiresAt, now),
      ),
    )
    .orderBy(desc(ritualPendingResponses.firedAt))
    .limit(1);
  return row ?? null;
}

/**
 * recordJournalResponse — PP#5 deposit helper (VOICE-01, VOICE-06; D-26-02).
 *
 * Three-step atomic-ish flow:
 *   1. Atomic consume — UPDATE ... SET consumed_at WHERE consumed_at IS NULL
 *      RETURNING id, prompt_text. Mutual exclusion against concurrent PP#5
 *      invocations.
 *   2. Pensieve write with explicit RITUAL_RESPONSE tag (D-26-03 epistemicTag
 *      parameter) and metadata.source_subtype = 'ritual_journal' (VOICE-06).
 *   3. ritual_responses link row insert with prompt_text from the consumed
 *      pending row (per amended D-26-02 — no empty-string placeholder, no
 *      NOT NULL violation; checker B4 fix).
 *
 * Throws StorageError('ritual.pp5.race_lost') on race-loss (concurrent consume
 * already won) — engine PP#5 catches and returns '' silently.
 */
export async function recordJournalResponse(
  pending: typeof ritualPendingResponses.$inferSelect,
  chatId: bigint,
  text: string,
): Promise<{ pensieveEntryId: string; consumedAt: Date }> {
  // STEP 1: Atomic consume (D-26-02 mutual exclusion guarantee).
  // Return prompt_text alongside id so STEP 3 can populate ritual_responses
  // (per amended D-26-02 — no empty-string placeholder).
  const [consumed] = await db
    .update(ritualPendingResponses)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(ritualPendingResponses.id, pending.id),
        isNull(ritualPendingResponses.consumedAt),
      ),
    )
    .returning({
      id: ritualPendingResponses.id,
      consumedAt: ritualPendingResponses.consumedAt,
      promptText: ritualPendingResponses.promptText,
    });

  if (!consumed || !consumed.consumedAt) {
    throw new StorageError('ritual.pp5.race_lost');
  }

  // STEP 2: Pensieve write with explicit tag (D-26-03 epistemicTag param).
  const entry = await storePensieveEntry(
    text,
    'telegram',
    {
      telegramChatId: Number(chatId),
      source_subtype: 'ritual_journal', // VOICE-06 (Phase 31: renamed from ritual_voice_note)
      ritual_id: pending.ritualId,
      ritual_pending_response_id: pending.id,
    },
    { epistemicTag: 'RITUAL_RESPONSE' }, // D-26-03 direct-tag write path
  );

  // STEP 3: ritual_responses link row — prompt_text from consumed pending row
  // (per amended D-26-02; checker B4 fix — no empty-string).
  await db.insert(ritualResponses).values({
    ritualId: pending.ritualId,
    firedAt: pending.firedAt,
    respondedAt: consumed.consumedAt,
    promptText: consumed.promptText,
    pensieveEntryId: entry.id,
  });

  // STEP 4 (Phase 28 SKIP-01 / D-28-03): emit 'responded' ritual_fire_events
  // row + reset rituals.skip_count = 0. Two sequential writes — NOT a
  // transaction (both are idempotent under retry; D-28-03 documents tradeoff).
  // 'responded' resets skip_count so ritual does not trigger adjustment
  // dialogue on next sweep tick (user engagement resets the clock).
  await db.insert(ritualFireEvents).values({
    ritualId: pending.ritualId,
    firedAt: consumed.consumedAt,
    outcome: RITUAL_OUTCOME.RESPONDED,
    metadata: {
      pendingResponseId: pending.id,
      pensieveEntryId: entry.id,
    },
  });
  await db.update(rituals).set({ skipCount: 0 }).where(eq(rituals.id, pending.ritualId));

  return { pensieveEntryId: entry.id, consumedAt: consumed.consumedAt };
}

// ── Pre-fire suppression (VOICE-04 — Plan 26-03; D-26-05 + D-26-06) ───────

/**
 * shouldSuppressJournalFire — Pitfall 9 mitigation (D-26-05).
 *
 * Returns true if today (local Europe/Paris day, computed via the canonical
 * `dayBoundaryUtc` Luxon helper from src/episodic/sources.ts) already has
 * `RITUAL_SUPPRESS_DEPOSIT_THRESHOLD` (default 5) or more telegram-source
 * JOURNAL-mode Pensieve entries. When true, fireJournal skips firing with
 * the 'system_suppressed' outcome (D-26-06) — Greg has clearly journaled
 * enough today that another prompt would feel redundant.
 *
 * Per CONTEXT.md D-26-05: the query targets Pensieve directly (not the
 * conversations table) because Pensieve is the authoritative store (D035) and
 * matches Pitfall 9's mitigation language verbatim ("≥5 deposits today").
 * The `metadata.mode` field is set by JOURNAL-mode Pensieve writers
 * (src/chris/modes/journal.ts) so the predicate `metadata->>'mode' = 'JOURNAL'`
 * counts user JOURNAL deposits, not assistant turns or other modes.
 *
 * Note on dayBoundaryUtc signature: the canonical helper returns
 * `{ start, end }` (NOT a single Date with a 'start'|'end' selector). We
 * destructure `start` for the local-Paris day-start UTC instant.
 */
export async function shouldSuppressJournalFire(now: Date): Promise<boolean> {
  const { start: dayStart } = dayBoundaryUtc(now, config.proactiveTimezone);
  const result = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(pensieveEntries)
    .where(
      and(
        eq(pensieveEntries.source, 'telegram'),
        gte(pensieveEntries.createdAt, dayStart),
        sql`${pensieveEntries.metadata}->>'mode' = 'JOURNAL'`,
      ),
    );
  const count = result[0]?.count ?? 0;
  return count >= RITUAL_SUPPRESS_DEPOSIT_THRESHOLD;
}

// ── fireJournal handler (VOICE-02 + VOICE-03 — Plan 26-02) ─────────────────

/**
 * fireJournal — daily journal ritual handler (D-26-04, D-26-08).
 *
 * Dispatched from src/rituals/scheduler.ts dispatchRitualHandler when
 * ritual.name === 'daily_journal'. Picks the next prompt from the
 * shuffled bag, sends a Telegram message, and inserts a
 * ritual_pending_responses row binding the fire to the chat (which PP#5
 * will look up when Greg replies via STT).
 *
 * Persists prompt_text on the pending row per amended D-26-02 — PP#5's
 * recordJournalResponse will read it back to populate
 * ritual_responses.prompt_text (longitudinal trail).
 *
 * Returns the RitualFireOutcome string. Plan 26-03 will add the
 * 'system_suppressed' branch (pre-fire suppression for high-deposit days).
 */
export async function fireJournal(
  ritual: typeof rituals.$inferSelect,
  cfg: RitualConfig,
): Promise<RitualFireOutcome> {
  // STEP 0: Pre-fire suppression check (VOICE-04 — Plan 26-03; D-26-04 + D-26-05).
  // Runs BEFORE prompt selection per D-26-04: on suppression, advance
  // next_run_at to tomorrow's 21:00 Paris and return 'system_suppressed'
  // (D-26-06) with NO Telegram send, NO pending row insert, NO prompt_bag
  // update, NO skip_count touch.
  //
  // Why we advance via `computeNextRunAt(endOfToday, 'daily', cfg)` and NOT
  // `computeNextRunAt(now, ...)`: in production the cron sweep dispatches
  // fireJournal at the configured fire_at (21:00 Paris), so `now ≈ today's
  // 21:00 Paris` and `computeNextRunAt(now, 'daily', cfg)` lands on tomorrow's
  // 21:00 Paris (target <= now → +1 day). But a manual `runRitualSweep` (or
  // an `npx tsx scripts/manual-sweep.ts` invocation) at any earlier wall-clock
  // time would compute today's still-future 21:00 Paris instead — defeating
  // the suppression's "skip today entirely" semantic. Anchoring to the local
  // end-of-day instant guarantees tomorrow's slot under both timing patterns.
  const now = new Date();
  if (await shouldSuppressJournalFire(now)) {
    const { end: endOfTodayLocal } = dayBoundaryUtc(now, cfg.time_zone);
    const tomorrow = computeNextRunAt(endOfTodayLocal, 'daily', cfg);
    await db
      .update(rituals)
      .set({ nextRunAt: tomorrow })
      .where(eq(rituals.id, ritual.id));
    logger.info(
      { ritualId: ritual.id, nextRunAt: tomorrow.toISOString() },
      'rituals.journal.suppressed',
    );
    // Phase 28 SKIP-01: emit ritual_fire_events on suppression path.
    // system_suppressed does NOT increment skip_count (per SKIP-01 rules).
    await db.insert(ritualFireEvents).values({
      ritualId: ritual.id,
      firedAt: now,
      outcome: RITUAL_OUTCOME.SYSTEM_SUPPRESSED,
      metadata: {
        reason: 'heavy_deposit_day',
        deposit_threshold: RITUAL_SUPPRESS_DEPOSIT_THRESHOLD,
      },
    });
    return 'system_suppressed';
  }

  // STEP 1: Pop next prompt from bag (Plan 26-01 chooseNextPromptIndex).
  //
  // Phase 32 #8: lastIdx must be the index that was fired in the immediately
  // PRIOR fire (the past) — not bag[bag.length - 1], which is just the last
  // not-yet-used index in the CURRENT bag (the future). The previous code
  // read the wrong end of the bag, so on cycle-boundary refill (bag.length
  // === 0) it fell back to undefined and the no-consecutive-duplicate guard
  // had no signal — producing a back-to-back duplicate ~1/PROMPTS_COUNT
  // (~17%) of the time. Persist the prior fired index in cfg.last_fired_prompt_idx
  // and read it back here. First fire after migration sees undefined → no
  // history → no guard, which is correct (no prior fire to duplicate).
  const bag = cfg.prompt_bag ?? [];
  const lastIdx = cfg.last_fired_prompt_idx;
  const { index: promptIdx, newBag } = chooseNextPromptIndex(
    bag,
    Math.random,
    lastIdx,
  );

  // Phase 46 L10N-04 — cron-context language detection.
  // M009 first-Sunday lesson: in-memory `sessionLanguage` is empty after
  // process restart; cron handlers MUST read from DB. Default to 'French'
  // on null per CONTEXT.md specifics (Greg's primary locale). The same
  // pattern is used in weekly-review.ts:580-583 for the cross-cron
  // boundary discipline.
  const chatId = BigInt(config.telegramAuthorizedUserId);
  const detectedLang = await getLastUserLanguageFromDb(chatId);
  const lang: Lang = langOf(detectedLang ?? 'French');
  const prompt = PROMPTS[lang][promptIdx]!;

  // STEP 2: Send Telegram message FIRST. If this throws, no pending row is
  //         inserted, so PP#5 won't have a stale binding.
  await bot.api.sendMessage(Number(chatId), prompt);

  // STEP 3: Insert ritual_pending_responses row WITH prompt_text (amended D-26-02).
  const firedAt = new Date();
  const expiresAt = new Date(firedAt.getTime() + RESPONSE_WINDOW_HOURS * 3600 * 1000);
  await db.insert(ritualPendingResponses).values({
    ritualId: ritual.id,
    chatId,
    firedAt,
    expiresAt,
    promptText: prompt,
  });

  // STEP 4: Update rituals.config.prompt_bag with the new bag, and persist
  // last_fired_prompt_idx so the next fire's cycle-boundary refill (Phase 32 #8)
  // can run the no-consecutive-duplicate guard.
  const updatedCfg: RitualConfig = {
    ...cfg,
    prompt_bag: newBag,
    last_fired_prompt_idx: promptIdx,
  };
  await db
    .update(rituals)
    .set({ config: updatedCfg })
    .where(eq(rituals.id, ritual.id));

  logger.info(
    { ritualId: ritual.id, promptIdx, prompt },
    'rituals.journal.fired',
  );
  // Phase 28 SKIP-01: emit ritual_fire_events on successful fire path.
  // 'fired' does NOT increment skip_count. firedAt uses the local var
  // already in scope from STEP 3 (matches the pending row's firedAt).
  await db.insert(ritualFireEvents).values({
    ritualId: ritual.id,
    firedAt,
    outcome: RITUAL_OUTCOME.FIRED,
    metadata: { promptIdx, prompt },
  });
  return 'fired';
}
