/**
 * Proactive sweep orchestrator — dual-channel architecture.
 *
 * Two independent channels run on each sweep tick:
 *
 * ACCOUNTABILITY CHANNEL (fires first per D-05):
 *   deadline trigger → AWAITING_RESOLUTION row → ACCOUNTABILITY_SYSTEM_PROMPT → Telegram
 *   Independent daily cap: hasSentTodayAccountability / setLastSentAccountability
 *
 * REFLECTIVE CHANNEL (independent per D-05):
 *   Phase 1 (SQL): silence (priority 1) + commitment (priority 3) — cheap, parallel
 *   Phase 2 (Opus): pattern (priority 4) + thread (priority 5) — expensive, only if Phase 1 empty
 *   Winner selected by priority. Uses PROACTIVE_SYSTEM_PROMPT.
 *   Independent daily cap: hasSentTodayReflective / setLastSentReflective
 *
 * Global mute gates BOTH channels.
 * Error in accountability channel does NOT block reflective channel.
 *
 * Observability: Structured Pino logs at every phase —
 * proactive.sweep.start, .skipped, .opus_skipped, .trigger, .sent,
 * .error, .opus_phase_error, .accountability.sent, .accountability.error
 */

import { bot } from '../bot/bot.js';
import { config } from '../config.js';
import { anthropic, SONNET_MODEL } from '../llm/client.js';
import { saveMessage } from '../memory/conversation.js';
import { logger } from '../utils/logger.js';
import {
  isMuted,
  hasSentTodayReflective,
  setLastSentReflective,
  hasSentTodayAccountability,
  setLastSentAccountability,
} from './state.js';
import { PROACTIVE_SYSTEM_PROMPT, ACCOUNTABILITY_SYSTEM_PROMPT } from './prompts.js';
import { createSilenceTrigger } from './triggers/silence.js';
import { createCommitmentTrigger } from './triggers/commitment.js';
import { createDeadlineTrigger } from './triggers/deadline.js';
import { buildSweepContext } from './context-builder.js';
import { runOpusAnalysis } from './triggers/opus-analysis.js';
import { createPatternTrigger } from './triggers/pattern.js';
import { createThreadTrigger } from './triggers/thread.js';
import { upsertAwaitingResolution } from '../decisions/capture-state.js';
import { getLastUserLanguage } from '../chris/language.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ChannelResult {
  triggered: boolean;
  triggerType?: string;
  message?: string;
}

export interface SweepResult {
  triggered: boolean;
  triggerType?: string;  // backward compat: accountability's type if fired, else reflective's
  message?: string;      // backward compat: accountability's message if fired, else reflective's
  skippedReason?: 'muted' | 'already_sent_today' | 'no_trigger' | 'insufficient_data';
  accountabilityResult?: ChannelResult;
  reflectiveResult?: ChannelResult;
}

// ── Sweep ──────────────────────────────────────────────────────────────────

export async function runSweep(): Promise<SweepResult> {
  const startMs = Date.now();
  logger.info({ timestamp: new Date().toISOString() }, 'proactive.sweep.start');

  try {
    // 1. Global mute gate — gates both channels
    if (await isMuted()) {
      logger.info({ skippedReason: 'muted' }, 'proactive.sweep.skipped');
      return { triggered: false, skippedReason: 'muted' };
    }

    let accountabilityResult: ChannelResult | undefined;
    let reflectiveResult: ChannelResult | undefined;
    let reflectiveSkippedReason: 'insufficient_data' | 'no_trigger' | undefined;

    // ── ACCOUNTABILITY CHANNEL (fires first per D-05) ──────────────────────

    if (!(await hasSentTodayAccountability(config.proactiveTimezone))) {
      try {
        const deadlineTrigger = createDeadlineTrigger();
        const deadlineResult = await deadlineTrigger.detect();

        if (deadlineResult.triggered) {
          const systemPrompt = ACCOUNTABILITY_SYSTEM_PROMPT.replace(
            '{triggerContext}',
            deadlineResult.context,
          );

          const response = await anthropic.messages.create({
            model: SONNET_MODEL,
            max_tokens: 256,
            system: [
              {
                type: 'text',
                text: systemPrompt,
                cache_control: { type: 'ephemeral' },
              },
            ],
            messages: [
              {
                role: 'user',
                content: deadlineResult.context,
              },
            ],
          });

          const firstBlock = response.content[0];
          const messageText = firstBlock?.type === 'text' ? firstBlock.text : '';

          if (!messageText) {
            logger.error({ response }, 'proactive.sweep.accountability.error');
          } else {
            // Extract decision ID from evidence (format: 'Decision ID: <uuid>')
            const decisionId = deadlineResult.evidence![0]!.replace('Decision ID: ', '');

            // Write AWAITING_RESOLUTION row BEFORE sending the message
            await upsertAwaitingResolution(BigInt(config.telegramAuthorizedUserId), decisionId);

            // Send via Telegram
            await bot.api.sendMessage(config.telegramAuthorizedUserId, messageText);

            // Save to conversation history
            await saveMessage(
              BigInt(config.telegramAuthorizedUserId),
              'ASSISTANT',
              messageText,
              'JOURNAL',
            );

            // Update accountability cap
            await setLastSentAccountability(new Date());

            const latencyMs = Date.now() - startMs;
            logger.info(
              { triggerType: 'decision-deadline', latencyMs, messageLength: messageText.length },
              'proactive.sweep.accountability.sent',
            );

            accountabilityResult = {
              triggered: true,
              triggerType: 'decision-deadline',
              message: messageText,
            };
          }
        }
      } catch (err) {
        // Error in accountability channel does NOT block reflective channel
        logger.error({ err }, 'proactive.sweep.accountability.error');
      }
    }

    // ── REFLECTIVE CHANNEL (independent per D-05) ──────────────────────────

    if (!(await hasSentTodayReflective(config.proactiveTimezone))) {
      // Phase 1 — SQL-only triggers (silence + commitment) in parallel
      const sqlTriggers = [
        createSilenceTrigger(BigInt(config.telegramAuthorizedUserId), {
          thresholdMultiplier: config.proactiveSilenceThresholdMultiplier,
          baselineDays: config.proactiveSilenceBaselineDays,
        }),
        createCommitmentTrigger(config.proactiveCommitmentStaleDays),
      ];

      const sqlResults = await Promise.all(sqlTriggers.map((t) => t.detect()));
      const fired = sqlResults.filter((r) => r.triggered);

      if (fired.length > 0) {
        // SQL trigger fired — short-circuit, skip Opus phase
        logger.info(
          { sqlTriggersFound: fired.length },
          'proactive.sweep.opus_skipped',
        );
        reflectiveResult = await runReflectiveChannel(fired, startMs);
      } else {
        // Phase 2 — Opus triggers (pattern + thread), only if no SQL trigger fired
        const hasInsufficientData = sqlResults.some((r) =>
          r.context.includes('Insufficient'),
        );

        try {
          const sweepContext = await buildSweepContext(config.proactiveSweepContextMaxTokens);
          const analysis = await runOpusAnalysis(sweepContext);
          const opusTriggers = [
            createPatternTrigger(analysis),
            createThreadTrigger(analysis),
          ];
          const opusResults = await Promise.all(opusTriggers.map((t) => t.detect()));
          const opusFired = opusResults.filter((r) => r.triggered);
          fired.push(...opusFired);
        } catch (err) {
          logger.error({ err }, 'proactive.sweep.opus_phase_error');
          // Fall through — fired stays empty, treated as no_trigger
        }

        if (fired.length > 0) {
          reflectiveResult = await runReflectiveChannel(fired, startMs);
        } else {
          reflectiveSkippedReason = hasInsufficientData
            ? ('insufficient_data' as const)
            : ('no_trigger' as const);
          logger.info(
            { skippedReason: reflectiveSkippedReason, triggers: sqlResults.map((r) => ({ type: r.triggerType, context: r.context })) },
            'proactive.sweep.skipped',
          );
          // Reflective channel has nothing to fire; fall through to result assembly
        }
      }
    }

    // ── Result assembly ────────────────────────────────────────────────────

    const triggered = !!(accountabilityResult?.triggered || reflectiveResult?.triggered);
    // skippedReason is returned by the caller of runSweep; the reflective channel
    // may set a more descriptive reason (insufficient_data). We surface it here.
    const skippedReason: SweepResult['skippedReason'] = triggered
      ? undefined
      : reflectiveSkippedReason ?? 'no_trigger';

    return {
      triggered,
      triggerType: accountabilityResult?.triggerType ?? reflectiveResult?.triggerType,
      message: accountabilityResult?.message ?? reflectiveResult?.message,
      skippedReason,
      accountabilityResult,
      reflectiveResult,
    };
  } catch (err) {
    logger.error({ err, latencyMs: Date.now() - startMs }, 'proactive.sweep.error');
    throw err;
  }
}

// ── Reflective channel helper ──────────────────────────────────────────────

async function runReflectiveChannel(
  fired: Array<{ triggered: boolean; triggerType: string; priority: number; context: string; evidence?: string[] }>,
  startMs: number,
): Promise<ChannelResult> {
  // Select winner by priority (lowest number = highest priority)
  fired.sort((a, b) => a.priority - b.priority);
  const winner = fired[0]!;

  logger.info(
    {
      triggerType: winner.triggerType,
      evidence: winner.evidence,
      firedCount: fired.length,
      allFired: fired.map((r) => r.triggerType),
    },
    'proactive.sweep.trigger',
  );

  // Generate message via Sonnet using PROACTIVE_SYSTEM_PROMPT
  const systemPrompt = PROACTIVE_SYSTEM_PROMPT.replace(
    '{triggerContext}',
    winner.context,
  );

  const response = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: 256,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: winner.context,
      },
    ],
  });

  const firstBlock = response.content[0];
  const messageText = firstBlock?.type === 'text' ? firstBlock.text : '';

  if (!messageText) {
    logger.error({ response }, 'proactive.sweep.error');
    return { triggered: false };
  }

  // Send via Telegram
  await bot.api.sendMessage(config.telegramAuthorizedUserId, messageText);

  // Save to conversation history as ASSISTANT message
  await saveMessage(
    BigInt(config.telegramAuthorizedUserId),
    'ASSISTANT',
    messageText,
    'JOURNAL',
  );

  // Update reflective cap (after successful send)
  await setLastSentReflective(new Date());

  const latencyMs = Date.now() - startMs;
  logger.info(
    { triggerType: winner.triggerType, latencyMs, messageLength: messageText.length },
    'proactive.sweep.sent',
  );

  return { triggered: true, triggerType: winner.triggerType, message: messageText };
}
