/**
 * src/bot/handlers/ritual-callback.ts — Phase 27 Plan 01 (WELL-02 partial)
 *
 * First inline-keyboard callback dispatcher in the Chris codebase. Verified
 * via grep at kickoff — zero existing callback_query/InlineKeyboard usage in
 * src/. This module owns the prefix-routing for ritual callback_data.
 *
 * Prefix scheme (forward-compat for Phases 28 + 29):
 *   r:w:*    — wellbeing snapshot taps (Phase 27)
 *   r:adj:*  — Phase 28 adjustment dialogue confirmations
 *   r:wr:*   — Phase 29 weekly review confirmations
 *
 * Telegram contract: every callback_query MUST be acknowledged via
 * ctx.answerCallbackQuery() within 30 seconds, otherwise the loading
 * spinner hangs on the user's button. This dispatcher always acks — even
 * for unknown prefixes (silent ack with a warn log).
 *
 * Auth: bot.use(auth) in src/bot/bot.ts runs for ALL update types (verified
 * src/bot/middleware/auth.ts), so single-user gate is preserved without
 * additional checks here. (D-27-09: server-side dim ∈ {e,m,a} + value ∈ [1,5]
 * validation lives in Plan 27-02's parseCallbackData, not in the dispatcher.)
 */
import type { Context } from 'grammy';
import { handleWellbeingCallback } from '../../rituals/wellbeing.js';
import { logger } from '../../utils/logger.js';

// ── Prefix constants ───────────────────────────────────────────────────────

const RITUAL_CALLBACK_PREFIX = 'r:';
const WELLBEING_CALLBACK_PREFIX = 'r:w:';
// Future Phase 28 prefix: 'r:adj:'
// Future Phase 29 prefix: 'r:wr:'

// ── Dispatcher ─────────────────────────────────────────────────────────────

/**
 * handleRitualCallback — entry point for `bot.on('callback_query:data')`.
 *
 * Always invokes ctx.answerCallbackQuery() exactly once per call (or delegates
 * to a handler that owns its own ack) to satisfy Telegram's 30-second contract.
 * Errors thrown by delegate handlers bubble up to bot.catch in src/bot/bot.ts.
 */
export async function handleRitualCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;

  if (!data) {
    logger.warn({}, 'rituals.callback.missing_data');
    await ctx.answerCallbackQuery();
    return;
  }

  if (data.startsWith(WELLBEING_CALLBACK_PREFIX)) {
    // Plan 27-02 implements this handler. Delegate WITHOUT acking — the
    // handler is responsible for its own ack so it can surface a custom
    // message like "Logged: energy 3" if desired.
    await handleWellbeingCallback(ctx, data);
    return;
  }

  if (data.startsWith(RITUAL_CALLBACK_PREFIX)) {
    // Known root prefix but unknown ritual prefix — Phase 28 (r:adj:*) or
    // Phase 29 (r:wr:*) callback arriving before its handler ships, OR a
    // stale button from a deleted message. Silent ack + warn.
    logger.warn({ data }, 'rituals.callback.unknown_ritual_prefix');
    await ctx.answerCallbackQuery();
    return;
  }

  // Completely unknown callback prefix. Silent ack + warn (no throw — keeps
  // chat UX clean even if a stale unrelated button surfaces).
  logger.warn({ data }, 'rituals.callback.unknown_root_prefix');
  await ctx.answerCallbackQuery();
}
