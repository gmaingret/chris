import 'dotenv/config';
import { validate } from 'node-cron';

const required = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

/**
 * validatedCron — D-03 fail-fast: validate cron expression at module load.
 *
 * Throws if the expression is invalid; container restart-loops until env
 * fixed. Mirrors the existing `required(key)` helper pattern (throws on
 * missing). A silently-broken cron expression means rituals never fire — the
 * symptom is "Greg notices the bot didn't message him for several days",
 * which is exactly the trust-breaking failure mode this milestone is built
 * to prevent.
 */
function validatedCron(envKey: string, fallback: string): string {
  const expr = process.env[envKey] || fallback;
  if (!validate(expr)) {
    throw new Error(`config: invalid ${envKey} expression "${expr}"`);
  }
  return expr;
}

export const config = {
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  telegramBotToken: required('TELEGRAM_BOT_TOKEN'),
  telegramAuthorizedUserId: parseInt(required('TELEGRAM_AUTHORIZED_USER_ID'), 10),
  databaseUrl: required('DATABASE_URL'),
  embeddingModel: process.env.EMBEDDING_MODEL || 'Xenova/bge-m3',
  embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1024', 10),
  webhookUrl: process.env.WEBHOOK_URL || '',
  maxContextTokens: parseInt(process.env.MAX_CONTEXT_TOKENS || '80000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',

  // Model IDs — override via env vars when Anthropic retires/updates models
  haikuModel: process.env.HAIKU_MODEL || 'claude-haiku-4-5-20251001',
  sonnetModel: process.env.SONNET_MODEL || 'claude-sonnet-4-6',
  opusModel: process.env.OPUS_MODEL || 'claude-opus-4-6',

  // Google OAuth (optional — required only for Gmail sync)
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback',

  // Immich (optional — required only for photo sync)
  immichApiUrl: process.env.IMMICH_API_URL || '',
  immichApiKey: process.env.IMMICH_API_KEY || '',

  // Background sync scheduler — D-03 cron.validate fail-fast at config load
  syncIntervalCron: validatedCron('SYNC_INTERVAL_CRON', '0 */6 * * *'),
  syncEnabled: process.env.SYNC_ENABLED !== 'false',

  // Proactive messaging — D-03 cron.validate fail-fast at config load
  proactiveSweepCron: validatedCron('PROACTIVE_SWEEP_CRON', '0 10 * * *'),
  proactiveTimezone: process.env.PROACTIVE_TIMEZONE || 'Europe/Paris',
  proactiveSilenceThresholdMultiplier: parseFloat(process.env.PROACTIVE_SILENCE_THRESHOLD_MULTIPLIER || '3'),
  proactiveSilenceBaselineDays: parseInt(process.env.PROACTIVE_SILENCE_BASELINE_DAYS || '14', 10),
  proactiveCommitmentStaleDays: parseInt(process.env.PROACTIVE_COMMITMENT_STALE_DAYS || '7', 10),
  proactiveSweepContextMaxTokens: parseInt(process.env.PROACTIVE_SWEEP_CONTEXT_MAX_TOKENS || '10000', 10),

  // Ritual sweep (M009 Phase 25 RIT-12, revised post-deploy 2026-05-05).
  // Was '0 21 * * *' (Phase-25-era assumption that all rituals fire at 21:00).
  // M009 ships rituals at multiple fire times: daily_wellbeing 09:00,
  // weekly_review Sun 20:00, daily_journal 21:00. A single 21:00 cron
  // only catches 21:00 rituals on time; others fire late. Per-minute
  // cadence catches all fire_at times within ≤60s of the intended moment.
  // Cost: cheap WHERE next_run_at <= now() AND enabled query against ~3
  // rows once/min. Mirrors Phase 28's ritualConfirmationSweep cadence.
  ritualSweepCron: validatedCron('RITUAL_SWEEP_CRON', '* * * * *'),

  // Episodic consolidation (M008 Phase 20)
  // EPI-04: Episodic consolidation cron — fires at 23:00 in config.proactiveTimezone by default.
  episodicCron: validatedCron('EPISODIC_CRON', '0 23 * * *'),

  // M010 Phase 34 GEN-01 — operational profile updater cron.
  // Default '0 22 * * 0' = Sunday 22:00 in config.proactiveTimezone.
  // 2h gap after weekly_review (Sunday 20:00) to avoid M010-04 timing
  // collisions — both rituals read the same Pensieve substrate but the
  // weekly review's `runConsolidate` writes do not need to settle before
  // the profile updater fires; the 2h buffer is a conservative belt.
  // D-25 fail-fast: invalid PROFILE_UPDATER_CRON throws at module load
  // (silent-bad-cron M008 EPI-04 incident class).
  profileUpdaterCron: validatedCron('PROFILE_UPDATER_CRON', '0 22 * * 0'),

  // M011 Phase 38 PGEN-05 — psychological profile updater cron.
  // Default '0 9 1 * *' = 1st of month at 09:00 in config.proactiveTimezone.
  // UNCONDITIONAL fire per PGEN-06 (inverse of M010 GEN-07 hash-skip
  // idempotency). substrate_hash recorded for audit-trail / forensic-replay
  // only — NOT used for short-circuit.
  // D-28 fail-fast: invalid PSYCHOLOGICAL_PROFILE_UPDATER_CRON throws at
  // module load (silent-bad-cron M008 EPI-04 incident class).
  psychologicalProfileUpdaterCron: validatedCron('PSYCHOLOGICAL_PROFILE_UPDATER_CRON', '0 9 1 * *'),
} as const;
