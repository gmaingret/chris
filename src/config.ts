import 'dotenv/config';

const required = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

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

  // Google OAuth (optional — required only for Gmail sync)
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback',

  // Immich (optional — required only for photo sync)
  immichApiUrl: process.env.IMMICH_API_URL || '',
  immichApiKey: process.env.IMMICH_API_KEY || '',

  // Background sync scheduler
  syncIntervalCron: process.env.SYNC_INTERVAL_CRON || '0 */6 * * *',
  syncEnabled: process.env.SYNC_ENABLED !== 'false',

  // Proactive messaging
  proactiveSweepCron: process.env.PROACTIVE_SWEEP_CRON || '0 10 * * *',
  proactiveTimezone: process.env.PROACTIVE_TIMEZONE || 'Europe/Paris',
  proactiveSilenceThresholdMultiplier: parseFloat(process.env.PROACTIVE_SILENCE_THRESHOLD_MULTIPLIER || '2'),
  proactiveSilenceBaselineDays: parseInt(process.env.PROACTIVE_SILENCE_BASELINE_DAYS || '14', 10),
  proactiveCommitmentStaleDays: parseInt(process.env.PROACTIVE_COMMITMENT_STALE_DAYS || '7', 10),
  proactiveSweepContextMaxTokens: parseInt(process.env.PROACTIVE_SWEEP_CONTEXT_MAX_TOKENS || '10000', 10),
} as const;
