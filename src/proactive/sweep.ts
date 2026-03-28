/**
 * Proactive sweep orchestrator.
 *
 * Runs the full proactive messaging pipeline:
 * mute check → daily cap check → two-phase trigger detection → LLM generation → Telegram delivery → state update.
 *
 * Phase 1 (SQL triggers): silence (priority 1) + commitment (priority 2) — cheap, parallel.
 * Phase 2 (Opus triggers): pattern (priority 3) + thread (priority 4) — expensive, only if Phase 1 has no hits.
 * Winner is selected by priority (lowest = highest priority).
 *
 * Designed to be called from a cron scheduler. All state is in PostgreSQL,
 * so the daily cap survives container restarts.
 *
 * Observability: Structured Pino logs at every phase —
 * proactive.sweep.start, .skipped, .opus_skipped, .trigger, .sent, .error, .opus_phase_error
 */

import { bot } from '../bot/bot.js';
import { config } from '../config.js';
import { anthropic, SONNET_MODEL } from '../llm/client.js';
import { saveMessage } from '../memory/conversation.js';
import { logger } from '../utils/logger.js';
import { isMuted, hasSentToday, setLastSent } from './state.js';
import { PROACTIVE_SYSTEM_PROMPT } from './prompts.js';
import { createSilenceTrigger } from './triggers/silence.js';
import { createCommitmentTrigger } from './triggers/commitment.js';
import { buildSweepContext } from './context-builder.js';
import { runOpusAnalysis } from './triggers/opus-analysis.js';
import { createPatternTrigger } from './triggers/pattern.js';
import { createThreadTrigger } from './triggers/thread.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SweepResult {
  triggered: boolean;
  triggerType?: string;
  message?: string;
  skippedReason?: 'muted' | 'already_sent_today' | 'no_trigger' | 'insufficient_data';
}

// ── Sweep ──────────────────────────────────────────────────────────────────

export async function runSweep(): Promise<SweepResult> {
  const startMs = Date.now();
  logger.info({ timestamp: new Date().toISOString() }, 'proactive.sweep.start');

  try {
    // 1. Check mute state
    if (await isMuted()) {
      logger.info({ skippedReason: 'muted' }, 'proactive.sweep.skipped');
      return { triggered: false, skippedReason: 'muted' };
    }

    // 2. Check daily cap (timezone-aware)
    if (await hasSentToday(config.proactiveTimezone)) {
      logger.info({ skippedReason: 'already_sent_today' }, 'proactive.sweep.skipped');
      return { triggered: false, skippedReason: 'already_sent_today' };
    }

    // 3. Phase 1 — SQL-only triggers (silence + commitment) in parallel
    const sqlTriggers = [
      createSilenceTrigger(BigInt(config.telegramAuthorizedUserId), {
        thresholdMultiplier: config.proactiveSilenceThresholdMultiplier,
        baselineDays: config.proactiveSilenceBaselineDays,
      }),
      createCommitmentTrigger(config.proactiveCommitmentStaleDays),
    ];

    const sqlResults = await Promise.all(sqlTriggers.map((t) => t.detect()));
    const fired = sqlResults.filter((r) => r.triggered);

    // 4. Phase 2 — Opus triggers (pattern + thread), only if no SQL trigger fired
    if (fired.length === 0) {
      // Check for insufficient data before attempting Opus phase
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

      if (fired.length === 0) {
        const skippedReason = hasInsufficientData
          ? ('insufficient_data' as const)
          : ('no_trigger' as const);
        logger.info(
          { skippedReason, triggers: sqlResults.map((r) => ({ type: r.triggerType, context: r.context })) },
          'proactive.sweep.skipped',
        );
        return { triggered: false, skippedReason };
      }
    } else {
      // SQL trigger fired — short-circuit, skip Opus phase
      logger.info(
        { sqlTriggersFound: fired.length },
        'proactive.sweep.opus_skipped',
      );
    }

    // 5. Select winner by priority (lowest number = highest priority)
    fired.sort((a, b) => a.priority - b.priority);
    const winner = fired[0];

    logger.info(
      {
        triggerType: winner.triggerType,
        evidence: winner.evidence,
        firedCount: fired.length,
        allFired: fired.map((r) => r.triggerType),
      },
      'proactive.sweep.trigger',
    );

    // 5. Generate message via Sonnet
    const systemPrompt = PROACTIVE_SYSTEM_PROMPT.replace(
      '{triggerContext}',
      winner.context,
    );

    const response = await anthropic.messages.create({
      cache_control: { type: 'ephemeral' },
      model: SONNET_MODEL,
      max_tokens: 256,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: winner.context,
        },
      ],
    });

    const messageText =
      response.content[0].type === 'text'
        ? response.content[0].text
        : '';

    if (!messageText) {
      logger.error({ response }, 'proactive.sweep.error');
      return { triggered: false, skippedReason: 'no_trigger' };
    }

    // 6. Send via Telegram
    await bot.api.sendMessage(config.telegramAuthorizedUserId, messageText);

    // 7. Save to conversation history as ASSISTANT message
    await saveMessage(
      BigInt(config.telegramAuthorizedUserId),
      'ASSISTANT',
      messageText,
      'JOURNAL',
    );

    // 8. Update last_sent state (after successful send, not before)
    await setLastSent(new Date());

    const latencyMs = Date.now() - startMs;
    logger.info(
      { triggerType: winner.triggerType, latencyMs, messageLength: messageText.length },
      'proactive.sweep.sent',
    );

    return { triggered: true, triggerType: winner.triggerType, message: messageText };
  } catch (err) {
    logger.error({ err, latencyMs: Date.now() - startMs }, 'proactive.sweep.error');
    throw err;
  }
}
