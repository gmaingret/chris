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

  // Ritual sweep (M009 Phase 25 RIT-12) — second cron tick at 21:00 Paris
  // peer to the proactive sweep above. D-03 cron.validate fail-fast.
  ritualSweepCron: validatedCron('RITUAL_SWEEP_CRON', '0 21 * * *'),

  // Episodic consolidation (M008 Phase 20)
  // EPI-04: Episodic consolidation cron — fires at 23:00 in config.proactiveTimezone by default.
  episodicCron: validatedCron('EPISODIC_CRON', '0 23 * * *'),
} as const;
