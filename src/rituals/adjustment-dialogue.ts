/**
 * src/rituals/adjustment-dialogue.ts — Phase 28 Plan 03 (SKIP-04 + SKIP-05)
 *
 * Adjustment dialogue handler with Haiku 3-class classification + 60s
 * confirmation window.
 *
 * ON TOP OF:
 *   - Plan 28-01 substrate (ritual_fire_events writes)
 *   - Plan 28-02 predicate (shouldFireAdjustmentDialogue)
 *
 * Per RESEARCH Landmine 1: ritual_config_events writes use the discriminated
 * envelope inside `patch` jsonb (NOT the change_kind/old_value/new_value
 * top-level columns CONTEXT.md D-28-09 incorrectly described). Actual columns:
 * id, ritual_id, actor varchar(32), patch jsonb, created_at.
 *
 * Per RESEARCH Landmine 2: this module REQUIRES migration 0010 (metadata jsonb
 * on ritual_pending_responses).
 *
 * Per RESEARCH Landmine 5: ritualConfirmationSweep is a NARROW helper, NOT
 * runRitualSweep — registered separately in cron-registration.ts with a
 * '* * * * *' schedule.
 *
 * Per RESEARCH Landmine 6: PP#5 voice-note path preserved — NULL/undefined
 * metadata.kind falls through to existing voice-note handling.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import * as zV4 from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from '../config.js';
import { db } from '../db/connection.js';
import {
  rituals,
  ritualPendingResponses,
  ritualResponses,
  ritualFireEvents,
  ritualConfigEvents,
} from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { StorageError } from '../utils/errors.js';
import { bot } from '../bot/bot.js';
import { anthropic, HAIKU_MODEL } from '../llm/client.js';
import { RITUAL_OUTCOME, parseRitualConfig, type RitualFireOutcome } from './types.js';

// ── Constants (D-28-05 + D-28-06 locked spec) ─────────────────────────────

const RESPONSE_WINDOW_HOURS = 18; // mirrors voice-note.ts RESPONSE_WINDOW_HOURS
const CONFIRMATION_WINDOW_SECONDS = 60; // D-28-06 locked spec
const HAIKU_MAX_RETRIES = 2; // D-28-05 retry cap (mirrors Phase 29 pattern)
const CONFIDENCE_DEFAULT_EVASIVE_THRESHOLD = 0.7; // CONTEXT.md "default-evasive on low confidence"

const ADJUSTMENT_JUDGE_PROMPT =
  "You are classifying a user's reply to an adjustment-dialogue message about a recurring ritual. The ritual has been skipped too many times and the user was asked what should change. Classify the reply into exactly one category: 'change_requested' (user wants a specific change to the ritual config), 'no_change' (user says no change needed, or wants to keep going), or 'evasive' (user is vague, dismissive, or unclear). If change_requested, extract the proposed change field (one of: fire_at, fire_dow, skip_threshold, mute_until) and the new value. Output JSON: { classification: 'change_requested'|'no_change'|'evasive', proposed_change: { field, new_value } | null, confidence: number 0-1 }.";

// ── Zod schemas (v3+v4 dual — mirrors weekly-review.ts:131-186 pattern) ──────

/** v3 — runtime contract; used for re-validation after SDK parse. */
const AdjustmentClassificationSchema = z.object({
  classification: z.enum(['change_requested', 'no_change', 'evasive']),
  proposed_change: z.object({
    field: z.enum(['fire_at', 'fire_dow', 'skip_threshold', 'mute_until']),
    new_value: z.union([z.string(), z.number(), z.null()]),
  }).nullable(),
  confidence: z.number().min(0).max(1),
});

/** v4 — SDK boundary; no refine. Lock-step with v3. */
const AdjustmentClassificationSchemaV4 = zV4.object({
  classification: zV4.enum(['change_requested', 'no_change', 'evasive']),
  proposed_change: zV4.object({
    field: zV4.enum(['fire_at', 'fire_dow', 'skip_threshold', 'mute_until']),
    new_value: zV4.union([zV4.string(), zV4.number(), zV4.null()]),
  }).nullable(),
  confidence: zV4.number().min(0).max(1),
});

type AdjustmentClassification = z.infer<typeof AdjustmentClassificationSchema>;
type ProposedChange = NonNullable<AdjustmentClassification['proposed_change']>;

// ── Internal helper: Haiku 3-class classification ──────────────────────────

/**
 * classifyAdjustmentReply — Haiku structured-output classification.
 *
 * Retry-cap-2 loop mirroring weekly-review.ts:424-474 retry pattern.
 * On Zod parse failure or null parsed_output, retries. After 2 failures,
 * returns templated fallback: { classification: 'no_change', proposed_change: null,
 * confidence: 1.0, isFallback: true }.
 *
 * Security: proposed_change.field is z.enum(['fire_at', 'fire_dow',
 * 'skip_threshold', 'mute_until']) — Haiku CANNOT inject other field names
 * (T-28-02 mitigation). v4 schema is the SDK boundary gate; v3 re-validates
 * after parse to catch drift.
 */
async function classifyAdjustmentReply(
  text: string,
): Promise<AdjustmentClassification & { isFallback: boolean }> {
  for (let attempt = 0; attempt < HAIKU_MAX_RETRIES; attempt++) {
    try {
      const response = await anthropic.messages.parse({
        model: HAIKU_MODEL,
        max_tokens: 200,
        system: [{ type: 'text' as const, text: ADJUSTMENT_JUDGE_PROMPT }],
        messages: [{ role: 'user' as const, content: text }],
        output_config: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          format: zodOutputFormat(AdjustmentClassificationSchemaV4 as unknown as any),
        },
      });
      if (response.parsed_output === null || response.parsed_output === undefined) {
        throw new Error('Adjustment dialogue: parsed_output is null');
      }
      // v3 re-validate (runtime contract — catches v3 vs v4 drift)
      const parsed = AdjustmentClassificationSchema.parse(response.parsed_output);
      return { ...parsed, isFallback: false };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: errMsg, attempt }, 'chris.adjustment.classify.retry');
      // On last attempt failure: fall through to templated fallback below
    }
  }

  // Retry-cap-2 exhausted — templated fallback (CONTEXT.md D-28-05)
  logger.warn({ haiku_max_retries: HAIKU_MAX_RETRIES }, 'chris.adjustment.fallback_fired');
  return {
    classification: 'no_change' as const,
    proposed_change: null,
    confidence: 1.0,
    isFallback: true,
  };
}

// ── Export 1: fireAdjustmentDialogue ─────────────────────────────────────────

/**
 * fireAdjustmentDialogue — fire-side handler (SKIP-04).
 *
 * Called by scheduler.ts when shouldFireAdjustmentDialogue predicate hits.
 * Mirrors fireVoiceNote (voice-note.ts:289-365) in structure:
 *   1. Compose + send Telegram message
 *   2. Insert ritual_pending_responses with metadata.kind='adjustment_dialogue'
 *   3. Insert ritual_fire_events with outcome=IN_DIALOGUE
 *   4. Return 'in_dialogue' outcome
 *
 * @param ritual - The ritual row from runRitualSweep.
 * @returns 'in_dialogue' RitualFireOutcome.
 */
export async function fireAdjustmentDialogue(
  ritual: typeof rituals.$inferSelect,
): Promise<RitualFireOutcome> {
  const cadence = ritual.type === 'weekly' ? 'weekly' : 'daily';
  const messageText =
    `This ${cadence} ${ritual.name} ritual isn't working — what should change? ` +
    `Reply with what to change, or 'no change' / 'drop it' if you'd prefer to keep skipping or stop entirely.`;

  const chatId = BigInt(config.telegramAuthorizedUserId);

  // Send BEFORE inserting pending row — if Telegram fails, no stale binding
  // (mirrors voice-note.ts:340 sequencing)
  await bot.api.sendMessage(Number(chatId), messageText);

  const firedAt = new Date();
  const expiresAt = new Date(firedAt.getTime() + RESPONSE_WINDOW_HOURS * 3600 * 1000);

  const [inserted] = await db
    .insert(ritualPendingResponses)
    .values({
      ritualId: ritual.id,
      chatId,
      firedAt,
      expiresAt,
      promptText: messageText,
      metadata: {
        kind: 'adjustment_dialogue',
        cadence,
        ritualName: ritual.name,
      },
    })
    .returning({ id: ritualPendingResponses.id });

  const pendingResponseId = inserted?.id;

  // ritual_fire_events row with outcome = IN_DIALOGUE
  await db.insert(ritualFireEvents).values({
    ritualId: ritual.id,
    firedAt,
    outcome: RITUAL_OUTCOME.IN_DIALOGUE,
    metadata: { adjustmentDialogueId: pendingResponseId },
  });

  logger.info(
    { ritualId: ritual.id, skipCount: ritual.skipCount, pendingResponseId },
    'chris.adjustment.fired',
  );

  return RITUAL_OUTCOME.IN_DIALOGUE;
}

// ── Export 2: handleAdjustmentReply ──────────────────────────────────────────

/**
 * handleAdjustmentReply — reply-side handler (SKIP-04).
 *
 * Called by engine.ts PP#5 when pending.metadata.kind === 'adjustment_dialogue'.
 * Plan 28-03 ships the Haiku classification path; refusal pre-check is added
 * by Plan 28-04 BEFORE the Haiku call.
 *
 * Returns '' (IN-02 silent-skip — engine PP#5 short-circuits regardless).
 */
export async function handleAdjustmentReply(
  pending: typeof ritualPendingResponses.$inferSelect,
  chatId: number,
  text: string,
): Promise<string> {
  // STEP 1: Atomic-consume (mirrors voice-note.ts:184-204).
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
    });

  if (!consumed || !consumed.consumedAt) {
    throw new StorageError('ritual.adjustment.race_lost');
  }

  // STEP 2: Haiku 3-class classification with retry-cap-2 + templated fallback
  const classified = await classifyAdjustmentReply(text);

  // STEP 3: confidence-default-evasive — override on low confidence
  let { classification } = classified;
  if (!classified.isFallback && classified.confidence < CONFIDENCE_DEFAULT_EVASIVE_THRESHOLD) {
    classification = 'evasive';
  }

  // STEP 4: Branch on classification
  if (classification === 'change_requested' && classified.proposed_change) {
    // Queue confirmation: echo + insert adjustment_confirmation pending row
    await queueConfigPatchConfirmation(pending.ritualId, classified.proposed_change, chatId);
    logger.info(
      {
        ritualId: pending.ritualId,
        field: classified.proposed_change.field,
        newValue: classified.proposed_change.new_value,
      },
      'chris.adjustment.classified',
    );
  } else if (classification === 'no_change') {
    // Reset skip_count (user acknowledged the dialogue)
    await db
      .update(rituals)
      .set({ skipCount: 0 })
      .where(eq(rituals.id, pending.ritualId));

    // ritual_fire_events: outcome=RESPONDED
    await db.insert(ritualFireEvents).values({
      ritualId: pending.ritualId,
      firedAt: new Date(),
      outcome: RITUAL_OUTCOME.RESPONDED,
      metadata: { dialogueId: pending.id, classification: 'no_change', isFallback: classified.isFallback },
    });

    // ritual_responses row for longitudinal tracking
    await db.insert(ritualResponses).values({
      ritualId: pending.ritualId,
      firedAt: pending.firedAt,
      respondedAt: new Date(),
      promptText: pending.promptText,
      metadata: { kind: 'adjustment_dialogue_response', classification: 'no_change' },
    });

    logger.info({ ritualId: pending.ritualId }, 'chris.adjustment.classified.no_change');
  } else {
    // evasive (or change_requested with no proposed_change — conservative fallback)
    // Write ritual_responses row — Plan 28-04's hasReachedEvasiveTrigger reads this
    await db.insert(ritualResponses).values({
      ritualId: pending.ritualId,
      firedAt: pending.firedAt,
      respondedAt: new Date(),
      promptText: pending.promptText,
      metadata: {
        kind: 'adjustment_dialogue_response',
        classification: 'evasive',
        greg_text: text,
      },
    });

    // Do NOT reset skip_count (the user did not engage)
    logger.info({ ritualId: pending.ritualId, confidence: classified.confidence }, 'chris.adjustment.classified.evasive');
  }

  return ''; // IN-02 silent-skip
}

// ── Export 3: handleConfirmationReply ──────────────────────────────────────

/**
 * handleConfirmationReply — yes/no/default-no handler (SKIP-05).
 *
 * Called by engine.ts PP#5 when pending.metadata.kind === 'adjustment_confirmation'.
 * Atomically consumes the pending row; applies or aborts the patch.
 *
 * Returns '' (IN-02 silent-skip).
 */
export async function handleConfirmationReply(
  pending: typeof ritualPendingResponses.$inferSelect,
  chatId: number,
  text: string,
): Promise<string> {
  // STEP 1: Atomic-consume
  const [consumed] = await db
    .update(ritualPendingResponses)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(ritualPendingResponses.id, pending.id),
        isNull(ritualPendingResponses.consumedAt),
      ),
    )
    .returning({ id: ritualPendingResponses.id });

  if (!consumed) {
    // Race lost — sweep or another PP#5 instance consumed first
    logger.info({ pendingId: pending.id }, 'chris.adjustment.confirmation_reply.race_lost');
    return '';
  }

  // STEP 2: Parse yes/no
  const normalized = text.trim().toLowerCase();
  const isYes = /^(yes|y|ok|confirm|apply|yeah|yep|sure|oui|da)$/i.test(normalized);

  // STEP 3: Read proposed_change from metadata
  const metadata = pending.metadata as {
    kind?: string;
    proposed_change?: ProposedChange;
  } | null;
  const proposedChange = metadata?.proposed_change;

  if (!proposedChange) {
    logger.warn({ pendingId: pending.id }, 'chris.adjustment.confirmation_reply.missing_proposed_change');
    return '';
  }

  // STEP 4: Apply or abort
  if (isYes) {
    await confirmConfigPatch(pending.ritualId, proposedChange, 'user');
    await bot.api.sendMessage(chatId, `Applied: ${proposedChange.field} = ${proposedChange.new_value}`);
    logger.info(
      { ritualId: pending.ritualId, field: proposedChange.field, actor: 'user' },
      'chris.adjustment.applied',
    );
  } else {
    // No (or anything else) — abort
    await db.insert(ritualConfigEvents).values({
      ritualId: pending.ritualId,
      actor: 'user',
      patch: {
        kind: 'abort',
        field: proposedChange.field,
        source: 'user_explicit_no',
      },
    });
    await bot.api.sendMessage(chatId, `OK, keeping current config`);
    logger.info(
      { ritualId: pending.ritualId, field: proposedChange.field },
      'chris.adjustment.aborted',
    );
  }

  return '';
}

// ── Export 4: confirmConfigPatch ─────────────────────────────────────────────

/**
 * confirmConfigPatch — apply a proposed config patch to rituals.config.
 *
 * Per RESEARCH Landmine 1: writes use the discriminated envelope inside
 * patch jsonb — { kind: 'apply', field, old_value, new_value, source }.
 *
 * Uses jsonb_set for atomic config mutation. Reads old_value before update
 * for audit trail. actor is varchar(32) — must be ≤32 chars.
 */
export async function confirmConfigPatch(
  ritualId: string,
  proposedChange: ProposedChange,
  actor: 'user' | 'auto_apply_on_timeout' | 'system',
): Promise<void> {
  // STEP 1: Read current config to capture old_value
  const [ritual] = await db.select().from(rituals).where(eq(rituals.id, ritualId));
  if (!ritual) {
    logger.warn({ ritualId }, 'chris.adjustment.config_patch.ritual_not_found');
    return;
  }

  const cfg = ritual.config as Record<string, unknown>;
  const oldValue = cfg[proposedChange.field];
  const newValue = proposedChange.new_value;

  // STEP 2: Apply via jsonb_set
  // postgres-js String() cast workaround per wellbeing.ts:148-150 JSDoc
  await db
    .update(rituals)
    .set({
      config: sql`jsonb_set(${rituals.config}, ${sql.raw(`'{${proposedChange.field}}'`)}, ${String(JSON.stringify(newValue))}::jsonb, true)`,
    })
    .where(eq(rituals.id, ritualId));

  // STEP 3: INSERT ritual_config_events (discriminated envelope per Landmine 1)
  await db.insert(ritualConfigEvents).values({
    ritualId,
    actor,
    patch: {
      kind: 'apply',
      field: proposedChange.field,
      old_value: oldValue,
      new_value: newValue,
      source: actor === 'auto_apply_on_timeout' ? 'sweep' : 'reply',
    },
  });

  logger.info(
    {
      ritualId,
      field: proposedChange.field,
      oldValue,
      newValue,
      actor,
    },
    'chris.adjustment.config_patched',
  );
}

// ── Export 5: ritualConfirmationSweep ────────────────────────────────────────

/**
 * ritualConfirmationSweep — 1-minute cron sweep helper (D-28-06, SKIP-05).
 *
 * NARROW helper per RESEARCH Landmine 5 — NOT runRitualSweep. ONLY scans for
 * expired adjustment_confirmation pending rows. Sub-millisecond on hot path
 * when nothing pending (uses partial index
 * ritual_pending_responses_adjustment_confirmation_idx).
 *
 * Atomic-consume race-safety: mirrors voice-note.ts:184-204. Both this sweep
 * and engine.ts PP#5 handleConfirmationReply use the consumed_at IS NULL guard
 * — whichever consumes first wins; the other returns silently (T-28-03
 * mitigation).
 *
 * @param now - Current timestamp for testability (defaults to new Date()).
 * @returns Number of rows processed (0 on hot path when nothing pending).
 */
export async function ritualConfirmationSweep(now: Date = new Date()): Promise<number> {
  // STEP 1: SELECT expired adjustment_confirmation rows (LIMIT 10 — T-28-D3 DoS cap)
  const expired = await db
    .select()
    .from(ritualPendingResponses)
    .where(
      and(
        isNull(ritualPendingResponses.consumedAt),
        sql`${ritualPendingResponses.expiresAt} <= ${now.toISOString()}`,
        sql`${ritualPendingResponses.metadata}->>'kind' = 'adjustment_confirmation'`,
      ),
    )
    .limit(10);

  if (expired.length === 0) {
    return 0; // hot path — sub-millisecond when nothing pending
  }

  let processedCount = 0;

  for (const row of expired) {
    // STEP 2: Atomic-consume per row
    const [consumed] = await db
      .update(ritualPendingResponses)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(ritualPendingResponses.id, row.id),
          isNull(ritualPendingResponses.consumedAt),
        ),
      )
      .returning({ id: ritualPendingResponses.id });

    if (!consumed) {
      // Race lost — peer (PP#5 handleConfirmationReply) consumed first
      continue;
    }

    // STEP 3: Read proposed_change from metadata
    const metadata = row.metadata as {
      kind?: string;
      proposed_change?: ProposedChange;
    } | null;
    const proposedChange = metadata?.proposed_change;

    if (!proposedChange) {
      logger.warn({ pendingId: row.id }, 'chris.adjustment.sweep.missing_proposed_change');
      continue;
    }

    // STEP 4: Apply patch with actor='auto_apply_on_timeout'
    await confirmConfigPatch(row.ritualId, proposedChange, 'auto_apply_on_timeout');

    // STEP 5: ritual_fire_events RESPONDED — user implicitly responded by not replying (D-28-06)
    await db.insert(ritualFireEvents).values({
      ritualId: row.ritualId,
      firedAt: new Date(),
      outcome: RITUAL_OUTCOME.RESPONDED,
      metadata: { confirmationId: row.id, source: 'auto_apply_on_timeout' },
    });

    // STEP 6: Reset skip_count = 0 (per D-28-03 — adjustment-completion is a reset event)
    await db
      .update(rituals)
      .set({ skipCount: 0 })
      .where(eq(rituals.id, row.ritualId));

    processedCount++;
  }

  logger.info(
    { processedCount, scanned: expired.length },
    'chris.adjustment.confirmation_sweep.done',
  );

  return processedCount;
}

// ── Internal helper: queue confirmation ───────────────────────────────────────

/**
 * queueConfigPatchConfirmation — insert adjustment_confirmation pending row
 * + send Telegram echo.
 *
 * Expires at firedAt + 60s (D-28-06 locked spec).
 */
async function queueConfigPatchConfirmation(
  ritualId: string,
  proposedChange: ProposedChange,
  chatId: number,
): Promise<void> {
  const firedAt = new Date();
  const expiresAt = new Date(firedAt.getTime() + CONFIRMATION_WINDOW_SECONDS * 1000);

  // Send confirmation echo before inserting pending row (mirrors voice-note sequencing)
  await bot.api.sendMessage(
    chatId,
    `Change ${proposedChange.field} to ${proposedChange.new_value} — OK? (auto-applies in 60s if no reply)`,
  );

  await db.insert(ritualPendingResponses).values({
    ritualId,
    chatId: BigInt(chatId),
    firedAt,
    expiresAt,
    promptText: `Confirm: ${proposedChange.field} → ${proposedChange.new_value}?`,
    metadata: {
      kind: 'adjustment_confirmation',
      proposed_change: proposedChange,
    },
  });
}
