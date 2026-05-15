/**
 * src/rituals/wellbeing.ts — Phase 27 Plan 02 (WELL-01..05)
 *
 * Daily wellbeing snapshot ritual handler. First inline-keyboard surface in
 * the codebase. Two entry points:
 *
 *   - fireWellbeing(ritual, cfg): called by dispatchRitualHandler at sweep
 *     time. Inserts a ritual_responses row, builds the inline keyboard (3
 *     rows of 1-5 buttons + skip row), sends via Telegram. Returns 'fired'
 *     RitualFireOutcome (matches Phase 26 fireJournal contract — D-26-08).
 *
 *   - handleWellbeingCallback(ctx, data): called by handleRitualCallback
 *     when a `r:w:*` callback arrives. Merges per-dim into metadata.partial
 *     via jsonb_set (atomic at Postgres column level — no TOCTOU race), then:
 *     - skip → close + write metadata.skipped + emit 'wellbeing_skipped' outcome
 *     - 3rd dim tapped → write wellbeing_snapshots row + emit 'wellbeing_completed' outcome
 *     - 1st/2nd dim tapped → redraw keyboard with [N] highlights, no completion
 *
 * Anchor-bias defeat (D-27-04): this module reads ZERO data from
 * wellbeing_snapshots and ZERO data from prior ritual_responses (other than
 * today's in-progress row). The "hide" is the absence of code, not added code.
 * Plan 27-03's negative grep guard in scripts/test.sh enforces this contract
 * across future regressions.
 *
 * Race-safety: per-tap UPDATE … SET metadata = jsonb_set(...) is atomic at
 * Postgres row-lock level. Concurrent UPDATEs on the same row serialize. The
 * completion-gated wellbeing_snapshots INSERT runs ONCE (only when handler
 * observes all 3 dims present in just-merged metadata).
 *
 * NOT NULL constraint on wellbeing_snapshots.energy/mood/anxiety means partial-
 * row writes fail. We stage partial state in ritual_responses.metadata.partial
 * jsonb (per WELL-03) and only write to wellbeing_snapshots when all 3 dims
 * are captured (per D-27-05).
 *
 * Server-side validation (D-27-09): parseCallbackData rejects dimStr ∉ {e,m,a}
 * or value ∉ [1,5] with kind:'invalid' — Telegram callback_data is untrusted.
 * Defense-in-depth: explicit assert before sql.raw() construction.
 *
 * Outcome semantics (Phase 28 homogenized via RITUAL_OUTCOME const map):
 *   - 'wellbeing_completed' resets skip_count via D-28-03; represents full 3-tap engagement
 *   - 'wellbeing_skipped' is neither reset nor increment; Greg's explicit opt-out
 *   - 'fired_no_response' emitted by ritualResponseWindowSweep on 18h window expiry
 *   - 'fired' emitted on initial fire (added Phase 28); not previously tracked from wellbeing
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { InlineKeyboard, type Context } from 'grammy';
import { DateTime } from 'luxon';
import { bot } from '../bot/bot.js';
import { config } from '../config.js';
import { db } from '../db/connection.js';
import { rituals, ritualResponses, ritualFireEvents, wellbeingSnapshots } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { RITUAL_OUTCOME, type RitualConfig, type RitualFireOutcome } from './types.js';

// ── Constants ──────────────────────────────────────────────────────────────

const WELLBEING_PROMPT = 'Wellbeing snapshot — tap energy, mood, anxiety:';
const WELLBEING_SKIP_LABEL = 'Skip';
const WELLBEING_CALLBACK_PREFIX = 'r:w:';
const WELLBEING_SKIP_CALLBACK = 'r:w:skip';
const DIMS = ['e', 'm', 'a'] as const;
type Dim = (typeof DIMS)[number];
const DIM_LABELS: Record<Dim, string> = { e: 'energy', m: 'mood', a: 'anxiety' };

// Metadata jsonb shape (stored in ritual_responses.metadata)
interface WellbeingPartial {
  e?: number;
  m?: number;
  a?: number;
}
interface WellbeingMetadata {
  message_id?: number;
  partial: WellbeingPartial;
  completed?: boolean;
  skipped?: boolean;
  adjustment_eligible?: boolean;
}

// ── Fire-side (called by dispatchRitualHandler) ────────────────────────────

/**
 * fireWellbeing — initial fire. Creates ritual_responses row with empty partial
 * state, builds the inline keyboard, sends via Telegram.
 *
 * Anchor-bias defeat: reads ZERO data from wellbeing_snapshots. The keyboard
 * starts blank (no highlights). The prompt text is constant — no historical
 * reference (D-27-04 prong 2).
 *
 * Idempotency: dispatchRitualHandler caller has already run tryFireRitualAtomic
 * (RIT-10), so this function is invoked AT MOST ONCE per fire even under
 * concurrent sweep ticks. Safe to insert ritual_responses + send Telegram
 * message without further deduplication.
 *
 * Conforms to Phase 26 D-26-08 dispatcher contract: takes (ritual, cfg) and
 * returns RitualFireOutcome. Currently unconditionally returns 'fired' — Phase
 * 28 may add a 'system_suppressed' branch (mirroring fireJournal D-26-06)
 * if anchor-day-suppression is desired; for v2.4 the wellbeing fire is
 * unconditional once the sweep tick claims it.
 *
 * Logs: rituals.wellbeing.fired
 */
export async function fireWellbeing(
  ritual: typeof rituals.$inferSelect,
  _cfg: RitualConfig,
): Promise<RitualFireOutcome> {
  // 1. Insert ritual_responses row with empty partial state
  const initialMetadata: WellbeingMetadata = { partial: {} };
  const [fireRow] = await db
    .insert(ritualResponses)
    .values({
      ritualId: ritual.id,
      firedAt: new Date(),
      promptText: WELLBEING_PROMPT,
      metadata: initialMetadata,
    })
    .returning();

  if (!fireRow) {
    logger.error({ ritualId: ritual.id }, 'rituals.wellbeing.fire.insert_failed');
    return 'fired';
  }

  // 2. Build initial keyboard (no highlights — empty partial)
  const kb = buildKeyboard({ partial: {} });

  // 3. Send via Telegram + record message_id for subsequent edit-in-place
  const sent = await bot.api.sendMessage(
    config.telegramAuthorizedUserId,
    WELLBEING_PROMPT,
    { reply_markup: kb },
  );

  // 4. Persist message_id to ritual_responses.metadata for the callback handler
  //    to use (technically optional — ctx.editMessageReplyMarkup uses the
  //    message_id from ctx.callbackQuery.message — but recorded for observability).
  //
  //    NOTE: postgres-js cannot bind a JS number to a `jsonb` parameter type
  //    (errors with "The 'string' argument must be of type string..." at
  //    bytes.js:22). We pass the message_id as a string ("12345") which jsonb
  //    parses as the JSON number 12345 on the server side. Same idiom applied
  //    in handleTap below for the per-dim value param.
  await db
    .update(ritualResponses)
    .set({
      metadata: sql`jsonb_set(${ritualResponses.metadata}, '{message_id}', ${String(sent.message_id)}::jsonb, true)`,
    })
    .where(eq(ritualResponses.id, fireRow.id));

  logger.info(
    { ritualId: ritual.id, fireRowId: fireRow.id, messageId: sent.message_id },
    'rituals.wellbeing.fired',
  );

  // Phase 28 SKIP-01: emit ritual_fire_events on fire path.
  // Per RESEARCH Landmine 8: fire-side emit was MISSING pre-Phase-28;
  // only completion/skip writes existed. 'fired' does NOT increment skip_count.
  await db.insert(ritualFireEvents).values({
    ritualId: ritual.id,
    firedAt: new Date(),
    outcome: RITUAL_OUTCOME.FIRED,
    metadata: { fireRowId: fireRow.id, prompt: WELLBEING_PROMPT },
  });

  return 'fired';
}

// ── Callback-side (called by handleRitualCallback) ─────────────────────────

/**
 * handleWellbeingCallback — entry point for r:w:* callbacks.
 *
 * Parses callback_data with server-side validation (D-27-09: dim ∈ {e,m,a},
 * value ∈ [1,5]), finds today's open ritual_responses row, merges the new
 * value into metadata.partial via atomic jsonb_set, redraws the keyboard,
 * and on completion (3rd dim OR skip) writes the final snapshot + clears keyboard.
 *
 * Always invokes ctx.answerCallbackQuery() exactly once (Telegram 30s contract).
 *
 * Logs: rituals.wellbeing.tap, rituals.wellbeing.completed,
 *       rituals.wellbeing.skipped, rituals.wellbeing.no_open_row,
 *       rituals.wellbeing.invalid_payload
 */
export async function handleWellbeingCallback(ctx: Context, data: string): Promise<void> {
  const parsed = parseCallbackData(data);
  if (parsed.kind === 'invalid') {
    logger.warn({ data }, 'rituals.wellbeing.invalid_payload');
    await ctx.answerCallbackQuery({ text: 'Invalid wellbeing button' });
    return;
  }

  // Find the open ritual_responses row for today's daily_wellbeing fire
  const openRow = await findOpenWellbeingRow();
  if (!openRow) {
    logger.warn({ data }, 'rituals.wellbeing.no_open_row');
    await ctx.answerCallbackQuery({ text: 'Snapshot already closed' });
    return;
  }

  if (parsed.kind === 'skip') {
    await handleSkip(ctx, openRow);
    return;
  }

  // parsed.kind === 'tap'
  await handleTap(ctx, openRow, parsed.dim, parsed.value);
}

// ── Tap handling ───────────────────────────────────────────────────────────

async function handleTap(
  ctx: Context,
  openRow: typeof ritualResponses.$inferSelect,
  dim: Dim,
  value: number,
): Promise<void> {
  // Defense-in-depth: parseCallbackData already validated dim ∈ {e,m,a} and
  // value ∈ [1,5]. Re-assert before sql.raw() construction so any future
  // refactor that bypasses parseCallbackData fails loud rather than silently
  // opening an injection surface (PATTERNS.md item 7).
  if (!DIMS.includes(dim)) {
    throw new Error(`rituals.wellbeing.handleTap: invariant violated — dim=${dim} not in {e,m,a}`);
  }
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error(`rituals.wellbeing.handleTap: invariant violated — value=${value} not in [1,5]`);
  }

  // Atomic per-dim merge (no TOCTOU race — jsonb_set is row-lock atomic)
  // Path string `{partial,e}` is constructed from the validated dim above.
  // Value passed as a string per postgres-js jsonb-binding constraint
  // (cannot bind JS number directly to jsonb param — see fireWellbeing
  // comment above). The integer is validated 1-5 above, so String(value)
  // is always a parseable JSON number on the server side.
  const path = `{partial,${dim}}`;
  await db
    .update(ritualResponses)
    .set({
      metadata: sql`jsonb_set(coalesce(${ritualResponses.metadata}, '{}'::jsonb), ${path}, ${String(value)}::jsonb, true)`,
    })
    .where(eq(ritualResponses.id, openRow.id));

  logger.info({ fireRowId: openRow.id, dim, value }, 'rituals.wellbeing.tap');

  // Re-read merged state (for redraw + completion check)
  const [updatedRow] = await db
    .select()
    .from(ritualResponses)
    .where(eq(ritualResponses.id, openRow.id))
    .limit(1);

  const meta = (updatedRow?.metadata ?? { partial: {} }) as WellbeingMetadata;

  if (isComplete(meta.partial)) {
    await completeSnapshot(ctx, openRow, meta);
  } else {
    // Redraw keyboard with [N] highlights for tapped dimensions
    await ctx.editMessageReplyMarkup({ reply_markup: buildKeyboard(meta) });
    await ctx.answerCallbackQuery({ text: `${DIM_LABELS[dim]}: ${value}` });
  }
}

// ── Completion + persistence ───────────────────────────────────────────────

async function completeSnapshot(
  ctx: Context,
  openRow: typeof ritualResponses.$inferSelect,
  meta: WellbeingMetadata,
): Promise<void> {
  // Phase 42 RACE-03 (D-42-06 + D-42-07): atomic completion-claim UPDATE
  // BEFORE any side-effect work. Three concurrent third-tap callbacks can
  // each reach this function under rapid-tap concurrency; without the claim
  // guard, all three would each emit a duplicate wellbeing_completed
  // ritual_fire_events row, call editMessageText three times, and
  // redundantly set skip_count=0. The atomic UPDATE on
  // `respondedAt IS NULL` is the canonical idempotency key (mirrors the
  // tryFireRitualAtomic pattern from idempotency.ts — D-42-06): only ONE
  // claim wins per ritual_responses row; losers silently return at DEBUG
  // log level.
  const [claimed] = await db
    .update(ritualResponses)
    .set({ respondedAt: new Date() })
    .where(
      and(
        eq(ritualResponses.id, openRow.id),
        isNull(ritualResponses.respondedAt),
      ),
    )
    .returning({ id: ritualResponses.id });

  if (!claimed) {
    logger.debug(
      { fireRowId: openRow.id },
      'rituals.wellbeing.completion_race_lost',
    );
    return;
  }

  const today = todayLocalDate();

  // Single atomic insert with all 3 columns (per D-27-05). Idempotent via
  // ON CONFLICT (snapshot_date) — but the completion-claim above already
  // guarantees we are the ONLY caller running this code path for this row.
  await db
    .insert(wellbeingSnapshots)
    .values({
      snapshotDate: today,
      energy: meta.partial.e!,
      mood: meta.partial.m!,
      anxiety: meta.partial.a!,
    })
    .onConflictDoUpdate({
      target: wellbeingSnapshots.snapshotDate,
      set: {
        energy: sql.raw('EXCLUDED.energy'),
        mood: sql.raw('EXCLUDED.mood'),
        anxiety: sql.raw('EXCLUDED.anxiety'),
      },
    });

  // Mark ritual_responses metadata with completed:true (respondedAt is
  // already set by the claim UPDATE above).
  const completedMeta: WellbeingMetadata = { ...meta, completed: true };
  await db
    .update(ritualResponses)
    .set({ metadata: completedMeta })
    .where(eq(ritualResponses.id, openRow.id));

  // Phase 28 SKIP-01: emit ritual_fire_events for completed wellbeing snapshot.
  // Uses RITUAL_OUTCOME const map (homogenized in Phase 28 — was a free-form string).
  // 'wellbeing_completed' is the response signal — resets skip_count (D-28-03).
  // Per PATTERNS.md: keep wellbeing_completed as the response signal; do NOT
  // also emit 'responded' (it would be redundant).
  await db.insert(ritualFireEvents).values({
    ritualId: openRow.ritualId,
    firedAt: new Date(),
    outcome: RITUAL_OUTCOME.WELLBEING_COMPLETED,
    metadata: { fireRowId: openRow.id, snapshotDate: today },
  });

  // Phase 28 D-28-03: reset denormalized skip_count on completion.
  // Skip_count = 0 because Greg engaged with the ritual (3-tap completion).
  await db.update(rituals).set({ skipCount: 0 }).where(eq(rituals.id, openRow.ritualId));

  // Clear keyboard via editMessageText (no reply_markup → keyboard cleared)
  await ctx.editMessageText(
    `Logged: energy ${meta.partial.e}, mood ${meta.partial.m}, anxiety ${meta.partial.a}.`,
  );
  await ctx.answerCallbackQuery({ text: 'Snapshot complete' });

  logger.info(
    { fireRowId: openRow.id, snapshotDate: today, ...meta.partial },
    'rituals.wellbeing.completed',
  );
}

// ── Skip handling ──────────────────────────────────────────────────────────

async function handleSkip(
  ctx: Context,
  openRow: typeof ritualResponses.$inferSelect,
): Promise<void> {
  // Phase 42 RACE-04 (D-42-09): completion-claim guard FIRST. Two-way safety
  // on the ritual_responses row — a skip arriving concurrently with a
  // third-tap completion must produce exactly one winner. Same atomic
  // UPDATE shape as RACE-03 in completeSnapshot above.
  const [claimed] = await db
    .update(ritualResponses)
    .set({ respondedAt: new Date() })
    .where(
      and(
        eq(ritualResponses.id, openRow.id),
        isNull(ritualResponses.respondedAt),
      ),
    )
    .returning({ id: ritualResponses.id });

  if (!claimed) {
    logger.debug(
      { fireRowId: openRow.id },
      'rituals.wellbeing.skip_race_lost',
    );
    return;
  }

  // Phase 42 RACE-04 (D-42-08): nested jsonb_set merge for skipped +
  // adjustment_eligible flags. The pre-RACE-04 code wrote a FULL-OBJECT
  // metadata overwrite via `{...meta, skipped: true, adjustment_eligible:
  // false}`, which silently discarded any concurrent metadata.partial.{e|m|a}
  // tap that landed between findOpenWellbeingRow and this UPDATE. The nested
  // jsonb_set pattern (mirror of the tap path at line 237) merges the two
  // skip-flag fields into whatever metadata is currently in the column,
  // preserving partial-tap state for downstream forensics. Closes the
  // data-fidelity-mandate violation called out in Phase 27 BL-02.
  await db
    .update(ritualResponses)
    .set({
      metadata: sql`jsonb_set(jsonb_set(
        coalesce(${ritualResponses.metadata}, '{}'::jsonb),
        '{skipped}', 'true'::jsonb, true),
        '{adjustment_eligible}', 'false'::jsonb, true)`,
    })
    .where(eq(ritualResponses.id, openRow.id));

  // Phase 28 SKIP-01: emit WELLBEING_SKIPPED via RITUAL_OUTCOME const map (homogenized in Phase 28).
  // 'wellbeing_skipped' is neither reset nor increment (SKIP-01 rules) — Greg's
  // explicit opt-out of today's snapshot. Does NOT touch rituals.skip_count.
  await db.insert(ritualFireEvents).values({
    ritualId: openRow.ritualId,
    firedAt: new Date(),
    outcome: RITUAL_OUTCOME.WELLBEING_SKIPPED,
    metadata: { fireRowId: openRow.id, adjustment_eligible: false },
  });

  // Clear keyboard
  await ctx.editMessageText('Skipped wellbeing snapshot.');
  await ctx.answerCallbackQuery({ text: 'Skipped' });

  logger.info({ fireRowId: openRow.id }, 'rituals.wellbeing.skipped');
}

// ── Keyboard rendering ─────────────────────────────────────────────────────

function buildKeyboard(meta: Pick<WellbeingMetadata, 'partial'>): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const dim of DIMS) {
    const tappedValue = meta.partial[dim];
    for (let val = 1; val <= 5; val++) {
      const label = tappedValue === val ? `[${val}]` : `${val}`;
      kb.text(label, `${WELLBEING_CALLBACK_PREFIX}${dim}:${val}`);
    }
    kb.row();
  }
  kb.text(WELLBEING_SKIP_LABEL, WELLBEING_SKIP_CALLBACK);
  return kb;
}

// ── Helpers ────────────────────────────────────────────────────────────────

type ParsedCallback =
  | { kind: 'tap'; dim: Dim; value: number }
  | { kind: 'skip' }
  | { kind: 'invalid' };

/**
 * Server-side validation per D-27-09 — Telegram callback_data is untrusted.
 * Rejects dimStr ∉ {e,m,a} or value ∉ [1,5] with kind:'invalid'.
 */
function parseCallbackData(data: string): ParsedCallback {
  if (!data.startsWith(WELLBEING_CALLBACK_PREFIX)) return { kind: 'invalid' };
  const rest = data.slice(WELLBEING_CALLBACK_PREFIX.length);
  if (rest === 'skip') return { kind: 'skip' };
  const [dimStr, valStr] = rest.split(':');
  if (!dimStr || !valStr) return { kind: 'invalid' };
  if (!DIMS.includes(dimStr as Dim)) return { kind: 'invalid' };
  const value = Number(valStr);
  if (!Number.isInteger(value) || value < 1 || value > 5) return { kind: 'invalid' };
  return { kind: 'tap', dim: dimStr as Dim, value };
}

function isComplete(partial: WellbeingPartial): boolean {
  return partial.e !== undefined && partial.m !== undefined && partial.a !== undefined;
}

function todayLocalDate(): string {
  return DateTime.now().setZone(config.proactiveTimezone).toISODate()!;
}

/**
 * Find today's open ritual_responses row for the daily_wellbeing ritual.
 *
 * "Open" = responded_at IS NULL AND fired_at::date matches today's local date.
 * Returns null if no open row exists (snapshot already completed/skipped, or
 * stale callback after window expiry).
 *
 * Queries by ritual NAME ('daily_wellbeing') so the callback handler does not
 * need to know the seeded UUID.
 */
async function findOpenWellbeingRow(): Promise<typeof ritualResponses.$inferSelect | null> {
  const today = todayLocalDate();
  const tz = config.proactiveTimezone;
  const [row] = await db
    .select({
      id: ritualResponses.id,
      ritualId: ritualResponses.ritualId,
      firedAt: ritualResponses.firedAt,
      respondedAt: ritualResponses.respondedAt,
      promptText: ritualResponses.promptText,
      pensieveEntryId: ritualResponses.pensieveEntryId,
      metadata: ritualResponses.metadata,
      createdAt: ritualResponses.createdAt,
    })
    .from(ritualResponses)
    .innerJoin(rituals, eq(rituals.id, ritualResponses.ritualId))
    .where(
      sql`
        ${rituals.name} = 'daily_wellbeing'
        AND ${ritualResponses.respondedAt} IS NULL
        AND date_trunc('day', ${ritualResponses.firedAt} AT TIME ZONE ${tz})
            = ${today}::date
      `,
    )
    .orderBy(sql`${ritualResponses.firedAt} DESC`)
    .limit(1);

  return row ?? null;
}
